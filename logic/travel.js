// logic/travel.js - Travel driver + gather popup + close X + cooldown + adaptive delays

const { checkCaptcha } = require('./captcha');
const { humanDelay } = require('./human-delay');
const { clickHandle } = require('./click-utils');
const { detectAntiFastWarning, markFastWarning, tuneDelay } = require('./anti-fast');

// mini-state
let lastOpenAt = 0;
let awaitingPopupUntil = 0;
let resourceCooldownUntil = 0;
let lastGatherActionAt = 0;
const MIN_GATHER_ACTION_INTERVAL_MS = 5200;
const seenLootKeys = new Set();

async function safeGoto(page, url, socket) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return true;
  } catch (e) {
    socket?.emit('bot-log', `goto failed (${url}): ${e.message}`);
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getHandleInfo(handle) {
  return await handle.evaluate((el) => {
    const style = window.getComputedStyle(el);
    const raw = (el.innerText || el.textContent || '').trim();
    const lower = raw.toLowerCase();
    const visible = el.offsetParent !== null && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    const disabled = !!(
      el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.hasAttribute('disabled')
    );
    return { raw, lower, visible, disabled };
  }).catch(() => ({ raw: '', lower: '', visible: false, disabled: true }));
}

async function findAndClick(page, predicate, opts = {}) {
  const handles = await page.$$('button, a, .btn, [role="button"]');
  for (const handle of handles) {
    const info = await getHandleInfo(handle);
    if (!info.visible || info.disabled) {
      await handle.dispose().catch(() => {});
      continue;
    }

    let match = false;
    try {
      match = !!predicate(info);
    } catch {
      match = false;
    }
    if (!match) {
      await handle.dispose().catch(() => {});
      continue;
    }

    const clicked = await clickHandle(handle, opts.click || {});
    await handle.dispose().catch(() => {});
    if (clicked) return { clicked: true, info };
  }
  return { clicked: false, info: null };
}

async function closePopupByX(page, socket) {
  const X_PATH_D = 'M6 18 18 6M6 6l12 12';
  const pathHandles = await page.$$(`svg path[d="${X_PATH_D}"]`);

  for (const pathHandle of pathHandles) {
    const candidateHandle = await pathHandle.evaluateHandle((p) => {
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

      let candidate =
        p.closest('button') ||
        p.closest('a') ||
        p.closest('[role="button"]');

      if (!candidate) {
        let cur = p.parentElement;
        let steps = 0;
        while (cur && steps < 10) {
          if (isClickable(cur)) {
            candidate = cur;
            break;
          }
          cur = cur.parentElement;
          steps++;
        }
      }
      return candidate || null;
    }).catch(() => null);

    const candidate = candidateHandle && candidateHandle.asElement ? candidateHandle.asElement() : null;
    if (candidate) {
      const info = await getHandleInfo(candidate);
      if (info.visible) {
        const clicked = await clickHandle(candidate, { minDelay: 100, maxDelay: 260 });
        await candidate.dispose().catch(() => {});
        await candidateHandle.dispose().catch(() => {});
        await pathHandle.dispose().catch(() => {});
        if (clicked) {
          socket.emit('bot-log', 'Popup closed (X)');
          await sleep(humanDelay('close', 450, 900));
          return true;
        }
      } else {
        await candidate.dispose().catch(() => {});
      }
    }

    if (candidateHandle) await candidateHandle.dispose().catch(() => {});
    await pathHandle.dispose().catch(() => {});
  }
  return false;
}

async function closePopupByXRetry(page, socket) {
  for (let i = 0; i < 3; i++) {
    const ok = await closePopupByX(page, socket);
    if (ok) return true;
    await sleep(humanDelay('close', 600, 1300));
  }
  return false;
}

async function clickGatherPopupButton(page, socket) {
  const sinceLastGather = Date.now() - lastGatherActionAt;
  if (sinceLastGather < MIN_GATHER_ACTION_INTERVAL_MS) {
    return false;
  }

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
    socket.emit('bot-log', `Popup: #gather_button disabled (${info.label || 'disabled'})`);
    return true;
  }

  const clicked = await clickHandle(btn, { minDelay: 120, maxDelay: 300 });
  if (!clicked) {
    socket.emit('bot-log', 'Popup: gather_button click failed');
    return false;
  }
  lastGatherActionAt = Date.now();
  socket.emit('bot-log', `Popup: gather_button click (${info.label || 'gather'})`);

  // even wachten zodat gather echt start
  await sleep(humanDelay('popup', 900, 1700));

  const closed = await closePopupByXRetry(page, socket);
  if (closed) {
    // cooldown 12-18 sec, maar adaptief: soms iets langer
    const cd = humanDelay('resource', 12000, 18000, { afterResource: true });
    resourceCooldownUntil = Date.now() + cd;
    socket.emit('bot-log', `Resource cooldown ${(cd / 1000).toFixed(0)}s -> focusing steps`);
  } else {
    socket.emit('bot-log', 'Could not close X (still open?)');
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

  const antiFastWarning = await detectAntiFastWarning(page);
  if (antiFastWarning) {
    markFastWarning('gather', socket, 'travel warning detected');
    return tuneDelay('gather', humanDelay('resource', 7000, 12000, { afterResource: true }), { floorMs: 7000 });
  }

  const now = Date.now();

  // popup cleanup
  await closePopupByXRetry(page, socket);

  // popup actie
  const didPopup = await clickGatherPopupButton(page, socket);
  if (didPopup) return humanDelay('resource', 2600, 4200, { afterResource: true });

  // wachten op popup window
  if (now < awaitingPopupUntil) {
    const did = await waitAndClickPopup(page, socket, 1000);
    if (did) return humanDelay('resource', 2600, 4200, { afterResource: true });
    return humanDelay('popup', 900, 1600);
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
    if (did) return humanDelay('resource', 2600, 4200, { afterResource: true });
    return humanDelay('popup', 900, 1700);
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
    const cd = humanDelay('resource', 22000, 34000);
    resourceCooldownUntil = Date.now() + cd;
    const stepClick = await findAndClick(
      page,
      (b) => b.lower.includes('take a step'),
      { click: { minDelay: 120, maxDelay: 300 } }
    );
    const didStep = !!stepClick.clicked;

    if (didStep) {
      sessionStats.steps = (sessionStats.steps || 0) + 1;
      socket.emit('bot-log', `Resource skipped: skill level too low (${Math.round(cd / 1000)}s cooldown), stepped anyway`);
      socket.emit('update-stats', sessionStats);
      return humanDelay('step', 2200, 3800);
    }

    socket.emit('bot-log', `Resource skipped: skill level too low (${Math.round(cd / 1000)}s cooldown), no step button found`);
    return humanDelay('step', 2000, 3400);
  }

  let result = { type: 'none' };

  if (settings.combat) {
    const confirmAtk = await findAndClick(
      page,
      (b) => b.lower === 'attack',
      { click: { minDelay: 120, maxDelay: 300 } }
    );
    if (confirmAtk.clicked) {
      result = { type: 'executing', name: confirmAtk.info.raw || 'Attack' };
    }
  }

  if (result.type === 'none' && settings.resources) {
    const confirmGather = await findAndClick(
      page,
      (b) => b.lower.includes('click here to gather'),
      { click: { minDelay: 120, maxDelay: 300 } }
    );
    if (confirmGather.clicked) {
      result = { type: 'executing', name: confirmGather.info.raw || 'Click here to gather' };
    }
  }

  if (result.type === 'none') {
    const closeAction = await findAndClick(
      page,
      (b) => /leave|close|continue|back to travel|collect loot/i.test(b.raw || ''),
      { click: { minDelay: 130, maxDelay: 320 } }
    );
    if (closeAction.clicked) {
      result = { type: 'close', name: closeAction.info.raw || 'Close' };
    }
  }

  if (result.type === 'none' && !cooldownActive && settings.resources) {
    const openResource = await findAndClick(
      page,
      (b) => (
        b.lower.includes('gather') ||
        b.lower.includes('mine') ||
        b.lower.includes('chop') ||
        b.lower.includes('catch') ||
        b.lower.includes('catching') ||
        b.lower.includes('salvage') ||
        b.lower.includes('salvaging') ||
        b.lower.includes('harvest') ||
        b.lower.includes('fish') ||
        b.lower.includes('forage')
      ),
      { click: { minDelay: 140, maxDelay: 340 } }
    );
    if (openResource.clicked) {
      result = { type: 'opening', name: openResource.info.raw || 'Resource' };
    }
  }

  if (result.type === 'none') {
    const stepAction = await findAndClick(
      page,
      (b) => b.lower.includes('take a step'),
      { click: { minDelay: 120, maxDelay: 300 } }
    );
    if (stepAction.clicked) {
      result = { type: 'step' };
    }
  }

  if (result.type === 'opening') {
    lastOpenAt = Date.now();
    awaitingPopupUntil = Date.now() + 3500;
    socket.emit('bot-log', `Opening interaction: ${result.name} (waiting for popup)`);

    const did = await waitAndClickPopup(page, socket, 1600);
    if (did) {
      awaitingPopupUntil = 0;
      return humanDelay('resource', 2600, 4200, { afterResource: true });
    }

    return humanDelay('popup', 1000, 2000);
  }

  if (result.type === 'executing') {
    socket.emit('bot-log', `Confirming: ${result.name}`);
    if ((result.name || '').toLowerCase() === 'attack') {
      return humanDelay('combat', 3600, 5600, { afterCombat: true });
    }
    if ((result.name || '').toLowerCase().includes('gather')) {
      lastGatherActionAt = Date.now();
      return humanDelay('resource', 3200, 5200, { afterResource: true });
    }
    return humanDelay('combat', 2600, 4200, { afterCombat: true });
  }

  if (result.type === 'close') {
    socket.emit('bot-log', `Closing: ${result.name}`);
    if (/collect loot/i.test(result.name || '')) {
      await sleep(800 + Math.random() * 900);
      const emitted = await scanAndEmitLoot(page, socket, sessionStats, 'collect');
      if (emitted === 0) socket.emit('bot-log', 'Loot scan (collect): no new items found');
    }
    return humanDelay('close', 1600, 2800);
  }

  if (result.type === 'step') {
    sessionStats.steps = (sessionStats.steps || 0) + 1;
    socket.emit('bot-log', `Step ${sessionStats.steps} taken`);
    socket.emit('update-stats', sessionStats);
    return humanDelay('step', 2200, 4000);
  }

  return humanDelay('step', 2000, 3600);
}

module.exports = { handleTravel };
