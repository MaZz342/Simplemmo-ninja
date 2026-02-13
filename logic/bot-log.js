function classifyLogMessage(message) {
  const text = String(message || '').toLowerCase();

  let level = 'info';
  if (/error|failed|fout|blocked|captcha|anti-bot/.test(text)) level = 'error';
  else if (/warning|warn|throttle|slow down|too fast|hold on/.test(text)) level = 'warn';

  let flow = 'core';
  if (/battle/.test(text)) flow = 'battle';
  else if (/combat|attack/.test(text)) flow = 'combat';
  else if (/quest/.test(text)) flow = 'quests';
  else if (/travel|step|gather|resource|loot|popup/.test(text)) flow = 'travel';
  else if (/browser|window|launch/.test(text)) flow = 'browser';

  let action = 'log';
  if (/started|active/.test(text)) action = 'start';
  else if (/stopped|finished|depleted/.test(text)) action = 'stop';
  else if (/clicked|opening|confirming|closing/.test(text)) action = 'click';
  else if (/waiting|retry|recover|recovering/.test(text)) action = 'wait';
  else if (/error|failed|fout/.test(text)) action = 'error';

  return { level, flow, action };
}

function buildBotLogEvent(message, meta = {}) {
  const base = classifyLogMessage(message);
  return {
    ts: Date.now(),
    message: String(message || ''),
    level: meta.level || base.level,
    flow: meta.flow || base.flow,
    action: meta.action || base.action,
    context: meta.context && typeof meta.context === 'object' ? meta.context : {}
  };
}

function installBotLogBridge(socket) {
  if (!socket || socket.__botLogBridgeInstalled) return socket;

  const rawEmit = socket.emit.bind(socket);
  socket.emit = (eventName, ...args) => {
    if (eventName === 'bot-log') {
      const message = args.length > 0 ? args[0] : '';
      const meta = args.length > 1 && args[1] && typeof args[1] === 'object' ? args[1] : {};
      rawEmit('bot-log-event', buildBotLogEvent(message, meta));
    }
    return rawEmit(eventName, ...args);
  };

  socket.__botLogBridgeInstalled = true;
  return socket;
}

function emitBotLogToIo(io, message, meta = {}) {
  if (!io || typeof io.emit !== 'function') return;
  io.emit('bot-log', String(message || ''));
  io.emit('bot-log-event', buildBotLogEvent(message, meta));
}

module.exports = {
  installBotLogBridge,
  emitBotLogToIo,
  buildBotLogEvent
};
