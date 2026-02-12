// logic/quests.js (Puppeteer v24+ compatible)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleQuests(page, socket) {
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('/quests')) return 0;

    const buttons = await page.$$('button, a, [role="button"], .btn');
    for (const el of buttons) {
      const text = await page
        .evaluate(e => (e.innerText || e.textContent || '').trim(), el)
        .catch(() => '');

      if (!text) continue;

      const low = text.toLowerCase();
      if (!low.includes('perform')) continue;

      const disabled = await page
        .evaluate(e => e.disabled || e.getAttribute('aria-disabled') === 'true' || e.hasAttribute('disabled'), el)
        .catch(() => true);

      if (disabled) continue;

      try { await el.evaluate(n => n.scrollIntoView({ block: 'center' })); } catch {}
      await sleep(150 + Math.random() * 250);

      await el.click({ delay: 60 + Math.random() * 110, timeout: 15000 });
      socket.emit('bot-log', '✅ Quest uitgevoerd (Perform)');
      return 1800 + Math.random() * 800;
    }

    return 0;
  } catch (err) {
    console.error('[quests] Fout:', err.message);
    socket.emit('bot-log', `Quest fout: ${err.message}`);
    return 2500;
  }
}

module.exports = { handleQuests };
