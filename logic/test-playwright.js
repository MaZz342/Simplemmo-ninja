const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://example.com');

  // Test of .first() bestaat en werkt
  const locator = page.locator('a');
  console.log('Type of first:', typeof locator.first);          // moet 'function' zijn
  console.log('Calling first():', await locator.first());       // moet een Locator object loggen

  await browser.close();
})();