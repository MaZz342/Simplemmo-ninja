// logic/travel.js

async function handleTravel(page, socket, sessionStats) {
    try {
        const currentUrl = await page.url();

        // Niet op travel? Ga erheen
        if (!currentUrl.includes('/travel')) {
            socket.emit('bot-log', 'Niet op travel → ga ernaartoe');
            await page.goto('https://web.simple-mmo.com/travel', {
                waitUntil: 'networkidle2',
                timeout: 45000
            });
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
            socket.emit('bot-log', 'Aangekomen op travel-pagina');
            return 5000;
        }

        socket.emit('bot-log', 'Op travel-pagina – zoeken naar resource-knoppen');

        const resourceButtons = await page.$$('button, a, [role="button"], .btn');
        let resourceClicked = false;

        for (const btn of resourceButtons) {
            const text = await btn.evaluate(el => el.innerText || el.textContent || el.value || '')
                .then(t => t.toLowerCase().trim())
                .catch(() => '');

            if (
                text.includes('gather') ||
                text.includes('mine') ||
                text.includes('chop') ||
                text.includes('catch') ||
                text.includes('salvage') ||
                text.includes('woodcutting') ||
                text.includes('fishing') ||
                text.includes('farming') ||
                text.includes('harvest')
            ) {
                const isDisabled = await btn.evaluate(el => {
                    return (
                        el.disabled === true ||
                        el.hasAttribute('disabled') ||
                        el.classList.contains('disabled') ||
                        el.getAttribute('aria-disabled') === 'true' ||
                        el.style.pointerEvents === 'none'
                    );
                }).catch(() => true);

                if (isDisabled) {
                    socket.emit('bot-log', `Resource-knop "${text}" disabled → wachten...`);
                    return 2000 + Math.random() * 3000;
                }

                socket.emit('bot-log', `Resource-knop gevonden: "${text}" → klikken`);
                await page.mouse.move(Math.random() * 1920, Math.random() * 1080, { steps: 10 });
                await new Promise(r => setTimeout(r, 600 + Math.random() * 1200));
                try { await btn.evaluate(el => el.scrollIntoView({ block: 'center' })); } catch {}
                await btn.click({ timeout: 20000 });

                socket.emit('bot-log', `⛏️ Resource actie gestart: ${text}`);
                resourceClicked = true;
                break;
            }
        }

        if (resourceClicked) {
            socket.emit('bot-log', 'Wachten op popup verschijning...');
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));

            socket.emit('bot-log', 'Popup zichtbaar – zoeken naar actie-knop (Mine/Chop/etc)');

            const popupButtons = await page.$$('button, a, [role="button"], .btn, [class*="modal"] button');
            let actionClicked = false;

            for (const popupBtn of popupButtons) {
                const popupText = await popupBtn.evaluate(el => el.innerText || el.textContent || el.value || '')
                    .then(t => t.toLowerCase().trim())
                    .catch(() => '');

                if (
                    popupText.includes('mine') ||
                    popupText.includes('mine all') ||
                    popupText.includes('chop') ||
                    popupText.includes('chop all') ||
                    popupText.includes('gather') ||
                    popupText.includes('harvest') ||
                    popupText.includes('catch') ||
                    popupText.includes('salvage') ||
                    popupText.includes('woodcut') ||
                    popupText.includes('fish') ||
                    popupText.includes('start') ||
                    popupText.includes('begin') ||
                    popupText.includes('do it') ||
                    popupText.includes('confirm')
                ) {
                    const isPopupDisabled = await popupBtn.evaluate(el => {
                        return (
                            el.disabled === true ||
                            el.hasAttribute('disabled') ||
                            el.classList.contains('disabled') ||
                            el.getAttribute('aria-disabled') === 'true' ||
                            el.style.pointerEvents === 'none'
                        );
                    }).catch(() => true);

                    if (isPopupDisabled) {
                        socket.emit('bot-log', `Actie-knop "${popupText}" in popup disabled → wachten...`);
                        return 2000 + Math.random() * 3000;
                    }

                    socket.emit('bot-log', `Actie-knop in popup gevonden: "${popupText}" → klikken`);
                    await page.mouse.move(Math.random() * 1920, Math.random() * 1080, { steps: 10 });
                    await new Promise(r => setTimeout(r, 700 + Math.random() * 1300));
                    try { await popupBtn.evaluate(el => el.scrollIntoView({ block: 'center' })); } catch {}
                    await popupBtn.click({ timeout: 20000 });

                    socket.emit('bot-log', `✅ Actie uitgevoerd in popup: ${popupText}`);
                    actionClicked = true;
                    break;
                }
            }

            if (!actionClicked) socket.emit('bot-log', 'Geen actie-knop gevonden in popup');
            return 5000 + Math.random() * 5000;
        }

        socket.emit('bot-log', 'Geen resource-actie → terugval op stap');

        const stepButtons = await page.$$('button, a, [role="button"], .btn');

        for (const btn of stepButtons) {
            const text = await btn.evaluate(el => el.innerText || el.textContent || el.value || '')
                .then(t => t.toLowerCase().trim());

            if (
                text.includes('take a step') ||
                text.includes('stap') ||
                text.includes('step') ||
                text.includes('walk') ||
                text.includes('move forward') ||
                text.includes('neem een stap')
            ) {
                const isDisabled = await btn.evaluate(el => {
                    return (
                        el.disabled === true ||
                        el.hasAttribute('disabled') ||
                        el.classList.contains('disabled') ||
                        el.getAttribute('aria-disabled') === 'true' ||
                        el.style.pointerEvents === 'none'
                    );
                }).catch(() => true);

                if (isDisabled) {
                    socket.emit('bot-log', 'Take a step knop disabled → wachten...');
                    return 1500 + Math.random() * 2500;
                }

                socket.emit('bot-log', `Take a step knop klikbaar: "${text}"`);
                await page.mouse.move(Math.random() * 1920, Math.random() * 1080, { steps: 10 });
                await new Promise(r => setTimeout(r, 600 + Math.random() * 1200));
                await btn.click({ timeout: 20000 });

                sessionStats.steps = (sessionStats.steps || 0) + 1;
                socket.emit('update-stats', sessionStats);
                socket.emit('bot-log', `👣 Stap gezet! Totaal: ${sessionStats.steps}`);
                return 3800 + Math.random() * 2200;
            }
        }

        socket.emit('bot-log', 'Geen stap- of resource-knop gevonden');
        return 5000 + Math.random() * 3000;
    } catch (err) {
        console.error('[travel error]', err.message, err.stack);
        socket.emit('bot-log', 'Travel fout: ' + err.message);
        return 8000;
    }
}

module.exports = { handleTravel };
