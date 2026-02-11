// logic/captcha.js (Puppeteer)

async function checkCaptcha(page) {
    try {
        const cloudflareFrames = await page.$$(
            'iframe[src*="cloudflare"], iframe[src*="challenges"], iframe[src*="turnstile"], iframe[title*="turnstile"]'
        );
        if (cloudflareFrames.length) return true;

        const hcaptchaFrames = await page.$$('iframe[src*="hcaptcha"]');
        if (hcaptchaFrames.length) return true;

        const recaptchaFrames = await page.$$('iframe[src*="recaptcha"], div.g-recaptcha');
        if (recaptchaFrames.length) return true;

        const hasVerifyText = await page.evaluate(() => {
            const text = (document.body?.innerText || '').toLowerCase();
            return (
                text.includes('verifieer dat u een mens bent') ||
                text.includes('verify that you are human') ||
                text.includes('cloudflare') ||
                text.includes('turnstile') ||
                text.includes('hcaptcha') ||
                text.includes('recaptcha') ||
                text.includes('please solve the puzzle') ||
                text.includes('security check')
            );
        });

        return !!hasVerifyText;
    } catch (err) {
        console.error('[captcha] Fout:', err.message);
        return false;
    }
}

module.exports = { checkCaptcha };
