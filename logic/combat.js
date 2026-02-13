// logic/combat.js - Puppeteer v24+ + silent retry bij navigation + adaptive delays

const { humanDelay } = require('./human-delay');
const { clickHandle, scrollIntoView } = require('./click-utils');
const { markFastWarning, tuneDelay } = require('./anti-fast');

let lastAttackClickAt = 0;
const MIN_ATTACK_INTERVAL_MS = 5200;

function isNavDestroy(err) {
  const msg = (err && err.message) ? err.message : String(err || '');
  return msg.includes('Execution context was destroyed') || msg.includes('Cannot find context');
}

async function handleCombat(page, socket, sessionStats) {
  try {
    const url = page.url();
    const likelyCombat = url.includes('/combat') || url.includes('monster');
    const now = Date.now();

    const antiFastWarning = await page.evaluate(() => {
      const text = (document.body?.innerText || '').toLowerCase();
      return (
        (text.includes('hold on') && text.includes('too fast')) ||
        text.includes('you are going too fast') ||
        text.includes('slow down')
      );
    }).catch(() => false);
    if (antiFastWarning) {
      socket.emit('bot-log', 'Combat throttle: anti-fast warning detected, backing off');
      markFastWarning('combat', socket, 'warning detected');
      return tuneDelay('combat', humanDelay('combat', 7000, 12000, { afterCombat: true }), { floorMs: 7000 });
    }

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
      await scrollIntoView(el);
      await clickHandle(el, { minDelay: 120, maxDelay: 300 });
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
      return humanDelay('close', 1600, 2800);
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
      socket.emit('bot-log', 'Combat: confirm/ok clicked');
      return humanDelay('combat', 1800, 3200, { afterCombat: true });
    }

    // Attack
    for (const el of elements) {
      const text = (await getText(el)).toLowerCase();
      if (!text) continue;

      const isAttack = text === 'attack' || text.includes('attack') || text.includes('aanval');
      if (!isAttack) continue;
      if (!(await isClickable(el))) continue;

      const sinceLastAttack = now - lastAttackClickAt;
      if (sinceLastAttack < MIN_ATTACK_INTERVAL_MS) {
        const waitMs = (MIN_ATTACK_INTERVAL_MS - sinceLastAttack) + Math.round(Math.random() * 900);
        socket.emit('bot-log', `Combat throttle: waiting ${Math.round(waitMs / 1000)}s before next attack`);
        return tuneDelay('combat', waitMs, { floorMs: 1800 });
      }

      await clickSoft(el);
      lastAttackClickAt = Date.now();
      socket.emit('bot-log', 'Combat: attack clicked');

      return likelyCombat
        ? humanDelay('combat', 3600, 5600, { afterCombat: true })
        : humanDelay('combat', 4200, 6200, { afterCombat: true });
    }

    return 0;
  } catch (err) {
    if (isNavDestroy(err)) {
      return humanDelay('close', 1500, 2600, { afterNav: true });
    }
    socket.emit('bot-log', 'Combat error: ' + (err?.message || String(err)));
    return humanDelay('close', 2200, 3600);
  }
}

module.exports = { handleCombat };
