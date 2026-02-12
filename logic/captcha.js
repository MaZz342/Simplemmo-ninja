// logic/captcha.js (Puppeteer)

async function checkCaptcha(page) {
  try {
    // 1) bekende captcha/anti-bot iframes
    const cloudflareFrames = await page.$$(
      'iframe[src*="cloudflare"], iframe[src*="challenges"], iframe[src*="turnstile"], iframe[title*="turnstile"]'
    );
    if (cloudflareFrames.length) return true;

    const hcaptchaFrames = await page.$$('iframe[src*="hcaptcha"]');
    if (hcaptchaFrames.length) return true;

    const recaptchaFrames = await page.$$('iframe[src*="recaptcha"], div.g-recaptcha');
    if (recaptchaFrames.length) return true;

    // 2) tekst-detectie (incl jouw exacte zinnen)
    const hasVerifyText = await page.evaluate(() => {
      const text = (document.body?.innerText || '').toLowerCase();

      return (
        // jouw melding
        text.includes('woah! hold up there') ||
        text.includes("i'm a person! promise") ||
        text.includes("im a person! promise") ||

        // algemeen
        text.includes('verifieer dat u een mens bent') ||
        text.includes('verify that you are human') ||
        text.includes('please solve the puzzle') ||
        text.includes('security check') ||
        text.includes('are you human') ||

        // providers
        text.includes('cloudflare') ||
        text.includes('turnstile') ||
        text.includes('hcaptcha') ||
        text.includes('recaptcha')
      );
    });

    return !!hasVerifyText;
  } catch (err) {
    console.error('[captcha] Fout:', err.message);
    return false;
  }
}

module.exports = { checkCaptcha };
