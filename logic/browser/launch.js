const fs = require('fs');
const path = require('path');

function ensureWritableDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecoverableLaunchError(err) {
  const message = `${err?.name || ''} ${err?.message || String(err || '')}`.toLowerCase();
  return (
    message.includes('spawn eperm') ||
    message.includes('operation not permitted') ||
    message.includes('targetcloseerror') ||
    message.includes('target closed') ||
    message.includes('browser has disconnected') ||
    message.includes('failed to launch')
  );
}

function normalizeWindowConfig(cfg = {}) {
  const mode = (cfg.mode || 'maximized').toLowerCase() === 'windowed' ? 'windowed' : 'maximized';
  const width = Number.isFinite(Number(cfg.width)) && Number(cfg.width) > 0 ? Number(cfg.width) : 1366;
  const height = Number.isFinite(Number(cfg.height)) && Number(cfg.height) > 0 ? Number(cfg.height) : 900;
  return { mode, width, height };
}

function loadPersistedWindowConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeWindowConfig(parsed || {});
  } catch {
    return null;
  }
}

function persistWindowConfig(configPath, cfg) {
  try {
    const normalized = normalizeWindowConfig(cfg || {});
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf8');
  } catch {
    // non-fatal
  }
}

function buildBaseOptions(cfg) {
  const normalized = normalizeWindowConfig(cfg);
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-breakpad'
  ];

  if (normalized.mode === 'windowed') {
    args.push(`--window-size=${normalized.width},${normalized.height}`);
  } else {
    args.push('--start-maximized');
  }

  return {
    headless: false,
    defaultViewport: null,
    args
  };
}

async function launchWithRetries({ puppeteer, socket, cfg, chromePath, userDataDir }) {
  const base = buildBaseOptions(cfg);

  const attempts = [];
  if (ensureWritableDir(userDataDir)) {
    attempts.push({
      label: 'chrome + userDataDir',
      options: { ...base, executablePath: chromePath, userDataDir }
    });
  } else {
    socket?.emit('bot-log', `USER_DATA_DIR is not writable: ${userDataDir}`);
  }

  attempts.push({
    label: 'chrome zonder userDataDir',
    options: { ...base, executablePath: chromePath }
  });

  attempts.push({
    label: 'standaard puppeteer browser',
    options: { ...base }
  });

  let lastErr = null;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      socket?.emit('bot-log', `Browser launch attempt ${i + 1}/${attempts.length}: ${attempt.label}`);
      return await puppeteer.launch(attempt.options);
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      socket?.emit('bot-log', `Launch attempt failed: ${attempt.label} -> ${msg}`);
      if (!isRecoverableLaunchError(err)) {
        throw err;
      }
    }
  }

  throw lastErr || new Error('Browser launch failed without a specific error message.');
}

module.exports = {
  normalizeWindowConfig,
  loadPersistedWindowConfig,
  persistWindowConfig,
  launchWithRetries
};
