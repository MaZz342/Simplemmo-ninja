const assert = require('assert');

function runSmokeTests() {
  const antiFast = require('../logic/anti-fast');
  const botLogic = require('../logic/bot-logic');
  const travel = require('../logic/travel');
  const combat = require('../logic/combat');
  const battleEnergy = require('../logic/battle-energy');
  const botLog = require('../logic/bot-log');
  const launch = require('../logic/browser/launch');
  const stats = require('../logic/browser/stats');
  const questLive = require('../logic/browser/quest-live');

  // Export smoke tests
  assert.strictEqual(typeof antiFast.tuneDelay, 'function');
  assert.strictEqual(typeof antiFast.markFastWarning, 'function');
  assert.strictEqual(typeof antiFast.detectAntiFastWarning, 'function');
  assert.strictEqual(typeof antiFast.setAntiFastProfile, 'function');

  assert.strictEqual(typeof botLogic.startBotLoop, 'function');
  assert.strictEqual(typeof botLogic.stopBotLoop, 'function');
  assert.strictEqual(typeof botLogic.isBotRunning, 'function');

  assert.strictEqual(typeof travel.handleTravel, 'function');
  assert.strictEqual(typeof combat.handleCombat, 'function');
  assert.strictEqual(typeof battleEnergy.handleBattleEnergy, 'function');
  assert.strictEqual(typeof battleEnergy.shouldRunBattleBurst, 'function');

  assert.strictEqual(typeof botLog.installBotLogBridge, 'function');
  assert.strictEqual(typeof botLog.emitBotLogToIo, 'function');
  assert.strictEqual(typeof botLog.buildBotLogEvent, 'function');

  assert.strictEqual(typeof launch.normalizeWindowConfig, 'function');
  assert.strictEqual(typeof launch.loadPersistedWindowConfig, 'function');
  assert.strictEqual(typeof launch.persistWindowConfig, 'function');
  assert.strictEqual(typeof launch.launchWithRetries, 'function');

  assert.strictEqual(typeof stats.parseInteger, 'function');
  assert.strictEqual(typeof stats.parsePercent, 'function');
  assert.strictEqual(typeof stats.applyStatsFromPayload, 'function');
  assert.strictEqual(typeof stats.applyCharacterSnapshotHtml, 'function');

  assert.strictEqual(typeof questLive.decodeEscapedUrl, 'function');
  assert.strictEqual(typeof questLive.normalizeQuestLivePayload, 'function');
  assert.strictEqual(typeof questLive.pollQuestLiveRaw, 'function');

  const humanDelay = require('../logic/human-delay');
  assert.strictEqual(typeof humanDelay.humanDelay, 'function');
  assert.strictEqual(typeof humanDelay.setDelayProfile, 'function');

  // Bot-log structured event smoke test
  const evt = botLog.buildBotLogEvent('Battle burst: Attack clicked');
  assert.strictEqual(evt.message, 'Battle burst: Attack clicked');
  assert.strictEqual(evt.flow, 'battle');
  assert.strictEqual(typeof evt.ts, 'number');
  assert.strictEqual(typeof evt.context, 'object');

  // Quest normalizer smoke test
  const normalized = questLive.normalizeQuestLivePayload({
    quest_points: 3,
    max_quest_points: 5,
    expeditions: [
      {
        id: 11,
        title: 'Defeat 5 wolves',
        level_required: 7,
        success_chance: 82,
        experience: 1250,
        gold: 640,
        is_completed: false,
        completed_amount: 2,
        amount_to_complete: 5
      }
    ]
  });

  assert.strictEqual(normalized.quest_points, 3);
  assert.strictEqual(normalized.max_quest_points, 5);
  assert.ok(Array.isArray(normalized.quests));
  assert.strictEqual(normalized.quests.length, 1);
  assert.strictEqual(normalized.quests[0].remaining_amount, 3);
  assert.strictEqual(normalized.quests[0].progress_percent, 40);
}

module.exports = { runSmokeTests };
