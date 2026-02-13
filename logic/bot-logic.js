// bot-logic.js - anti-double-start + stop on captcha + alarm

let loopTimeout = null;
let isRunning = false;
let questBurstActive = false;
let battleBurstActive = false;
let captchaPauseActive = false;
let lastQuestWaitLogAt = 0;
let lastBattleWaitLogAt = 0;
const MIN_LOOP_DELAY_MS = 1500;

const { checkCaptcha } = require('./captcha');
const { handleTravel } = require('./travel');
const { handleCombat } = require('./combat');
const { handleQuests } = require('./quests');
const { handleBattleEnergy, shouldRunBattleBurst } = require('./battle-energy');

function getQuestPointState(stats) {
  const qp = Number(stats?.qp ?? stats?.quest_points ?? 0);
  const maxQp = Number(stats?.max_qp ?? stats?.max_quest_points ?? 0);
  return {
    qp: Number.isFinite(qp) ? qp : 0,
    maxQp: Number.isFinite(maxQp) ? maxQp : 0
  };
}

function shouldRunQuestBurst(stats, socket) {
  const { qp, maxQp } = getQuestPointState(stats);

  if (!(maxQp > 0)) {
    return false;
  }

  if (questBurstActive) {
    if (qp <= 0) {
      questBurstActive = false;
      socket.emit('bot-log', 'Quest burst finished: points depleted, waiting for full refill');
      return false;
    }
    return true;
  }

  if (qp >= maxQp) {
    questBurstActive = true;
    socket.emit('bot-log', `Quest burst started at full points (${qp}/${maxQp})`);
    return true;
  }

  const now = Date.now();
  if (now - lastQuestWaitLogAt > 30000) {
    lastQuestWaitLogAt = now;
    socket.emit('bot-log', `Quest burst waiting for full points (${qp}/${maxQp})`);
  }
  return false;
}

function startBotLoop(socket, page, settings, sessionStats) {
  if (isRunning) {
    socket.emit('bot-log', 'Bot is already running - no new start');
    console.log('[BOT] Already running -> no new start');
    return false;
  }

  isRunning = true;
  captchaPauseActive = false;
  questBurstActive = false;
  battleBurstActive = false;
  lastQuestWaitLogAt = 0;
  lastBattleWaitLogAt = 0;
  socket.emit('bot-log', 'Bot loop started - step mode active');
  console.log('[BOT] startBotLoop aangeroepen');

  const runLoop = async () => {
    if (!isRunning) return;

    try {
      const stats = sessionStats || { steps: 0, items: 0 };

      if (await checkCaptcha(page)) {
        captchaPauseActive = true;
        const msg = 'CAPTCHA / anti-bot detected -> bot was stopped (solve this manually)';
        socket.emit('bot-log', msg);

        socket.emit('alarm', {
          type: 'captcha',
          message: 'CAPTCHA/anti-bot gedetecteerd: "Woah! Hold up there. I\'m a person! Promise!"'
        });

        stopBotLoop();
        socket.emit('status', false);
        return;
      }

      const s = settings || {};
      let delay = 0;

      if (s.battleEnergy) {
        battleBurstActive = shouldRunBattleBurst(stats, battleBurstActive, socket);
        if (!battleBurstActive) {
          const energy = Number(stats?.energy ?? 0);
          const maxEnergy = Number(stats?.max_energy ?? 0);
          if (maxEnergy > 0 && Date.now() - lastBattleWaitLogAt > 30000) {
            lastBattleWaitLogAt = Date.now();
            socket.emit('bot-log', `Battle burst waiting for full energy (${energy}/${maxEnergy})`);
          }
        }
        if (battleBurstActive) {
          delay = await handleBattleEnergy(page, socket, stats);
          if (delay > 0) {
            delay = Math.max(MIN_LOOP_DELAY_MS, Math.round(delay));
            loopTimeout = setTimeout(runLoop, delay);
            return;
          }
        }
      }

      if (s.combat) {
        delay = await handleCombat(page, socket, stats);
        if (delay > 0) {
          delay = Math.max(MIN_LOOP_DELAY_MS, Math.round(delay));
          loopTimeout = setTimeout(runLoop, delay);
          return;
        }
      }

      if (s.quests) {
        const runQuestNow = shouldRunQuestBurst(stats, socket);
        if (runQuestNow) {
          delay = await handleQuests(page, socket, stats);
          if (delay > 0) {
            delay = Math.max(MIN_LOOP_DELAY_MS, Math.round(delay));
            loopTimeout = setTimeout(runLoop, delay);
            return;
          }
        }
      }

      delay = await handleTravel(page, s, stats, socket);
      if (!(delay > 0)) delay = 6000 + Math.random() * 3000;
      delay = Math.max(MIN_LOOP_DELAY_MS, Math.round(delay));

      loopTimeout = setTimeout(runLoop, delay);
    } catch (err) {
      console.error('[BOT LOOP FOUT]', err.message, err.stack);
      socket.emit('bot-log', 'Loop error: ' + err.message);
      loopTimeout = setTimeout(runLoop, 10000);
    }
  };

  loopTimeout = setTimeout(runLoop, 100);
  return true;
}

function stopBotLoop() {
  if (loopTimeout) {
    clearTimeout(loopTimeout);
    loopTimeout = null;
    console.log('[BOT] loopTimeout stopped');
  }
  isRunning = false;
  questBurstActive = false;
  battleBurstActive = false;
  lastQuestWaitLogAt = 0;
  lastBattleWaitLogAt = 0;
  return true;
}

function isBotRunning() {
  return isRunning;
}

function isCaptchaPauseActive() {
  return captchaPauseActive;
}

module.exports = {
  startBotLoop,
  stopBotLoop,
  isBotRunning,
  isCaptchaPauseActive
};
