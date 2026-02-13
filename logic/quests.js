// logic/quests.js (Puppeteer v24+ compatible)

const { humanDelay } = require('./human-delay');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function selectLowestLevelQuest(page) {
  return page.evaluate(() => {
    const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const cards = Array.from(
      document.querySelectorAll('button[x-on\\:click*="set-expedition-data"]')
    );

    const parsed = cards.map((card, idx) => {
      const txt = normalize(card.textContent || '');
      const levelMatch = txt.match(/Level\s+(\d+)/i);
      const leftMatch = txt.match(/(\d+)\s+left/i);
      const titleEl = card.querySelector('p[x-text="expedition.title"]');
      const title = normalize(titleEl?.textContent || '');

      return {
        idx,
        level: levelMatch ? Number(levelMatch[1]) : Number.POSITIVE_INFINITY,
        remaining: leftMatch ? Number(leftMatch[1]) : 0,
        title
      };
    }).filter((q) => Number.isFinite(q.level));

    if (!parsed.length) {
      return { ok: false, reason: 'no quest cards found' };
    }

    const notCompleted = parsed.filter((q) => q.remaining > 0);
    const source = notCompleted.length ? notCompleted : parsed;
    source.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return b.remaining - a.remaining;
    });

    const chosen = source[0];
    const target = cards[chosen.idx];
    if (!target) {
      return { ok: false, reason: 'chosen quest card missing in DOM' };
    }

    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.click();

    return {
      ok: true,
      title: chosen.title || 'Unknown quest',
      level: chosen.level,
      remaining: chosen.remaining
    };
  });
}

async function clickPerform(page) {
  const buttons = await page.$$(
    'button[x-on\\:click*="performExpedition"], button'
  );

  for (const el of buttons) {
    const text = await page
      .evaluate((e) => (e.innerText || e.textContent || '').trim(), el)
      .catch(() => '');
    if (!text || !text.toLowerCase().includes('perform')) continue;

    const disabled = await page
      .evaluate((e) => e.disabled || e.getAttribute('aria-disabled') === 'true' || e.hasAttribute('disabled'), el)
      .catch(() => true);
    if (disabled) continue;

    try { await el.evaluate((n) => n.scrollIntoView({ block: 'center' })); } catch {}
    await sleep(350 + Math.random() * 450);
    await el.click({ delay: 120 + Math.random() * 140, timeout: 15000 });
    return true;
  }

  return false;
}

async function handleQuests(page, socket, sessionStats) {
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('/quests')) {
      socket.emit('bot-log', 'Quest burst active: opening /quests');
      try {
        await page.goto('https://web.simple-mmo.com/quests?new_page=true', {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
      } catch (navErr) {
        socket.emit('bot-log', `Quest navigation failed: ${navErr.message}`);
        return 3000;
      }
      return humanDelay('quest', 2400, 3600, { afterNav: true });
    }

    const pick = await selectLowestLevelQuest(page);
    if (!pick?.ok) {
      socket.emit('bot-log', `Quest burst: unable to pick lowest-level quest (${pick?.reason || 'unknown'})`);
      return humanDelay('quest', 2200, 3200);
    }

    socket.emit('bot-log', `Quest pick: "${pick.title}" (level ${pick.level}, ${pick.remaining} left)`);
    await sleep(500 + Math.random() * 600);

    const didPerform = await clickPerform(page);
    if (didPerform) {
      socket.emit('bot-log', 'Quest action: Perform clicked');
      if (sessionStats && Number.isFinite(Number(sessionStats.qp))) {
        const nextQp = Math.max(0, Number(sessionStats.qp) - 1);
        sessionStats.qp = nextQp;
        sessionStats.quest_points = nextQp;
        if (Number.isFinite(Number(sessionStats.max_qp)) && Number(sessionStats.max_qp) > 0) {
          sessionStats.qp_percent = Math.max(0, Math.min(100, (nextQp / Number(sessionStats.max_qp)) * 100));
        }
      }
      return humanDelay('quest', 2800, 4500);
    }

    socket.emit('bot-log', 'Quest burst: no perform button found, retrying shortly');
    return humanDelay('quest', 2000, 3200);
  } catch (err) {
    console.error('[quests] Error:', err.message);
    socket.emit('bot-log', `Quest error: ${err.message}`);
    return humanDelay('quest', 2800, 4200);
  }
}

module.exports = { handleQuests };
