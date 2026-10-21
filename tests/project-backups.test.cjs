const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createWorkspaceService } = require('../desktop/services/workspace-service.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-backups-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^movement-backups-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const paths = { storageRoot: path.join(root, 'storage'), examplesRoot: path.join(root, 'examples') };
  const service = createWorkspaceService(paths);
  const workspace = service.createWorkspace('Test');
  const project = service.createProject(workspace.id, 'Story');
  const projectRoot = path.join(paths.storageRoot, 'Test', project.id);
  return { root, paths, service, workspaceId: workspace.id, projectId: project.id, projectRoot };
}

function savedVersions(f) {
  const previous = { schemaVersion: 2, title: '<img src=x onerror=alert(1)> Old title',
    isPublished: true, publishedAt: '2025-01-01', slides: [{ text: 'Old slide' }, { text: 'Second' }] };
  fs.writeFileSync(path.join(f.projectRoot, 'flow.json'), JSON.stringify(previous));
  const current = { ...previous, title: 'Current title', slides: [{ text: 'Current slide' }] };
  f.service.saveProjectFlow(f.workspaceId, f.projectId, current);
  return { previous, current, backup: f.service.listProjectBackups(f.workspaceId, f.projectId)[0] };
}

test('restore a backup as an editable copy with current media, preserving source and history', t => {
  const f = setup(t);
  assert.deepEqual(f.service.listProjectBackups(f.workspaceId, f.projectId), []);
  const { previous, current, backup } = savedVersions(f);
  assert.equal(backup.title, previous.title);
  assert.equal(backup.slideCount, 2);
  assert.ok(Number.isFinite(Date.parse(backup.savedAt)));
  assert.equal(JSON.stringify(backup).includes(f.root), false);
  const media = Buffer.from('Current media content');
  fs.writeFileSync(path.join(f.projectRoot, 'img', 'cover.png'), media);
  const sourceBefore = fs.readFileSync(path.join(f.projectRoot, 'flow.json'));
  const historyBefore = fs.readFileSync(path.join(f.projectRoot, 'backups', backup.name));
  const restored = f.service.restoreProjectBackup(f.workspaceId, f.projectId, backup.name, backup.revision);
  assert.notEqual(restored.id, f.projectId);
  assert.equal(restored.title, `${previous.title} (Restored)`);
  const loaded = f.service.loadProjectFlow(f.workspaceId, restored.id);
  assert.deepEqual(loaded.flow.slides, previous.slides);
  assert.equal(loaded.flow.isPublished, false);
  assert.equal(loaded.flow.publishedAt, undefined);
  const restoredRoot = path.join(path.dirname(f.projectRoot), restored.id);
  assert.deepEqual(fs.readFileSync(path.join(restoredRoot, 'img', 'cover.png')), media);
  f.service.saveProjectFlow(f.workspaceId, restored.id,
    { ...loaded.flow, title: 'Edited restored copy' }, loaded.revision);
  assert.equal(f.service.listProjectBackups(f.workspaceId, restored.id).length, 1);
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'flow.json')), sourceBefore);
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'backups', backup.name)), historyBefore);
  assert.equal(JSON.parse(sourceBefore).title, current.title);
  const second = f.service.restoreProjectBackup(f.workspaceId, f.projectId, backup.name, backup.revision);
  assert.notEqual(second.id, restored.id);
});

test('a corrupt current flow can be recovered without overwriting it', t => {
  const f = setup(t);
  const { backup, previous } = savedVersions(f);
  fs.writeFileSync(path.join(f.projectRoot, 'flow.json'), '{corrupt');
  assert.equal(f.service.listProjectBackups(f.workspaceId, f.projectId)[0].valid, true);
  const restored = f.service.restoreProjectBackup(f.workspaceId, f.projectId, backup.name, backup.revision);
  assert.deepEqual(f.service.loadProjectFlow(f.workspaceId, restored.id).flow.slides, previous.slides);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'flow.json'), 'utf8'), '{corrupt');
});

test('invalid, missing, changed and unsafe backup selections cannot create or replace projects', t => {
  const f = setup(t);
  const { backup } = savedVersions(f);
  const before = fs.readFileSync(path.join(f.projectRoot, 'flow.json'));
  const count = f.service.listProjects(f.workspaceId).length;
  for (const name of ['../flow.json', '..\\flow.json', '/flow.json', 'flow-missing.json']) {
    assert.throws(() => f.service.restoreProjectBackup(f.workspaceId, f.projectId, name, backup.revision));
  }
  assert.throws(() => f.service.restoreProjectBackup(f.workspaceId, f.projectId, backup.name, null), /changed/);
  fs.appendFileSync(path.join(f.projectRoot, 'backups', backup.name), '\n');
  assert.throws(() => f.service.restoreProjectBackup(f.workspaceId, f.projectId, backup.name, backup.revision), /changed/);
  fs.writeFileSync(path.join(f.projectRoot, 'backups', 'flow-invalid.json'), '{broken');
  const invalid = f.service.listProjectBackups(f.workspaceId, f.projectId).find(x => x.name === 'flow-invalid.json');
  assert.equal(invalid.valid, false);
  assert.throws(() => f.service.restoreProjectBackup(f.workspaceId, f.projectId, invalid.name, 'fake'), /valid slideshow/);
  assert.equal(f.service.listProjects(f.workspaceId).length, count);
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'flow.json')), before);
  assert.throws(() => f.service.listProjectBackups('examples', f.projectId), /read-only/);
});

test('copy failure leaves source and backup intact and removes the incomplete copy', t => {
  const f = setup(t);
  const { backup } = savedVersions(f);
  const sourceBefore = fs.readFileSync(path.join(f.projectRoot, 'flow.json'));
  const backupBefore = fs.readFileSync(path.join(f.projectRoot, 'backups', backup.name));
  const copy = fs.copyFileSync;
  fs.copyFileSync = function (source, destination, ...args) {
    if (destination.includes('.movement-tmp-restore-')) {
      fs.writeFileSync(destination, 'partial');
      throw new Error('Simulated copy failure');
    }
    return copy.call(this, source, destination, ...args);
  };
  try {
    assert.throws(() => f.service.restoreProjectBackup(f.workspaceId, f.projectId, backup.name, backup.revision), /copy failure/);
  } finally { fs.copyFileSync = copy; }
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'flow.json')), sourceBefore);
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'backups', backup.name)), backupBefore);
  assert.equal(fs.readdirSync(path.dirname(f.projectRoot)).some(x => x.startsWith('.movement-tmp-')), false);
  assert.equal(f.service.listProjects(f.workspaceId).length, 1);
});

test('backup UI works through the real desktop preload and IPC', {
  skip: process.env.MOVEMENT_TEST_BACKUPS_BROWSER !== '1'
}, t => {
  const f = setup(t);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOVEMENT_ELECTRON_SMOKE_TEST;
  const result = spawnSync(require('electron'), [
    path.join(__dirname, 'fixtures', 'project-backups-browser.cjs'), path.resolve(__dirname, '..'), f.root
  ], { env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /BACKUPS_BROWSER_OK/);
  console.log(result.stdout.trim());
});
