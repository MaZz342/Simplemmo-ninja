// bot-logic.js – versie met anti-dubbel-start bescherming + STOP bij captcha + alarm

let loopTimeout = null;
let isRunning = false;

// laad modules één keer
const { checkCaptcha } = require('./logic/captcha');
const { handleTravel } = require('./logic/travel');
const { handleCombat } = require('./logic/combat');
const { handleGathering } = require('./logic/gathering');
const { handleQuests } = require('./logic/quests');

function startBotLoop(socket, page, settings, sessionStats) {
  if (isRunning) {
    socket.emit('bot-log', 'Bot is al bezig – geen nieuwe start');
    console.log('[BOT] Al running → geen nieuwe start');
    return;
  }

  isRunning = true;
  socket.emit('bot-log', 'Bot loop gestart – stappen modus actief');
  console.log('[BOT] startBotLoop aangeroepen');

  const runLoop = async () => {
    if (!isRunning) return;

    try {
      const stats = sessionStats || { steps: 0, items: 0 };

      // ✅ Captcha / Anti-bot check (STOP + ALARM)
      if (await checkCaptcha(page)) {
        const msg = '🧩 CAPTCHA / anti-bot gedetecteerd → bot is gestopt (los dit handmatig op)';
        socket.emit('bot-log', msg);

        // alarm event naar dashboard
        socket.emit('alarm', {
          type: 'captcha',
          message: 'CAPTCHA/anti-bot gedetecteerd: "Woah! Hold up there. I\'m a person! Promise!"'
        });

        // stop loop echt
        stopBotLoop();
        socket.emit('status', false);
        return;
      }

      const s = settings || {};
      let delay = 0;

      if (s.combat) {
        delay = await handleCombat(page, socket);
        if (delay > 0) return (loopTimeout = setTimeout(runLoop, delay));
      }

      if (s.quests) {
        delay = await handleQuests(page, socket);
        if (delay > 0) return (loopTimeout = setTimeout(runLoop, delay));
      }

      if (s.resources) {
        delay = await handleGathering(page, socket);
        if (delay > 0) return (loopTimeout = setTimeout(runLoop, delay));
      }

      // fallback travel/steps
      delay = await handleTravel(page, s, stats, socket);
      if (!(delay > 0)) delay = 6000 + Math.random() * 3000;

      loopTimeout = setTimeout(runLoop, delay);
    } catch (err) {
      console.error('[BOT LOOP FOUT]', err.message, err.stack);
      socket.emit('bot-log', '❌ Loop fout: ' + err.message);
      loopTimeout = setTimeout(runLoop, 10000);
    }
  };

  loopTimeout = setTimeout(runLoop, 100);
}

function stopBotLoop() {
  if (loopTimeout) {
    clearTimeout(loopTimeout);
    loopTimeout = null;
    console.log('[BOT] loopTimeout gestopt');
  }
  isRunning = false;
}

module.exports = {
  startBotLoop,
  stopBotLoop
};
