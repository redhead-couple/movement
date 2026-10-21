const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createWorkspaceService } = require('../desktop/services/workspace-service.cjs');

const source = fs.readFileSync(path.join(__dirname, '../studio/editor/json-maker-logic.js'), 'utf8');
const stateHelpers = source.slice(source.indexOf('let unsavedChanges'), source.indexOf('// --- Utils ---'));
const saveFunction = source.slice(source.indexOf('async function saveProject()'),
  source.indexOf('async function downloadJSONOnly()'));
const desktopUi = source.slice(source.indexOf('function applyDesktopEditorUi()'),
  source.indexOf('async function exportDesktopPortableProject()'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function editor(desktop) {
  const elements = Object.fromEntries(['saveProjectBtn', 'playSlideshowBtn', 'playFromCurrentBtn', 'saveStatus']
    .map(id => [id, { textContent: '', style: {} }]));
  elements.saveProjectBtn.textContent = 'Save Slideshow';
  const handlers = {};
  const requests = [];
  const alerts = [];
  const context = {
    DESKTOP_MODE: desktop,
    PROJECT_CONTEXT: { workspaceId: 'workspace', project: 'project' },
    MAKER_ENDPOINT: '/json-maker.php',
    state: { title: 'Original', description: '', openingImage: 'cover.png',
      slides: [{ text: 'A slide', bgImage: 'cover.png', foregroundLayers: [], audioLayers: [] }] },
    document: { getElementById: id => elements[id] || null, querySelectorAll: () => [] },
    window: { addEventListener: (name, callback) => { handlers[name] = callback; }, confirm: () => true },
    els: { saveBtn: elements.saveProjectBtn, saveStatus: elements.saveStatus },
    File, FormData,
    console: { error() {} }, alert: message => alerts.push(message), setTimeout() {},
    confirm: () => true, getCsrfToken: () => 'token',
    buildReplaceExistingMessage: () => 'Replace existing media?',
    desktopHasPendingMediaFiles: () => false,
    normalizeForegroundLayersForSlide: slide => slide.foregroundLayers,
    normalizeAudioLayersForSlide: slide => slide.audioLayers,
    normalizeGlobalAudioLayers: () => [],
    generateFinalJSON: () => ({
      schemaVersion: 2, title: context.state.title, description: context.state.description,
      openingImage: context.state.openingImage, slides: [{ textHTML: context.state.slides[0].text }]
    }),
    DESKTOP_BRIDGE: {
      saveProjectFlow(...args) {
        const result = deferred();
        requests.push({ args, result, flow: JSON.parse(JSON.stringify(args[2])) });
        return result.promise;
      }
    },
    fetch(_url, options) {
      const result = deferred();
      requests.push({ body: options.body, result, flow: JSON.parse(options.body.get('json_data')) });
      return result.promise;
    }
  };
  vm.createContext(context);
  vm.runInContext(stateHelpers + saveFunction + desktopUi, context);
  vm.runInContext("activeProjectRevision = 'revision-0'; clearUnsaved();", context);
  if (desktop) context.applyDesktopEditorUi();
  return {
    context, elements, requests, alerts,
    dirty: () => vm.runInContext('unsavedChanges', context),
    revision: () => vm.runInContext('activeProjectRevision', context),
    edit(title) { context.state.title = title; context.markUnsaved(); },
    save: () => context.saveProject(),
    succeed(index, revision = `revision-${index + 1}`) {
      requests[index].result.resolve(desktop ? { revision } : {
        ok: true, json: async () => ({ status: 'success' })
      });
    },
    closeIsPrevented() {
      let prevented = false;
      handlers.beforeunload({ preventDefault() { prevented = true; } });
      return prevented;
    }
  };
}

function assertClean(harness) {
  assert.equal(harness.dirty(), false);
  assert.equal(harness.elements.saveProjectBtn.disabled, false);
  assert.equal(harness.elements.saveProjectBtn.textContent, 'Save Slideshow');
  assert.equal(harness.elements.playSlideshowBtn.textContent, 'Play Slideshow');
  assert.doesNotMatch(harness.elements.saveStatus.textContent, /not saved yet/);
}

function assertStillDirty(harness) {
  assert.equal(harness.dirty(), true);
  assert.equal(harness.elements.saveProjectBtn.disabled, false);
  assert.equal(harness.elements.saveProjectBtn.textContent, '* Save Slideshow');
  assert.equal(harness.elements.playSlideshowBtn.textContent, 'Save First to Play');
  assert.equal(harness.elements.playFromCurrentBtn.textContent, 'Save First to Play');
}

for (const desktop of [true, false]) {
  const mode = desktop ? 'desktop' : 'online';
  test(`${mode}: ordinary save acknowledges the edited snapshot and clears dirty controls`, async () => {
    const h = editor(desktop);
    h.edit('Saved title');
    const saving = h.save();
    assert.equal(h.elements.saveProjectBtn.disabled, true);
    assert.equal(h.requests[0].flow.title, 'Saved title');
    h.succeed(0);
    await saving;
    assertClean(h);
    assert.deepEqual(h.alerts, []);
    if (desktop) assert.equal(h.closeIsPrevented(), false);
    else assert.equal(h.requests[0].body.get('csrf_token'), 'token');
  });

  test(`${mode}: edits during save remain dirty until a second save acknowledges them`, async () => {
    const h = editor(desktop);
    h.edit('First snapshot');
    const saving = h.save();
    h.edit('Newer edits');
    h.succeed(0);
    await saving;
    assert.equal(h.requests[0].flow.title, 'First snapshot');
    assert.equal(h.context.state.title, 'Newer edits');
    assertStillDirty(h);
    assert.match(h.elements.saveStatus.textContent, /New changes are not saved yet/);
    if (desktop) assert.equal(h.closeIsPrevented(), true);

    const savingAgain = h.save();
    assert.equal(h.requests[1].flow.title, 'Newer edits');
    if (desktop) assert.equal(h.requests[1].args[3], 'revision-1');
    h.succeed(1);
    await savingAgain;
    assertClean(h);
    if (desktop) assert.equal(h.closeIsPrevented(), false);
  });

  test(`${mode}: failed save preserves edits and allows retry`, async () => {
    const h = editor(desktop);
    h.edit('Changes');
    const saving = h.save();
    h.edit('Even newer changes');
    h.requests[0].result.reject(new Error(desktop ? 'REVISION_CONFLICT' : 'Network unavailable'));
    await saving;
    assertStillDirty(h);
    assert.equal(h.alerts.length, 1);
    if (desktop) assert.equal(h.revision(), 'revision-0');
    const retry = h.save();
    assert.equal(h.requests[1].flow.title, 'Even newer changes');
    h.succeed(1);
    await retry;
    assertClean(h);
  });
}

test('online: edits while parsing the response are not acknowledged as saved', async () => {
  const h = editor(false);
  const response = deferred();
  const parsing = deferred();
  h.edit('Sent');
  const saving = h.save();
  h.requests[0].result.resolve({ ok: true, json() { parsing.resolve(); return response.promise; } });
  await parsing.promise;
  h.edit('Edited while parsing');
  response.resolve({ status: 'success' });
  await saving;
  assertStillDirty(h);
});

for (const replace of [true, false]) {
  test(`online: replacement confirmation ${replace ? 'retries the original snapshot' : 'cancellation retains edits'}`, async () => {
    const h = editor(false);
    h.edit('Sent');
    h.context.window.confirm = () => { h.edit('Changed after request'); return replace; };
    const saving = h.save();
    h.requests[0].result.resolve({ ok: true, json: async () => ({ status: 'needs_confirmation' }) });
    if (replace) {
      // Wait for the real save function to issue its second HTTP request.
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[1].flow.title, 'Sent');
      assert.equal(h.requests[1].body.get('replace_existing'), '1');
      h.succeed(1);
    }
    await saving;
    assertStillDirty(h);
    assert.equal(h.context.state.title, 'Changed after request');
  });
}

test('desktop: actual flow writes, backup and next revision remain correct across an in-flight edit', async t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-save-state-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.match(path.basename(fixture), /^movement-save-state-/);
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const service = createWorkspaceService({
    examplesRoot: path.join(fixture, 'examples'), storageRoot: path.join(fixture, 'workspaces')
  });
  const workspace = service.createWorkspace('Test');
  const project = service.createProject(workspace.id, 'Original');
  const h = editor(true);
  h.context.PROJECT_CONTEXT = { workspaceId: workspace.id, project: project.id };
  vm.runInContext(`activeProjectRevision = ${JSON.stringify(
    service.loadProjectFlow(workspace.id, project.id).revision
  )}`, h.context);

  h.edit('First save');
  const first = h.save();
  const firstResult = service.saveProjectFlow(...h.requests[0].args);
  h.edit('Edited while IPC reply was pending');
  h.requests[0].result.resolve(firstResult);
  await first;
  assert.equal(service.loadProjectFlow(workspace.id, project.id).flow.title, 'First save');
  assertStillDirty(h);
  assert.equal(h.closeIsPrevented(), true);

  const second = h.save();
  const secondResult = service.saveProjectFlow(...h.requests[1].args);
  h.requests[1].result.resolve(secondResult);
  await second;
  assertClean(h);
  assert.equal(service.loadProjectFlow(workspace.id, project.id).flow.title, 'Edited while IPC reply was pending');
  const backup = path.join(fixture, 'workspaces', 'Test', project.id, 'backups', secondResult.backupName);
  assert.equal(JSON.parse(fs.readFileSync(backup)).title, 'First save');
});
