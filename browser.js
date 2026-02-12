const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

let browser = null;
let page = null;

const CHROME_PATH =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const DEFAULT_USER_DATA_DIR =
  process.env.USER_DATA_DIR ||
  path.join(os.tmpdir(), 'smmo-puppeteer-profile');

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

function buildBaseOptions() {
  return {
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad'
    ]
  };
}

async function launchWithRetries(socket) {
  const base = buildBaseOptions();

  const attempts = [];
  if (ensureWritableDir(DEFAULT_USER_DATA_DIR)) {
    attempts.push({
      label: 'chrome + userDataDir',
      options: { ...base, executablePath: CHROME_PATH, userDataDir: DEFAULT_USER_DATA_DIR }
    });
  } else {
    socket?.emit('bot-log', `USER_DATA_DIR niet schrijfbaar: ${DEFAULT_USER_DATA_DIR}`);
  }

  attempts.push({
    label: 'chrome zonder userDataDir',
    options: { ...base, executablePath: CHROME_PATH }
  });

  attempts.push({
    label: 'standaard puppeteer browser',
    options: { ...base }
  });

  let lastErr = null;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      socket?.emit('bot-log', `Browser launch poging ${i + 1}/${attempts.length}: ${attempt.label}`);
      return await puppeteer.launch(attempt.options);
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      socket?.emit('bot-log', `Launch poging mislukt: ${attempt.label} -> ${msg}`);
      if (!isRecoverableLaunchError(err)) {
        throw err;
      }
    }
  }

  throw lastErr || new Error('Browser launch mislukt zonder specifieke foutmelding.');
}

async function startBrowser(socket) {
  if (browser && page && !browser.process()?.killed) {
    socket?.emit('bot-log', 'Browser draait al');
    return page;
  }

  browser = await launchWithRetries(socket);

  browser.on('disconnected', () => {
    browser = null;
    page = null;
  });

  page = (await browser.pages())[0] || await browser.newPage();

  await page.goto('https://web.simple-mmo.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  socket?.emit('bot-log', 'SimpleMMO geopend');
  return page;
}

function getPage() {
  return page;
}

module.exports = { startBrowser, getPage };
