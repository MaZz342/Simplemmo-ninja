require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { startBrowser, getPage } = require('./browser');
const botModule = require('./logic/bot-logic');

const startLoop = botModule.startLoop || botModule.startBotLoop;
const stopLoop = botModule.stopLoop || botModule.stopBotLoop || (() => {});

if (typeof startLoop !== 'function') {
  console.error('logic/bot-logic.js mist export: startLoop() of startBotLoop()');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const sessionStats = {
  steps: 0,
  items: 0,
  gold: '0',
  xp: 0,
  qp: 0,
  max_qp: 0,
  level: 0,
  username: '-',
  bank: '0',
  hp_percent: 100,
};

let botRunning = false;

io.on('connection', (socket) => {
  console.log('Dashboard verbonden');

  const emitStats = () => {
    socket.emit('update-stats', sessionStats);
  };

  emitStats();
  const statsInterval = setInterval(emitStats, 1000);

  const doStartBrowser = async () => {
    try {
      socket.emit('bot-log', 'Browser starten...');
      await startBrowser(socket, sessionStats);
      socket.emit('ready');
      socket.emit('browser-ready');
      socket.emit('bot-log', 'Browser gestart');
      emitStats();
    } catch (err) {
      console.error('[start browser]', err);
      socket.emit('bot-log', 'Browser start fout: ' + (err?.message || String(err)));
    }
  };

  socket.on('start-game', doStartBrowser);
  socket.on('start-browser', doStartBrowser);

  const doStopBot = () => {
    if (typeof stopLoop === 'function') {
      stopLoop();
    }
    botRunning = false;
    socket.emit('status', false);
    socket.emit('bot-log', 'Bot gestopt');
    emitStats();
  };

  const doToggleBot = (settings) => {
    const page = getPage();
    if (!page) {
      socket.emit('bot-log', 'Eerst "Open Browser" klikken.');
      return;
    }

    if (botRunning) {
      doStopBot();
      return;
    }

    startLoop(socket, page, settings || {}, sessionStats);
    botRunning = true;
    socket.emit('status', true);
    socket.emit('bot-log', 'Bot gestart');
    emitStats();
  };

  socket.on('toggle', doToggleBot);
  socket.on('toggle-bot', doToggleBot);
  socket.on('stop-bot', doStopBot);

  socket.on('disconnect', () => {
    clearInterval(statsInterval);
    console.log('Dashboard verbinding verbroken');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server draait op http://localhost:${PORT}`);
});
