function decodeEscapedUrl(value) {
  return String(value || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .trim();
}

function findQuestArray(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const known = [
    payload.expeditions,
    payload.data?.expeditions,
    payload.value?.expeditions,
    payload.result?.expeditions,
    payload.data,
    payload.value,
    payload.result
  ];
  for (const candidate of known) {
    if (Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === 'object') {
      return candidate;
    }
  }

  const seen = new Set();
  const queue = [payload];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    for (const value of Object.values(node)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const probe = value[0];
        const keys = Object.keys(probe).map((k) => String(k).toLowerCase());
        const likelyQuest = keys.includes('title') || keys.includes('level_required') || keys.includes('is_completed');
        if (likelyQuest) return value;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return [];
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeQuestLivePayload(rawPayload) {
  const list = findQuestArray(rawPayload);
  const quests = list.map((item) => {
    const title = String(
      item?.title ||
      item?.name ||
      item?.quest_title ||
      item?.expedition_title ||
      ''
    ).trim();
    if (!title) return null;

    const completedAmount = toNumberOrNull(item?.completed_amount);
    const amountToComplete = toNumberOrNull(item?.amount_to_complete);
    const remainingAmount = (completedAmount !== null && amountToComplete !== null)
      ? Math.max(0, amountToComplete - completedAmount)
      : null;
    return {
      id: item?.id ?? null,
      title,
      level_required: toNumberOrNull(item?.level_required),
      success_chance: toNumberOrNull(item?.success_chance),
      experience: toNumberOrNull(item?.experience),
      gold: toNumberOrNull(item?.gold),
      is_completed: Boolean(item?.is_completed),
      completed_amount: completedAmount,
      amount_to_complete: amountToComplete,
      remaining_amount: remainingAmount,
      progress_percent: (completedAmount !== null && amountToComplete && amountToComplete > 0)
        ? Math.max(0, Math.min(100, Math.floor((completedAmount / amountToComplete) * 100)))
        : null
    };
  }).filter(Boolean).slice(0, 30);

  const questPoints = toNumberOrNull(
    rawPayload?.quest_points ??
    rawPayload?.user?.quest_points ??
    rawPayload?.expedition?.user?.quest_points
  );
  const maxQuestPoints = toNumberOrNull(
    rawPayload?.max_quest_points ??
    rawPayload?.user?.max_quest_points ??
    rawPayload?.expedition?.user?.max_quest_points
  );

  return {
    quests,
    quest_points: questPoints,
    max_quest_points: maxQuestPoints
  };
}

async function pollQuestLiveRaw(page, cachedEndpoint) {
  return await page.evaluate(async (initialEndpoint) => {
    const decodeEscaped = (value) => String(value || '')
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&')
      .trim();

    const parseEndpointFromHtml = (htmlText) => {
      const raw = String(htmlText || '');
      const patterns = [
        /"expedition\.get_endpoint"\s*:\s*"([^"]+)"/i,
        /setGameData\(\s*['"]expedition\.get_endpoint['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i,
        /expedition\.get_endpoint['"]?\s*[:=]\s*['"]([^'"]+)['"]/i
      ];
      for (const re of patterns) {
        const m = raw.match(re);
        if (m && m[1]) return decodeEscaped(m[1]);
      }
      return '';
    };

    const tryFetchJson = async (endpoint) => {
      if (!endpoint) return null;
      try {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        const apiToken = document.querySelector('meta[name="api-token"]')?.getAttribute('content') || '';
        const resp = await fetch(endpoint, {
          credentials: 'include',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
            ...(apiToken ? { 'x-api-token': apiToken } : {})
          }
        });
        if (!resp.ok) return null;
        const ct = String(resp.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          return await resp.json().catch(() => null);
        }
        const text = await resp.text().catch(() => '');
        if (!text) return null;
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const parseQuestPointsFromHtml = (htmlText) => {
      const raw = String(htmlText || '');
      const qpMatch = raw.match(/"expedition\.user\.quest_points"\s*:\s*([0-9]+)/i);
      const maxMatch = raw.match(/"expedition\.user\.max_quest_points"\s*:\s*([0-9]+)/i);
      const qp = qpMatch && qpMatch[1] ? Number(qpMatch[1]) : null;
      const maxQp = maxMatch && maxMatch[1] ? Number(maxMatch[1]) : null;
      return {
        qp: Number.isFinite(qp) ? qp : null,
        maxQp: Number.isFinite(maxQp) ? maxQp : null
      };
    };

    let endpoint = decodeEscaped(initialEndpoint || '');
    let payload = await tryFetchJson(endpoint);
    let htmlFallback = '';

    if (!payload) {
      try {
        const htmlResp = await fetch('/quests?new_page=true', { credentials: 'include' });
        if (htmlResp.ok) {
          const html = await htmlResp.text();
          htmlFallback = html || '';
          endpoint = parseEndpointFromHtml(htmlFallback);
          payload = await tryFetchJson(endpoint);
        }
      } catch {
        // ignore
      }
    }

    if (!payload) {
      const points = parseQuestPointsFromHtml(htmlFallback);
      payload = {
        quest_points: points.qp,
        max_quest_points: points.maxQp,
        expeditions: []
      };
    }

    return {
      endpoint: endpoint || '',
      payload: payload || null
    };
  }, cachedEndpoint).catch(() => null);
}

module.exports = {
  decodeEscapedUrl,
  normalizeQuestLivePayload,
  pollQuestLiveRaw
};
