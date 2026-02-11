// bot-logic.js – versie met anti-dubbel-start bescherming

let loopTimeout = null;
let isRunning = false;

// laad modules één keer (geen require in de loop)
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
        console.log('[BOT] Nieuwe loop cyclus');

        if (!isRunning) {
            console.log('[BOT] Gestopt door stopBotLoop of externe stop');
            return;
        }

        try {
            socket.emit('bot-log', 'Loop cyclus start');

            const stats = sessionStats || { steps: 0, items: 0 };

            // 1) Captcha check (altijd)
            if (await checkCaptcha(page)) {
                socket.emit('bot-log', '🧩 Captcha/security check gedetecteerd → los dit handmatig op');
                loopTimeout = setTimeout(runLoop, 5000);
                return;
            }

            // 2) Optionele taken (settings)
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

            // 3) Fallback: travel/steps
            socket.emit('bot-log', 'handleTravel wordt uitgevoerd...');
            delay = await handleTravel(page, socket, stats);
            if (!(delay > 0)) delay = 6000 + Math.random() * 3000;

            socket.emit('bot-log', `Volgende check over ~${Math.round(delay / 1000)} seconden`);
            console.log('[BOT] Volgende loop in', delay, 'ms');

            loopTimeout = setTimeout(runLoop, delay);
        } catch (err) {
            console.error('[BOT LOOP FOUT]', err.message, err.stack);
            socket.emit('bot-log', '❌ Loop fout: ' + err.message + ' → zie terminal');
            loopTimeout = setTimeout(runLoop, 10000);
        }
    };

    console.log('[BOT] runLoop starten');
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
