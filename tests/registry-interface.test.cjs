const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const applicationRoot = path.resolve(__dirname, '..');

function read(filename) {
  return fs.readFileSync(path.join(applicationRoot, filename), 'utf8');
}

test('desktop Registry Editor requires the protected bridge', () => {
  const editor = read(path.join('studio', 'authoring', 'registry-editor.html'));
  assert.match(editor, /shared\/frontend\/platform-adapter\.js/);
  assert.match(editor, /api\.listRegistries\(\)/);
  assert.match(editor, /api\.saveRegistry\(/);
  assert.match(editor, /currentRegistry\(\)\.revision/);
  assert.match(editor, /api\.openDeveloperFiles\(\)/);
  assert.match(editor, /Open the Registry Editor from Movement Timeline Studio/);
  assert.doesNotMatch(editor, /\bfetch\(/);
  assert.match(editor, /editingCategory/);
  assert.match(editor, /editing \? 'Done' : 'Edit'/);
  assert.match(editor, /Needs attention/);
  assert.doesNotMatch(editor, /verified maker|verified pair/i);
});

test('registry page loads and saves through the desktop bridge with its expected revision', async () => {
  const editor = read('studio/authoring/registry-editor.html');
  const start = editor.indexOf('async function loadRegistries(');
  const source = editor.slice(start, editor.indexOf('        elements.tabs.forEach', start));
  const calls = [];
  const state = { activeType: 'effects', writable: true, dirty: new Set(), editingCategory: {} };
  const catalog = { effects: { categories: [{ Category: 'Test', engines: ['demo'] }], revision: 'revision-1' } };
  const context = {
    state, elements: { reloadBtn: {}, saveBtn: {} },
    api: {
      async listRegistries() { calls.push('list'); return catalog; },
      async saveRegistry(type, registry, revision) {
        calls.push([type, JSON.parse(JSON.stringify(registry)), revision]);
        return { categories: registry, revision: 'revision-2' };
      }
    },
    currentRegistry: () => state.data.effects,
    normalizePayload: value => value,
    render() {}, updateSaveButton() {}, setStatus() {},
    console: { error(error) { throw error; } },
    fetch() { assert.fail('Desktop registry must use its bridge'); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.loadRegistries();
  state.dirty.add('effects');
  await context.saveActiveRegistry();
  assert.deepEqual(calls, ['list', ['effects', [{ Category: 'Test', engines: ['demo'] }], 'revision-1']]);
  assert.equal(state.data.effects.revision, 'revision-2');
  assert.equal(state.dirty.size, 0);
  const messages = [];
  context.api = null;
  context.console = { error() {} };
  context.setStatus = message => messages.push(message);
  await context.loadRegistries();
  await context.saveActiveRegistry();
  assert.equal(calls.length, 2);
  assert.equal(messages.filter(message => message === 'Open the Registry Editor from Movement Timeline Studio.').length, 2);
});

test('both maker hubs expose their matching registry management control', () => {
  const effectsHub = read(path.join('studio', 'hubs', 'effects-hub.html'));
  const transitionsHub = read(path.join('studio', 'hubs', 'transitions-hub.html'));
  assert.match(effectsHub, /id="manageRegistryBtn"[^>]*>Manage effects</);
  assert.match(effectsHub, /registryType:\s*'effects'/);
  assert.match(transitionsHub, /id="manageRegistryBtn"[^>]*>Manage transitions</);
  assert.match(transitionsHub, /registryType:\s*'transitions'/);
});

test('both maker hubs install the shared scrolling guard in maker iframes', () => {
  const effectsHub = read(path.join('studio', 'hubs', 'effects-hub.html'));
  const transitionsHub = read(path.join('studio', 'hubs', 'transitions-hub.html'));
  const scrollGuard = read(path.join('studio', 'maker', 'maker-scroll-guard.js'));
  const scrollStyles = read(path.join('studio', 'maker', 'maker-scroll-guard.css'));

  for (const hub of [effectsHub, transitionsHub]) {
    assert.match(hub, /<script src="\/studio\/maker\/maker-scroll-guard\.js"><\/script>/);
    assert.match(hub, /frame\.addEventListener\('load'/);
    assert.match(hub, /MovementMakerScrollGuard\.install\(frame\)/);
  }

  assert.match(scrollGuard, /body > aside/);
  assert.match(scrollGuard, /input, select, textarea, button/);
  assert.match(scrollGuard, /data-movement-maker-scroll-guard/);
  assert.match(scrollStyles, /\.movement-maker-scroll-panel/);
  assert.match(scrollStyles, /overflow-y:\s*auto !important/);
  assert.match(scrollStyles, /scrollbar-gutter:\s*stable/);
});

test('Effects Hub exposes the friendly effect prompt builder', () => {
  const effectsHub = read(path.join('studio', 'hubs', 'effects-hub.html'));
  const editorLogic = read(path.join('studio', 'editor', 'json-maker-logic.js'));
  assert.match(effectsHub, /id="createEffectPromptBtn"[^>]*>Create or improve effect</);
  assert.match(effectsHub, /type:\s*'movement-open-effect-prompt-builder'/);
  assert.match(effectsHub, /'\/effects\/' \+ engine \+ '-maker\.html'/);
  assert.match(editorLogic, /event\.data\.type !== 'movement-open-effect-prompt-builder'/);
  assert.match(editorLogic, /DESKTOP_BRIDGE\.openEffectPromptBuilder\(\)/);
});

test('Transitions Hub exposes the friendly transition prompt builder', () => {
  const transitionsHub = read(path.join('studio', 'hubs', 'transitions-hub.html'));
  const editorLogic = read(path.join('studio', 'editor', 'json-maker-logic.js'));
  assert.match(
    transitionsHub,
    /id="createTransitionPromptBtn"[^>]*>Create or improve transition</
  );
  assert.match(transitionsHub, /type:\s*'movement-open-transition-prompt-builder'/);
  assert.match(
    editorLogic,
    /event\.data\.type !== 'movement-open-transition-prompt-builder'/
  );
  assert.match(editorLogic, /DESKTOP_BRIDGE\.openTransitionPromptBuilder\(\)/);
});

test('desktop editor validates hub messages and refreshes a changed registry', () => {
  const editorLogic = read(path.join('studio', 'editor', 'json-maker-logic.js'));
  assert.match(editorLogic, /event\.data\.type !== 'movement-open-registry-editor'/);
  assert.match(editorLogic, /event\.source === els\.iframe\.contentWindow/);
  assert.match(editorLogic, /event\.source === els\.transitionsIframe\.contentWindow/);
  assert.match(editorLogic, /DESKTOP_BRIDGE\.openRegistryEditor\(registryType\)/);
  assert.match(editorLogic, /DESKTOP_BRIDGE\.onRegistryChanged/);
  assert.match(editorLogic, /type:\s*'movement-registry-changed'/);
});
