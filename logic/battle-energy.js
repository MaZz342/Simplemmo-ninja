// logic/battle-energy.js - strict NPC battle flow for full energy burst

const { humanDelay } = require('./human-delay');

let battlePhase = 'menu'; // menu -> generate-open -> generate-confirm -> battle-enter -> fight
let generateMisses = 0;
let fightMisses = 0;

function getEnergyState(stats) {
  const energy = Number(stats?.energy ?? 0);
  const maxEnergy = Number(stats?.max_energy ?? 0);
  return {
    energy: Number.isFinite(energy) ? energy : 0,
    maxEnergy: Number.isFinite(maxEnergy) ? maxEnergy : 0
  };
}

function shouldRunBattleBurst(stats, burstActive, socket) {
  const { energy, maxEnergy } = getEnergyState(stats);
  if (!(maxEnergy > 0)) return burstActive;

  if (burstActive) {
    if (energy <= 0) {
      battlePhase = 'menu';
      generateMisses = 0;
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst finished: energy depleted, waiting for full refill');
      return false;
    }
    return true;
  }

  if (energy >= maxEnergy) {
    battlePhase = 'menu';
    generateMisses = 0;
    fightMisses = 0;
    socket?.emit('bot-log', `Battle burst started at full energy (${energy}/${maxEnergy})`);
    return true;
  }

  return false;
}

async function clickHandleRobust(handle) {
  if (!handle) return false;
  await handle.evaluate((el) => {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
  }).catch(() => {});

  const clickedViaPuppeteer = await handle
    .click({ delay: 120 + Math.random() * 160 })
    .then(() => true)
    .catch(() => false);
  if (clickedViaPuppeteer) return true;

  const clickedViaDom = await handle.evaluate((el) => {
    try { el.click(); return true; } catch { return false; }
  }).catch(() => false);
  return clickedViaDom;
}

async function findBattleNpcHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const info = await h.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const visible = style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
      const rect = el.getBoundingClientRect();
      return { txt, visible, w: rect.width, h: rect.height, disabled: !!el.disabled };
    }).catch(() => null);
    if (!info || !info.visible || info.disabled || info.w <= 0 || info.h <= 0) continue;
    if (/back|leave|close|cancel|return/.test(info.txt)) continue;
    if (info.txt === 'battle npcs' || info.txt.includes('battle npcs') || info.txt.includes('battle npc')) {
      return h;
    }
  }
  return null;
}

async function findGenerateEnemyHandle(page) {
  const cssCandidates = [
    'button[x-on\\:click*="show_npc_generation_popup"]',
    'button[class*="bg-indigo-600"]'
  ];
  for (const selector of cssCandidates) {
    const list = await page.$$(selector).catch(() => []);
    for (const h of list) {
      const ok = await h.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
        const hasMarker = attrs.some((name) => String(el.getAttribute(name) || '').toLowerCase().includes('show_npc_generation_popup'));
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.pointerEvents !== 'none' &&
          !el.disabled &&
          rect.width > 0 &&
          rect.height > 0 &&
          (hasMarker || txt.includes('generate enemy'))
        );
      }).catch(() => false);
      if (ok) return h;
    }
  }

  const all = await page.$$('button, a, [role="button"], .btn');
  for (const h of all) {
    const ok = await h.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasMarker = attrs.some((name) => String(el.getAttribute(name) || '').toLowerCase().includes('show_npc_generation_popup'));
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.pointerEvents !== 'none' &&
        !el.disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        (hasMarker || txt.includes('generate enemy'))
      );
    }).catch(() => false);
    if (ok) return h;
  }

  return null;
}

async function findGenerateConfirmHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasGenerateNpc = attrs.some((name) => {
        const val = String(el.getAttribute(name) || '').toLowerCase().replace(/\s+/g, '');
        return val.includes('generatenpc()') || val.includes('generatenpc');
      });
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.pointerEvents !== 'none' &&
        !el.disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        (hasGenerateNpc || txt === 'generate')
      );
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function clickFightAction(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  let confirm = null;
  let close = null;
  for (const h of handles) {
    const info = await h.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const rect = el.getBoundingClientRect();
      return {
        txt,
        visible: style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none',
        disabled: !!el.disabled,
        w: rect.width,
        h: rect.height
      };
    }).catch(() => null);
    if (!info || !info.visible || info.disabled || info.w <= 0 || info.h <= 0) continue;
    if (!close && (info.txt.includes('leave') || info.txt.includes('close'))) {
      close = h;
      continue;
    }
    if (/back|cancel|return/.test(info.txt)) continue;
    if (info.txt === 'attack' || info.txt.includes('attack')) {
      const ok = await clickHandleRobust(h);
      if (ok) return 'attack';
      continue;
    }
    if (!confirm && (info.txt.includes('continue') || info.txt.includes('confirm') || info.txt === 'ok' || info.txt === 'yes')) {
      confirm = h;
    }
  }
  if (close) {
    const ok = await clickHandleRobust(close);
    if (ok) return 'close';
  }
  if (confirm) {
    const ok = await clickHandleRobust(confirm);
    if (ok) return 'confirm';
  }
  return 'none';
}

async function findAttackHandle(page) {
  const selectors = [
    'a[href*="/battle/attack"]',
    'button[x-on\\:click*="attack"]',
    'button[@click*="attack"]',
    'button, a, [role="button"], .btn'
  ];

  for (const selector of selectors) {
    const list = await page.$$(selector).catch(() => []);
    for (const h of list) {
      const ok = await h.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
        const hasAttackAttr = attrs.some((name) => {
          const v = String(el.getAttribute(name) || '').toLowerCase();
          return v.includes('attack') && !v.includes('show_npc_generation_popup');
        });
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          style.pointerEvents !== 'none' &&
          !el.disabled &&
          rect.width > 0 &&
          rect.height > 0 &&
          (txt === 'attack' || txt.includes('attack') || hasAttackAttr)
        );
      }).catch(() => false);
      if (ok) return h;
    }
  }
  return null;
}

async function findBattleEnterHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasLoadingClick = attrs.some((name) => {
        const val = String(el.getAttribute(name) || '').toLowerCase().replace(/\s+/g, '');
        return val.includes('loading=true');
      });
      const rect = el.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.pointerEvents !== 'none' &&
        !el.disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        txt === 'battle' &&
        hasLoadingClick
      );
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function handleBattleEnergy(page, socket, sessionStats) {
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('/battle/menu') && !currentUrl.includes('/battle/arena') && !currentUrl.includes('/battle/attack') && !currentUrl.includes('/battle/npc')) {
      battlePhase = 'menu';
      generateMisses = 0;
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst active: opening /battle/arena');
      await page.goto('https://web.simple-mmo.com/battle/arena?new_page=true', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });
      return humanDelay('combat', 2400, 3600, { afterNav: true });
    }

    if (battlePhase === 'menu') {
      const npcBtn = await findBattleNpcHandle(page);
      const openerBtn = await findGenerateEnemyHandle(page);
      if (!npcBtn && !openerBtn) {
        return humanDelay('combat', 2200, 3400);
      }
      const target = npcBtn || openerBtn;
      const clicked = await clickHandleRobust(target);
      if (!clicked) {
        socket?.emit('bot-log', 'Battle burst: opening button found but click failed');
        return humanDelay('combat', 2400, 3600);
      }
      if (target === npcBtn) {
        battlePhase = 'generate-open';
        socket?.emit('bot-log', 'Battle burst: Battle NPCs clicked -> waiting for Generate Enemy');
      } else {
        battlePhase = 'generate-confirm';
        socket?.emit('bot-log', 'Battle burst: Generate Enemy clicked -> waiting for Generate');
      }
      generateMisses = 0;
      return humanDelay('combat', 2200, 3400, { afterCombat: true });
    }

    if (battlePhase === 'generate-open') {
      const generateBtn = await findGenerateEnemyHandle(page);
      if (!generateBtn) {
        generateMisses += 1;
        if (generateMisses % 2 === 1) {
          socket?.emit('bot-log', `Battle burst: Generate Enemy not found yet (miss ${generateMisses})`);
        }
        if (generateMisses >= 8) {
          battlePhase = 'menu';
          generateMisses = 0;
          socket?.emit('bot-log', 'Battle burst: retrying from Battle NPCs');
        }
        return humanDelay('combat', 2400, 3800);
      }

      const clicked = await clickHandleRobust(generateBtn);
      if (!clicked) {
        generateMisses += 1;
        socket?.emit('bot-log', `Battle burst: Generate Enemy click failed (miss ${generateMisses})`);
        return humanDelay('combat', 2400, 3800);
      }

      battlePhase = 'generate-confirm';
      generateMisses = 0;
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst: Generate Enemy clicked -> waiting for Generate');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    if (battlePhase === 'generate-confirm') {
      const confirmGenerate = await findGenerateConfirmHandle(page);
      if (!confirmGenerate) {
        generateMisses += 1;
        if (generateMisses % 2 === 1) {
          socket?.emit('bot-log', `Battle burst: Generate button not found yet (miss ${generateMisses})`);
        }
        if (generateMisses >= 10) {
          battlePhase = 'generate-open';
          generateMisses = 0;
          socket?.emit('bot-log', 'Battle burst: retrying Generate Enemy step');
        }
        return humanDelay('combat', 2300, 3600);
      }

      const clicked = await clickHandleRobust(confirmGenerate);
      if (!clicked) {
        generateMisses += 1;
        socket?.emit('bot-log', `Battle burst: Generate button click failed (miss ${generateMisses})`);
        return humanDelay('combat', 2400, 3800);
      }

      battlePhase = 'battle-enter';
      generateMisses = 0;
      fightMisses = 0;
      sessionStats.energy = Math.max(0, Number(sessionStats.energy || 0) - 1);
      if (Number(sessionStats.max_energy || 0) > 0) {
        sessionStats.energy_percent = Math.max(
          0,
          Math.min(100, (Number(sessionStats.energy) / Number(sessionStats.max_energy)) * 100)
        );
      }
      socket?.emit('bot-log', 'Battle burst: Generate clicked -> waiting for Battle');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    if (battlePhase === 'battle-enter') {
      const battleBtn = await findBattleEnterHandle(page);
      if (!battleBtn) {
        generateMisses += 1;
        if (generateMisses % 2 === 1) {
          socket?.emit('bot-log', `Battle burst: Battle button not found yet (miss ${generateMisses})`);
        }
        if (generateMisses >= 8) {
          battlePhase = 'generate-open';
          generateMisses = 0;
          socket?.emit('bot-log', 'Battle burst: retrying from Generate Enemy step');
        }
        return humanDelay('combat', 2200, 3600);
      }

      const clicked = await clickHandleRobust(battleBtn);
      if (!clicked) {
        generateMisses += 1;
        socket?.emit('bot-log', `Battle burst: Battle button click failed (miss ${generateMisses})`);
        return humanDelay('combat', 2400, 3800);
      }

      battlePhase = 'fight';
      generateMisses = 0;
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst: Battle clicked');
      return humanDelay('combat', 2600, 4200, { afterCombat: true });
    }

    const attackBtn = await findAttackHandle(page);
    if (attackBtn) {
      const clickedAttack = await clickHandleRobust(attackBtn);
      if (clickedAttack) {
        fightMisses = 0;
        socket?.emit('bot-log', 'Battle burst: Attack clicked');
        return humanDelay('combat', 3000, 4600, { afterCombat: true });
      }
    }

    const action = await clickFightAction(page);
    if (action === 'confirm') {
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst: Continue clicked');
      return humanDelay('combat', 2600, 4200, { afterCombat: true });
    }
    if (action === 'close') {
      battlePhase = 'menu';
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst: Leave/Close clicked, next NPC');
      return humanDelay('close', 1800, 3000, { afterCombat: true });
    }
    fightMisses += 1;
    if (fightMisses % 4 === 1) {
      socket?.emit('bot-log', `Battle burst: waiting for attack state (miss ${fightMisses})`);
    }
    if (fightMisses >= 14) {
      battlePhase = 'menu';
      fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst: fight stalled, restarting NPC cycle');
    }
    return humanDelay('combat', 2200, 3600);
  } catch (err) {
    socket?.emit('bot-log', `Battle burst error: ${err.message}`);
    return humanDelay('combat', 3000, 4800, { afterNav: true });
  }
}

module.exports = {
  shouldRunBattleBurst,
  handleBattleEnergy
};
