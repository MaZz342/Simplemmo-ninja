// logic/travel.js — Travel driver + gather popup + close X + cooldown + adaptive delays

const { checkCaptcha } = require('./captcha');
const { humanDelay } = require('./human-delay');

// mini-state
let lastOpenAt = 0;
let awaitingPopupUntil = 0;
let resourceCooldownUntil = 0;
const seenLootKeys = new Set();

async function safeGoto(page, url, socket) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return true;
  } catch (e) {
    socket?.emit('bot-log', `⚠️ goto failed (${url}): ${e.message}`);
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function closePopupByX(page, socket) {
  const clicked = await page.evaluate(() => {
    const X_PATH_D = 'M6 18 18 6M6 6l12 12';

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return el.offsetParent !== null && style.pointerEvents !== 'none' && style.visibility !== 'hidden';
    };

    const isClickable = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'a') return true;
      if (el.getAttribute && el.getAttribute('role') === 'button') return true;
      if (el.onclick) return true;
      if (el.getAttribute) {
        if (el.getAttribute('x-on:click')) return true;
        if (el.getAttribute('@click')) return true;
      }
      return false;
    };

    const clickHard = (el) => {
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try { el.click(); } catch {}

      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const evInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      try { el.dispatchEvent(new MouseEvent('mousedown', evInit)); } catch {}
      try { el.dispatchEvent(new MouseEvent('mouseup', evInit)); } catch {}
      try { el.dispatchEvent(new MouseEvent('click', evInit)); } catch {}
    };

    const paths = Array.from(document.querySelectorAll(`svg path[d="${X_PATH_D}"]`));
    if (paths.length === 0) return { ok: false };

    for (const p of paths) {
      let candidate =
        p.closest('button') ||
        p.closest('a') ||
        p.closest('[role="button"]');

      if (!candidate) {
        let cur = p.parentElement;
        let steps = 0;
        while (cur && steps < 10) {
          if (isClickable(cur)) { candidate = cur; break; }
          cur = cur.parentElement;
          steps++;
        }
      }

      if (!candidate) continue;
      if (!isVisible(candidate)) continue;

      clickHard(candidate);
      return { ok: true, tag: candidate.tagName };
    }

    return { ok: false };
  }).catch(() => ({ ok: false }));

  if (clicked && clicked.ok) {
    socket.emit('bot-log', `❎ Popup closed (X) [${clicked.tag || 'clicked'}]`);
    await sleep(humanDelay('close', 160, 320));
    return true;
  }
  return false;
}

async function closePopupByXRetry(page, socket) {
  for (let i = 0; i < 3; i++) {
    const ok = await closePopupByX(page, socket);
    if (ok) return true;
    await sleep(humanDelay('close', 220, 480, { quick: true }));
  }
  return false;
}

async function clickGatherPopupButton(page, socket) {
  const btn = await page.$('#gather_button');
  if (!btn) return false;

  const info = await btn.evaluate((n) => {
    const style = window.getComputedStyle(n);
    const visible = n.offsetParent !== null;
    const disabled = !!(
      n.disabled ||
      n.getAttribute('aria-disabled') === 'true' ||
      n.hasAttribute('disabled') ||
      style.pointerEvents === 'none'
    );
    const label = (n.innerText || n.textContent || '').trim();
    return { visible, disabled, label };
  }).catch(() => ({ visible: false, disabled: true, label: '' }));

  if (!info.visible) return false;

  if (info.disabled) {
    socket.emit('bot-log', `🪟 Popup: #gather_button disabled (${info.label || 'disabled'})`);
    return true;
  }

  await btn.evaluate((el) => el.click());
  socket.emit('bot-log', `🪟 Popup: gather_button CLICK (${info.label || 'gather'})`);

  // even wachten zodat gather echt start
  await sleep(humanDelay('popup', 420, 900));

  const closed = await closePopupByXRetry(page, socket);
  if (closed) {
    // cooldown 12-18 sec, maar adaptief: soms iets langer
    const cd = humanDelay('resource', 12000, 18000, { afterResource: true });
    resourceCooldownUntil = Date.now() + cd;
    socket.emit('bot-log', `⏳ Resource cooldown ${(cd / 1000).toFixed(0)}s -> focusing steps`);
  } else {
    socket.emit('bot-log', '⚠️ Could not close X (still open?)');
  }

  return true;
}

async function waitAndClickPopup(page, socket, timeoutMs = 1800) {
  try {
    await page.waitForSelector('#gather_button', { timeout: timeoutMs, visible: true });
  } catch {
    return false;
  }
  return await clickGatherPopupButton(page, socket);
}

async function extractLootEntries(page) {
  return await page.evaluate(() => {
    const toAbsoluteIconSrc = (raw) => {
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      if (raw.startsWith('//')) return `https:${raw}`;
      return `https://web.simple-mmo.com${raw.startsWith('/') ? '' : '/'}${raw}`;
    };

    const findIconNearSpan = (span) => {
      const tryImgs = [];

      const prev = span.previousElementSibling;
      if (prev && (prev.tagName || '').toLowerCase() === 'img') tryImgs.push(prev);

      const parent = span.parentElement;
      if (parent) {
        const parentImg = parent.querySelector('img[src], img[data-src]');
        if (parentImg) tryImgs.push(parentImg);
      }

      let cur = span.parentElement;
      let depth = 0;
      while (cur && depth < 4) {
        const near = cur.querySelector('img[src*="/img/icons/"], img[data-src*="/img/icons/"], img[src], img[data-src]');
        if (near) tryImgs.push(near);
        cur = cur.parentElement;
        depth++;
      }

      for (const img of tryImgs) {
        if (!img) continue;
        const rawSrc = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const src = toAbsoluteIconSrc(rawSrc);
        if (!src) continue;
        const cls = img.getAttribute('class') || 'inline-block';
        return `<img src="${src}" class="${cls}">`;
      }
      return '';
    };

    const nodes = Array.from(document.querySelectorAll('[onclick*="retrieveItem("]'));
    return nodes.slice(0, 12).map((span) => {
      const onclick = span.getAttribute('onclick') || '';
      const idMatch = onclick.match(/retrieveItem\((\d+),\s*["']([^"']+)["']\)/i);
      // Use stable key: item id + visible text.
      // The 2nd retrieveItem token often changes between polls and causes duplicate spam.
      const text = (span.textContent || '').trim();
      const key = idMatch ? `${idMatch[1]}:${text}` : (span.id || text);
      const iconHtml = findIconNearSpan(span);

      const spanClone = span.cloneNode(true);
      spanClone.removeAttribute('onclick');
      const spanHtml = spanClone.outerHTML;
      const html = `${iconHtml} ${spanHtml}`.trim();
      return { key, text, html };
    }).filter((x) => x && x.key);
  }).catch(() => []);
}

function rememberLootKey(key) {
  if (!key) return false;
  if (seenLootKeys.has(key)) return false;
  seenLootKeys.add(key);
  if (seenLootKeys.size > 500) {
    const first = seenLootKeys.values().next().value;
    if (first) seenLootKeys.delete(first);
  }
  return true;
}

async function scanAndEmitLoot(page, socket, sessionStats, source = 'scan') {
  const lootRows = await extractLootEntries(page);
  if (!lootRows.length) return 0;
  const withIcon = lootRows.filter((r) => (r.html || '').includes('<img')).length;

  let emitted = 0;
  for (const row of lootRows) {
    if (!rememberLootKey(row.key)) continue;
    socket.emit('new-loot', row.html || row.text || 'Loot');
    emitted++;
  }

  if (emitted > 0) {
    socket.emit('bot-log', `Loot raw (${source}): ${lootRows.length} item(s), ${withIcon} with icon`);
    sessionStats.items = (sessionStats.items || 0) + emitted;
    socket.emit('update-stats', sessionStats);
    socket.emit('bot-log', `Loot scan (${source}): ${emitted} new item(s)`);
  }

  return emitted;
}

async function handleTravel(page, settings, sessionStats, socket) {
  if (await checkCaptcha(page)) return { type: 'captcha' };
  await scanAndEmitLoot(page, socket, sessionStats, 'pre-loop');

  const now = Date.now();

  // popup cleanup
  await closePopupByXRetry(page, socket);

  // popup actie
  const didPopup = await clickGatherPopupButton(page, socket);
  if (didPopup) return humanDelay('resource', 1400, 2600, { afterResource: true });

  // wachten op popup window
  if (now < awaitingPopupUntil) {
    const did = await waitAndClickPopup(page, socket, 1000);
    if (did) return humanDelay('resource', 1400, 2600, { afterResource: true });
    return humanDelay('popup', 450, 950, { quick: true });
  }

  const url = page.url();

  // herstellen naar /travel
  const isActionBusy = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a, .btn'));
    const vis = (b) => b.offsetParent !== null;
    return btns.some(b => vis(b) && (
      b.innerText.toLowerCase() === 'attack' ||
      b.innerText.toLowerCase().includes('click here to gather') ||
      b.innerText.toLowerCase().includes('collect loot') ||
      b.innerText.toLowerCase().includes('continue')
    ));
  }).catch(() => false);

  if (!url.includes('/travel') && !isActionBusy) {
    if (!url.includes('/combat') && !url.includes('/job/') && !url.includes('/crafting/')) {
      socket.emit('bot-log', 'Not on travel -> recovering to /travel');
      await safeGoto(page, 'https://web.simple-mmo.com/travel?new_page=true', socket);
      return humanDelay('close', 1400, 2400, { afterNav: true });
    }
  }

  // anti open-spam
  if (now - lastOpenAt < 2500) {
    const did = await waitAndClickPopup(page, socket, 1200);
    if (did) return humanDelay('resource', 1400, 2600, { afterResource: true });
    return humanDelay('popup', 520, 1050, { quick: true });
  }

  // cooldown actief? dan alleen close/confirm/step
  const cooldownActive = now < resourceCooldownUntil;

  // Als skill te laag is voor current resource, skip resource-open clicks tijdelijk.
  const lowSkillBlocked = await page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    return (
      text.includes("your skill level isn't high enough") ||
      text.includes("your skill level isnt high enough")
    );
  }).catch(() => false);

  if (lowSkillBlocked) {
    const cd = humanDelay('resource', 18000, 30000, { quick: true });
    resourceCooldownUntil = Date.now() + cd;
    const didStep = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, .btn, [role="button"]'));
      const vis = (b) => b && b.offsetParent !== null && !b.disabled;
      const txt = (b) => (b.innerText || b.textContent || '').trim().toLowerCase();
      const stp = btns.find((b) => vis(b) && txt(b).includes('take a step'));
      if (!stp) return false;

      const rect = stp.getBoundingClientRect();
      const x = rect.left + (Math.random() * rect.width);
      const y = rect.top + (Math.random() * rect.height);
      stp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      return true;
    }).catch(() => false);

    if (didStep) {
      sessionStats.steps = (sessionStats.steps || 0) + 1;
      socket.emit('bot-log', `Resource skipped: skill level too low (${Math.round(cd / 1000)}s cooldown), stepped anyway`);
      socket.emit('update-stats', sessionStats);
      return humanDelay('step', 2200, 3800, { quick: true });
    }

    socket.emit('bot-log', `Resource skipped: skill level too low (${Math.round(cd / 1000)}s cooldown), no step button found`);
    return humanDelay('step', 1800, 3200, { quick: true });
  }

  const result = await page.evaluate((cfg) => {
    const clickHumanly = (el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + (Math.random() * rect.width);
      const y = rect.top + (Math.random() * rect.height);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    };

    const btns = Array.from(document.querySelectorAll('button, a, .btn, [role="button"]'));
    const vis = (b) => b && b.offsetParent !== null && !b.disabled;
    const txt = (b) => (b.innerText || b.textContent || '').trim().toLowerCase();
    const raw = (b) => (b.innerText || b.textContent || '').trim();

    // Confirm
    const confirmAtk = btns.find(b => vis(b) && txt(b) === 'attack');
    const confirmGather = btns.find(b => vis(b) && txt(b).includes('click here to gather'));
    if (cfg.combat && confirmAtk) { clickHumanly(confirmAtk); return { type: 'executing', name: 'Attack' }; }
    if (cfg.resources && confirmGather) { clickHumanly(confirmGather); return { type: 'executing', name: 'Click here to gather' }; }

    // Close/collect/continue/back
    const cls = btns.find(b => vis(b) && /leave|close|continue|back to travel|collect loot/i.test(raw(b)));
    if (cls) { clickHumanly(cls); return { type: 'close', name: raw(cls) }; }

    // Open/start resource (alleen als niet in cooldown)
    // Prioriteit boven "take a step", zodat catch/salvage op travel niet gemist worden.
    if (!cfg.__cooldown) {
      const startRes = btns.find(b => vis(b) && (
        txt(b).includes('gather') ||
        txt(b).includes('mine') ||
        txt(b).includes('chop') ||
        txt(b).includes('catch') ||
        txt(b).includes('catching') ||
        txt(b).includes('salvage') ||
        txt(b).includes('salvaging') ||
        txt(b).includes('harvest') ||
        txt(b).includes('fish')
      ));
      if (cfg.resources && startRes) { clickHumanly(startRes); return { type: 'opening', name: raw(startRes) }; }
    }

    // Step (fallback)
    const stp = btns.find(b => vis(b) && txt(b).includes('take a step'));
    if (stp) { clickHumanly(stp); return { type: 'step' }; }

    return { type: 'none' };
  }, { ...settings, __cooldown: cooldownActive }).catch((e) => ({ type: 'eval_error', name: e.message }));

  if (result.type === 'opening') {
    lastOpenAt = Date.now();
    awaitingPopupUntil = Date.now() + 3500;
    socket.emit('bot-log', `Opening interaction: ${result.name} (waiting for popup)`);

    const did = await waitAndClickPopup(page, socket, 1600);
    if (did) {
      awaitingPopupUntil = 0;
      return humanDelay('resource', 1400, 2600, { afterResource: true });
    }

    return humanDelay('popup', 600, 1200, { quick: true });
  }

  if (result.type === 'executing') {
    socket.emit('bot-log', `Confirming: ${result.name}`);
    return humanDelay('combat', 1400, 2500, { afterCombat: true });
  }

  if (result.type === 'close') {
    socket.emit('bot-log', `Closing: ${result.name}`);
    if (/collect loot/i.test(result.name || '')) {
      await sleep(300);
      const emitted = await scanAndEmitLoot(page, socket, sessionStats, 'collect');
      if (emitted === 0) socket.emit('bot-log', 'Loot scan (collect): no new items found');
    }
    return humanDelay('close', 1000, 1800);
  }

  if (result.type === 'step') {
    sessionStats.steps = (sessionStats.steps || 0) + 1;
    socket.emit('bot-log', `Step ${sessionStats.steps} taken`);
    socket.emit('update-stats', sessionStats);
    return humanDelay('step', 3400, 5800);
  }

  if (result.type === 'eval_error') {
    socket.emit('bot-log', `⚠️ Travel evaluate interrupted: ${result.name}`);
    return humanDelay('close', 900, 1600, { afterNav: true, quick: true });
  }

  return humanDelay('step', 2600, 4200);
}

module.exports = { handleTravel };
