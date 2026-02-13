const { runSmokeTests } = require('./smoke.test');

try {
  runSmokeTests();
  console.log('[smoke] All smoke tests passed.');
  process.exit(0);
} catch (err) {
  const msg = err && err.stack ? err.stack : String(err);
  console.error('[smoke] Test failed:', msg);
  process.exit(1);
}

