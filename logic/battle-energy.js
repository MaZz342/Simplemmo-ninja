// logic/battle-energy.js - compact battle arena state machine

const { humanDelay } = require('./human-delay');

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
  lastArenaRecoverAt: 0
};

function resetPhaseState(nextPhase = PHASE.MENU) {
  state.phase = nextPhase;
  state.generateMisses = 0;
  state.fightMisses = 0;
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
  if (!handle) return false;
  await handle.evaluate((el) => {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
  }).catch(() => {});

  const clickedViaPuppeteer = await handle.click({ delay: 120 + Math.random() * 160 }).then(() => true).catch(() => false);
  if (clickedViaPuppeteer) return true;

  return await handle.evaluate((el) => {
    try { el.click(); return true; } catch { return false; }
  }).catch(() => false);
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

async function clickFightAction(page) {
  const handles = await page.$$('button, a, [role="button"], .btn, input[type="submit"], input[type="button"]');
  let confirm = null;
  let close = null;

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

    if (!close && (info.txt.includes('leave') || info.txt.includes('close'))) {
      close = h;
      continue;
    }
    if (/back|cancel|return/.test(info.txt)) continue;
    if (info.txt === 'attack' || info.txt.includes('attack')) {
      if (await clickHandleRobust(h)) return 'attack';
      continue;
    }
    if (!confirm && (info.txt.includes('continue') || info.txt.includes('confirm') || info.txt === 'ok' || info.txt === 'yes')) {
      confirm = h;
    }
  }

  if (close && await clickHandleRobust(close)) return 'close';
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
  socket?.emit('bot-log', 'Battle burst: Battle clicked');
  return humanDelay('combat', 2600, 4200, { afterCombat: true });
}

async function handlePhaseFight(page, socket) {
  if (await clickAttackDirect(page)) {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Attack clicked (direct)');
    return humanDelay('combat', 3000, 4600, { afterCombat: true });
  }

  const retryBattleBtn = await findBattleEnterHandle(page);
  if (retryBattleBtn && await clickHandleRobust(retryBattleBtn)) {
    state.fightMisses = 0;
    socket?.emit('bot-log', 'Battle burst: Battle clicked (retry for attack state)');
    return humanDelay('combat', 2200, 3600, { afterCombat: true });
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
  if (action === 'close') {
    resetPhaseState(PHASE.MENU);
    socket?.emit('bot-log', 'Battle burst: Leave/Close clicked, next NPC');
    return humanDelay('close', 1800, 3000, { afterCombat: true });
  }

  state.fightMisses += 1;
  if (state.fightMisses % 4 === 1) {
    socket?.emit('bot-log', `Battle burst: waiting for attack state (miss ${state.fightMisses})`);
  }
  if (state.fightMisses >= 14) {
    resetPhaseState(PHASE.MENU);
    socket?.emit('bot-log', 'Battle burst: fight stalled, restarting NPC cycle');
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

async function handleBattleEnergy(page, socket, sessionStats) {
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('/battle')) {
      resetPhaseState(PHASE.MENU);
      const now = Date.now();
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

    const handler = PHASE_HANDLERS[state.phase] || handlePhaseMenu;
    return await handler(page, socket, sessionStats);
  } catch (err) {
    socket?.emit('bot-log', `Battle burst error: ${err.message}`);
    return humanDelay('combat', 3000, 4800, { afterNav: true });
  }
}

module.exports = {
  shouldRunBattleBurst,
  handleBattleEnergy
};
