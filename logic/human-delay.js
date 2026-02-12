// logic/human-delay.js
// Centrale "menselijke" delay generator met state (fatigue, streaks, afleiding)

let state = {
  lastActionAt: 0,
  streak: 0,           // aantal acties achter elkaar
  lastType: '',        // 'step' | 'resource' | 'combat' | 'close' | ...
  fatigue: 0,          // 0..1, loopt langzaam op
  lastDistractionAt: 0
};

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
  if (idle > 15000) {
    // 15s idle => iets frisser
    state.fatigue = clamp(state.fatigue - 0.06, 0, 1);
  } else if (idle > 60000) {
    state.fatigue = clamp(state.fatigue - 0.12, 0, 1);
  }
}

/**
 * humanDelay(type, baseMin, baseMax, opts?)
 * type: 'step' | 'resource' | 'combat' | 'close' | 'popup' | ...
 */
function humanDelay(type, baseMin, baseMax, opts = {}) {
  decayFatigue();
  updateState(type);

  const now = Date.now();

  // basis delay
  let delay = softSkew(baseMin, baseMax);

  // streak invloed: als je veel hetzelfde doet, soms iets trager
  if (state.streak >= 4) delay *= 1.08;
  if (state.streak >= 8) delay *= 1.15;
  if (state.streak >= 12) delay *= 1.22;

  // fatigue invloed
  delay *= (1 + state.fatigue * 0.18);

  // optionele context
  if (opts.afterResource) delay *= 1.18;
  if (opts.afterCombat) delay *= 1.10;
  if (opts.afterNav) delay *= 1.05;
  if (opts.quick) delay *= 0.85;

  // micro-pause: heel klein menselijk “twijfel”-moment
  if (should(0.22)) delay += rand(80, 420);

  // afleiding: zelden, maar wel echt (niet te vaak)
  const canDistract = (now - state.lastDistractionAt) > 90000; // max 1x per 90s
  if (canDistract && should(type === 'step' ? 0.06 : 0.035)) {
    const extra = rand(4000, 12000);
    delay += extra;
    state.lastDistractionAt = now;
  }

  // cap
  delay = clamp(delay, 250, 60000);

  return Math.round(delay);
}

module.exports = { humanDelay };
