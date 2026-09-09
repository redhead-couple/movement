const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_WINDOW_STATE,
  loadWindowState,
  normalizeWindowState,
  saveWindowState
} = require('../desktop/services/window-state-service.cjs');

const displays = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: -1280, y: 0, width: 1280, height: 1024 }
];

test('missing or malformed Library state uses the first-launch defaults', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-window-state-'));
  const stateFile = path.join(temporaryRoot, 'main-window-state.json');
  try {
    assert.deepEqual(loadWindowState(stateFile, displays), DEFAULT_WINDOW_STATE);
    fs.writeFileSync(stateFile, '{not-json', 'utf8');
    assert.deepEqual(loadWindowState(stateFile, displays), DEFAULT_WINDOW_STATE);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Library state restores visible bounds and maximized preference', () => {
  assert.deepEqual(
    normalizeWindowState({
      x: -1100,
      y: 80,
      width: 1180,
      height: 760,
      maximized: true
    }, displays),
    {
      x: -1100,
      y: 80,
      width: 1180,
      height: 760,
      maximized: true
    }
  );
});

test('an off-screen saved position is discarded while size is retained', () => {
  assert.deepEqual(
    normalizeWindowState({
      x: 8000,
      y: 8000,
      width: 1320,
      height: 880,
      maximized: false
    }, displays),
    { width: 1320, height: 880, maximized: false }
  );
});

test('saved Library state round-trips through its JSON file', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-window-state-'));
  const stateFile = path.join(temporaryRoot, 'nested', 'main-window-state.json');
  const state = { x: 120, y: 90, width: 1400, height: 900, maximized: true };
  try {
    saveWindowState(stateFile, state);
    assert.deepEqual(loadWindowState(stateFile, displays), state);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
