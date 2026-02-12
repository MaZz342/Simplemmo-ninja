const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

let browser = null;
let page = null;

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const USER_DATA_DIR =
  process.env.USER_DATA_DIR ||
  "C:\\temp\\smmo_node_master";

async function startBrowser(socket, sessionStats) {
  if (browser && page) {
    socket?.emit('bot-log', 'ℹ️ Browser draait al');
    return page;
  }

  browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    userDataDir: USER_DATA_DIR,
    args: ['--start-maximized'],
    defaultViewport: null,
  });

  page = (await browser.pages())[0] || await browser.newPage();

  await page.goto("https://web.simple-mmo.com/", {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  socket?.emit('bot-log', '🌍 SimpleMMO geopend');
  return page;
}

function getPage() {
  return page;
}

module.exports = { startBrowser, getPage };
