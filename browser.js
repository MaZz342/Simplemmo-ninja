const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

let browser = null;
let page = null;
let statsPollInterval = null;
let didLogStatsReady = false;
let didLogStatsMissing = false;
let responseStatsHooked = false;
let didLogApiSync = false;
const STATS_POLL_MS = Number(process.env.STATS_POLL_MS || 7000);

const CHROME_PATH =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const DEFAULT_USER_DATA_DIR =
  process.env.USER_DATA_DIR ||
  path.join(os.tmpdir(), 'smmo-puppeteer-profile');
let windowConfig = {
  mode: (process.env.BROWSER_WINDOW_MODE || 'maximized').toLowerCase(),
  width: Number(process.env.BROWSER_WIDTH || 1366),
  height: Number(process.env.BROWSER_HEIGHT || 900),
};

function ensureWritableDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecoverableLaunchError(err) {
  const message = `${err?.name || ''} ${err?.message || String(err || '')}`.toLowerCase();
  return (
    message.includes('spawn eperm') ||
    message.includes('operation not permitted') ||
    message.includes('targetcloseerror') ||
    message.includes('target closed') ||
    message.includes('browser has disconnected') ||
    message.includes('failed to launch')
  );
}

function normalizeWindowConfig(cfg = {}) {
  const mode = (cfg.mode || 'maximized').toLowerCase() === 'windowed' ? 'windowed' : 'maximized';
  const width = Number.isFinite(Number(cfg.width)) && Number(cfg.width) > 0 ? Number(cfg.width) : 1366;
  const height = Number.isFinite(Number(cfg.height)) && Number(cfg.height) > 0 ? Number(cfg.height) : 900;
  return { mode, width, height };
}

function buildBaseOptions(cfg) {
  const normalized = normalizeWindowConfig(cfg);
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-breakpad'
  ];

  if (normalized.mode === 'windowed') {
    args.push(`--window-size=${normalized.width},${normalized.height}`);
  } else {
    args.push('--start-maximized');
  }

  return {
    headless: false,
    defaultViewport: null,
    args
  };
}

async function launchWithRetries(socket, cfg) {
  const base = buildBaseOptions(cfg);

  const attempts = [];
  if (ensureWritableDir(DEFAULT_USER_DATA_DIR)) {
    attempts.push({
      label: 'chrome + userDataDir',
      options: { ...base, executablePath: CHROME_PATH, userDataDir: DEFAULT_USER_DATA_DIR }
    });
  } else {
    socket?.emit('bot-log', `USER_DATA_DIR is not writable: ${DEFAULT_USER_DATA_DIR}`);
  }

  attempts.push({
    label: 'chrome zonder userDataDir',
    options: { ...base, executablePath: CHROME_PATH }
  });

  attempts.push({
    label: 'standaard puppeteer browser',
    options: { ...base }
  });

  let lastErr = null;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      socket?.emit('bot-log', `Browser launch attempt ${i + 1}/${attempts.length}: ${attempt.label}`);
      return await puppeteer.launch(attempt.options);
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      socket?.emit('bot-log', `Launch attempt failed: ${attempt.label} -> ${msg}`);
      if (!isRecoverableLaunchError(err)) {
        throw err;
      }
    }
  }

  throw lastErr || new Error('Browser launch failed without a specific error message.');
}

async function startBrowser(socket, sessionStats) {
  if (browser && page && !browser.process()?.killed) {
    socket?.emit('bot-log', 'Browser is already running');
    return page;
  }

  const normalized = normalizeWindowConfig(windowConfig);
  socket?.emit('bot-log', `Browser mode: ${normalized.mode}${normalized.mode === 'windowed' ? ` (${normalized.width}x${normalized.height})` : ''}`);
  browser = await launchWithRetries(socket, normalized);

  browser.on('disconnected', () => {
    if (statsPollInterval) {
      clearInterval(statsPollInterval);
      statsPollInterval = null;
    }
    browser = null;
    page = null;
    responseStatsHooked = false;
    didLogApiSync = false;
  });

  page = (await browser.pages())[0] || await browser.newPage();
  if (!responseStatsHooked && sessionStats) {
    responseStatsHooked = true;
    didLogApiSync = false;
    page.on('response', async (resp) => {
      try {
        const headers = resp.headers?.() || {};
        const contentType = String(headers['content-type'] || '');
        const url = String(resp.url?.() || '');
        const looksJson = contentType.includes('application/json') || url.includes('/api/');
        if (!looksJson) return;

        const payload = await resp.json().catch(() => null);
        if (!payload) return;

        const changed = applyStatsFromPayload(payload, sessionStats);
        if (changed && !didLogApiSync) {
          didLogApiSync = true;
          socket?.emit('bot-log', 'Live stats synced from API payload');
        }
      } catch {
        // ignore noisy responses
      }
    });
  }

  await page.goto('https://web.simple-mmo.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  socket?.emit('bot-log', 'SimpleMMO opened');
  startStatsPolling(socket, sessionStats);
  return page;
}

function parseInteger(value) {
  const raw = String(value ?? '').replace(/[^\d-]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePercent(value) {
  const m = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function keepPreviousOnSuspiciousZero(nextValue, previousValue) {
  return (nextValue === null || nextValue === undefined) ? previousValue : nextValue;
}

function toInt(v) {
  const n = parseInteger(v);
  return Number.isFinite(n) ? n : null;
}

function findFirstByKeys(root, keys) {
  if (!root || typeof root !== 'object') return null;
  const wanted = new Set(keys.map((k) => String(k).toLowerCase()));
  const seen = new Set();
  const queue = [root];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    for (const [k, value] of Object.entries(node)) {
      if (wanted.has(String(k).toLowerCase())) {
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          return value;
        }
      }
    }

    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return null;
}

function applyStatsFromPayload(payload, sessionStats) {
  if (!payload || typeof payload !== 'object' || !sessionStats) return false;

  const level = toInt(findFirstByKeys(payload, ['level']));
  const gold = toInt(findFirstByKeys(payload, ['gold']));
  const bank = toInt(findFirstByKeys(payload, ['bank', 'bank_gold', 'bank_balance']));
  const diamonds = toInt(findFirstByKeys(payload, ['diamonds', 'diamond']));
  const totalSteps = toInt(findFirstByKeys(payload, ['total_steps', 'steps_total']));
  const xpRemaining = toInt(findFirstByKeys(payload, ['exp_remaining', 'xp_remaining']));
  const currentHp = toInt(findFirstByKeys(payload, ['current_hp', 'health_current']));
  const maxHp = toInt(findFirstByKeys(payload, ['max_hp', 'health_max']));
  const qp = toInt(findFirstByKeys(payload, ['quest_points', 'qp', 'current_quest_points']));
  const maxQp = toInt(findFirstByKeys(payload, ['max_quest_points', 'max_qp', 'quest_points_max']));
  const usernameRaw = findFirstByKeys(payload, ['username', 'name']);
  const username = usernameRaw ? String(usernameRaw).trim() : '';

  let changed = false;
  const setIf = (cond, fn) => {
    if (!cond) return;
    fn();
    changed = true;
  };

  setIf(username && username !== sessionStats.username, () => { sessionStats.username = username; });
  setIf(level !== null && level >= 0, () => { sessionStats.level = level; });
  setIf(gold !== null && gold >= 0, () => { sessionStats.gold = String(gold); });
  setIf(bank !== null && bank >= 0, () => { sessionStats.bank = String(bank); });
  setIf(diamonds !== null && diamonds >= 0, () => { sessionStats.diamonds = diamonds; });
  setIf(totalSteps !== null && totalSteps >= 0, () => { sessionStats.total_steps = totalSteps; });
  setIf(xpRemaining !== null, () => { sessionStats.xp_remaining = xpRemaining; });
  setIf(currentHp !== null && currentHp >= 0, () => { sessionStats.current_hp = currentHp; });
  setIf(maxHp !== null && maxHp > 0, () => { sessionStats.max_hp = maxHp; });
  setIf(qp !== null && qp >= 0, () => {
    sessionStats.qp = qp;
    sessionStats.quest_points = qp;
  });
  setIf(maxQp !== null && maxQp > 0, () => {
    sessionStats.max_qp = maxQp;
    sessionStats.max_quest_points = maxQp;
  });

  if (sessionStats.current_hp > 0 && sessionStats.max_hp > 0) {
    sessionStats.hp_percent = Math.max(0, Math.min(100, (sessionStats.current_hp / sessionStats.max_hp) * 100));
  }
  if (sessionStats.qp >= 0 && sessionStats.max_qp > 0) {
    sessionStats.qp_percent = Math.max(0, Math.min(100, (sessionStats.qp / sessionStats.max_qp) * 100));
  }
  if (changed) {
    sessionStats.stats_updated_at = Date.now();
  }
  return changed;
}

function startStatsPolling(socket, sessionStats) {
  if (statsPollInterval) {
    clearInterval(statsPollInterval);
    statsPollInterval = null;
  }
  didLogStatsReady = false;
  didLogStatsMissing = false;

  if (!sessionStats) {
    return;
  }

  const collectStats = async () => {
    if (!page) return;

    try {
      const snapshot = await page.evaluate(async () => {
        const touchedComponents = [];
        try {
          const nodes = Array.from(document.querySelectorAll('[x-data], [x-show], [x-text]'));
          for (const node of nodes.slice(0, 400)) {
            const stack = node && node._x_dataStack;
            if (!Array.isArray(stack)) continue;
            for (const obj of stack) {
              if (!obj || typeof obj !== 'object') continue;
              touchedComponents.push(obj);
            }
          }
        } catch {
          // Best effort only.
        }

        const normalizeNumText = (text) => String(text || '').replace(/\s+/g, ' ').trim();
        const looksNumeric = (text) => /^-?\d[\d,.\s]*$/.test(normalizeNumText(text));
        const textOf = (el) => normalizeNumText(el?.textContent || '');

        const readValueByLabel = (label) => {
          const labels = Array.from(document.querySelectorAll('p, span, div'));
          const lbl = labels.find((n) => textOf(n).toLowerCase() === label.toLowerCase());
          if (!lbl) return '';

          let wrap = lbl.parentElement;
          if (!wrap) return '';

          for (let i = 0; i < 4 && wrap; i++) {
            const candidates = Array.from(wrap.querySelectorAll('[x-text], p, span')).map((n) => textOf(n));
            const numeric = candidates.find((t) => looksNumeric(t));
            if (numeric && numeric !== label) return numeric;
            wrap = wrap.parentElement;
          }
          return '';
        };

        const readPairByHeading = (heading) => {
          const headings = Array.from(document.querySelectorAll('p, span, div'));
          const h = headings.find((n) => textOf(n).toLowerCase() === heading.toLowerCase());
          if (!h) return { cur: '', max: '' };

          let wrap = h.parentElement;
          if (!wrap) return { cur: '', max: '' };

          for (let i = 0; i < 5 && wrap; i++) {
            const txt = textOf(wrap);
            const m = txt.match(/(-?\d[\d,.\s]*)\s+out\s+of\s+(-?\d[\d,.\s]*)/i);
            if (m) return { cur: normalizeNumText(m[1]), max: normalizeNumText(m[2]) };
            wrap = wrap.parentElement;
          }
          return { cur: '', max: '' };
        };

        const xTextNodes = Array.from(document.querySelectorAll('[x-text]')).map((el) => ({
          key: String(el.getAttribute('x-text') || '').trim(),
          value: normalizeNumText(el.textContent || '')
        }));

        const getByXTextExact = (expr) => {
          const row = xTextNodes.find((r) => r.key === expr && r.value);
          return row ? row.value : '';
        };

        const getByXTextIncludes = (exprPart) => {
          const row = xTextNodes.find((r) => r.key.includes(exprPart) && r.value && looksNumeric(r.value));
          return row ? row.value : '';
        };

        const readAny = (selectors) => {
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (!node) continue;
            const text = (node.textContent || '').trim();
            if (text) return text;
          }
          return '';
        };

        const barWidth = (id) => {
          const node = document.querySelector(id);
          if (!node) return '';
          return node.getAttribute('style') || '';
        };

        const asObject = (v) => (v && typeof v === 'object' ? v : null);
        const pickUserObject = (items) => {
          for (const it of items) {
            if (!it || typeof it !== 'object') continue;
            const directUser = it.user;
            if (directUser && typeof directUser === 'object') {
              const keys = Object.keys(directUser);
              if (keys.includes('gold') || keys.includes('bank') || keys.includes('quest_points') || keys.includes('current_hp')) {
                return directUser;
              }
            }

            const keys = Object.keys(it);
            const hit = ['gold', 'bank', 'diamonds', 'total_steps', 'current_hp', 'max_hp', 'quest_points', 'max_quest_points']
              .filter((k) => keys.includes(k)).length;
            if (hit >= 3) return it;
          }
          return null;
        };

        const roots = [
          asObject(window),
          asObject(window?.user),
          asObject(window?.app),
          asObject(window?.App),
          asObject(window?.__INITIAL_STATE__),
          asObject(window?.__NUXT__),
          asObject(window?.store),
          asObject(window?.reduxStore)
        ].filter(Boolean);

        const desiredKeys = new Set([
          'gold', 'bank', 'diamonds', 'total_steps', 'level', 'exp_remaining',
          'current_hp', 'max_hp', 'quest_points', 'max_quest_points'
        ]);

        const gatherAlpineData = () => {
          const out = [];
          const nodes = Array.from(document.querySelectorAll('[x-data], [x-text], [x-show]')).slice(0, 250);
          for (const node of nodes) {
            try {
              const stack = node && node._x_dataStack;
              if (!Array.isArray(stack)) continue;
              for (const item of stack) {
                if (item && typeof item === 'object') out.push(item);
              }
            } catch {
              // ignore
            }
          }
          return out;
        };

        const findUserLike = () => {
          const seen = new Set();
          const alpineRoots = gatherAlpineData().map((x) => asObject(x)).filter(Boolean);
          const queue = roots.concat(alpineRoots).map((r) => ({ node: r, depth: 0 }));

          while (queue.length) {
            const { node, depth } = queue.shift();
            if (!node || typeof node !== 'object') continue;
            if (seen.has(node)) continue;
            seen.add(node);

            const keys = Object.keys(node);
            const hitCount = keys.filter((k) => desiredKeys.has(k)).length;
            if (hitCount >= 3) return node;

            if (depth >= 6) continue;
            for (const k of keys.slice(0, 120)) {
              const child = node[k];
              if (child && typeof child === 'object') {
                queue.push({ node: child, depth: depth + 1 });
              }
            }
          }
          return null;
        };

        const findValueByKey = (targetKey) => {
          const seen = new Set();
          const alpineRoots = gatherAlpineData().map((x) => asObject(x)).filter(Boolean);
          const queue = roots.concat(alpineRoots).map((r) => ({ node: r, depth: 0 }));

          while (queue.length) {
            const { node, depth } = queue.shift();
            if (!node || typeof node !== 'object') continue;
            if (seen.has(node)) continue;
            seen.add(node);

            if (Object.prototype.hasOwnProperty.call(node, targetKey)) {
              const v = node[targetKey];
              if (v !== null && v !== undefined && String(v).trim() !== '') {
                return String(v);
              }
            }

            if (depth >= 7) continue;
            for (const k of Object.keys(node).slice(0, 140)) {
              const child = node[k];
              if (child && typeof child === 'object') {
                queue.push({ node: child, depth: depth + 1 });
              }
            }
          }
          return '';
        };

        const windowUser = (typeof window !== 'undefined' && window.user && typeof window.user === 'object') ? window.user : null;
        const alpineUser = pickUserObject(touchedComponents.map((x) => asObject(x)).filter(Boolean));
        const globalUser = findUserLike();
        const keyGold = findValueByKey('gold');
        const keyBank = findValueByKey('bank');
        const keyDiamonds = findValueByKey('diamonds');
        const keyTotalSteps = findValueByKey('total_steps');
        const keyXpRemaining = findValueByKey('exp_remaining');
        const keyCurrentHp = findValueByKey('current_hp');
        const keyMaxHp = findValueByKey('max_hp');
        const keyQuestPoints = findValueByKey('quest_points');
        const keyMaxQuestPoints = findValueByKey('max_quest_points');
        const rawText = (document.body?.textContent || '').replace(/\s+/g, ' ');
        const pick = (re, idx = 1) => {
          const m = rawText.match(re);
          return m && m[idx] ? String(m[idx]).trim() : '';
        };

        const textLevel = pick(/\bLevel\s+([0-9][0-9,\.]*)\b/i);
        const textGold = pick(/\bGold\s+([0-9][0-9,\.]*)\b/i);
        const textBank = pick(/\bBank\s+([0-9][0-9,\.]*)\b/i);
        const textDiamonds = pick(/\bDiamonds\s+([0-9][0-9,\.]*)\b/i);
        const textSteps = pick(/\bTotal\s+Steps\s+([0-9][0-9,\.]*)\b/i);
        const textXpRemaining = pick(/\b([0-9][0-9,\.]*)\s*EXP\s+remaining\b/i);
        const textHpCur = pick(/\bHealth\s+([0-9][0-9,\.]*)\s+out\s+of\s+([0-9][0-9,\.]*)\b/i, 1);
        const textHpMax = pick(/\bHealth\s+([0-9][0-9,\.]*)\s+out\s+of\s+([0-9][0-9,\.]*)\b/i, 2);
        const textQpCur = pick(/\bQuest\s+Points\s+([0-9][0-9,\.]*)\s+out\s+of\s+([0-9][0-9,\.]*)\b/i, 1);
        const textQpMax = pick(/\bQuest\s+Points\s+([0-9][0-9,\.]*)\s+out\s+of\s+([0-9][0-9,\.]*)\b/i, 2);
        const hpPair = readPairByHeading('Health');
        const qpPair = readPairByHeading('Quest Points');

        const result = {
          username: readAny([
            '[x-text*="user.username"]',
            '[x-text*="user.name"]',
            'a[href^="/user/view/"] span span',
            'a[href^="/user/view/"] span',
            'a[href^="/user/view/"]'
          ]) || (alpineUser?.username || alpineUser?.name || windowUser?.username || windowUser?.name || ''),
          level: getByXTextExact('user.level') || getByXTextIncludes('user.level') || readAny(['[x-text*="user.level"]']) || String(alpineUser?.level || windowUser?.level || globalUser?.level || '') || textLevel,
          gold: getByXTextExact('user.gold') || getByXTextIncludes('user.gold') || readValueByLabel('Gold') || readAny(['[x-text*="user.gold"]']) || String(alpineUser?.gold || windowUser?.gold || globalUser?.gold || keyGold || '') || textGold,
          bank: getByXTextExact('user.bank') || getByXTextIncludes('user.bank') || readValueByLabel('Bank') || readAny(['[x-text*="user.bank"]']) || String(alpineUser?.bank || windowUser?.bank || globalUser?.bank || keyBank || '') || textBank,
          diamonds: getByXTextExact('user.diamonds') || getByXTextIncludes('user.diamonds') || readValueByLabel('Diamonds') || readAny(['[x-text*="user.diamonds"]']) || String(alpineUser?.diamonds || windowUser?.diamonds || globalUser?.diamonds || keyDiamonds || '') || textDiamonds,
          totalSteps: getByXTextExact('user.total_steps') || getByXTextIncludes('user.total_steps') || readValueByLabel('Total Steps') || readAny(['[x-text*="user.total_steps"]']) || String(alpineUser?.total_steps || windowUser?.total_steps || globalUser?.total_steps || keyTotalSteps || '') || textSteps,
          xpRemaining: getByXTextExact('user.exp_remaining') || getByXTextIncludes('user.exp_remaining') || readAny(['[x-text*="user.exp_remaining"]']) || String(alpineUser?.exp_remaining || windowUser?.exp_remaining || globalUser?.exp_remaining || keyXpRemaining || '') || textXpRemaining,
          currentHp: getByXTextExact('user.current_hp') || getByXTextIncludes('user.current_hp') || hpPair.cur || readAny(['[x-text*="user.current_hp"]']) || String(alpineUser?.current_hp || windowUser?.current_hp || globalUser?.current_hp || keyCurrentHp || '') || textHpCur,
          maxHp: getByXTextExact('user.max_hp') || getByXTextIncludes('user.max_hp') || hpPair.max || readAny(['[x-text*="user.max_hp"]']) || String(alpineUser?.max_hp || windowUser?.max_hp || globalUser?.max_hp || keyMaxHp || '') || textHpMax,
          energy: readAny(['[x-text*="user.energy"]']) || String(windowUser?.energy || ''),
          maxEnergy: readAny(['[x-text*="user.max_energy"]']) || String(windowUser?.max_energy || ''),
          questPoints: getByXTextExact('user.quest_points') || getByXTextIncludes('user.quest_points') || qpPair.cur || readAny(['[x-text*="user.quest_points"]']) || String(alpineUser?.quest_points || windowUser?.quest_points || globalUser?.quest_points || keyQuestPoints || '') || textQpCur,
          maxQuestPoints: getByXTextExact('user.max_quest_points') || getByXTextIncludes('user.max_quest_points') || qpPair.max || readAny(['[x-text*="user.max_quest_points"]']) || String(alpineUser?.max_quest_points || windowUser?.max_quest_points || globalUser?.max_quest_points || keyMaxQuestPoints || '') || textQpMax,
          xpBarStyle: barWidth('#experience_bar'),
          hpBarStyle: barWidth('#health_bar'),
          qpBarStyle: barWidth('#quest_points_bar'),
          debugFoundGlobal: !!globalUser,
          debugFoundAlpineUser: !!alpineUser
        };

        return result;
      });

      const level = parseInteger(snapshot.level);
      const gold = parseInteger(snapshot.gold);
      const bank = parseInteger(snapshot.bank);
      const diamonds = parseInteger(snapshot.diamonds);
      const totalSteps = parseInteger(snapshot.totalSteps);
      const xpRemaining = parseInteger(snapshot.xpRemaining);
      const currentHp = parseInteger(snapshot.currentHp);
      const maxHp = parseInteger(snapshot.maxHp);
      const questPoints = parseInteger(snapshot.questPoints);
      const maxQuestPoints = parseInteger(snapshot.maxQuestPoints);
      const xpPercent = parsePercent(snapshot.xpBarStyle);
      const hpPercent = parsePercent(snapshot.hpBarStyle);
      const qpPercent = parsePercent(snapshot.qpBarStyle);

      if (snapshot.username) sessionStats.username = snapshot.username;

      const safeLevel = keepPreviousOnSuspiciousZero(level, sessionStats.level);
      const safeGold = keepPreviousOnSuspiciousZero(gold, sessionStats.gold);
      const safeBank = keepPreviousOnSuspiciousZero(bank, sessionStats.bank);
      const safeDiamonds = keepPreviousOnSuspiciousZero(diamonds, sessionStats.diamonds);
      const safeTotalSteps = keepPreviousOnSuspiciousZero(totalSteps, sessionStats.total_steps);
      const safeXpRemaining = keepPreviousOnSuspiciousZero(xpRemaining, sessionStats.xp_remaining);
      const safeCurrentHp = keepPreviousOnSuspiciousZero(currentHp, sessionStats.current_hp);
      const safeMaxHp = keepPreviousOnSuspiciousZero(maxHp, sessionStats.max_hp);
      const safeQuestPoints = keepPreviousOnSuspiciousZero(questPoints, sessionStats.qp);
      const safeMaxQuestPoints = keepPreviousOnSuspiciousZero(maxQuestPoints, sessionStats.max_qp);
      const safeXpPercent = keepPreviousOnSuspiciousZero(xpPercent, sessionStats.xp_progress);
      const safeHpPercent = keepPreviousOnSuspiciousZero(hpPercent, sessionStats.hp_percent);
      const safeQpPercent = keepPreviousOnSuspiciousZero(qpPercent, sessionStats.qp_percent);

      if (safeLevel !== null && safeLevel !== undefined) sessionStats.level = safeLevel;
      if (safeGold !== null && safeGold !== undefined) sessionStats.gold = String(safeGold);
      if (safeBank !== null && safeBank !== undefined) sessionStats.bank = String(safeBank);
      if (safeDiamonds !== null && safeDiamonds !== undefined) sessionStats.diamonds = safeDiamonds;
      if (safeTotalSteps !== null && safeTotalSteps !== undefined) sessionStats.total_steps = safeTotalSteps;
      if (safeXpRemaining !== null && safeXpRemaining !== undefined) sessionStats.xp_remaining = safeXpRemaining;
      if (safeXpPercent !== null && safeXpPercent !== undefined) sessionStats.xp_progress = safeXpPercent;
      if (safeCurrentHp !== null && safeCurrentHp !== undefined) sessionStats.current_hp = safeCurrentHp;
      if (safeMaxHp !== null && safeMaxHp !== undefined) sessionStats.max_hp = safeMaxHp;
      if (hpPercent !== null) {
        sessionStats.hp_percent = safeHpPercent;
      } else if (safeCurrentHp !== null && safeMaxHp) {
        sessionStats.hp_percent = Math.max(0, Math.min(100, (safeCurrentHp / safeMaxHp) * 100));
      }
      if (safeQuestPoints !== null && safeQuestPoints !== undefined) {
        sessionStats.qp = safeQuestPoints;
        sessionStats.quest_points = safeQuestPoints;
      }
      if (safeMaxQuestPoints !== null && safeMaxQuestPoints !== undefined) {
        sessionStats.max_qp = safeMaxQuestPoints;
        sessionStats.max_quest_points = safeMaxQuestPoints;
      }
      if (qpPercent !== null) {
        sessionStats.qp_percent = safeQpPercent;
      } else if (safeQuestPoints !== null && safeMaxQuestPoints) {
        sessionStats.qp_percent = Math.max(0, Math.min(100, (safeQuestPoints / safeMaxQuestPoints) * 100));
      }
      sessionStats.stats_updated_at = Date.now();

      if (!didLogStatsReady && (gold !== null || questPoints !== null || currentHp !== null || xpRemaining !== null)) {
        didLogStatsReady = true;
        didLogStatsMissing = false;
        socket?.emit('bot-log', `Stats sync active${snapshot.username ? ` (${snapshot.username})` : ''}`);
      } else if (!didLogStatsMissing && snapshot.username && gold === null && questPoints === null && currentHp === null && xpRemaining === null) {
        didLogStatsMissing = true;
        socket?.emit('bot-log', `Stats not found yet (username only, global=${snapshot.debugFoundGlobal ? 'yes' : 'no'})`);
      }
    } catch {
      // Best effort polling: falen mag bot-flow niet stoppen.
    }
  };

  collectStats();
  statsPollInterval = setInterval(collectStats, STATS_POLL_MS);
}

async function closeBrowser(socket) {
  if (statsPollInterval) {
    clearInterval(statsPollInterval);
    statsPollInterval = null;
  }

  const activeBrowser = browser;
  browser = null;
  page = null;

  if (!activeBrowser) {
    return;
  }

  try {
    await activeBrowser.close();
    socket?.emit('bot-log', 'Browser closed');
  } catch (err) {
    const msg = err?.message || String(err);
    socket?.emit('bot-log', `Failed to close browser: ${msg}`);
    try {
      activeBrowser.process()?.kill('SIGKILL');
    } catch {
      // Best effort: proces kan al weg zijn.
    }
  }
}

function getPage() {
  return page;
}

function setBrowserWindowConfig(cfg = {}) {
  windowConfig = normalizeWindowConfig(cfg);
  return windowConfig;
}

function getBrowserWindowConfig() {
  return normalizeWindowConfig(windowConfig);
}

module.exports = { startBrowser, closeBrowser, getPage, setBrowserWindowConfig, getBrowserWindowConfig };
