// Integration harness for tools/verify-desktop-effects.cjs.
// Loads the distribution's host, preload and pages unchanged. Only native file
// selection, visibility and storage locations are replaced with test fixtures.
// The save-race check additionally holds one real IPC reply after its disk write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');

const [applicationRoot, fixture] = process.argv.slice(2);
assert.ok(path.isAbsolute(applicationRoot) && path.isAbsolute(fixture));
assert.match(path.basename(fixture), /^movement-distribution-effects-/);
const storageRoot = path.join(fixture, 'workspaces');
for (const name of ['profile', 'documents', 'downloads']) fs.mkdirSync(path.join(fixture, name));
app.setPath('userData', path.join(fixture, 'profile'));
app.setPath('documents', path.join(fixture, 'documents'));
app.setPath('downloads', path.join(fixture, 'downloads'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.getAppPath = () => applicationRoot;
app.getVersion = () => JSON.parse(fs.readFileSync(path.join(applicationRoot, 'package.json'))).version;
Object.defineProperty(app, 'isPackaged', { value: true });
BrowserWindow.prototype.show = function () {};
const storage = require(path.join(applicationRoot, 'desktop/services/storage-location-service.cjs'));
storage.resolvePortableStorageRoot = () => storageRoot;
storage.resolvePackagedStorageRoot = () => storageRoot;

let holdNextSave = false;
let releaseSaveReply = null;
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => registerHandler(channel,
  channel !== 'project:save-flow' ? listener : async (...args) => {
    const result = await listener(...args);
    if (holdNextSave) {
      holdNextSave = false;
      await new Promise(resolve => { releaseSaveReply = resolve; });
    }
    return result;
  });

let selection = null;
let saveDestination = null;
dialog.showOpenDialog = async () => {
  assert.ok(selection, 'Unexpected file picker');
  return { canceled: false, filePaths: [selection] };
};
dialog.showSaveDialog = async () => {
  assert.ok(saveDestination, 'Unexpected save picker');
  return { canceled: false, filePath: saveDestination };
};
dialog.showMessageBox = async () => { throw new Error('Unexpected confirmation dialog'); };
dialog.showErrorBox = (title, message) => { throw new Error(`${title}: ${message}`); };
const unexpectedRequests = [];
const consoleErrors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', event => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      unexpectedRequests.push(details.url);
      callback({ cancel: true });
    }
  );
});

const { writeStoredZip, normalizePortableArchive } = require(
  path.join(applicationRoot, 'desktop/services/portable-project-service.cjs')
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);
const hostileFilename = "' + (top.__movementEffectInjection = 731) + '.png";
const js = async (win, source) => {
  try {
    return await win.webContents.executeJavaScript(source, true);
  } catch (error) {
    throw new Error(`${error.message}\nURL: ${win.webContents.getURL()}\nScript: ${source}\n${consoleErrors.join('\n')}`);
  }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${consoleErrors.join('\n')}`);
}
const hubExpression = "document.getElementById('effects-iframe').contentWindow";
const makerExpression = `${hubExpression}.document.getElementById('toolFrame').contentWindow`;

function makeArchive(id, filename) {
  const flow = {
    schemaVersion: 2, title: id, openingImage: filename, defaultBeatSeconds: 5,
    slides: [{
      textHTML: '<b>Effect distribution check</b>', seconds: 5,
      background: { src: filename, effect: { engine: 'ripple',
        config: { imgSrc: `img/${filename}`, x: 0.5, y: 0.5, startTime: 0,
          count: 2, interval: 0.2, freq: 25, speed: 2, amp: 10, decay: 1 } } },
      foregroundLayers: [], audioLayers: []
    }]
  };
  const archive = path.join(fixture, `${id}.zip`);
  writeStoredZip(archive, [
    { name: `${id}/flow.json`, buffer: Buffer.from(JSON.stringify(flow)) },
    { name: `${id}/img/${filename}`, buffer: png },
    { name: `${id}/player.html`, buffer: Buffer.from('<script>top.__movementEffectInjection=999</script>') }
  ]);
  return archive;
}

async function exerciseProject(library, workspaceId, id, filename) {
  selection = makeArchive(id, filename);
  const imported = await js(library, `movementDesktop.importPortableProject(${JSON.stringify(workspaceId)})`);
  assert.equal(imported.id, id);
  const projectRoot = path.join(storageRoot, 'Distribution Check', id);
  assert.ok(fs.existsSync(path.join(projectRoot, 'img', filename)));
  assert.equal(fs.existsSync(path.join(projectRoot, 'player.html')), false);
  await js(library, `movementDesktop.openProjectEditor(${JSON.stringify(workspaceId)}, ${JSON.stringify(id)})`);
  const editor = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('/studio/editor/json-maker.html')), 'editor window');
  await until(() => js(editor, "typeof activeProjectRevision !== 'undefined' && !!activeProjectRevision"),
    'loaded project');
  await js(editor, "openEffectInHub('bg')");
  await until(() => js(editor, `Boolean(${hubExpression}?.document.getElementById('toolFrame')?.contentWindow.MakerAPI)`),
    'Ripple maker');
  await until(() => js(editor, `${makerExpression}.imgName === ${JSON.stringify(filename)}
    && Boolean(${makerExpression}.imgData)`), 'effect image hydration');
  const definition = await js(editor, `${makerExpression}.MakerAPI.getExportJSON()`);
  assert.equal(definition.engine, 'ripple');
  assert.equal(definition.config.imgSrc, `img/${filename}`);
  assert.equal(await js(editor, 'window.__movementEffectInjection ?? null'), null);

  // Use the real Apply message chain, then the editor's ordinary save operation.
  await js(editor, `${hubExpression}.document.getElementById('globalApplyBtn').click()`);
  await until(() => js(editor, "!document.getElementById('effects-modal').classList.contains('open')"),
    'Apply closes effect modal');
  await js(editor, 'saveProject()');
  const saved = JSON.parse(fs.readFileSync(path.join(projectRoot, 'flow.json'), 'utf8'));
  assert.equal(saved.slides[0].background.effect.engine, 'ripple');
  assert.equal(saved.slides[0].background.effect.config.imgSrc, `img/${filename}`);
  assert.equal(await js(editor, 'window.__movementEffectInjection ?? null'), null);

  // Preview and the standalone project player both use the bundled runtime.
  await js(editor, 'openPlaybackModal({startSlide: 0, autoPlay: 1})');
  await until(() => js(editor, `document.getElementById('playback-iframe').contentDocument
    ?.getElementById('maxLabel')?.textContent === '1'`), 'editor preview');
  await js(library, `movementDesktop.openProjectPlayer(${JSON.stringify(workspaceId)}, ${JSON.stringify(id)})`);
  const player = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('/studio/player/local-player.html')), 'player window');
  await until(() => js(player, "document.getElementById('maxLabel').textContent === '1'"), 'player ready');
  // Project media has its own origin, so reading canvas pixels is intentionally
  // forbidden. Observe real draw calls without weakening that boundary.
  await js(player, `(() => {
    window.__effectDraws = 0;
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = original.apply(this, args);
      window.__effectDraws += 1;
      return result;
    };
  })()`);
  await js(player, "document.getElementById('startBtn').click()");
  await until(() => js(player, `window.__effectDraws > 0 &&
    Array.from(document.querySelectorAll('canvas.layer-bg')).some(canvas => canvas.width > 0)`),
  'effect paints in player');
  assert.equal(await js(player, 'window.__movementEffectInjection ?? null'), null);
  saveDestination = path.join(fixture, `${id}-export.zip`);
  const exported = await js(editor,
    `movementDesktop.exportPortableProject(${JSON.stringify(workspaceId)}, ${JSON.stringify(id)})`);
  assert.equal(exported.status, 'success');
  const inspected = normalizePortableArchive(saveDestination);
  assert.equal(inspected.flow.slides[0].background.effect.config.imgSrc, `img/${filename}`);
  player.destroy();
  editor.destroy();
  console.log(`PROJECT_EFFECT_OK ${id}: import, edit, Apply, save, preview, player paint, export; no code execution`);
}

async function exerciseAllMakers(library, workspaceId) {
  await js(library, `movementDesktop.openProjectEditor(${JSON.stringify(workspaceId)}, 'normal')`);
  const editor = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('/studio/editor/json-maker.html')), 'all-makers editor');
  await until(() => js(editor, "typeof activeProjectRevision !== 'undefined' && !!activeProjectRevision"),
    'all-makers project loaded');
  await js(editor, "openEffectsHub('bg')");
  const count = await until(() => js(editor, `${hubExpression}.document.querySelectorAll('.effect-btn').length`),
    'effects registry');
  const engines = [];
  for (let index = 0; index < count; index += 1) {
    await js(editor, `new Promise(resolve => {
      const hub = ${hubExpression};
      hub.document.getElementById('toolFrame').addEventListener('load', resolve, {once:true});
      hub.document.querySelectorAll('.effect-btn')[${index}].click();
    })`);
    await until(() => js(editor, `Boolean(${makerExpression}.MakerAPI?.getExportJSON)`), `maker ${index}`);
    const engine = await js(editor, `(() => {
      const maker = ${makerExpression};
      maker.MakerAPI.run();
      const result = maker.MakerAPI.getExportJSON();
      if (!result || !result.engine || !result.config) throw new Error('Invalid effect definition');
      return result.engine;
    })()`);
    engines.push(engine);
  }
  assert.equal(new Set(engines).size, count);
  assert.equal(await js(editor, 'window.__movementEffectInjection ?? null'), null);
  editor.destroy();
  console.log(`ALL_MAKERS_OK count=${count} engines=${engines.join(',')}`);
}

async function exerciseSaveState(library, workspaceId) {
  await js(library, `movementDesktop.openProjectEditor(${JSON.stringify(workspaceId)}, 'normal')`);
  const editor = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('/studio/editor/json-maker.html')), 'save-state editor');
  await until(() => js(editor, "typeof activeProjectRevision !== 'undefined' && !!activeProjectRevision"),
    'save-state project loaded');
  const projectRoot = path.join(storageRoot, 'Distribution Check', 'normal');
  const loadDisk = () => JSON.parse(fs.readFileSync(path.join(projectRoot, 'flow.json'), 'utf8'));
  const editTitle = title => js(editor, `(() => {
    els.title.value = ${JSON.stringify(title)};
    els.title.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const save = () => js(editor, "document.getElementById('saveProjectBtn').click()");
  const waitForSave = () => until(() => js(editor,
    "!document.getElementById('saveProjectBtn').disabled"), 'save response');
  const controls = () => js(editor, `({
    dirty: unsavedChanges,
    button: document.getElementById('saveProjectBtn').textContent,
    play: document.getElementById('playSlideshowBtn').textContent,
    status: document.getElementById('saveStatus').textContent,
    closePrevented: !window.dispatchEvent(new Event('beforeunload', {cancelable:true})),
    revision: activeProjectRevision
  })`);

  await editTitle('Ordinary packaged save');
  await save();
  await waitForSave();
  assert.equal(loadDisk().title, 'Ordinary packaged save');
  let state = await controls();
  assert.equal(state.dirty, false);
  assert.equal(state.closePrevented, false);
  assert.equal(state.button, 'Save Slideshow');
  assert.equal(state.play, 'Play Slideshow');

  await editTitle('Snapshot submitted for saving');
  holdNextSave = true;
  await save();
  await until(() => releaseSaveReply, 'held IPC reply after real write');
  assert.equal(loadDisk().title, 'Snapshot submitted for saving');
  assert.equal(await js(editor, "document.getElementById('saveProjectBtn').disabled"), true);
  await editTitle('New edit while save was pending');
  releaseSaveReply();
  releaseSaveReply = null;
  await waitForSave();
  state = await controls();
  assert.equal(loadDisk().title, 'Snapshot submitted for saving');
  assert.equal(await js(editor, 'els.title.value'), 'New edit while save was pending');
  assert.equal(state.dirty, true, 'The earlier reply must not acknowledge the later edit');
  assert.equal(state.closePrevented, true);
  assert.equal(state.button, '* Save Slideshow');
  assert.equal(state.play, 'Save First to Play');
  assert.match(state.status, /New changes are not saved yet/);
  const earlierRevision = state.revision;

  await save();
  await waitForSave();
  state = await controls();
  assert.equal(loadDisk().title, 'New edit while save was pending');
  assert.equal(state.dirty, false);
  assert.equal(state.closePrevented, false);
  assert.equal(state.button, 'Save Slideshow');
  assert.equal(state.play, 'Play Slideshow');
  assert.notEqual(state.revision, earlierRevision);
  const backups = fs.readdirSync(path.join(projectRoot, 'backups')).sort();
  const lastBackup = JSON.parse(fs.readFileSync(path.join(projectRoot, 'backups', backups.at(-1)), 'utf8'));
  assert.equal(lastBackup.title, 'Snapshot submitted for saving');
  editor.destroy();
  console.log('SAVE_STATE_BROWSER_OK ordinary save; in-flight edits stay dirty and block close; next save, revision and backup verified');
}

// Required after installing the harness overrides; this is the actual packaged main.
require(path.join(applicationRoot, 'desktop/main.cjs'));
app.whenReady().then(async () => {
  const library = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('/shared/frontend/index.html')), 'library window');
  await until(() => js(library, 'Boolean(window.movementDesktop)'), 'preload bridge');
  const workspace = await js(library, "movementDesktop.createWorkspace('Distribution Check')");
  await exerciseProject(library, workspace.id, 'hostile', hostileFilename);
  await exerciseProject(library, workspace.id, 'normal', "O'Brien.png");
  await exerciseSaveState(library, workspace.id);
  await exerciseAllMakers(library, workspace.id);
  assert.deepEqual(unexpectedRequests, [], 'Desktop effect flow must work without internet');
  assert.deepEqual(consoleErrors, [], 'Effect workflow must not report renderer errors');
  console.log('DESKTOP_EFFECTS_BROWSER_OK networkRequests=0 rendererErrors=0');
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
