// logic/combat.js — Puppeteer v24+ + silent retry bij navigation + adaptive delays

const { humanDelay } = require('./human-delay');

function isNavDestroy(err) {
  const msg = (err && err.message) ? err.message : String(err || '');
  return msg.includes('Execution context was destroyed') || msg.includes('Cannot find context');
}

async function handleCombat(page, socket, sessionStats) {
  try {
    const url = page.url();
    const likelyCombat = url.includes('/combat') || url.includes('monster');

    const elements = await page.$$('button, a, [role="button"], .btn');

    const getText = async (el) =>
      await el.evaluate(e => (e.innerText || e.textContent || '').trim()).catch(() => '');

    const isClickable = async (el) =>
      await el.evaluate((e) => {
        const style = window.getComputedStyle(e);
        const visible = e.offsetParent !== null && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
        const disabled = !!(e.disabled || e.getAttribute('aria-disabled') === 'true' || e.hasAttribute('disabled'));
        return visible && !disabled;
      }).catch(() => false);

    const clickSoft = async (el) => {
      await el.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {});
      // DOM click eerst (stabiel)
      const ok = await el.evaluate(e => { e.click(); return true; }).catch(() => false);
      if (!ok) {
        await el.click({ delay: 80 }).catch(() => {});
      }
    };

    // Loot eerst, zodat drops zichtbaar worden in dashboard
    for (const el of elements) {
      const textRaw = await getText(el);
      const text = textRaw.toLowerCase();
      if (!text) continue;
      if (!text.includes('loot')) continue;
      if (!(await isClickable(el))) continue;

      await clickSoft(el);
      sessionStats.items = (sessionStats.items || 0) + 1;
      socket.emit('new-loot', `Loot: ${textRaw}`);
      socket.emit('update-stats', sessionStats);
      socket.emit('bot-log', `Loot collected: ${textRaw}`);
      return humanDelay('close', 900, 1600, { quick: true });
    }

    // Confirm/OK/Yes daarna
    for (const el of elements) {
      const text = (await getText(el)).toLowerCase();
      if (!text) continue;

      const isConfirm =
        text === 'ok' ||
        text === 'yes' ||
        text.includes('confirm') ||
        text.includes('continue') ||
        text.includes('bevestig') ||
        text.includes('ja');

      if (!isConfirm) continue;
      if (!(await isClickable(el))) continue;

      await clickSoft(el);
      socket.emit('bot-log', '✅ Combat: confirm/ok clicked');
      return humanDelay('combat', 900, 1800, { afterCombat: true });
    }

    // Attack
    for (const el of elements) {
      const text = (await getText(el)).toLowerCase();
      if (!text) continue;

      const isAttack = text === 'attack' || text.includes('attack') || text.includes('aanval');
      if (!isAttack) continue;
      if (!(await isClickable(el))) continue;

      await clickSoft(el);
      socket.emit('bot-log', '⚔️ Combat: attack clicked');

      return likelyCombat
        ? humanDelay('combat', 1200, 2600, { afterCombat: true })
        : humanDelay('combat', 1600, 3200, { afterCombat: true });
    }

    return 0;
  } catch (err) {
    if (isNavDestroy(err)) {
      return humanDelay('close', 800, 1500, { afterNav: true, quick: true });
    }
    socket.emit('bot-log', 'Combat error: ' + (err?.message || String(err)));
    return humanDelay('close', 1600, 2800);
  }
}

module.exports = { handleCombat };
