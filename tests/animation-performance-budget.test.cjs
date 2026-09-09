const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

test('shared animation performance budget prevents the known renderer crash patterns', () => {
  const budget = fs.readFileSync(
    path.join(applicationRoot, 'docs', 'ANIMATION_PERFORMANCE_BUDGET.md'),
    'utf8'
  );

  assert.match(budget, /acceptance requirements, not suggestions/);
  assert.match(budget, /2,073,600 \(1920 × 1080\)/);
  assert.match(budget, /Never assign `canvas\.width` and `canvas\.height` directly from unchecked `naturalWidth`/);
  assert.match(budget, /Do not repeatedly decode or rescale source media.*every frame/);
  assert.match(budget, /target 30 frames per second.*must not exceed 45/s);
  assert.match(budget, /default of 72 or fewer.*maximum of 120 or fewer/s);
  assert.match(budget, /Do not apply live `shadowBlur`.*separately to many objects/s);
  assert.match(budget, /raw slider `input` event must not repeatedly remount the engine/s);
  assert.match(budget, /at least two simultaneous instances/);
  assert.match(budget, /actual Chromium\/Electron stress check/);
  assert.match(budget, /Mock canvas tests with no-op drawing methods do not count/);
});
