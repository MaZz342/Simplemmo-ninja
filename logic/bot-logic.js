// bot-logic.js - anti-double-start + stop on captcha + alarm

let loopTimeout = null;
let isRunning = false;

const { checkCaptcha } = require('./captcha');
const { handleTravel } = require('./travel');
const { handleCombat } = require('./combat');
const { handleQuests } = require('./quests');

function startBotLoop(socket, page, settings, sessionStats) {
  if (isRunning) {
    socket.emit('bot-log', 'Bot is already running - no new start');
    console.log('[BOT] Already running -> no new start');
    return false;
  }

  isRunning = true;
  socket.emit('bot-log', 'Bot loop started - step mode active');
  console.log('[BOT] startBotLoop aangeroepen');

  const runLoop = async () => {
    if (!isRunning) return;

    try {
      const stats = sessionStats || { steps: 0, items: 0 };

      if (await checkCaptcha(page)) {
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

      if (s.combat) {
        delay = await handleCombat(page, socket, stats);
        if (delay > 0) {
          loopTimeout = setTimeout(runLoop, delay);
          return;
        }
      }

      if (s.quests) {
        delay = await handleQuests(page, socket);
        if (delay > 0) {
          loopTimeout = setTimeout(runLoop, delay);
          return;
        }
      }

      delay = await handleTravel(page, s, stats, socket);
      if (!(delay > 0)) delay = 6000 + Math.random() * 3000;

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
  return true;
}

function isBotRunning() {
  return isRunning;
}

module.exports = {
  startBotLoop,
  stopBotLoop,
  isBotRunning
};
