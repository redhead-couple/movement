const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const applicationRoot = path.resolve(process.env.MOVEMENT_DESKTOP_TEST_ROOT || path.join(__dirname, '..'));
const workspaceModule = path.join(applicationRoot, 'desktop/services/workspace-service.cjs');
const { createWorkspaceService } = require(workspaceModule);

// End a separate process without unwinding finally blocks, at the actual
// filesystem boundaries of the production import. No production test hooks.
const childSource = `
const fs = require('node:fs');
const path = require('node:path');
const [modulePath, fixture, type, filename, phase] = process.argv.slice(1);
const { createWorkspaceService } = require(modulePath);
const copy = fs.copyFileSync;
const rename = fs.renameSync;
fs.copyFileSync = function (source, target, ...args) {
  if (target.endsWith('.import') && (phase === 'during-copy' || phase === 'copy-error')) {
    fs.writeFileSync(target, fs.readFileSync(source).subarray(0, 12), { flag: 'wx' });
    if (phase === 'during-copy') process.exit(73);
    throw Object.assign(new Error('Simulated disk full'), { code: 'ENOSPC' });
  }
  return copy.call(this, source, target, ...args);
};
fs.renameSync = function (source, target, ...args) {
  if (source.endsWith('.import')) {
    if (phase === 'before-commit') process.exit(73);
    if (phase === 'rename-error') {
      throw Object.assign(new Error('Simulated file busy'), { code: 'EBUSY' });
    }
  }
  const result = rename.call(this, source, target, ...args);
  if (source.endsWith('.import') && phase === 'after-commit') process.exit(73);
  return result;
};
const service = createWorkspaceService({
  examplesRoot: path.join(fixture, 'examples'), storageRoot: path.join(fixture, 'storage')
});
try {
  const result = service.importProjectMedia(service.getCurrentWorkspace().id,
    'story', type, path.join(fixture, 'incoming', filename), true);
  if (phase.endsWith('-error')) throw new Error('Expected failure was not raised');
  if (result.disposition !== 'replaced') throw new Error('Expected replacement');
} catch (error) {
  if (phase === 'copy-error' && error.code === 'ENOSPC') process.exit(74);
  if (phase === 'rename-error' && error.code === 'EBUSY') process.exit(74);
  throw error;
}
`;

for (const type of ['img', 'speech', 'audio']) {
  for (const phase of ['normal', 'during-copy', 'before-commit', 'after-commit', 'copy-error', 'rename-error']) {
    test(`${type} replacement preserves complete media across ${phase}`, t => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-media-recovery-'));
      t.after(() => {
        assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
        assert.match(path.basename(fixture), /^movement-media-recovery-/);
        fs.rmSync(fixture, { recursive: true, force: true });
      });
      const paths = { examplesRoot: path.join(fixture, 'examples'),
        storageRoot: path.join(fixture, 'storage') };
      const projectRoot = path.join(paths.storageRoot, 'alice', 'story');
      const mediaRoot = path.join(projectRoot, type);
      const filename = type === 'img' ? 'cover.png' : 'voice.mp3';
      const signature = type === 'img'
        ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : Buffer.from('ID3');
      const original = Buffer.concat([signature, Buffer.alloc(8192, 11)]);
      const replacement = Buffer.concat([signature, Buffer.alloc(16384, 22)]);
      fs.mkdirSync(mediaRoot, { recursive: true });
      fs.mkdirSync(path.join(fixture, 'incoming'));
      const destination = path.join(mediaRoot, filename);
      const incoming = path.join(fixture, 'incoming', filename);
      fs.writeFileSync(destination, original);
      fs.writeFileSync(incoming, replacement);
      const flow = JSON.stringify({ schemaVersion: 2, title: 'Recovery test', slides: [{
        background: type === 'img' ? { src: filename } : {},
        audioLayers: type === 'img' ? [] : [{ src: `${type}/${filename}` }]
      }] });
      fs.writeFileSync(path.join(projectRoot, 'flow.json'), flow);
      const child = spawnSync(process.execPath, ['-e', childSource,
        workspaceModule, fixture, type, filename, phase],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      const expectedExit = phase === 'normal' ? 0 : phase.endsWith('-error') ? 74 : 73;
      assert.equal(child.status, expectedExit, `${child.stdout}\n${child.stderr}`);
      const expected = ['normal', 'after-commit'].includes(phase) ? replacement : original;
      // Check before reopening as well: a crash must never leave a missing name.
      assert.deepEqual(fs.readFileSync(destination), expected);
      const restarted = createWorkspaceService(paths);
      const workspaceId = restarted.getCurrentWorkspace().id;
      assert.deepEqual(restarted.listProjectMedia(workspaceId, 'story', type), [filename]);
      const resolved = restarted.resolveProjectAssetPath(workspaceId, 'story', `${type}/${filename}`);
      assert.deepEqual(fs.readFileSync(resolved), expected);
      assert.equal(fs.readFileSync(path.join(projectRoot, 'flow.json'), 'utf8'), flow);
      assert.deepEqual(fs.readFileSync(incoming), replacement);
      assert.equal(fs.readdirSync(mediaRoot).some(name => name.endsWith('.previous')), false);
      if (phase === 'normal' || phase.endsWith('-error')) {
        assert.deepEqual(fs.readdirSync(mediaRoot), [filename], 'clean up failed copies');
      }
      // A later replacement still works after an interrupted/failed operation.
      assert.equal(restarted.importProjectMedia(workspaceId, 'story', type, incoming, true).disposition, 'replaced');
      assert.deepEqual(fs.readFileSync(destination), replacement);
    });
  }
}
