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

function findBestStatsObject(root) {
  if (!root || typeof root !== 'object') return null;
  const targetKeys = [
    'level', 'gold', 'bank', 'diamonds', 'total_steps',
    'exp_remaining', 'current_hp', 'max_hp', 'energy', 'max_energy',
    'quest_points', 'max_quest_points',
    'strength', 'defence', 'dexterity'
  ];
  const keySet = new Set(targetKeys);
  const seen = new Set();
  const queue = [root];
  let best = null;
  let bestScore = 0;

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    const keys = Object.keys(node);
    const score = keys.filter((k) => keySet.has(String(k).toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }

    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') queue.push(v);
    }
  }

  return bestScore >= 3 ? best : null;
}

function readDirect(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const v = obj[key];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        return v;
      }
    }
  }
  return null;
}

function applyStatsFromPayload(payload, sessionStats) {
  if (!payload || typeof payload !== 'object' || !sessionStats) return false;

  const source = findBestStatsObject(payload);
  if (!source) return false;

  const level = toInt(readDirect(source, ['level']));
  const gold = toInt(readDirect(source, ['gold']));
  const bank = toInt(readDirect(source, ['bank', 'bank_gold', 'bank_balance']));
  const diamonds = toInt(readDirect(source, ['diamonds', 'diamond']));
  const totalSteps = toInt(readDirect(source, ['total_steps', 'steps_total']));
  const xpRemaining = toInt(readDirect(source, ['exp_remaining', 'xp_remaining']));
  const currentHp = toInt(readDirect(source, ['current_hp', 'health_current']));
  const maxHp = toInt(readDirect(source, ['max_hp', 'health_max']));
  const energy = toInt(readDirect(source, ['energy', 'current_energy']));
  const maxEnergy = toInt(readDirect(source, ['max_energy', 'energy_max']));
  const qp = toInt(readDirect(source, ['quest_points', 'qp', 'current_quest_points']));
  const maxQp = toInt(readDirect(source, ['max_quest_points', 'max_qp', 'quest_points_max']));
  const strength = toInt(readDirect(source, ['strength', 'str']));
  const defence = toInt(readDirect(source, ['defence', 'defense']));
  const dexterity = toInt(readDirect(source, ['dexterity', 'dex']));
  const pointsRemaining = toInt(readDirect(source, ['points_remaining', 'skill_points_remaining']));
  const mining = toInt(readDirect(source, ['mining', 'mining_level']));
  const crafting = toInt(readDirect(source, ['crafting', 'crafting_level']));
  const fishing = toInt(readDirect(source, ['fishing', 'fishing_level']));
  const woodcutting = toInt(readDirect(source, ['woodcutting', 'woodcutting_level']));
  const treasure = toInt(readDirect(source, ['treasure_hunting', 'treasure_hunting_level']));
  const spatkRaw = readDirect(source, ['spatk_bonus', 'spatk_damage', 'special_attack_damage']);
  const spatkBonus = spatkRaw !== null && spatkRaw !== undefined ? String(spatkRaw).trim() : '';
  const usernameRaw = readDirect(source, ['username', 'name']) || findFirstByKeys(payload, ['username', 'name']);
  const username = usernameRaw ? String(usernameRaw).trim() : '';

  let changed = false;
  const setIf = (cond, fn) => {
    if (!cond) return;
    fn();
    changed = true;
  };

  setIf(username && username !== sessionStats.username, () => { sessionStats.username = username; });
  const prevLevel = Number(sessionStats.level || 0);
  const prevGold = Number(sessionStats.gold || 0);
  const prevBank = Number(sessionStats.bank || 0);
  const prevDiamonds = Number(sessionStats.diamonds || 0);
  const prevTotalSteps = Number(sessionStats.total_steps || 0);

  setIf(level !== null && (level > 0 || prevLevel === 0), () => { sessionStats.level = level; });
  setIf(gold !== null && (gold > 0 || prevGold === 0), () => { sessionStats.gold = String(gold); });
  setIf(bank !== null && (bank > 0 || prevBank === 0), () => { sessionStats.bank = String(bank); });
  setIf(diamonds !== null && (diamonds > 0 || prevDiamonds === 0), () => { sessionStats.diamonds = diamonds; });
  setIf(totalSteps !== null && (totalSteps > 0 || prevTotalSteps === 0), () => { sessionStats.total_steps = totalSteps; });
  setIf(xpRemaining !== null, () => { sessionStats.xp_remaining = xpRemaining; });
  if (currentHp !== null && maxHp !== null && maxHp > 0) {
    setIf(currentHp >= 0, () => { sessionStats.current_hp = currentHp; });
    setIf(maxHp > 0, () => { sessionStats.max_hp = maxHp; });
  }
  if (energy !== null && maxEnergy !== null && maxEnergy > 0) {
    setIf(energy >= 0, () => { sessionStats.energy = energy; });
    setIf(maxEnergy > 0, () => { sessionStats.max_energy = maxEnergy; });
  }
  if (qp !== null && maxQp !== null && maxQp > 0) {
    setIf(qp >= 0, () => {
      sessionStats.qp = qp;
      sessionStats.quest_points = qp;
    });
    setIf(maxQp > 0, () => {
      sessionStats.max_qp = maxQp;
      sessionStats.max_quest_points = maxQp;
    });
  }
  const prevStrength = Number(sessionStats.strength || 0);
  const prevDefence = Number(sessionStats.defence || 0);
  const prevDexterity = Number(sessionStats.dexterity || 0);
  setIf(strength !== null && (strength > 0 || prevStrength === 0), () => { sessionStats.strength = strength; });
  setIf(defence !== null && (defence > 0 || prevDefence === 0), () => { sessionStats.defence = defence; });
  setIf(dexterity !== null && (dexterity > 0 || prevDexterity === 0), () => { sessionStats.dexterity = dexterity; });
  setIf(pointsRemaining !== null && pointsRemaining >= 0, () => { sessionStats.points_remaining = pointsRemaining; });
  setIf(mining !== null && mining >= 0, () => { sessionStats.skill_mining = mining; });
  setIf(crafting !== null && crafting >= 0, () => { sessionStats.skill_crafting = crafting; });
  setIf(fishing !== null && fishing >= 0, () => { sessionStats.skill_fishing = fishing; });
  setIf(woodcutting !== null && woodcutting >= 0, () => { sessionStats.skill_woodcutting = woodcutting; });
  setIf(treasure !== null && treasure >= 0, () => { sessionStats.skill_treasure_hunting = treasure; });
  setIf(spatkBonus, () => {
    sessionStats.spatk_bonus = spatkBonus.includes('%') ? spatkBonus : `${spatkBonus}%`;
  });

  if (sessionStats.current_hp > 0 && sessionStats.max_hp > 0) {
    sessionStats.hp_percent = Math.max(0, Math.min(100, (sessionStats.current_hp / sessionStats.max_hp) * 100));
  }
  if (sessionStats.energy >= 0 && sessionStats.max_energy > 0) {
    sessionStats.energy_percent = Math.max(0, Math.min(100, (sessionStats.energy / sessionStats.max_energy) * 100));
  }
  if (sessionStats.qp >= 0 && sessionStats.max_qp > 0) {
    sessionStats.qp_percent = Math.max(0, Math.min(100, (sessionStats.qp / sessionStats.max_qp) * 100));
  }
  if (changed) {
    sessionStats.stats_updated_at = Date.now();
  }
  return changed;
}

function parseIntFromHtmlById(html, id) {
  const re = new RegExp(`id=["']${id}["'][^>]*>[\\s\\S]*?(-?\\d[\\d,.]*)`, 'i');
  const m = String(html || '').match(re);
  return m && m[1] ? toInt(m[1]) : null;
}

function parseSkillLevelFromHtml(html, skillName) {
  const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}[\\s\\S]{0,220}?Level\\s*(-?\\d[\\d,.]*)`, 'i');
  const m = String(html || '').match(re);
  return m && m[1] ? toInt(m[1]) : null;
}

function parseSpatkBonusFromHtml(html) {
  const idMatch = String(html || '').match(/id=["']add_crit_stat["'][^>]*>\s*([+\-]?\d+(?:[.,]\d+)?)\s*%/i);
  if (idMatch && idMatch[1]) return `${String(idMatch[1]).replace(',', '.')}%`;

  const genericMatch = String(html || '').match(/spATK\s*Damage[\s\S]{0,200}?([+\-]?\d+(?:[.,]\d+)?)\s*%/i);
  if (genericMatch && genericMatch[1]) return `${String(genericMatch[1]).replace(',', '.')}%`;
  return '';
}

function applyCharacterSnapshotHtml(html, sessionStats) {
  if (!html || !sessionStats) return false;

  const str = parseIntFromHtmlById(html, 'str_stat');
  const def = parseIntFromHtmlById(html, 'def_stat');
  const dex = parseIntFromHtmlById(html, 'dex_stat');
  const pointsRemaining = parseIntFromHtmlById(html, 'available_points');
  const mining = parseSkillLevelFromHtml(html, 'Mining');
  const crafting = parseSkillLevelFromHtml(html, 'Crafting');
  const fishing = parseSkillLevelFromHtml(html, 'Fishing');
  const woodcutting = parseSkillLevelFromHtml(html, 'Woodcutting');
  const treasure = parseSkillLevelFromHtml(html, 'Treasure Hunting');
  const spatkBonus = parseSpatkBonusFromHtml(html);

  let changed = false;
  const setNumber = (field, value) => {
    if (value === null || value === undefined || value < 0) return;
    if (Number(sessionStats[field] || 0) === Number(value)) return;
    sessionStats[field] = value;
    changed = true;
  };
  const setString = (field, value) => {
    const next = String(value || '').trim();
    if (!next) return;
    if (String(sessionStats[field] || '').trim() === next) return;
    sessionStats[field] = next;
    changed = true;
  };

  setNumber('strength', str);
  setNumber('defence', def);
  setNumber('dexterity', dex);
  setNumber('points_remaining', pointsRemaining);
  setNumber('skill_mining', mining);
  setNumber('skill_crafting', crafting);
  setNumber('skill_fishing', fishing);
  setNumber('skill_woodcutting', woodcutting);
  setNumber('skill_treasure_hunting', treasure);
  setString('spatk_bonus', spatkBonus);

  if (changed) {
    sessionStats.stats_updated_at = Date.now();
  }

  return changed;
}

module.exports = {
  parseInteger,
  parsePercent,
  keepPreviousOnSuspiciousZero,
  applyStatsFromPayload,
  applyCharacterSnapshotHtml
};
