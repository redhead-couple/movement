const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const applicationRoot = path.resolve(process.env.MOVEMENT_DESKTOP_TEST_ROOT || path.join(__dirname, '..'));
const { createWorkspaceService } = require(path.join(applicationRoot, 'desktop/services/workspace-service.cjs'));

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-image-trash-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^movement-image-trash-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const paths = { storageRoot: path.join(root, 'storage'), examplesRoot: path.join(root, 'examples') };
  const service = createWorkspaceService(paths);
  const workspace = service.createWorkspace('Test');
  const project = service.createProject(workspace.id, 'Story');
  const projectRoot = path.join(paths.storageRoot, 'Test', project.id);
  const ids = [workspace.id, project.id];
  const flow = { schemaVersion: 2, title: 'Story', openingImage: 'img/cover.png', slides: [{
    background: { src: 'img/background.png' }, foregroundLayers: [{ src: 'img/layer.png' }],
    bgEffect: { config: { frames: ['img/frame.png'], images: ['img/multi.png'], maskSrc: 'img/mask.png' } },
    fgEffect: { customUnknownKey: 'img/encoded%20image.png?x=1' },
    audioLayers: [{ src: 'speech/voice.mp3' }]
  }] };
  fs.writeFileSync(path.join(projectRoot, 'flow.json'), JSON.stringify(flow));
  for (const name of ['cover.png','background.png','layer.png','frame.png','multi.png','mask.png','encoded image.png','unused.png','second.png','notes.txt']) {
    fs.writeFileSync(path.join(projectRoot, 'img', name), `bytes:${name}`);
  }
  fs.writeFileSync(path.join(projectRoot, 'speech', 'voice.mp3'), 'voice');
  return { root, paths, projectRoot, service, ids, flow };
}

test('bulk cleanup preserves opening, layers, effect arrays, unknown fields, audio and saved flow; restores exact bytes', t => {
  const f = setup(t);
  const before = fs.readFileSync(path.join(f.projectRoot, 'flow.json'));
  const overview = f.service.getProjectMediaOverview(...f.ids);
  assert.deepEqual(overview.cleanupImages.map(x => x.filename).sort(), ['second.png','unused.png']);
  assert.deepEqual(f.service.moveUnusedImagesToTrash(...f.ids, overview.cleanupToken), { moved: 2 });
  const trash = f.service.getProjectMediaOverview(...f.ids).trash;
  assert.equal(trash.length, 2);
  for (const entry of trash) {
    assert.equal(fs.existsSync(path.join(f.projectRoot, 'img', entry.filename)), false);
    f.service.restoreProjectMedia(...f.ids, entry.trashId, entry.type, entry.filename);
    assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img', entry.filename), 'utf8'), `bytes:${entry.filename}`);
  }
  assert.equal(f.service.getProjectMediaOverview(...f.ids).trash.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'flow.json')), before);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'speech/voice.mp3'), 'utf8'), 'voice');
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img/notes.txt'), 'utf8'), 'bytes:notes.txt');
});

test('stale flow or file list, invalid flow, traversal and restore collisions cannot remove or overwrite content', t => {
  const f = setup(t);
  let overview = f.service.getProjectMediaOverview(...f.ids);
  fs.writeFileSync(path.join(f.projectRoot, 'img/new.png'), 'new');
  assert.throws(() => f.service.moveUnusedImagesToTrash(...f.ids, overview.cleanupToken), /changed/);
  overview = f.service.getProjectMediaOverview(...f.ids);
  f.service.saveProjectFlow(...f.ids, { ...f.flow, openingImage: 'unused.png' });
  assert.throws(() => f.service.moveUnusedImagesToTrash(...f.ids, overview.cleanupToken), /changed/);
  overview = f.service.getProjectMediaOverview(...f.ids);
  f.service.moveUnusedImagesToTrash(...f.ids, overview.cleanupToken);
  const entry = f.service.getProjectMediaOverview(...f.ids).trash[0];
  fs.writeFileSync(path.join(f.projectRoot, 'img', entry.filename), 'newer');
  assert.throws(() => f.service.restoreProjectMedia(...f.ids, entry.trashId, 'img', entry.filename), /already exists/);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img', entry.filename), 'utf8'), 'newer');
  assert.throws(() => f.service.restoreProjectMedia(...f.ids, '../outside', 'img', entry.filename), /Invalid/);
  fs.writeFileSync(path.join(f.projectRoot, 'flow.json'), '{broken');
  assert.throws(() => f.service.moveUnusedImagesToTrash(...f.ids, overview.cleanupToken));
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img/unused.png'), 'utf8'), 'bytes:unused.png');
  for (const invalid of [{}, { schemaVersion: 2, title: 'Missing slides' }, { schemaVersion: 99, slides: [] }]) {
    fs.writeFileSync(path.join(f.projectRoot, 'flow.json'), JSON.stringify(invalid));
    assert.throws(() => f.service.getProjectMediaOverview(...f.ids));
  }
  assert.throws(() => f.service.moveUnusedImagesToTrash('examples', 'story', 'token'), error => error.code === 'READ_ONLY');
});

test('failed restoration preserves trash and linked folders are never followed', t => {
  const f = setup(t);
  f.service.moveUnusedImagesToTrash(...f.ids, f.service.getProjectMediaOverview(...f.ids).cleanupToken);
  const [entry] = f.service.getProjectMediaOverview(...f.ids).trash;
  const link = fs.linkSync;
  fs.linkSync = () => { throw new Error('Injected restore failure'); };
  try {
    assert.throws(() => f.service.restoreProjectMedia(...f.ids, entry.trashId, entry.type, entry.filename), /restore failure/);
  } finally { fs.linkSync = link; }
  assert.equal(fs.existsSync(path.join(f.projectRoot, 'img', entry.filename)), false);
  assert.ok(f.service.getProjectMediaOverview(...f.ids).trash.some(item => item.filename === entry.filename));
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  const linked = path.join(f.projectRoot, '.movement-media-trash', 'linked');
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(outside, 'img'));
  fs.writeFileSync(path.join(outside, 'img', 'external.png'), 'outside');
  assert.throws(() => f.service.restoreProjectMedia(...f.ids, 'linked', 'img', 'external.png'), /Linked/);
  assert.equal(fs.readFileSync(path.join(outside, 'img/external.png'), 'utf8'), 'outside');
  assert.equal(f.service.getProjectMediaOverview(...f.ids).trash.some(item => item.filename === 'external.png'), false);
  fs.linkSync = () => { const error = new Error('No hard links'); error.code = 'ENOTSUP'; throw error; };
  try {
    f.service.restoreProjectMedia(...f.ids, entry.trashId, entry.type, entry.filename);
  } finally { fs.linkSync = link; }
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img', entry.filename), 'utf8'), `bytes:${entry.filename}`);
});

test('a failed move reports partial progress and keeps every original byte recoverable', t => {
  const f = setup(t);
  const overview = f.service.getProjectMediaOverview(...f.ids);
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (path.basename(from) === 'unused.png') throw new Error('Injected disk failure');
    return rename(from, to);
  };
  try {
    const result = f.service.moveUnusedImagesToTrash(...f.ids, overview.cleanupToken);
    assert.equal(result.moved, 1);
    assert.match(result.error, /disk failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img/unused.png'), 'utf8'), 'bytes:unused.png');
  const [entry] = f.service.getProjectMediaOverview(...f.ids).trash;
  f.service.restoreProjectMedia(...f.ids, entry.trashId, entry.type, entry.filename);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img/second.png'), 'utf8'), 'bytes:second.png');
});

test('process termination after a move leaves discoverable trash and intact remaining images', t => {
  const f = setup(t);
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    const {createWorkspaceService} = require(process.argv[1]);
    const service = createWorkspaceService(JSON.parse(process.argv[2]));
    const ids = JSON.parse(process.argv[3]);
    const token = service.getProjectMediaOverview(...ids).cleanupToken;
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { rename(from, to); if (String(to).endsWith('.png')) process.exit(73); };
    service.moveUnusedImagesToTrash(...ids, token);
  `, path.join(applicationRoot, 'desktop/services/workspace-service.cjs'), JSON.stringify(f.paths), JSON.stringify(f.ids)],
  { windowsHide: true, encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  const reopened = createWorkspaceService(f.paths);
  const [entry] = reopened.getProjectMediaOverview(...f.ids).trash;
  assert.ok(entry);
  reopened.restoreProjectMedia(...f.ids, entry.trashId, entry.type, entry.filename);
  for (const name of ['second.png','unused.png']) assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img', name), 'utf8'), `bytes:${name}`);
});

test('audio and speech bulk cleanup preserves global music, slide layers, legacy narration and unknown references', t => {
  const f = setup(t);
  const flow = { ...f.flow, globalAudioLayers: [{ src: 'audio/global.mp3' }], slides: [{
    ...f.flow.slides[0], speech: 'speech/legacy.mp3', audio: 'speech/old-voice.mp3',
    audioLayers: [{ src: 'speech/voice.mp3' }, { src: 'audio/layer.mp3' }],
    custom: { track: 'audio/encoded%20track.mp3', narration: 'speech/custom.mp3' }
  }] };
  f.service.saveProjectFlow(...f.ids, flow);
  const before = fs.readFileSync(path.join(f.projectRoot, 'flow.json'));
  const used = { audio: ['global.mp3', 'layer.mp3', 'encoded track.mp3'], speech: ['voice.mp3', 'legacy.mp3', 'old-voice.mp3', 'custom.mp3'] };
  for (const type of ['audio', 'speech']) {
    for (const name of [...used[type], 'unused-one.mp3', 'unused-two.mp3']) fs.writeFileSync(path.join(f.projectRoot, type, name), `${type}:${name}`);
  }
  for (const type of ['audio', 'speech']) {
    const overview = f.service.getProjectMediaOverview(...f.ids);
    assert.deepEqual(overview.cleanup[type].files.map(item => item.filename), ['unused-one.mp3', 'unused-two.mp3']);
    assert.throws(() => f.service.moveUnusedMediaToTrash(...f.ids, type, overview.cleanup.img.token), /changed/);
    assert.deepEqual(f.service.moveUnusedMediaToTrash(...f.ids, type, overview.cleanup[type].token), { moved: 2 });
    for (const name of used[type]) assert.equal(fs.readFileSync(path.join(f.projectRoot, type, name), 'utf8'), `${type}:${name}`);
    assert.equal(fs.existsSync(path.join(f.projectRoot, type, 'unused-one.mp3')), false);
    const entries = f.service.getProjectMediaOverview(...f.ids).trash.filter(item => item.type === type);
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      f.service.restoreProjectMedia(...f.ids, entry.trashId, type, entry.filename);
      assert.equal(fs.readFileSync(path.join(f.projectRoot, type, entry.filename), 'utf8'), `${type}:${entry.filename}`);
    }
    const oldToken = f.service.getProjectMediaOverview(...f.ids).cleanup[type].token;
    fs.writeFileSync(path.join(f.projectRoot, type, 'added.mp3'), 'new');
    assert.throws(() => f.service.moveUnusedMediaToTrash(...f.ids, type, oldToken), /changed/);
  }
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'flow.json')), before);
});

test('empty trash deletes only reviewed trash files across media types; stale lists and read-only projects are refused', t => {
  const f = setup(t);
  const before = fs.readFileSync(path.join(f.projectRoot, 'flow.json'));
  for (const type of ['audio', 'speech']) fs.writeFileSync(path.join(f.projectRoot, type, 'unused.mp3'), type);
  for (const type of ['img', 'audio', 'speech']) {
    const overview = f.service.getProjectMediaOverview(...f.ids);
    f.service.moveUnusedMediaToTrash(...f.ids, type, overview.cleanup[type].token);
  }
  const snapshot = f.service.getProjectMediaOverview(...f.ids);
  assert.equal(snapshot.trash.length, 4);
  const item = snapshot.trash[0];
  f.service.restoreProjectMedia(...f.ids, item.trashId, item.type, item.filename);
  assert.throws(() => f.service.emptyProjectMediaTrash(...f.ids, snapshot.trashToken), /changed/);
  assert.equal(f.service.getProjectMediaOverview(...f.ids).trash.length, 3);
  assert.throws(() => f.service.emptyProjectMediaTrash('examples', 'story', snapshot.trashToken), error => error.code === 'READ_ONLY');
  const current = f.service.getProjectMediaOverview(...f.ids);
  assert.deepEqual(f.service.emptyProjectMediaTrash(...f.ids, current.trashToken), { deleted: 3 });
  assert.equal(f.service.getProjectMediaOverview(...f.ids).trash.length, 0);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'img/cover.png'), 'utf8'), 'bytes:cover.png');
  assert.equal(fs.readFileSync(path.join(f.projectRoot, 'speech/voice.mp3'), 'utf8'), 'voice');
  assert.ok(fs.existsSync(path.join(f.projectRoot, item.type, item.filename)));
  assert.deepEqual(fs.readFileSync(path.join(f.projectRoot, 'flow.json')), before);
});

test('partial empty-trash failure reports progress and keeps remaining files restorable', t => {
  const f = setup(t);
  f.service.moveUnusedImagesToTrash(...f.ids, f.service.getProjectMediaOverview(...f.ids).cleanupToken);
  const overview = f.service.getProjectMediaOverview(...f.ids);
  const unlink = fs.unlinkSync;
  let calls = 0;
  fs.unlinkSync = file => { if (++calls === 2) throw new Error('Injected failure'); return unlink(file); };
  try {
    const result = f.service.emptyProjectMediaTrash(...f.ids, overview.trashToken);
    assert.equal(result.deleted, 1);
    assert.match(result.error, /remaining files/);
  } finally { fs.unlinkSync = unlink; }
  const [item] = f.service.getProjectMediaOverview(...f.ids).trash;
  f.service.restoreProjectMedia(...f.ids, item.trashId, item.type, item.filename);
  assert.equal(fs.readFileSync(path.join(f.projectRoot, item.type, item.filename), 'utf8'), `bytes:${item.filename}`);
});

test('trash previews resolve only supported files within trash and expire after restore', t => {
  const f = setup(t);
  f.service.moveUnusedImagesToTrash(...f.ids, f.service.getProjectMediaOverview(...f.ids).cleanupToken);
  const item = f.service.getProjectMediaOverview(...f.ids).trash[0];
  const args = [item.trashId, item.type, item.filename];
  assert.equal(fs.readFileSync(f.service.resolveProjectTrashPreview(...f.ids, ...args), 'utf8'), `bytes:${item.filename}`);
  assert.throws(() => f.service.resolveProjectTrashPreview(...f.ids, '..', item.type, item.filename));
  assert.throws(() => f.service.resolveProjectTrashPreview(...f.ids, item.trashId, item.type, '../flow.json'));
  for (const filename of ['active.html', 'data.json', 'vector.svg']) {
    fs.writeFileSync(path.join(f.projectRoot, '.movement-media-trash', item.trashId, item.type, filename), 'untrusted');
    assert.throws(() => f.service.resolveProjectTrashPreview(...f.ids, item.trashId, item.type, filename));
  }
  const linked = path.join(f.projectRoot, '.movement-media-trash', 'linked');
  fs.symlinkSync(f.projectRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.service.resolveProjectTrashPreview(...f.ids, 'linked', 'img', 'cover.png'), /Linked/);
  f.service.restoreProjectMedia(...f.ids, ...args);
  assert.throws(() => f.service.resolveProjectTrashPreview(...f.ids, ...args));
  assert.equal(fs.readFileSync(path.join(f.projectRoot, item.type, item.filename), 'utf8'), `bytes:${item.filename}`);
});

test('desktop trash streaming provides correct ranges, lengths, HEAD and invalid-range responses', async t => {
  const f = setup(t);
  const { trashPreviewResponse } = require(path.join(applicationRoot, 'desktop/services/media-trash-service.cjs'));
  const file = path.join(f.projectRoot, 'audio', 'range.mp3');
  fs.writeFileSync(file, '0123456789');
  const request = (range, method = 'GET') => new Request('https://example.invalid/', { method, headers: range ? { Range: range } : {} });
  const partial = trashPreviewResponse(file, request('bytes=2-5'));
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(partial.headers.get('Content-Length'), '4');
  assert.equal(await partial.text(), '2345');
  assert.equal(await trashPreviewResponse(file, request('bytes=-3')).text(), '789');
  assert.equal(await trashPreviewResponse(file, request()).text(), '0123456789');
  const head = trashPreviewResponse(file, request(null, 'HEAD'));
  assert.equal(head.headers.get('Content-Length'), '10');
  assert.equal(await head.text(), '');
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=1-2,4-5', 'invalid']) {
    assert.equal(trashPreviewResponse(file, request(range)).status, 416);
  }
});

test('real desktop media UI confirmation, cancellation, dirty state and restoration', {
  skip: process.env.MOVEMENT_TEST_MEDIA_TRASH_BROWSER !== '1'
}, t => {
  const f = setup(t);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOVEMENT_ELECTRON_SMOKE_TEST;
  const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/media-trash-browser.cjs'),
    applicationRoot, f.root], { windowsHide: true, encoding: 'utf8', env, timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /MEDIA_TRASH_BROWSER_OK/);
});
