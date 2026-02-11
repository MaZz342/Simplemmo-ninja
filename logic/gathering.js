// logic/gathering.js (Puppeteer)

async function handleGathering(page, socket) {
    try {
        const candidates = await page.$$('button, a, [role="button"], .btn');

        const hasAny = (t) => {
            const s = (t || '').toLowerCase();
            return (
                s.includes('gather') ||
                s.includes('mine') ||
                s.includes('chop') ||
                s.includes('catch') ||
                s.includes('salvage') ||
                s.includes('woodcut') ||
                s.includes('fishing') ||
                s.includes('farming') ||
                s.includes('harvest')
            );
        };

        for (const el of candidates) {
            const text = await page
                .evaluate(e => (e.innerText || e.textContent || e.value || '').trim(), el)
                .catch(() => '');

            if (!hasAny(text)) continue;

            const disabled = await page
                .evaluate(e => {
                    const style = window.getComputedStyle(e);
                    return !!(
                        e.disabled ||
                        e.getAttribute('aria-disabled') === 'true' ||
                        e.hasAttribute('disabled') ||
                        style.pointerEvents === 'none'
                    );
                }, el)
                .catch(() => true);

            if (disabled) continue;

            try { await el.evaluate(n => n.scrollIntoView({ block: 'center' })); } catch {}
            await page.waitForTimeout(150 + Math.random() * 250);
            await el.click({ delay: 50 + Math.random() * 120, timeout: 15000 });
            socket.emit('bot-log', `⛏️ Gathering gestart (${text})`);
            return 2000 + Math.random() * 2000;
        }

        const collectWords = ['collect', 'loot', 'pick up', 'gather now', 'click here'];
        for (const el of candidates) {
            const text = await page
                .evaluate(e => (e.innerText || e.textContent || e.value || '').trim(), el)
                .catch(() => '');

            const low = text.toLowerCase();
            if (!collectWords.some(w => low.includes(w))) continue;

            const disabled = await page
                .evaluate(e => e.disabled || e.getAttribute('aria-disabled') === 'true' || e.hasAttribute('disabled'), el)
                .catch(() => true);

            if (disabled) continue;

            try { await el.evaluate(n => n.scrollIntoView({ block: 'center' })); } catch {}
            await page.waitForTimeout(120 + Math.random() * 220);
            await el.click({ delay: 40 + Math.random() * 110, timeout: 15000 });
            socket.emit('bot-log', `🎒 Loot/Collect geklikt (${text})`);
            return 1500 + Math.random() * 1500;
        }

        return 0;
    } catch (err) {
        console.error('[gathering] Fout:', err.message);
        socket.emit('bot-log', `Gathering fout: ${err.message}`);
        return 5000;
    }
}

module.exports = { handleGathering };
