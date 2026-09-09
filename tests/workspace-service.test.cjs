const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  EXAMPLES_WORKSPACE_ID,
  MAX_BACKUPS,
  WORKSPACE_METADATA,
  createWorkspaceService,
  isRecognizedWorkspace
} = require('../desktop/services/workspace-service.cjs');

function writeFlow(projectRoot, overrides = {}) {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'flow.json'), JSON.stringify({
    title: 'Untitled',
    description: '',
    isPublished: false,
    schemaVersion: 2,
    defaultBeatSeconds: 5,
    openingImage: '',
    slides: [],
    ...overrides
  }), 'utf8');
}

function makeTestPaths(prefix) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    temporaryRoot,
    examplesRoot: path.join(temporaryRoot, 'examples'),
    storageRoot: path.join(temporaryRoot, 'private-data', 'slidedeck')
  };
}

function cleanTemporaryRoot(temporaryRoot) {
  const resolved = path.resolve(temporaryRoot);
  const expectedParent = path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved), expectedParent);
  assert.match(path.basename(resolved), /^movement-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('one recognized user workspace is selected automatically beside examples', t => {
  const paths = makeTestPaths('movement-one-workspace-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.examplesRoot, 'welcome'), { title: 'Welcome Example' });
  writeFlow(path.join(paths.storageRoot, 'alice', 'first-project'), {
    title: 'First Project',
    slides: [{ text: 'One' }]
  });

  const service = createWorkspaceService(paths);
  const workspaces = service.listWorkspaces();
  assert.equal(workspaces.length, 2);
  assert.equal(workspaces[0].id, EXAMPLES_WORKSPACE_ID);
  assert.equal(workspaces[0].readOnly, true);
  assert.equal(workspaces[1].name, 'alice');
  assert.equal(service.getCurrentWorkspace().id, workspaces[1].id);

  const projects = service.listProjects(workspaces[1].id);
  assert.equal(projects[0].title, 'First Project');
  assert.equal(projects[0].slideCount, 1);
  assert.equal(projects[0].readOnly, false);
});

test('bundled examples are selected before the first user workspace exists', t => {
  const paths = makeTestPaths('movement-first-run-examples-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.examplesRoot, 'welcome'), { title: 'Welcome Example' });

  const service = createWorkspaceService(paths);
  const selected = service.getCurrentWorkspace();

  assert.equal(selected.id, EXAMPLES_WORKSPACE_ID);
  assert.equal(selected.readOnly, true);
  assert.equal(service.listProjects(selected.id)[0].title, 'Welcome Example');
});

test('non-workspace utility folders are excluded from discovery', t => {
  const paths = makeTestPaths('movement-filter-workspaces-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.storageRoot, 'alice', 'story'));
  fs.mkdirSync(path.join(paths.storageRoot, 'transitions'), { recursive: true });
  fs.writeFileSync(
    path.join(paths.storageRoot, 'transitions', 'soft-wipe-engine.js'),
    'export function runTransition() {}',
    'utf8'
  );

  const service = createWorkspaceService(paths);
  assert.deepEqual(service.listWorkspaces().map(item => item.name), ['Examples', 'alice']);
  assert.equal(isRecognizedWorkspace(path.join(paths.storageRoot, 'transitions')), false);
});

test('multiple user workspaces require a choice and selection stays in memory', t => {
  const paths = makeTestPaths('movement-many-workspaces-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.storageRoot, 'alice', 'one'));
  writeFlow(path.join(paths.storageRoot, 'bob', 'two'));

  const service = createWorkspaceService(paths);
  const workspaces = service.listWorkspaces();
  assert.equal(service.getCurrentWorkspace(), null);

  const bob = workspaces.find(item => item.name === 'bob');
  assert.equal(service.selectWorkspace(bob.id).name, 'bob');
  assert.equal(service.getCurrentWorkspace().name, 'bob');
  assert.equal(fs.existsSync(path.join(paths.temporaryRoot, 'settings.json')), false);
});

test('metadata makes an empty folder a recognized workspace', t => {
  const paths = makeTestPaths('movement-empty-workspace-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const emptyRoot = path.join(paths.storageRoot, 'New Stories');
  fs.mkdirSync(emptyRoot, { recursive: true });
  fs.writeFileSync(
    path.join(emptyRoot, WORKSPACE_METADATA),
    JSON.stringify({ version: 1, name: 'New Stories' }),
    'utf8'
  );

  const service = createWorkspaceService(paths);
  const workspace = service.listWorkspaces().find(item => item.name === 'New Stories');
  assert.ok(workspace);
  assert.equal(workspace.projectCount, 0);
});

test('public results never expose absolute filesystem paths', t => {
  const paths = makeTestPaths('movement-no-path-leak-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.storageRoot, 'alice', 'story'), {
    title: 'A Story',
    openingImage: 'cover.webp'
  });

  const service = createWorkspaceService(paths);
  const serialized = JSON.stringify({
    workspaces: service.listWorkspaces(),
    projects: service.listProjects(service.getCurrentWorkspace().id)
  });
  assert.equal(serialized.includes(paths.temporaryRoot), false);
});

test('thumbnail lookup accepts only a project opening image', t => {
  const paths = makeTestPaths('movement-thumbnail-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot, { openingImage: 'cover.png' });
  fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'img', 'cover.png'), Buffer.from('image bytes'));

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const dataUrl = service.getProjectThumbnail(workspace.id, 'story');
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.throws(
    () => service.getProjectThumbnail(workspace.id, '../story'),
    error => error.code === 'NOT_FOUND'
  );
});

test('workspace and starter project creation use explicit metadata and schema v2', t => {
  const paths = makeTestPaths('movement-create-project-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  fs.mkdirSync(paths.examplesRoot, { recursive: true });

  const service = createWorkspaceService(paths);
  const workspace = service.createWorkspace('My Stories');
  const project = service.createProject(workspace.id, 'First Light');

  assert.equal(workspace.name, 'My Stories');
  assert.equal(project.id, 'first-light');
  assert.equal(project.title, 'First Light');
  assert.equal(project.slideCount, 0);

  const workspaceRoot = path.join(paths.storageRoot, 'My Stories');
  assert.equal(isFileForTest(path.join(workspaceRoot, WORKSPACE_METADATA)), true);
  for (const folder of ['img', 'speech', 'audio', 'backups']) {
    assert.equal(fs.statSync(path.join(workspaceRoot, 'first-light', folder)).isDirectory(), true);
  }
  const flow = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, 'first-light', 'flow.json'), 'utf8')
  );
  assert.equal(flow.schemaVersion, 2);
  assert.deepEqual(flow.slides, []);
  assert.deepEqual(flow.globalAudioLayers, []);
});

test('flow saves create backups and reject stale revisions', t => {
  const paths = makeTestPaths('movement-safe-save-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.storageRoot, 'alice', 'story'), {
    title: 'Original',
    slides: [{ text: 'One' }]
  });

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const loaded = service.loadProjectFlow(workspace.id, 'story');
  const result = service.saveProjectFlow(
    workspace.id,
    'story',
    { ...loaded.flow, title: 'Changed safely' },
    loaded.revision
  );

  assert.notEqual(result.revision, loaded.revision);
  assert.match(result.backupName, /^flow-.*\.json$/);
  assert.equal(service.loadProjectFlow(workspace.id, 'story').flow.title, 'Changed safely');
  assert.throws(
    () => service.saveProjectFlow(workspace.id, 'story', loaded.flow, loaded.revision),
    error => error.code === 'REVISION_CONFLICT'
  );
  const backupPath = path.join(
    paths.storageRoot,
    'alice',
    'story',
    'backups',
    result.backupName
  );
  assert.equal(JSON.parse(fs.readFileSync(backupPath, 'utf8')).title, 'Original');
});

test('flow backup retention is capped at the PHP-compatible limit', t => {
  const paths = makeTestPaths('movement-backup-retention-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  writeFlow(path.join(paths.storageRoot, 'alice', 'story'));

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  for (let index = 0; index < MAX_BACKUPS + 4; index += 1) {
    const loaded = service.loadProjectFlow(workspace.id, 'story');
    service.saveProjectFlow(
      workspace.id,
      'story',
      { ...loaded.flow, title: `Revision ${index}` },
      loaded.revision
    );
  }

  const backups = fs.readdirSync(
    path.join(paths.storageRoot, 'alice', 'story', 'backups')
  );
  assert.equal(backups.length, MAX_BACKUPS);
});

test('an example is copied with media but without published state or backup history', t => {
  const paths = makeTestPaths('movement-copy-example-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const exampleRoot = path.join(paths.examplesRoot, 'welcome');
  writeFlow(exampleRoot, {
    title: 'Welcome',
    isPublished: true,
    publishedAt: '2026-01-01T00:00:00Z',
    openingImage: 'cover.png'
  });
  fs.mkdirSync(path.join(exampleRoot, 'img'), { recursive: true });
  fs.mkdirSync(path.join(exampleRoot, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(exampleRoot, 'img', 'cover.png'), 'image');
  fs.writeFileSync(path.join(exampleRoot, 'backups', 'flow-old.json'), '{}');

  const service = createWorkspaceService(paths);
  const workspace = service.createWorkspace('Stories');
  const copied = service.copyExample('welcome', workspace.id);
  const loaded = service.loadProjectFlow(workspace.id, copied.id);

  assert.equal(copied.readOnly, false);
  assert.equal(loaded.flow.title, 'Welcome (Copy)');
  assert.equal(loaded.flow.isPublished, false);
  assert.equal('publishedAt' in loaded.flow, false);
  const copiedRoot = path.join(paths.storageRoot, 'Stories', copied.id);
  assert.equal(isFileForTest(path.join(copiedRoot, 'img', 'cover.png')), true);
  assert.deepEqual(fs.readdirSync(path.join(copiedRoot, 'backups')), []);
});

test('rename, duplicate, and trash operations preserve recoverability', t => {
  const paths = makeTestPaths('movement-project-lifecycle-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot, { title: 'Story' });
  fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'img', 'asset.webp'), 'asset');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const duplicate = service.duplicateProject(workspace.id, 'story');
  assert.equal(duplicate.id, 'story-copy');
  assert.equal(
    isFileForTest(path.join(paths.storageRoot, 'alice', 'story-copy', 'img', 'asset.webp')),
    true
  );

  const renamed = service.renameProject(workspace.id, duplicate.id, 'Second Story');
  assert.equal(renamed.id, 'second-story');
  assert.equal(service.loadProjectFlow(workspace.id, renamed.id).flow.title, 'Second Story');

  const trashed = service.moveProjectToTrash(workspace.id, renamed.id);
  assert.equal(trashed.recoverable, true);
  assert.equal(
    isDirectoryForTest(
      path.join(paths.storageRoot, 'alice', '.movement-trash', trashed.trashName)
    ),
    true
  );
  assert.equal(service.listProjects(workspace.id).some(item => item.id === renamed.id), false);
});

test('trashed projects can be listed, restored, and restored as conflict-safe copies', t => {
  const paths = makeTestPaths('movement-project-restore-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot, { title: 'Original Story', slides: [{ text: 'Recovered' }] });
  fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'img', 'asset.webp'), 'original media');
  fs.writeFileSync(path.join(projectRoot, 'backups', 'flow-old.json'), 'original backup');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const firstTrash = service.moveProjectToTrash(workspace.id, 'story');
  const firstListing = service.listTrashedProjects(workspace.id);
  assert.equal(firstListing.length, 1);
  assert.equal(firstListing[0].trashId, firstTrash.trashName);
  assert.equal(firstListing[0].originalProjectId, 'story');
  assert.equal(firstListing[0].title, 'Original Story');
  assert.equal(firstListing[0].slideCount, 1);
  assert.equal(firstListing[0].conflict, false);
  assert.equal(JSON.stringify(firstListing).includes(paths.temporaryRoot), false);

  const restored = service.restoreProjectFromTrash(workspace.id, firstTrash.trashName);
  assert.equal(restored.id, 'story');
  assert.equal(restored.restoredAsCopy, false);
  assert.equal(isFileForTest(path.join(projectRoot, 'img', 'asset.webp')), true);
  assert.equal(isFileForTest(path.join(projectRoot, 'backups', 'flow-old.json')), true);
  assert.deepEqual(service.listTrashedProjects(workspace.id), []);

  const secondTrash = service.moveProjectToTrash(workspace.id, 'story');
  writeFlow(projectRoot, { title: 'New Active Story' });
  assert.equal(service.listTrashedProjects(workspace.id)[0].conflict, true);
  assert.throws(
    () => service.restoreProjectFromTrash(workspace.id, secondTrash.trashName),
    error => error.code === 'CONFLICT'
  );

  const restoredCopy = service.restoreProjectFromTrash(
    workspace.id,
    secondTrash.trashName,
    true
  );
  assert.equal(restoredCopy.id, 'story-2');
  assert.equal(restoredCopy.title, 'Original Story');
  assert.equal(restoredCopy.restoredAsCopy, true);
  assert.equal(service.loadProjectFlow(workspace.id, 'story').flow.title, 'New Active Story');
  assert.equal(
    isFileForTest(path.join(paths.storageRoot, 'alice', 'story-2', 'img', 'asset.webp')),
    true
  );
  assert.deepEqual(service.listTrashedProjects(workspace.id), []);
  assert.throws(
    () => service.listTrashedProjects(EXAMPLES_WORKSPACE_ID),
    error => error.code === 'READ_ONLY'
  );
});

test('trashed projects can be permanently deleted without affecting active projects', t => {
  const paths = makeTestPaths('movement-project-delete-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const deletedProjectRoot = path.join(paths.storageRoot, 'alice', 'old-story');
  const activeProjectRoot = path.join(paths.storageRoot, 'alice', 'current-story');
  writeFlow(deletedProjectRoot, { title: 'Old Story', slides: [{ text: 'Delete me' }] });
  writeFlow(activeProjectRoot, { title: 'Current Story' });
  fs.mkdirSync(path.join(deletedProjectRoot, 'img'), { recursive: true });
  fs.mkdirSync(path.join(deletedProjectRoot, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(deletedProjectRoot, 'img', 'asset.webp'), 'old media');
  fs.writeFileSync(path.join(deletedProjectRoot, 'backups', 'flow-old.json'), 'old backup');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const trashed = service.moveProjectToTrash(workspace.id, 'old-story');
  const trashEntryRoot = path.join(
    paths.storageRoot,
    'alice',
    '.movement-trash',
    trashed.trashName
  );
  assert.equal(isDirectoryForTest(trashEntryRoot), true);

  const deleted = service.deleteTrashedProject(workspace.id, trashed.trashName);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.trashId, trashed.trashName);
  assert.equal(deleted.originalProjectId, 'old-story');
  assert.equal(deleted.title, 'Old Story');
  assert.equal(isDirectoryForTest(trashEntryRoot), false);
  assert.deepEqual(service.listTrashedProjects(workspace.id), []);
  assert.equal(service.loadProjectFlow(workspace.id, 'current-story').flow.title, 'Current Story');
  assert.throws(
    () => service.deleteTrashedProject(workspace.id, trashed.trashName),
    error => error.code === 'NOT_FOUND'
  );
  assert.throws(
    () => service.deleteTrashedProject(EXAMPLES_WORKSPACE_ID, trashed.trashName),
    error => error.code === 'READ_ONLY'
  );
});

test('read-only examples reject flow and media writes', t => {
  const paths = makeTestPaths('movement-readonly-example-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const exampleRoot = path.join(paths.examplesRoot, 'welcome');
  writeFlow(exampleRoot, { title: 'Welcome' });
  fs.mkdirSync(path.join(exampleRoot, 'img'), { recursive: true });
  fs.writeFileSync(path.join(exampleRoot, 'img', 'unused.png'), 'unused');

  const service = createWorkspaceService(paths);
  const loaded = service.loadProjectFlow(EXAMPLES_WORKSPACE_ID, 'welcome');
  assert.equal(loaded.readOnly, true);
  assert.throws(
    () => service.saveProjectFlow(
      EXAMPLES_WORKSPACE_ID,
      'welcome',
      { ...loaded.flow, title: 'Changed' },
      loaded.revision
    ),
    error => error.code === 'READ_ONLY'
  );
  const overview = service.getProjectMediaOverview(EXAMPLES_WORKSPACE_ID, 'welcome');
  assert.equal(overview.readOnly, true);
  assert.throws(
    () => service.moveUnusedProjectMediaToTrash(
      EXAMPLES_WORKSPACE_ID,
      'welcome',
      'img',
      'unused.png',
      overview.revision
    ),
    error => error.code === 'READ_ONLY'
  );
  assert.equal(
    service.loadProjectFlow(EXAMPLES_WORKSPACE_ID, 'welcome').flow.title,
    'Welcome'
  );
});

test('project media listing and asset resolution stay inside approved media folders', t => {
  const paths = makeTestPaths('movement-project-assets-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'speech'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'img', 'cover.webp'), 'image');
  fs.writeFileSync(path.join(projectRoot, 'speech', 'line.mp3'), 'audio');
  fs.writeFileSync(path.join(projectRoot, 'secret.txt'), 'not media');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  assert.deepEqual(service.listProjectMedia(workspace.id, 'story', 'img'), ['cover.webp']);
  assert.equal(
    service.resolveProjectAssetPath(workspace.id, 'story', 'img/cover.webp'),
    path.join(projectRoot, 'img', 'cover.webp')
  );
  assert.throws(
    () => service.resolveProjectAssetPath(workspace.id, 'story', '../secret.txt'),
    error => error.code === 'NOT_FOUND'
  );
  assert.throws(
    () => service.resolveProjectAssetPath(workspace.id, 'story', 'secret.txt'),
    error => error.code === 'NOT_FOUND'
  );
});

test('media imports validate content, avoid overwrites, and support explicit replacement', t => {
  const paths = makeTestPaths('movement-media-import-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot);
  const sourceRoot = path.join(paths.temporaryRoot, 'incoming');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const firstImage = path.join(sourceRoot, 'My Cover .png');
  const replacementImage = path.join(sourceRoot, 'My Cover.png');
  fs.writeFileSync(
    firstImage,
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('first')])
  );
  fs.writeFileSync(
    replacementImage,
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('second')])
  );

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const imported = service.importProjectMedia(workspace.id, 'story', 'img', firstImage);
  assert.deepEqual(
    {
      status: imported.status,
      type: imported.type,
      filename: imported.filename,
      disposition: imported.disposition
    },
    {
      status: 'success',
      type: 'img',
      filename: 'My Cover.png',
      disposition: 'imported'
    }
  );
  const destination = path.join(projectRoot, 'img', imported.filename);
  const originalBytes = fs.readFileSync(destination);

  const conflict = service.importProjectMedia(workspace.id, 'story', 'img', replacementImage);
  assert.equal(conflict.status, 'needs_confirmation');
  assert.equal(conflict.filename, imported.filename);
  assert.deepEqual(fs.readFileSync(destination), originalBytes);

  const replaced = service.importProjectMedia(
    workspace.id,
    'story',
    'img',
    replacementImage,
    true
  );
  assert.equal(replaced.disposition, 'replaced');
  assert.notDeepEqual(fs.readFileSync(destination), originalBytes);
  assert.deepEqual(service.listProjectMedia(workspace.id, 'story', 'img'), ['My Cover.png']);
});

test('media imports reject unsupported extensions and renamed non-media files', t => {
  const paths = makeTestPaths('movement-media-safety-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot);
  const sourceRoot = path.join(paths.temporaryRoot, 'incoming');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const executable = path.join(sourceRoot, 'payload.exe');
  const fakeImage = path.join(sourceRoot, 'payload.jpg');
  fs.writeFileSync(executable, 'MZ executable');
  fs.writeFileSync(fakeImage, 'MZ renamed executable');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  assert.throws(
    () => service.importProjectMedia(workspace.id, 'story', 'img', executable),
    error => error.code === 'UNSAFE_MEDIA_TYPE'
  );
  assert.throws(
    () => service.importProjectMedia(workspace.id, 'story', 'img', fakeImage),
    error => error.code === 'MEDIA_SIGNATURE_MISMATCH'
  );
  assert.equal(isDirectoryForTest(path.join(projectRoot, 'img')), false);
});

test('audio imports stay in the selected speech or audio folder', t => {
  const paths = makeTestPaths('movement-audio-import-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot);
  const sourcePath = path.join(paths.temporaryRoot, 'voice.mp3');
  fs.writeFileSync(sourcePath, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32, 1)]));

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const speech = service.importProjectMedia(workspace.id, 'story', 'speech', sourcePath);
  const audio = service.importProjectMedia(workspace.id, 'story', 'audio', sourcePath);
  assert.equal(speech.disposition, 'imported');
  assert.equal(audio.disposition, 'imported');
  assert.equal(isFileForTest(path.join(projectRoot, 'speech', 'voice.mp3')), true);
  assert.equal(isFileForTest(path.join(projectRoot, 'audio', 'voice.mp3')), true);
});

test('project media overview separates unused, missing, opening, global, and slide references', t => {
  const paths = makeTestPaths('movement-media-overview-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot, {
    openingImage: 'opening.png',
    globalAudioLayers: [{ name: 'Theme', src: 'audio/theme.mp3' }],
    slides: [
      {
        background: {
          src: 'background.png',
          effect: { config: { imgSrc: 'img/effect.png', frames: ['img/frame.png'] } }
        },
        foregroundLayers: [{ name: 'Presenter', src: 'presenter.png' }],
        audioLayers: [
          { name: 'Speech', src: 'speech/voice.mp3' },
          { name: 'Music', src: 'audio/music.mp3' }
        ]
      },
      {
        background: { src: 'missing.png' }
      }
    ]
  });
  const files = [
    ['img', 'opening.png'],
    ['img', 'background.png'],
    ['img', 'effect.png'],
    ['img', 'frame.png'],
    ['img', 'presenter.png'],
    ['img', 'unused.png'],
    ['speech', 'voice.mp3'],
    ['speech', 'unused.mp3'],
    ['audio', 'theme.mp3'],
    ['audio', 'music.mp3']
  ];
  for (const [folder, filename] of files) {
    const directory = path.join(projectRoot, folder);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), `${folder}:${filename}`);
  }

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const overview = service.getProjectMediaOverview(workspace.id, 'story');
  assert.equal(overview.slideCount, 2);
  assert.equal(overview.readOnly, false);
  assert.equal(JSON.stringify(overview).includes(paths.temporaryRoot), false);

  const opening = overview.media.img.find(item => item.filename === 'opening.png');
  assert.deepEqual(opening.references, [{
    scope: 'opening',
    slideNumber: null,
    role: 'Opening image'
  }]);
  const effect = overview.media.img.find(item => item.filename === 'effect.png');
  assert.equal(effect.references[0].slideNumber, 1);
  assert.equal(effect.references[0].role, 'Background effect: imgSrc');
  const globalAudio = overview.media.audio.find(item => item.filename === 'theme.mp3');
  assert.equal(globalAudio.references[0].scope, 'global');
  assert.equal(globalAudio.references[0].role, 'Theme');
  assert.deepEqual(
    overview.media.img.filter(item => item.references.length === 0).map(item => item.filename),
    ['unused.png']
  );
  assert.deepEqual(
    overview.media.speech.filter(item => item.references.length === 0).map(item => item.filename),
    ['unused.mp3']
  );
  assert.equal(overview.missing.img.length, 1);
  assert.equal(overview.missing.img[0].filename, 'missing.png');
  assert.equal(overview.missing.img[0].references[0].slideNumber, 2);
});

test('only unused media can move to recoverable project trash at the inspected revision', t => {
  const paths = makeTestPaths('movement-media-trash-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot, {
    openingImage: 'used.png',
    slides: [{ background: { src: 'used.png' } }]
  });
  const imageRoot = path.join(projectRoot, 'img');
  fs.mkdirSync(imageRoot, { recursive: true });
  fs.writeFileSync(path.join(imageRoot, 'used.png'), 'used');
  fs.writeFileSync(path.join(imageRoot, 'unused.png'), 'unused');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const overview = service.getProjectMediaOverview(workspace.id, 'story');
  assert.throws(
    () => service.moveUnusedProjectMediaToTrash(
      workspace.id,
      'story',
      'img',
      'used.png',
      overview.revision
    ),
    error => error.code === 'MEDIA_IN_USE'
  );
  assert.throws(
    () => service.moveUnusedProjectMediaToTrash(
      workspace.id,
      'story',
      'img',
      'unused.png',
      'stale-revision'
    ),
    error => error.code === 'REVISION_CONFLICT'
  );

  const removed = service.moveUnusedProjectMediaToTrash(
    workspace.id,
    'story',
    'img',
    'unused.png',
    overview.revision
  );
  assert.equal(removed.recoverable, true);
  assert.equal(isFileForTest(path.join(imageRoot, 'unused.png')), false);
  const trashRoot = path.join(projectRoot, '.movement-media-trash', removed.trashId);
  assert.equal(isFileForTest(path.join(trashRoot, 'img', 'unused.png')), true);
  assert.equal(isFileForTest(path.join(trashRoot, 'metadata.json')), true);
  assert.deepEqual(service.listProjectMedia(workspace.id, 'story', 'img'), ['used.png']);
});

test('portable ZIP is browser-playable, re-importable, and conflict-safe', async t => {
  const paths = makeTestPaths('movement-portable-project-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const sourceRoot = path.join(paths.storageRoot, 'alice', 'portable-story');
  writeFlow(sourceRoot, {
    title: 'Portable Story',
    openingImage: 'cover.png',
    slides: [{
      background: { src: 'cover.png' },
      audioLayers: [{ name: 'Speech', src: 'speech/voice.mp3' }]
    }]
  });
  fs.mkdirSync(path.join(sourceRoot, 'img'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'speech'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'img', 'cover.png'),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('portable image')
    ])
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'speech', 'voice.mp3'),
    Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32, 7)])
  );
  writeFlow(path.join(paths.storageRoot, 'bob', 'starter'), { title: 'Starter' });

  const service = createWorkspaceService(paths);
  const workspaces = service.listWorkspaces();
  const alice = workspaces.find(item => item.name === 'alice');
  const bob = workspaces.find(item => item.name === 'bob');
  const archivePath = path.join(paths.temporaryRoot, 'portable-story.zip');
  const exported = service.exportPortableProject(
    alice.id,
    'portable-story',
    archivePath
  );
  assert.equal(exported.status, 'success');
  assert.equal(exported.mediaCount, 2);
  assert.equal(isFileForTest(archivePath), true);
  const archiveBytes = fs.readFileSync(archivePath);
  assert.equal(archiveBytes.includes(Buffer.from('portable-story/player.html')), true);
  assert.equal(archiveBytes.includes(Buffer.from('portable-story/flow.json')), true);
  assert.equal(archiveBytes.includes(Buffer.from('window.PLAYER_BOOTSTRAP')), true);
  assert.equal(archiveBytes.includes(Buffer.from('player-runtime.js')), false);
  const archiveText = archiveBytes.toString('utf8');
  assert.equal(/<script\b[^>]*\bsrc\s*=/i.test(archiveText), false);
  assert.equal(/<link\b[^>]*\brel=["']stylesheet["']/i.test(archiveText), false);

  const inspection = service.inspectPortableProject(bob.id, archivePath);
  assert.equal(inspection.title, 'Portable Story');
  assert.equal(inspection.preferredProjectId, 'portable-story');
  assert.equal(inspection.conflict, false);
  assert.equal(inspection.hasPlayer, true);
  assert.equal(inspection.mediaCount, 2);

  const imported = await service.importPortableProject(bob.id, archivePath);
  assert.equal(imported.id, 'portable-story');
  assert.equal(imported.title, 'Portable Story');
  const importedRoot = path.join(paths.storageRoot, 'bob', imported.id);
  assert.equal(isFileForTest(path.join(importedRoot, 'flow.json')), true);
  assert.equal(isFileForTest(path.join(importedRoot, 'img', 'cover.png')), true);
  assert.equal(isFileForTest(path.join(importedRoot, 'speech', 'voice.mp3')), true);
  assert.equal(isFileForTest(path.join(importedRoot, 'player.html')), false);
  assert.equal(service.inspectPortableProject(bob.id, archivePath).conflict, true);
  await assert.rejects(
    service.importPortableProject(bob.id, archivePath),
    error => error.code === 'CONFLICT'
  );

  const importedCopy = await service.importPortableProject(bob.id, archivePath, true);
  assert.equal(importedCopy.id, 'portable-story-2');
  assert.equal(importedCopy.title, 'Portable Story Copy');
  assert.equal(importedCopy.importedAsCopy, true);
  assert.equal(service.listProjects(bob.id).some(item => item.id === 'portable-story-2'), true);
});

test('a duplicated exportable project remains editable and portable-exportable', t => {
  const paths = makeTestPaths('movement-duplicate-portable-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const sourceRoot = path.join(paths.storageRoot, 'alice', 'portable-story');
  writeFlow(sourceRoot, {
    title: 'Portable Story',
    openingImage: 'cover.png',
    slides: [{
      background: { src: 'cover.png' },
      audioLayers: [{ name: 'Speech', src: 'speech/voice.mp3' }]
    }]
  });
  fs.mkdirSync(path.join(sourceRoot, 'img'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'speech'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.movement-media-trash', 'discarded'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, '.save.lock'), 'runtime state');
  fs.writeFileSync(path.join(sourceRoot, 'backups', 'flow-old.json'), '{}');
  fs.writeFileSync(
    path.join(sourceRoot, 'img', 'cover.png'),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('portable image')
    ])
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'speech', 'voice.mp3'),
    Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32, 7)])
  );

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  const originalArchive = path.join(paths.temporaryRoot, 'portable-story.zip');
  assert.equal(
    service.exportPortableProject(workspace.id, 'portable-story', originalArchive).status,
    'success'
  );

  const duplicate = service.duplicateProject(workspace.id, 'portable-story');
  const duplicateRoot = path.join(paths.storageRoot, 'alice', duplicate.id);
  for (const mediaFolder of ['img', 'speech', 'audio']) {
    assert.deepEqual(
      fs.readdirSync(path.join(duplicateRoot, mediaFolder), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name),
      [],
      `${mediaFolder} must remain flat after duplication`
    );
  }
  assert.deepEqual(fs.readdirSync(path.join(duplicateRoot, 'backups')), []);
  assert.equal(fs.existsSync(path.join(duplicateRoot, '.movement-media-trash')), false);
  assert.equal(fs.existsSync(path.join(duplicateRoot, '.save.lock')), false);

  const loaded = service.loadProjectFlow(workspace.id, duplicate.id);
  service.saveProjectFlow(
    workspace.id,
    duplicate.id,
    { ...loaded.flow, description: 'Edited after duplication' },
    loaded.revision
  );
  const duplicateArchive = path.join(paths.temporaryRoot, `${duplicate.id}.zip`);
  const exportedDuplicate = service.exportPortableProject(
    workspace.id,
    duplicate.id,
    duplicateArchive
  );
  assert.equal(exportedDuplicate.status, 'success');
  assert.equal(exportedDuplicate.mediaCount, 2);
  assert.equal(isFileForTest(duplicateArchive), true);

  fs.mkdirSync(path.join(duplicateRoot, 'img', 'nested'));
  assert.throws(
    () => service.exportPortableProject(
      workspace.id,
      duplicate.id,
      path.join(paths.temporaryRoot, 'unsafe-nested.zip')
    ),
    error => error.code === 'UNSAFE_PROJECT'
  );
});

test('portable export refuses files that are not safe project media', t => {
  const paths = makeTestPaths('movement-portable-safety-');
  t.after(() => cleanTemporaryRoot(paths.temporaryRoot));
  const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
  writeFlow(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'img', 'payload.exe'), 'MZ executable');

  const service = createWorkspaceService(paths);
  const workspace = service.getCurrentWorkspace();
  assert.throws(
    () => service.exportPortableProject(
      workspace.id,
      'story',
      path.join(paths.temporaryRoot, 'unsafe.zip')
    ),
    error => error.code === 'UNSAFE_MEDIA_TYPE'
  );
  assert.equal(isFileForTest(path.join(paths.temporaryRoot, 'unsafe.zip')), false);
});

function isFileForTest(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectoryForTest(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
