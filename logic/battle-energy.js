// logic/battle-energy.js - compact battle arena state machine

const { humanDelay } = require('./human-delay');
const { clickHandle } = require('./click-utils');

const PHASE = {
  MENU: 'menu',
  GENERATE_OPEN: 'generate-open',
  GENERATE_CONFIRM: 'generate-confirm',
  BATTLE_ENTER: 'battle-enter',
  FIGHT: 'fight'
};

const state = {
  phase: PHASE.MENU,
  generateMisses: 0,
  fightMisses: 0,
  lastArenaRecoverAt: 0,
  lastBattleContextSeenAt: 0
};

function resetPhaseState(nextPhase = PHASE.MENU) {
  state.phase = nextPhase;
  state.generateMisses = 0;
  state.fightMisses = 0;
  if (nextPhase === PHASE.MENU) {
    state.lastBattleContextSeenAt = 0;
  }
}

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
      resetPhaseState(PHASE.MENU);
      state.lastArenaRecoverAt = 0;
      socket?.emit('bot-log', 'Battle burst finished: energy depleted, waiting for full refill');
      return false;
    }
    return true;
  }

  if (energy >= maxEnergy) {
    resetPhaseState(PHASE.MENU);
    state.lastArenaRecoverAt = 0;
    socket?.emit('bot-log', `Battle burst started at full energy (${energy}/${maxEnergy})`);
    return true;
  }

  return false;
}

async function clickHandleRobust(handle) {
  return await clickHandle(handle, { minDelay: 120, maxDelay: 280 });
}

async function findBattleNpcHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (/back|leave|close|cancel|return/.test(txt)) return false;
      return txt === 'battle npcs' || txt.includes('battle npcs') || txt.includes('battle npc');
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function findGenerateEnemyHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasMarker = attrs.some((name) => String(el.getAttribute(name) || '').toLowerCase().includes('show_npc_generation_popup'));
      return hasMarker || txt.includes('generate enemy');
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function findGenerateConfirmHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasGenerate = attrs.some((name) => String(el.getAttribute(name) || '').toLowerCase().includes('generatenpc'));
      return hasGenerate || txt === 'generate';
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function findBattleEnterHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasLoading = attrs.some((name) => String(el.getAttribute(name) || '').toLowerCase().replace(/\s+/g, '').includes('loading=true'));
      return txt === 'battle' && hasLoading;
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function findBattleAttackHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn, input[type="submit"], input[type="button"]');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      const txt = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
      if (txt !== 'attack') return false;
      if (txt.includes('special attack') || txt.includes('use item')) return false;

      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasAttackFalse = attrs.some((name) => {
        const v = String(el.getAttribute(name) || '').toLowerCase().replace(/\s+/g, '');
        return v.includes('attack(false');
      });

      return hasAttackFalse || txt === 'attack';
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function findQuickGenerateHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
      const hasQuickGenerate = attrs.some((name) =>
        String(el.getAttribute(name) || '').toLowerCase().replace(/\s+/g, '').includes('quickgenerate(')
      );

      return hasQuickGenerate || txt.includes('generate next opponent');
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function findContinueHandle(page) {
  const handles = await page.$$('button, a, [role="button"], .btn');
  for (const h of handles) {
    const ok = await h.evaluate((el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      return txt === 'continue' || txt === 'ok' || txt === 'yes' || txt.includes('continue');
    }).catch(() => false);
    if (ok) return h;
  }
  return null;
}

async function clickAttackDirect(page) {
  return await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, input[type="submit"], input[type="button"]'));
    const isVisible = (el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const attackBtn = candidates.find((el) => {
      if (!isVisible(el)) return false;
      const txt = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
      if (txt.startsWith('special attack') || txt.startsWith('use item')) return false;
      return txt === 'attack' || txt.startsWith('attack');
    });
    if (!attackBtn) return false;
    try { attackBtn.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { attackBtn.click(); return true; } catch { return false; }
  }).catch(() => false);
}

async function clickAttackExactAcrossFrames(page) {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const frames = page.frames ? page.frames() : [page.mainFrame?.()].filter(Boolean);

  for (const frame of frames) {
    const candidates = await frame.$x(
      `//button[normalize-space()='Attack'] | //a[normalize-space()='Attack'] | //*[@role='button' and normalize-space()='Attack'] | //input[translate(normalize-space(@value), '${upper}', '${lower}')='attack']`
    ).catch(() => []);

    for (const h of candidates) {
      try {
        const isOk = await h.evaluate((el) => {
          if (!el || el.disabled) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).catch(() => false);
        if (!isOk) {
          await h.dispose().catch(() => {});
          continue;
        }
        const clicked = await clickHandleRobust(h);
        await h.dispose().catch(() => {});
        if (clicked) return true;
      } catch {
        await h.dispose().catch(() => {});
      }
    }
  }

  return false;
}

async function clickAttackByTextProbe(page) {
  return await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const all = Array.from(document.querySelectorAll('*')).slice(0, 1500);
    for (const el of all) {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (!txt) continue;
      if (txt !== 'attack') continue;
      if (txt.includes('special attack') || txt.includes('use item')) continue;

      let clickable = el;
      let depth = 0;
      while (clickable && depth < 6) {
        const tag = (clickable.tagName || '').toLowerCase();
        const role = (clickable.getAttribute && clickable.getAttribute('role')) || '';
        const cls = (clickable.className || '').toString().toLowerCase();
        if (
          tag === 'button' ||
          tag === 'a' ||
          role === 'button' ||
          cls.includes('btn') ||
          !!clickable.onclick ||
          !!(clickable.getAttribute && (clickable.getAttribute('x-on:click') || clickable.getAttribute('@click')))
        ) {
          break;
        }
        clickable = clickable.parentElement;
        depth += 1;
      }

      if (!clickable || !isVisible(clickable)) continue;
      try { clickable.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try { clickable.click(); return true; } catch {}
    }

    return false;
  }).catch(() => false);
}

async function clickFightAction(page) {
  const handles = await page.$$('button, a, [role="button"], .btn, input[type="submit"], input[type="button"]');
  let confirm = null;

  for (const h of handles) {
    const info = await h.evaluate((el) => {
      if (!el || el.disabled) return null;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const txt = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
      return { txt };
    }).catch(() => null);
    if (!info) continue;

    if (info.txt.includes('leave') || info.txt.includes('close')) continue;
    if (/back|cancel|return/.test(info.txt)) continue;
    if (info.txt === 'attack') {
      if (await clickHandleRobust(h)) return 'attack';
      continue;
    }
    if (info.txt.includes('attack') && !info.txt.includes('special attack')) {
      if (await clickHandleRobust(h)) return 'attack';
      continue;
    }
    if (!confirm && (info.txt.includes('continue') || info.txt.includes('confirm') || info.txt === 'ok' || info.txt === 'yes')) {
      confirm = h;
    }
  }

  if (confirm && await clickHandleRobust(confirm)) return 'confirm';
  return 'none';
}

function withGenerateMisses(socket, missingMsg, retryLimit, retryPhase, retryMsg) {
  state.generateMisses += 1;
  if (state.generateMisses % 2 === 1) {
    socket?.emit('bot-log', `${missingMsg} (miss ${state.generateMisses})`);
  }
  if (state.generateMisses >= retryLimit) {
    resetPhaseState(retryPhase);
    socket?.emit('bot-log', retryMsg);
  }
}

async function handlePhaseMenu(page, socket) {
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
    resetPhaseState(PHASE.GENERATE_OPEN);
    socket?.emit('bot-log', 'Battle burst: Battle NPCs clicked -> waiting for Generate Enemy');
  } else {
    resetPhaseState(PHASE.GENERATE_CONFIRM);
    socket?.emit('bot-log', 'Battle burst: Generate Enemy clicked -> waiting for Generate');
  }
  return humanDelay('combat', 2200, 3400, { afterCombat: true });
}

async function handlePhaseGenerateOpen(page, socket) {
  const generateBtn = await findGenerateEnemyHandle(page);
  if (!generateBtn) {
    withGenerateMisses(socket, 'Battle burst: Generate Enemy not found yet', 8, PHASE.MENU, 'Battle burst: retrying from Battle NPCs');
    return humanDelay('combat', 2400, 3800);
  }

  if (!(await clickHandleRobust(generateBtn))) {
    withGenerateMisses(socket, 'Battle burst: Generate Enemy click failed', 8, PHASE.MENU, 'Battle burst: retrying from Battle NPCs');
    return humanDelay('combat', 2400, 3800);
  }

  resetPhaseState(PHASE.GENERATE_CONFIRM);
  socket?.emit('bot-log', 'Battle burst: Generate Enemy clicked -> waiting for Generate');
  return humanDelay('combat', 2200, 3600, { afterCombat: true });
}

async function handlePhaseGenerateConfirm(page, socket, sessionStats) {
  const confirmGenerate = await findGenerateConfirmHandle(page);
  if (!confirmGenerate) {
    withGenerateMisses(socket, 'Battle burst: Generate button not found yet', 10, PHASE.GENERATE_OPEN, 'Battle burst: retrying Generate Enemy step');
    return humanDelay('combat', 2300, 3600);
  }

  if (!(await clickHandleRobust(confirmGenerate))) {
    withGenerateMisses(socket, 'Battle burst: Generate button click failed', 10, PHASE.GENERATE_OPEN, 'Battle burst: retrying Generate Enemy step');
    return humanDelay('combat', 2400, 3800);
  }

  resetPhaseState(PHASE.BATTLE_ENTER);
  sessionStats.energy = Math.max(0, Number(sessionStats.energy || 0) - 1);
  if (Number(sessionStats.max_energy || 0) > 0) {
    sessionStats.energy_percent = Math.max(0, Math.min(100, (Number(sessionStats.energy) / Number(sessionStats.max_energy)) * 100));
  }
  socket?.emit('bot-log', 'Battle burst: Generate clicked -> waiting for Battle');
  return humanDelay('combat', 2200, 3600, { afterCombat: true });
}

async function handlePhaseBattleEnter(page, socket) {
  const battleBtn = await findBattleEnterHandle(page);
  if (!battleBtn) {
    withGenerateMisses(socket, 'Battle burst: Battle button not found yet', 8, PHASE.GENERATE_OPEN, 'Battle burst: retrying from Generate Enemy step');
    return humanDelay('combat', 2200, 3600);
  }

  if (!(await clickHandleRobust(battleBtn))) {
    withGenerateMisses(socket, 'Battle burst: Battle button click failed', 8, PHASE.GENERATE_OPEN, 'Battle burst: retrying from Generate Enemy step');
    return humanDelay('combat', 2400, 3800);
  }

  resetPhaseState(PHASE.FIGHT);
  state.lastBattleContextSeenAt = Date.now();
  socket?.emit('bot-log', 'Battle burst: Battle clicked');
  return humanDelay('combat', 2600, 4200, { afterCombat: true });
}

async function handlePhaseFight(page, socket) {
  const quickGenerateBtn = await findQuickGenerateHandle(page);
  if (quickGenerateBtn && await clickHandleRobust(quickGenerateBtn)) {
    state.fightMisses = 0;
    resetPhaseState(PHASE.BATTLE_ENTER);
    socket?.emit('bot-log', 'Battle burst: Generate Next Opponent clicked');
    return humanDelay('combat', 2400, 3800, { afterCombat: true });
  }

  const exactAttackBtn = await findBattleAttackHandle(page);
  if (exactAttackBtn && await clickHandleRobust(exactAttackBtn)) {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Attack clicked (attack(false))');
    return humanDelay('combat', 3000, 4600, { afterCombat: true });
  }

  if (await clickAttackExactAcrossFrames(page)) {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Attack clicked (exact/frame)');
    return humanDelay('combat', 3000, 4600, { afterCombat: true });
  }

  if (await clickAttackDirect(page)) {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Attack clicked (direct)');
    return humanDelay('combat', 3000, 4600, { afterCombat: true });
  }

  if (await clickAttackByTextProbe(page)) {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Attack clicked (text probe)');
    return humanDelay('combat', 3000, 4600, { afterCombat: true });
  }

  const action = await clickFightAction(page);
  if (action === 'attack') {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Attack clicked');
    return humanDelay('combat', 3000, 4600, { afterCombat: true });
  }
  if (action === 'confirm') {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Continue clicked');
    return humanDelay('combat', 2600, 4200, { afterCombat: true });
  }
  state.fightMisses += 1;
  if (state.fightMisses % 4 === 1) {
    socket?.emit('bot-log', `Battle burst: waiting for attack state (miss ${state.fightMisses}) @ ${page.url()}`);
  }
  if (state.fightMisses >= 20) {
    resetPhaseState(PHASE.BATTLE_ENTER);
    socket?.emit('bot-log', 'Battle burst: fight stalled, retrying Battle entry');
  }
  return humanDelay('combat', 2200, 3600);
}

const PHASE_HANDLERS = {
  [PHASE.MENU]: handlePhaseMenu,
  [PHASE.GENERATE_OPEN]: handlePhaseGenerateOpen,
  [PHASE.GENERATE_CONFIRM]: handlePhaseGenerateConfirm,
  [PHASE.BATTLE_ENTER]: handlePhaseBattleEnter,
  [PHASE.FIGHT]: handlePhaseFight
};

function isBattleContextUrl(url) {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('/battle') ||
    u.includes('/combat') ||
    u.includes('/monster/attack')
  );
}

async function handleBattleEnergy(page, socket, sessionStats) {
  try {
    const now = Date.now();
    const currentUrl = page.url();
    const inBattleContext = isBattleContextUrl(currentUrl);
    if (inBattleContext) {
      state.lastBattleContextSeenAt = now;
    }

    if (!inBattleContext) {
      // Na "Battle clicked" kan URL kort onstabiel zijn; niet meteen hard recoveren.
      const recentlyInBattle = state.lastBattleContextSeenAt > 0 && (now - state.lastBattleContextSeenAt) < 12000;
      if (state.phase === PHASE.FIGHT || state.phase === PHASE.BATTLE_ENTER || recentlyInBattle) {
        if (state.fightMisses % 4 === 0) {
          socket?.emit('bot-log', `Battle burst: transient URL outside battle, holding phase (${state.phase}) @ ${currentUrl}`);
        }
        state.fightMisses += 1;
        if (state.phase === PHASE.BATTLE_ENTER) {
          state.phase = PHASE.FIGHT;
        }
        return humanDelay('combat', 1800, 3000, { afterNav: true });
      }

      resetPhaseState(PHASE.MENU);
      if (now - state.lastArenaRecoverAt > 15000) {
        state.lastArenaRecoverAt = now;
        socket?.emit('bot-log', 'Battle burst active: recovering to /battle/arena');
      }
      await page.goto('https://web.simple-mmo.com/battle/arena?new_page=true', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });
      return humanDelay('combat', 2400, 3600, { afterNav: true });
    }

    if (String(currentUrl).toLowerCase().includes('/combat') && state.phase !== PHASE.FIGHT) {
      state.phase = PHASE.FIGHT;
      state.fightMisses = 0;
      socket?.emit('bot-log', 'Battle burst: combat page detected -> switching to fight phase');
    }

    // Deterministische knop-prioriteit (voorkomt "gek" menu-gedrag):
    // 1) Quick-generate (win scherm), 2) Attack, 3) Continue/OK,
    // 4) Battle, 5) Generate, 6) Generate Enemy, 7) Battle NPCs
    const quickGenerateBtn = await findQuickGenerateHandle(page);
    if (quickGenerateBtn && await clickHandleRobust(quickGenerateBtn)) {
      state.fightMisses = 0;
      resetPhaseState(PHASE.BATTLE_ENTER);
      socket?.emit('bot-log', 'Battle burst: Generate Next Opponent clicked');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    const attackBtn = await findBattleAttackHandle(page);
    if (attackBtn && await clickHandleRobust(attackBtn)) {
      state.fightMisses = 0;
      state.phase = PHASE.FIGHT;
      socket?.emit('bot-log', 'Battle burst: Attack clicked (attack(false))');
      return humanDelay('combat', 3000, 4600, { afterCombat: true });
    }

    const continueBtn = await findContinueHandle(page);
    if (continueBtn && await clickHandleRobust(continueBtn)) {
      state.fightMisses = 0;
      state.phase = PHASE.FIGHT;
      socket?.emit('bot-log', 'Battle burst: Continue clicked');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    const battleBtn = await findBattleEnterHandle(page);
    if (battleBtn && await clickHandleRobust(battleBtn)) {
      state.fightMisses = 0;
      resetPhaseState(PHASE.FIGHT);
      state.lastBattleContextSeenAt = Date.now();
      socket?.emit('bot-log', 'Battle burst: Battle clicked');
      return humanDelay('combat', 2400, 3800, { afterCombat: true });
    }

    const generateConfirmBtn = await findGenerateConfirmHandle(page);
    if (generateConfirmBtn && await clickHandleRobust(generateConfirmBtn)) {
      state.generateMisses = 0;
      resetPhaseState(PHASE.BATTLE_ENTER);
      sessionStats.energy = Math.max(0, Number(sessionStats.energy || 0) - 1);
      if (Number(sessionStats.max_energy || 0) > 0) {
        sessionStats.energy_percent = Math.max(0, Math.min(100, (Number(sessionStats.energy) / Number(sessionStats.max_energy)) * 100));
      }
      socket?.emit('bot-log', 'Battle burst: Generate clicked -> waiting for Battle');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    const generateEnemyBtn = await findGenerateEnemyHandle(page);
    if (generateEnemyBtn && await clickHandleRobust(generateEnemyBtn)) {
      state.generateMisses = 0;
      resetPhaseState(PHASE.GENERATE_CONFIRM);
      socket?.emit('bot-log', 'Battle burst: Generate Enemy clicked -> waiting for Generate');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    const npcBtn = await findBattleNpcHandle(page);
    if (npcBtn && await clickHandleRobust(npcBtn)) {
      state.generateMisses = 0;
      resetPhaseState(PHASE.GENERATE_OPEN);
      socket?.emit('bot-log', 'Battle burst: Battle NPCs clicked -> waiting for Generate Enemy');
      return humanDelay('combat', 2200, 3600, { afterCombat: true });
    }

    state.fightMisses += 1;
    if (state.fightMisses % 5 === 1) {
      socket?.emit('bot-log', `Battle burst: no target button found (phase=${state.phase}) @ ${currentUrl}`);
    }
    if (state.fightMisses >= 18) {
      resetPhaseState(PHASE.MENU);
      socket?.emit('bot-log', 'Battle burst: stalled, resetting to menu phase');
    }
    return humanDelay('combat', 1800, 3000);
  } catch (err) {
    socket?.emit('bot-log', `Battle burst error: ${err.message}`);
    return humanDelay('combat', 3000, 4800, { afterNav: true });
  }
}

module.exports = {
  shouldRunBattleBurst,
  handleBattleEnergy
};
