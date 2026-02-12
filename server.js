require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { startBrowser, getPage } = require('./browser');

// In jouw structuur staat bot-logic in /logic
const botModule = require('./logic/bot-logic');

// Support beide mogelijke exports: startLoop OF startBotLoop (wat jij ook hebt)
const startLoop = botModule.startLoop || botModule.startBotLoop;
const stopLoop = botModule.stopLoop || botModule.stopBotLoop || (() => {});

if (typeof startLoop !== 'function') {
  console.error('❌ logic/bot-logic.js mist export: startLoop() of startBotLoop()');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ✅ public static + index.html uit /public
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Session stats (minimaal, kan uitbreiden)
let sessionStats = {
  steps: 0,
  items: 0,
  gold: "0",
  xp: 0,
  qp: 0,
  max_qp: 0,
  level: 0,
  username: "-",
  bank: "0",
  hp_percent: 100,
};

let botRunning = false;

io.on('connection', (socket) => {
  console.log('Dashboard verbonden');

  // ---------- START BROWSER (compat) ----------
  const doStartBrowser = async () => {
    try {
      socket.emit('bot-log', '🟡 Browser starten...');
      await startBrowser(socket, sessionStats);
      socket.emit('ready');         // voor UI variant A
      socket.emit('browser-ready'); // voor UI variant B
      socket.emit('bot-log', '✅ Browser gestart');
    } catch (err) {
      console.error('[start browser]', err);
      socket.emit('bot-log', '❌ Browser start fout: ' + (err?.message || String(err)));
    }
  };

  socket.on('start-game', doStartBrowser);     // UI variant A :contentReference[oaicite:2]{index=2}
  socket.on('start-browser', doStartBrowser);  // UI variant B :contentReference[oaicite:3]{index=3}

  // ---------- TOGGLE BOT (compat) ----------
  const doToggleBot = (settings) => {
    const page = getPage();
    if (!page) {
      socket.emit('bot-log', '⚠️ Eerst "Open Browser" klikken.');
      return;
    }

    // Als jouw bot-logic een “toggle” heeft (zoals startLoop die zelf togglet), dan is botRunning niet nodig,
    // maar we houden het simpel: we togglen hier mee voor UI status.
    if (botRunning && typeof stopLoop === 'function') {
      stopLoop();
      botRunning = false;
      socket.emit('status', false);
      socket.emit('bot-log', '🛑 Bot gestopt');
      return;
    }

    // Start
    startLoop(socket, page, settings || {}, sessionStats);
    botRunning = true;
    socket.emit('status', true);
    socket.emit('bot-log', '🚀 Bot gestart');
  };

  socket.on('toggle', doToggleBot);       // UI variant A :contentReference[oaicite:4]{index=4}
  socket.on('toggle-bot', doToggleBot);   // UI variant B :contentReference[oaicite:5]{index=5}

  socket.on('disconnect', () => console.log('Dashboard verbinding verbroken'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server draait op http://localhost:${PORT}`);
});
