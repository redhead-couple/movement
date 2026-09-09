const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const applicationRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

test('online and offline editors share collapsible Project Settings and toolbar Save', () => {
  const onlineEditor = read('json-maker.php');
  const offlineEditor = read('studio/editor/json-maker.html');
  const sharedCss = read('studio/editor/editor-layout.css');
  const sharedScript = read('studio/editor/editor-layout.js');
  const desktopMain = read('desktop/main.cjs');

  for (const [mode, editor] of [
    ['online', onlineEditor],
    ['offline', offlineEditor]
  ]) {
    assert.match(editor, /href="\/studio\/editor\/editor-layout\.css"/);
    assert.match(editor, /id="editorToolbar"/);
    assert.match(editor, /id="editorWorkspace"/);
    assert.match(editor, /id="projectSettingsToggle"/);
    assert.match(editor, /aria-expanded="true"/);
    assert.equal(
      (editor.match(/id="saveProjectBtn"/g) || []).length,
      1,
      `${mode} editor should expose one Save Slideshow action`
    );
    assert.equal(
      (editor.match(/id="saveStatus"/g) || []).length,
      1,
      `${mode} editor should expose one save-status region`
    );
    assert.ok(
      editor.indexOf('id="saveProjectBtn"') < editor.indexOf('id="editorWorkspace"'),
      `${mode} Save Slideshow should remain in the toolbar above the workspace`
    );
    assert.match(editor, /src="\/studio\/editor\/editor-layout\.js"/);
  }

  assert.match(
    sharedCss,
    /grid-template-columns: 58px var\(--timeline-column-width\) minmax\(0, 1fr\)/
  );
  assert.match(sharedCss, /\.project-settings-panel\.is-collapsed \.project-settings-content/);
  assert.match(sharedCss, /\.editor-save-group \{[\s\S]*margin-left: auto/);
  assert.match(sharedScript, /timelinePanel\.getBoundingClientRect\(\)\.width/);
  assert.match(sharedScript, /setSettingsCollapsed\(false\)/);
  assert.doesNotMatch(sharedScript, /localStorage|sessionStorage/);
  assert.match(desktopMain, /'studio\/editor\/editor-layout\.css'/);
  assert.match(desktopMain, /'studio\/editor\/editor-layout\.js'/);
  assert.doesNotMatch(offlineEditor, /Timeline Studio|editorModeLabel|local-brand|local-muted/);
  assert.doesNotMatch(read('studio/editor/json-maker-logic.js'), /Desktop · Protected save/);
});

test('desktop editor context requires the desktop host and preserves workspace/project identifiers', () => {
  const html = read('studio/editor/json-maker.html');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('configureProjectContext'));
  assert.ok(script);
  for (const search of ['?desktop=1&workspaceId=work&projectId=project', '?workspaceId=work&projectId=project']) {
    const window = { location: { search } };
    vm.runInNewContext(script, { window, URLSearchParams });
    assert.equal(window.PROJECT_CONTEXT.desktopMode, true);
    assert.equal(window.PROJECT_CONTEXT.workspaceId, 'work');
    assert.equal(window.PROJECT_CONTEXT.project, 'project');
  }
  assert.doesNotMatch(html, /project-browser-modal|slidedeckFolderInput/);
});

test('desktop Save Slideshow keeps the bridge, publication state and revision guard', async () => {
  const editor = read('studio/editor/json-maker-logic.js');
  const source = editor.slice(editor.indexOf('async function saveProject()'), editor.indexOf('async function downloadJSONOnly()'));
  const calls = [];
  let cleared = false;
  const context = {
    DESKTOP_MODE: true,
    DESKTOP_BRIDGE: { async saveProjectFlow(...args) { calls.push(args); return { revision: 'next' }; } },
    PROJECT_CONTEXT: { workspaceId: 'workspace', project: 'project' },
    activeProjectRevision: 'expected',
    activePublicationState: { isPublished: true, publishedAt: '2026-09-01' },
    state: { title: 'Fixture', slides: [{ text: 'Fixture slide' }] },
    els: { saveBtn: {}, saveStatus: {} },
    desktopHasPendingMediaFiles: () => false,
    generateFinalJSON: () => ({ title: 'Fixture', schemaVersion: 2 }),
    clearUnsaved() { cleared = true; },
    setTimeout() {},
    console: { error(error) { throw error; } },
    alert(message) { assert.fail(message); },
    fetch() { assert.fail('Desktop Save must use its bridge'); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.saveProject();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[
    'workspace', 'project', { title: 'Fixture', schemaVersion: 2, isPublished: true, publishedAt: '2026-09-01' }, 'expected'
  ]]);
  assert.equal(context.activeProjectRevision, 'next');
  assert.equal(context.els.saveBtn.disabled, false);
  assert.equal(cleared, true);
});
