// logic/combat.js
async function handleCombat(page, socket) {
    try {
        const elements = await page.$$('button, a, [role="button"], [class*="btn"], [class*="attack"]');

        for (const el of elements) {
            try {
                const text = await page.evaluate(e => e.innerText || e.textContent || '', el);
                const lowerText = text.toLowerCase();

                if (lowerText.includes('attack') || lowerText.includes('aanval')) {
                    await el.click({ timeout: 10000 });
                    socket.emit('bot-log', '⚔️ Attack knop gevonden en geklikt');
                    return 2000 + Math.random() * 1500;
                }

                if (
                    lowerText.includes('confirm') ||
                    lowerText.includes('yes') ||
                    lowerText.includes('bevestig') ||
                    lowerText.includes('ok')
                ) {
                    await el.click({ timeout: 10000 });
                    socket.emit('bot-log', '✅ Bevestiging geklikt');
                    return 2500 + Math.random() * 1000;
                }
            } catch {
                // ignore
            }
        }

        return 0;
    } catch (err) {
        socket.emit('bot-log', 'Combat error: ' + err.message);
        return 4000;
    }
}

module.exports = { handleCombat };
