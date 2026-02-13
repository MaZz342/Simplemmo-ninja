// logic/gathering.js — veilig (geen elementHandle.click), alleen op /travel

async function handleGathering(page, socket) {
  try {
    const url = page.url();
    if (!url.includes('/travel')) return 0;

    const result = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, .btn, [role="button"]'));
      const vis = (b) => b && b.offsetParent !== null;

      const clickHumanly = (el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + (Math.random() * rect.width);
        const y = rect.top + (Math.random() * rect.height);
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      };

      const isDisabled = (el) => {
        const style = window.getComputedStyle(el);
        return !!(
          el.disabled ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.hasAttribute('disabled') ||
          style.pointerEvents === 'none'
        );
      };

      // Alleen resource-achtige knoppen
      const isResource = (t) => {
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

      for (const b of btns) {
        if (!vis(b) || isDisabled(b)) continue;
        const text = (b.innerText || b.textContent || '').trim();
        if (!text) continue;
        if (!isResource(text)) continue;

        clickHumanly(b);
        return { clicked: true, text };
      }

      return { clicked: false };
    });

    if (result.clicked) {
      socket.emit('bot-log', `⛏️ Gathering click (safe): ${result.text}`);
      return 1800 + Math.random() * 1800;
    }

    return 0;
  } catch (err) {
    socket.emit('bot-log', `Gathering error: ${err.message}`);
    return 2000;
  }
}

module.exports = { handleGathering };
