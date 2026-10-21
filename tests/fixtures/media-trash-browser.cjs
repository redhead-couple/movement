const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');
const [root, fixture] = process.argv.slice(2);
assert.match(path.basename(fixture), /^movement-image-trash-/);
const storageRoot = path.join(fixture, 'browser-storage');
fs.mkdirSync(path.join(fixture, 'profile'));
app.setPath('userData', path.join(fixture, 'profile'));
app.getAppPath = () => root;
app.disableHardwareAcceleration();
BrowserWindow.prototype.show = function () {};
const location = require(path.join(root, 'desktop/services/storage-location-service.cjs'));
location.resolvePortableStorageRoot = () => storageRoot;
location.resolvePackagedStorageRoot = () => storageRoot;
Object.defineProperty(app, 'isPackaged', { value: true });
let confirmResponse = 0;
const confirmations = [];
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  if (options.title.startsWith('Delete all unused') || options.title === 'Empty Media Trash') confirmations.push(options);
  return { response: confirmResponse };
};
dialog.showErrorBox = (title, message) => { throw new Error(`${title}: ${message}`); };
const { createWorkspaceService } = require(path.join(root, 'desktop/services/workspace-service.cjs'));
const service = createWorkspaceService({ storageRoot, examplesRoot: path.join(root, 'examples') });
const workspace = service.createWorkspace('Media test');
const project = service.createProject(workspace.id, 'Story');
const projectRoot = path.join(storageRoot, 'Media test', project.id);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=', 'base64');
for (const name of ['cover.png', 'unused.png', 'second.png']) fs.writeFileSync(path.join(projectRoot, 'img', name), png);
const sound = fs.readFileSync(path.join(root, 'examples/what-this-project-is/speech/slide8.mp3'));
for (const type of ['audio', 'speech']) for (const name of ['used.mp3', 'unused.mp3']) {
  fs.writeFileSync(path.join(projectRoot, type, name), sound);
}
service.saveProjectFlow(workspace.id, project.id, { schemaVersion: 2, title: 'Cleanup test',
  openingImage: 'cover.png', globalAudioLayers: [{ src: 'audio/used.mp3', name: 'Music' }],
  slides: [{ text: 'Normal slide', seconds: 5, background: { src: 'img/cover.png' }, audioLayers: [{ src: 'speech/used.mp3', name: 'Speech' }] }] });
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
});
const js = async (win, source) => {
  try { return await win.webContents.executeJavaScript(source, true); }
  catch (error) { throw new Error(`${source}\n${error.message}\n${errors.join('\n')}`); }
};
async function until(check) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out\n${errors.join('\n')}`);
}
const cleanup = "[...document.querySelectorAll('#projectMediaManagerContent button')].find(b => b.textContent.startsWith('Delete all unused images'))";
const restore = "[...document.querySelectorAll('#projectMediaManagerContent button')].filter(b => b.textContent === 'Restore')";
async function openTrash(editor, count) {
  await until(() => js(editor, `document.querySelector('#openMediaTrash')?.dataset.trashCount === '${count}'`));
  assert.equal(await js(editor, `${restore}.length`), 0, 'No trash rows on media screen');
  assert.equal(await js(editor, "document.querySelector('#openMediaTrash .media-trash-card__description').textContent"), 'Restore deleted files or empty the trash.');
  assert.equal(await js(editor, "document.querySelector('#openMediaTrash').classList.contains('has-files')"), true);
  if (count === 4 && process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR) {
    editor.setSize(1200, 900);
    await new Promise(resolve => setTimeout(resolve, 250));
    await editor.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR, 'desktop-media-trash-card.png'), (await editor.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  }
  await js(editor, "document.querySelector('#openMediaTrash').click()");
  await until(() => js(editor, `Boolean(document.querySelector('#backToProjectMedia')) && ${restore}.length === ${count}`));
  assert.equal(await js(editor, "document.querySelectorAll('[data-cleanup-type]').length"), 0);
  if (count === 2) {
    await until(() => js(editor, "[...document.querySelectorAll('.media-trash-thumbnail img')].length === 2 && [...document.querySelectorAll('.media-trash-thumbnail img')].every(img => img.complete && img.naturalWidth > 0)"));
    await js(editor, "document.querySelector('.media-trash-thumbnail').click()");
    await until(() => js(editor, "document.querySelector('.media-trash-image-dialog')?.open && document.querySelector('.media-trash-image-dialog img').naturalWidth > 0"));
    await js(editor, "document.querySelector('.media-trash-preview-close').click()");
    assert.equal(await js(editor, "document.querySelector('.media-trash-image-dialog').open"), false);
  }
  if (count === 1) {
    await until(() => js(editor, "document.querySelector('.media-trash-preview audio')?.readyState >= 1"));
    assert.equal(await js(editor, "Number.isFinite(document.querySelector('.media-trash-preview audio').duration)"), true);
    await js(editor, "document.querySelector('.media-trash-preview audio').play()");
    await until(() => js(editor, "document.querySelector('.media-trash-preview audio').currentTime > 0.05"));
    await js(editor, "{ const track = document.querySelector('.media-trash-preview audio'); track.currentTime = track.duration / 2; }");
    await until(() => js(editor, "!document.querySelector('.media-trash-preview audio').seeking"));
  }
  if (count === 4) {
    await until(() => js(editor, "[...document.querySelectorAll('.media-trash-preview audio')].length === 2 && [...document.querySelectorAll('.media-trash-preview audio')].every(a => a.readyState >= 1)"));
    await js(editor, "document.querySelectorAll('.media-trash-preview audio')[0].play()");
    await js(editor, "document.querySelectorAll('.media-trash-preview audio')[1].play()");
    await until(() => js(editor, "document.querySelectorAll('.media-trash-preview audio')[0].paused && !document.querySelectorAll('.media-trash-preview audio')[1].paused"));
    await js(editor, "closeProjectMediaManager()");
    assert.equal(await js(editor, "[...document.querySelectorAll('.media-trash-preview audio')].every(a => a.paused)"), true);
    await js(editor, "document.querySelector('#project-media-manager-modal').classList.add('open')");
  }
}
async function backToMedia(editor) {
  await until(() => js(editor, "Boolean(document.querySelector('#backToProjectMedia'))"));
  await js(editor, "document.querySelector('#backToProjectMedia').click()");
  await until(() => js(editor, "Boolean(document.querySelector('#openMediaTrash'))"));
}
require(path.join(root, 'desktop/main.cjs'));
(async () => {
  await app.whenReady();
  const library = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('shared/frontend/index.html')));
  await until(() => js(library, "Boolean(document.querySelector('[data-project-action=edit]'))"));
  await js(library, "document.querySelector('[data-project-action=edit]').click()");
  const editor = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('json-maker.html')));
  await until(() => js(editor, "Boolean(typeof activeProjectRevision !== 'undefined' && activeProjectRevision)"));
  await js(editor, 'openProjectMediaManager()');
  assert.equal(await js(editor, `${cleanup}.textContent`), 'Delete all unused images (2)…');
  assert.equal(await js(editor, "[...document.querySelectorAll('[data-cleanup-type]')].every(b => b.previousElementSibling.classList.contains('media-file-list'))"), true);
  await js(editor, `${cleanup}.click()`);
  await until(() => confirmations.length === 1);
  await until(() => js(editor, `${cleanup} && !${cleanup}.disabled`));
  assert.equal(confirmations[0].defaultId, 0);
  assert.equal(confirmations[0].message, 'Delete all 2 unused images?');
  assert.equal(confirmations[0].detail, 'You can restore them from Trash.');
  assert.deepEqual(confirmations[0].buttons, ['Cancel', 'Delete Images']);
  assert.ok(fs.existsSync(path.join(projectRoot, 'img/unused.png')));
  assert.equal(service.getProjectMediaOverview(workspace.id, project.id).trash.length, 0);
  await js(editor, "closeProjectMediaManager(); els.title.value = 'Edited'; els.title.dispatchEvent(new Event('input', {bubbles:true})); openProjectMediaManager()");
  await until(() => js(editor, `${cleanup} && ${cleanup}.disabled`));
  await js(editor, "closeProjectMediaManager(); els.saveBtn.click()");
  await until(() => js(editor, '!els.saveBtn.disabled && !unsavedChanges'));
  const savedBeforeCleanup = fs.readFileSync(path.join(projectRoot, 'flow.json'));
  await js(editor, 'openProjectMediaManager()');
  confirmResponse = 1;
  await js(editor, `${cleanup}.click()`);
  await openTrash(editor, 2);
  assert.deepEqual(fs.readFileSync(path.join(projectRoot, 'img/cover.png')), png);
  assert.equal(fs.existsSync(path.join(projectRoot, 'img/unused.png')), false);
  await js(editor, `${restore}[0].click()`);
  await until(() => js(editor, `${restore}.length === 1`));
  await js(editor, `${restore}[0].click()`);
  await until(() => js(editor, `Boolean(document.querySelector('#backToProjectMedia')) && ${restore}.length === 0`));
  for (const name of ['cover.png', 'second.png', 'unused.png']) assert.deepEqual(fs.readFileSync(path.join(projectRoot, 'img', name)), png);
  await backToMedia(editor);
  for (const type of ['audio', 'speech']) {
    const button = `document.querySelector('[data-cleanup-type="${type}"]')`;
    confirmResponse = 0;
    const previous = confirmations.length;
    await js(editor, `${button}.click()`);
    await until(() => confirmations.length === previous + 1);
    await until(() => js(editor, `${button} && !${button}.disabled`));
    assert.equal(confirmations.at(-1).message, `Delete 1 unused ${type} file?`);
    assert.equal(confirmations.at(-1).detail, 'You can restore them from Trash.');
    assert.ok(fs.existsSync(path.join(projectRoot, type, 'unused.mp3')));
    confirmResponse = 1;
    await js(editor, `${button}.click()`);
    await openTrash(editor, 1);
    assert.equal(fs.existsSync(path.join(projectRoot, type, 'unused.mp3')), false);
    assert.deepEqual(fs.readFileSync(path.join(projectRoot, type, 'used.mp3')), sound);

    await js(editor, `${restore}[0].click()`);
    await until(() => js(editor, `Boolean(document.querySelector('#backToProjectMedia')) && ${restore}.length === 0`));
    assert.deepEqual(fs.readFileSync(path.join(projectRoot, type, 'unused.mp3')), sound);
    await backToMedia(editor);
  }
  for (const type of ['img', 'audio', 'speech']) {
    const overview = service.getProjectMediaOverview(workspace.id, project.id);
    service.moveUnusedMediaToTrash(workspace.id, project.id, type, overview.cleanup[type].token);
  }
  await js(editor, 'refreshProjectMediaManager()');
  await openTrash(editor, 4);
  await new Promise(resolve => setTimeout(resolve, 250));
  if (process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR) {
    editor.setSize(1280, 900);
    await editor.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR, 'desktop-media-trash.png'), (await editor.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  }
  confirmResponse = 0;
  await js(editor, "document.querySelector('#emptyMediaTrash').click()");
  await until(() => confirmations.at(-1)?.title === 'Empty Media Trash');
  await until(() => js(editor, "document.querySelector('#emptyMediaTrash')?.disabled === false"));
  assert.equal(confirmations.at(-1).message, 'Permanently delete 4 files from Media Trash?');
  assert.equal(confirmations.at(-1).detail, 'This cannot be undone.');
  assert.equal(confirmations.at(-1).defaultId, 0);
  assert.equal(service.getProjectMediaOverview(workspace.id, project.id).trash.length, 4);
  confirmResponse = 1;
  await js(editor, "document.querySelector('#emptyMediaTrash').click()");
  await until(() => js(editor, `${restore}.length === 0 && document.querySelector('#emptyMediaTrash')?.disabled === true`));
  assert.equal(service.getProjectMediaOverview(workspace.id, project.id).trash.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(projectRoot, 'img/cover.png')), png);
  for (const type of ['audio', 'speech']) assert.deepEqual(fs.readFileSync(path.join(projectRoot, type, 'used.mp3')), sound);
  await backToMedia(editor);
  assert.equal(await js(editor, "document.querySelector('#openMediaTrash').dataset.trashCount === '0'"), true);
  assert.equal(await js(editor, "document.querySelector('#openMediaTrash .media-trash-card__description').textContent.includes('Trash is empty.')"), true);
  assert.equal(await js(editor, "document.querySelector('#openMediaTrash').classList.contains('has-files')"), false);
  const after = service.loadProjectFlow(workspace.id, project.id).flow;
  assert.equal(after.title, 'Edited');
  assert.equal(after.slides[0].text, 'Normal slide');
  assert.deepEqual(fs.readFileSync(path.join(projectRoot, 'flow.json')), savedBeforeCleanup);
  assert.deepEqual(errors, []);
  console.log('MEDIA_TRASH_BROWSER_OK cancellation, native confirmation, dirty blocking, normal save, bulk move and restore');
  console.log('MEDIA_TRASH_PREVIEWS_OK thumbnails, enlargement, audio/speech playback and seeking, single-player playback, stop on exit, restore, empty cancellation and permanent emptying');
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
