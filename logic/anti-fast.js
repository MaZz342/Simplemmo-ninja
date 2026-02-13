// logic/anti-fast.js - adaptive anti-fast throttle per flow

const FLOWS = {
  combat: { maxPenalty: 4.5, stepUp: 1.0, stepDown: 0.18, decayMs: 45000 },
  gather: { maxPenalty: 4.0, stepUp: 0.9, stepDown: 0.16, decayMs: 50000 },
  battle: { maxPenalty: 5.0, stepUp: 1.1, stepDown: 0.14, decayMs: 55000 }
};

const PROFILES = {
  safe: { delayMult: 1.16, warningBoost: 1.1 },
  balanced: { delayMult: 1.0, warningBoost: 1.0 },
  'fast-human': { delayMult: 0.9, warningBoost: 0.92 }
};

let activeProfile = 'balanced';

const state = {
  combat: { penalty: 0, lastUpdateAt: 0, lastWarnAt: 0, warnings: 0 },
  gather: { penalty: 0, lastUpdateAt: 0, lastWarnAt: 0, warnings: 0 },
  battle: { penalty: 0, lastUpdateAt: 0, lastWarnAt: 0, warnings: 0 }
};

function cfg(flow) {
  return FLOWS[flow] || FLOWS.gather;
}

function st(flow) {
  return state[flow] || state.gather;
}

function decay(flow) {
  const s = st(flow);
  const c = cfg(flow);
  const now = Date.now();
  if (!s.lastUpdateAt) {
    s.lastUpdateAt = now;
    return;
  }

  const elapsed = Math.max(0, now - s.lastUpdateAt);
  if (elapsed <= 0 || s.penalty <= 0) {
    s.lastUpdateAt = now;
    return;
  }

  const decayAmount = (elapsed / c.decayMs) * c.stepDown;
  s.penalty = Math.max(0, s.penalty - decayAmount);
  s.lastUpdateAt = now;
}

function tuneDelay(flow, delayMs, opts = {}) {
  const base = Number(delayMs);
  if (!(base > 0)) return 0;

  const s = st(flow);
  const c = cfg(flow);
  decay(flow);

  const profile = PROFILES[activeProfile] || PROFILES.balanced;
  let tuned = base * profile.delayMult * (1 + s.penalty * 0.24);
  const sinceWarn = s.lastWarnAt > 0 ? Date.now() - s.lastWarnAt : Number.POSITIVE_INFINITY;

  if (sinceWarn < 12000) {
    tuned += 800 + Math.random() * 1400;
  }

  if (Number.isFinite(Number(opts.floorMs))) {
    tuned = Math.max(tuned, Number(opts.floorMs));
  }

  const ceiling = Number.isFinite(Number(opts.ceilingMs)) ? Number(opts.ceilingMs) : 60000;
  tuned = Math.max(250, Math.min(ceiling, tuned));

  return Math.round(tuned);
}

function markFastWarning(flow, socket, reason = '') {
  const s = st(flow);
  const c = cfg(flow);
  const profile = PROFILES[activeProfile] || PROFILES.balanced;
  decay(flow);

  s.penalty = Math.min(c.maxPenalty, s.penalty + (c.stepUp * profile.warningBoost));
  s.lastWarnAt = Date.now();
  s.warnings += 1;

  const sec = Math.round(6 + s.penalty * 2.2);
  if (socket && typeof socket.emit === 'function') {
    const extra = reason ? ` (${reason})` : '';
    socket.emit('bot-log', `Adaptive anti-fast [${flow}]: slowing down ~${sec}s${extra}`);
  }
}

function markFlowProgress(flow) {
  const s = st(flow);
  const c = cfg(flow);
  decay(flow);
  s.penalty = Math.max(0, s.penalty - (c.stepDown * 0.4));
}

async function detectAntiFastWarning(page) {
  return await page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    return (
      (text.includes('hold on') && text.includes('too fast')) ||
      (text.includes('hold up') && text.includes('too fast')) ||
      text.includes('you are going too fast') ||
      text.includes('going too fast') ||
      text.includes('slow down') ||
      text.includes('too fast')
    );
  }).catch(() => false);
}

function getAntiFastState(flow) {
  const s = st(flow);
  decay(flow);
  return {
    penalty: Number(s.penalty.toFixed(2)),
    warnings: s.warnings,
    lastWarnAt: s.lastWarnAt
  };
}

function setAntiFastProfile(profileName) {
  const next = String(profileName || '').toLowerCase();
  activeProfile = PROFILES[next] ? next : 'balanced';
  return activeProfile;
}

module.exports = {
  tuneDelay,
  markFastWarning,
  markFlowProgress,
  detectAntiFastWarning,
  getAntiFastState,
  setAntiFastProfile
};
