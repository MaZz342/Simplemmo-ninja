// logic/click-utils.js - shared click helpers for Puppeteer ElementHandle usage

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

async function scrollIntoView(handle) {
  if (!handle) return;
  await handle.evaluate((el) => {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
  }).catch(() => {});
}

async function clickHandle(handle, opts = {}) {
  if (!handle) return false;
  const minDelay = Number.isFinite(Number(opts.minDelay)) ? Number(opts.minDelay) : 120;
  const maxDelay = Number.isFinite(Number(opts.maxDelay)) ? Number(opts.maxDelay) : 280;

  await scrollIntoView(handle);

  const clickedViaPuppeteer = await handle
    .click({ delay: randomDelay(minDelay, maxDelay) })
    .then(() => true)
    .catch(() => false);
  if (clickedViaPuppeteer) return true;

  return await handle.evaluate((el) => {
    try { el.click(); return true; } catch { return false; }
  }).catch(() => false);
}

module.exports = {
  clickHandle,
  scrollIntoView
};
