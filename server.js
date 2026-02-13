require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { startBrowser, closeBrowser, getPage, setBrowserWindowConfig, getBrowserWindowConfig } = require('./browser');
const botModule = require('./logic/bot-logic');

const startLoop = botModule.startLoop || botModule.startBotLoop;
const stopLoop = botModule.stopLoop || botModule.stopBotLoop || (() => {});
const getLoopRunningState = botModule.isBotRunning || botModule.isRunning || (() => false);

if (typeof startLoop !== 'function') {
  console.error('logic/bot-logic.js is missing export: startLoop() or startBotLoop()');
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
  points: 0,
  gold: '0',
  xp: 0,
  xp_remaining: 0,
  xp_progress: 0,
  qp: 0,
  max_qp: 0,
  qp_percent: 0,
  level: 0,
  username: '-',
  bank: '0',
  diamonds: 0,
  total_steps: 0,
  current_hp: 0,
  max_hp: 0,
  hp_percent: 100,
  stats_updated_at: 0,
};

let botRunning = false;
let cleanupInProgress = null;
let controllerSocketId = null;

function isController(socket) {
  return controllerSocketId === socket.id;
}

function claimController(socket) {
  if (!controllerSocketId) {
    controllerSocketId = socket.id;
    socket.emit('bot-log', 'Controller rights granted to this session');
    return true;
  }
  return isController(socket);
}

function requireController(socket, actionLabel) {
  if (claimController(socket)) {
    return true;
  }

  socket.emit('bot-log', `Action blocked (${actionLabel}): another client is controller`);
  socket.emit('control-denied', {
    action: actionLabel,
    reason: 'controller-locked',
    controllerActive: true
  });
  return false;
}

async function cleanupRuntime(reason, socket) {
  if (cleanupInProgress) {
    return cleanupInProgress;
  }

  cleanupInProgress = (async () => {
    try {
      if (typeof stopLoop === 'function') {
        stopLoop();
      }
      botRunning = !!getLoopRunningState();
      if (botRunning) {
        stopLoop();
        botRunning = false;
      }

      if (socket) {
        socket.emit('status', false);
        socket.emit('bot-log', reason);
      } else {
        io.emit('status', false);
        io.emit('bot-log', reason);
      }

      await closeBrowser(socket);
    } catch (err) {
      console.error('[cleanup runtime]', err);
    } finally {
      cleanupInProgress = null;
    }
  })();

  return cleanupInProgress;
}

io.on('connection', (socket) => {
  console.log('Dashboard connected');
  let lastStatus = null;

  const normalizeStats = (stats) => {
    const steps = Number(stats?.steps || 0);
    const items = Number(stats?.items || 0);
    const points = Number.isFinite(Number(stats?.points)) ? Number(stats.points) : (steps + items);
    const xpProgress = Number.isFinite(Number(stats?.xp_progress)) ? Math.max(0, Math.min(100, Number(stats.xp_progress))) : 0;
    const hpPercent = Number.isFinite(Number(stats?.hp_percent)) ? Math.max(0, Math.min(100, Number(stats.hp_percent))) : 0;
    const qpPercent = Number.isFinite(Number(stats?.qp_percent)) ? Math.max(0, Math.min(100, Number(stats.qp_percent))) : 0;

    return {
      ...stats,
      steps,
      items,
      points,
      xp_progress: xpProgress,
      hp_percent: hpPercent,
      qp_percent: qpPercent
    };
  };

  const emitStats = () => {
    const running = !!getLoopRunningState();
    botRunning = running;
    if (running !== lastStatus) {
      socket.emit('status', running);
      lastStatus = running;
    }
    const safeStats = normalizeStats(sessionStats);
    sessionStats.points = safeStats.points;
    socket.emit('update-stats', safeStats);
  };

  emitStats();
  const statsInterval = setInterval(emitStats, 1000);
  socket.emit('browser-window-config', getBrowserWindowConfig());

  const doStartBrowser = async () => {
    if (!requireController(socket, 'start-browser')) {
      return;
    }

    try {
      socket.emit('bot-log', 'Starting browser...');
      await startBrowser(socket, sessionStats);
      socket.emit('ready');
      socket.emit('browser-ready');
      socket.emit('bot-log', 'Browser started');
      emitStats();
    } catch (err) {
      console.error('[start browser]', err);
      socket.emit('bot-log', 'Browser start error: ' + (err?.message || String(err)));
    }
  };

  socket.on('start-game', doStartBrowser);
  socket.on('start-browser', doStartBrowser);
  socket.on('set-browser-window', (cfg) => {
    if (!requireController(socket, 'set-browser-window')) {
      return;
    }
    const next = setBrowserWindowConfig(cfg || {});
    socket.emit('browser-window-config', next);
    socket.emit('bot-log', `Browser window updated: ${next.mode}${next.mode === 'windowed' ? ` (${next.width}x${next.height})` : ''}`);
  });

  const doStopBot = () => {
    if (!requireController(socket, 'stop-bot')) {
      return;
    }

    if (typeof stopLoop === 'function') {
      stopLoop();
    }
    botRunning = !!getLoopRunningState();
    if (botRunning) {
      stopLoop();
      botRunning = false;
    }
    socket.emit('status', false);
    socket.emit('bot-log', 'Bot stopped');
    emitStats();
  };

  const doToggleBot = (settings) => {
    if (!requireController(socket, 'toggle-bot')) {
      return;
    }

    const page = getPage();
    if (!page) {
      socket.emit('bot-log', 'Click "Open Browser" first.');
      return;
    }

    botRunning = !!getLoopRunningState();
    if (botRunning) {
      doStopBot();
      return;
    }

    const started = startLoop(socket, page, settings || {}, sessionStats);
    botRunning = !!getLoopRunningState() || started === true;
    socket.emit('status', true);
    socket.emit('bot-log', 'Bot started');
    emitStats();
  };

  socket.on('toggle', doToggleBot);
  socket.on('toggle-bot', doToggleBot);
  socket.on('stop-bot', doStopBot);

  socket.on('disconnect', () => {
    clearInterval(statsInterval);
    console.log('Dashboard disconnected');

    if (isController(socket)) {
      controllerSocketId = null;
      cleanupRuntime('Controller client disconnected; bot and browser stopped cleanly');
    }

    if (io.engine.clientsCount === 0) {
      controllerSocketId = null;
      cleanupRuntime('Last dashboard client disconnected; bot and browser stopped cleanly');
    }
  });
});

let shuttingDown = false;
async function handleShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[shutdown] ${signal} ontvangen`);
  await cleanupRuntime(`Server shutdown (${signal}); bot and browser stopped`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => {
  handleShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  handleShutdown('SIGTERM');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server draait op http://localhost:${PORT}`);
});
