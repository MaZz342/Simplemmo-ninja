// logic/human-delay.js
// Centrale "menselijke" delay generator met state (fatigue, streaks, afleiding)

let state = {
  lastActionAt: 0,
  streak: 0,           // aantal acties achter elkaar
  lastType: '',        // 'step' | 'resource' | 'combat' | 'close' | ...
  fatigue: 0,          // 0..1, loopt langzaam op
  lastDistractionAt: 0
};

const DELAY_PROFILES = {
  safe: { mult: 1.22, distractionBoost: 0.01 },
  balanced: { mult: 1.0, distractionBoost: 0 },
  'fast-human': { mult: 0.88, distractionBoost: -0.005 }
};

let activeProfile = 'balanced';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// “lognormal-ish” random: meer massa rond het midden, af en toe uitschieter
function softSkew(min, max) {
  // gemiddelde van 3 randoms geeft bell-ish
  const t = (Math.random() + Math.random() + Math.random()) / 3;
  return min + (max - min) * t;
}

function should(p) {
  return Math.random() < p;
}

function getProfile() {
  return DELAY_PROFILES[activeProfile] ? activeProfile : 'balanced';
}

function setDelayProfile(profileName) {
  const next = String(profileName || '').toLowerCase();
  activeProfile = DELAY_PROFILES[next] ? next : 'balanced';
  return activeProfile;
}

function updateState(type) {
  const now = Date.now();

  if (state.lastType === type) state.streak += 1;
  else state.streak = 1;

  state.lastType = type;
  state.lastActionAt = now;

  // fatigue groeit langzaam bij acties, zakt langzaam in de tijd
  state.fatigue = clamp(state.fatigue + 0.01, 0, 1);

  // als lang niks: fatigue beetje resetten
  // (dit werkt ook als bot even pauze had)
  // NB: wordt pas effectief bij volgende call
}

function decayFatigue() {
  const now = Date.now();
  const idle = now - (state.lastActionAt || now);
  if (idle > 60000) {
    state.fatigue = clamp(state.fatigue - 0.12, 0, 1);
  } else if (idle > 15000) {
    // 15s idle => iets frisser
    state.fatigue = clamp(state.fatigue - 0.06, 0, 1);
  }
}

/**
 * humanDelay(type, baseMin, baseMax, opts?)
 * type: 'step' | 'resource' | 'combat' | 'close' | 'popup' | ...
 */
function humanDelay(type, baseMin, baseMax, opts = {}) {
  const now = Date.now();
  const sinceLastAction = state.lastActionAt > 0
    ? (now - state.lastActionAt)
    : Number.POSITIVE_INFINITY;

  decayFatigue();
  updateState(type);

  // basis delay
  let delay = softSkew(baseMin, baseMax);
  const profile = DELAY_PROFILES[getProfile()] || DELAY_PROFILES.balanced;
  delay *= profile.mult;

  // tempo-variatie: meestal normaal, soms sneller of juist trager
  const paceRoll = Math.random();
  if (paceRoll < 0.18) delay *= rand(0.84, 0.95);
  else if (paceRoll > 0.86) delay *= rand(1.10, 1.28);

  // anti-spam: rem bij extreem snelle opvolgende acties
  if (sinceLastAction < 1800) {
    delay += rand(500, 1350);
  } else if (sinceLastAction < 3200) {
    delay += rand(180, 700);
  }

  // streak invloed: als je veel hetzelfde doet, soms iets trager
  if (state.streak >= 4) delay *= 1.08;
  if (state.streak >= 8) delay *= 1.15;
  if (state.streak >= 12) delay *= 1.22;

  // stappen mogen iets vlotter blijven dan combat/resource loops
  if (type === 'step') {
    delay *= rand(0.84, 1.04);
  }

  // fatigue invloed
  delay *= (1 + state.fatigue * 0.18);

  // optionele context
  if (opts.afterResource) delay *= 1.10;
  if (opts.afterCombat) delay *= 1.08;
  if (opts.afterNav) delay *= 1.05;
  if (opts.quick) delay *= 0.90;

  // micro-pause: heel klein menselijk “twijfel”-moment
  if (should(clamp(0.32 + profile.distractionBoost, 0.08, 0.5))) delay += rand(90, 520);

  // afleiding: zelden, maar wel echt (niet te vaak)
  const canDistract = (now - state.lastDistractionAt) > 90000; // max 1x per 90s
  const distractBase = type === 'step' ? 0.045 : 0.035;
  const distractChance = clamp(distractBase + profile.distractionBoost, 0.005, 0.09);
  if (canDistract && should(distractChance)) {
    const extra = rand(4000, 12000);
    delay += extra;
    state.lastDistractionAt = now;
  }

  // cap
  delay = clamp(delay, 250, 60000);

  return Math.round(delay);
}

module.exports = {
  humanDelay,
  setDelayProfile,
  getDelayProfile: getProfile
};
