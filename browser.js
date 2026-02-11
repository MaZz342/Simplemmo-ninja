// browser.js (Puppeteer)
const puppeteer = require('puppeteer');
const path = require('path');

let browser;
let page;

async function startBrowser(socket) {
    const executablePath = process.env.CHROME_PATH || undefined;
    const userDataDir = process.env.USER_DATA_DIR
        ? path.resolve(process.env.USER_DATA_DIR)
        : path.resolve(process.cwd(), 'puppeteer_profile');

    browser = await puppeteer.launch({
        headless: false,
        executablePath,
        userDataDir,
        defaultViewport: null,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const pages = await browser.pages();
    page = pages.length ? pages[0] : await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    await page.goto('https://web.simple-mmo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    socket.emit('bot-log', `Puppeteer browser geopend (profile: ${userDataDir}) – log in op SimpleMMO`);

    return page;
}

module.exports = { startBrowser };
