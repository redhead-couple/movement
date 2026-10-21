const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');
const [root, fixture] = process.argv.slice(2);
assert.match(path.basename(fixture), /^movement-backups-/);
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
dialog.showErrorBox = (title, message) => { throw new Error(`${title}: ${message}`); };
const { createWorkspaceService } = require(path.join(root, 'desktop/services/workspace-service.cjs'));
const service = createWorkspaceService({ storageRoot, examplesRoot: path.join(root, 'examples') });
const workspace = service.createWorkspace('Restore test');
const project = service.createProject(workspace.id, 'Story');
const projectRoot = path.join(storageRoot, 'Restore test', project.id);
const old = { schemaVersion: 2, title: 'Older <b>literal</b> title', slides: [{ text: 'Old slide' }] };
fs.writeFileSync(path.join(projectRoot, 'flow.json'), JSON.stringify(old));
service.saveProjectFlow(workspace.id, project.id, { ...old, title: 'Current story', slides: [] });
const before = fs.readFileSync(path.join(projectRoot, 'flow.json'));
fs.writeFileSync(path.join(projectRoot, 'backups', 'flow-invalid.json'), 'broken');
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
});
const js = (win, source) => win.webContents.executeJavaScript(source, true);
async function until(check) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out\n${errors.join('\n')}`);
}
require(path.join(root, 'desktop/main.cjs'));
(async () => {
  await app.whenReady();
  const library = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('shared/frontend/index.html')));
  await until(() => js(library, "Boolean(document.querySelector('[data-project-action=\"backups\"]'))"));
  await js(library, "document.querySelector('[data-route=\"library\"]').click(); document.querySelector('[data-project-action=\"backups\"]').click()");
  await until(() => js(library, "document.querySelectorAll('#backups-list button').length === 2"));
  assert.equal(await js(library, "document.querySelector('#backups-dialog').open"), true);
  assert.equal(await js(library, "document.querySelector('#backups-list b')"), null);
  assert.equal(await js(library, "document.querySelectorAll('#backups-list button:disabled').length"), 1);
  if (process.env.MOVEMENT_BACKUPS_SCREENSHOT) {
    library.setSize(1200, 860);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await js(library, "document.querySelector('#backups-dialog').open"), true);
    fs.writeFileSync(process.env.MOVEMENT_BACKUPS_SCREENSHOT, (await library.webContents.capturePage()).toPNG());
  }
  // Cancellation closes the dialog without touching current data.
  await js(library, "document.querySelector('#backups-dialog [data-close-dialog]').click()");
  assert.equal(service.listProjects(workspace.id).length, 1);
  await js(library, "document.querySelector('[data-project-action=\"backups\"]').click()");
  await until(() => js(library, "Boolean(document.querySelector('#backups-list button:not(:disabled)'))"));
  await js(library, "document.querySelector('#backups-list button:not(:disabled)').click()");
  await until(() => js(library, "document.querySelectorAll('#project-grid [data-project-id]').length === 2"));
  const restored = service.listProjects(workspace.id).find(item => item.id !== project.id);
  assert.deepEqual(service.loadProjectFlow(workspace.id, restored.id).flow.slides, old.slides);
  assert.deepEqual(fs.readFileSync(path.join(projectRoot, 'flow.json')), before);
  await js(library, `document.querySelector('[data-project-id="${restored.id}"] [data-project-action="edit"]').click()`);
  const editor = await until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().includes('json-maker.html')));
  await until(() => js(editor, "Boolean(typeof activeProjectRevision !== 'undefined' && activeProjectRevision)"));
  await js(editor, "els.title.value = 'Edited restored copy'; els.title.dispatchEvent(new Event('input', {bubbles:true})); els.saveBtn.click()");
  await until(() => js(editor, "!els.saveBtn.disabled && !unsavedChanges"));
  assert.equal(service.loadProjectFlow(workspace.id, restored.id).flow.title, 'Edited restored copy');
  assert.deepEqual(fs.readFileSync(path.join(projectRoot, 'flow.json')), before);
  assert.deepEqual(errors, []);
  console.log('BACKUPS_BROWSER_OK list, literal titles, invalid backup, cancel, restore copy, edit/save; original unchanged');
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
