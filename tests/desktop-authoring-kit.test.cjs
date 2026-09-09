const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createAuthoringKitConfig,
  validateManifest
} = require('../tools/build-authoring-kit.cjs');
const { verifyAuthoringKit } = require('../tools/verify-authoring-kit.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
);
const kitManifest = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, 'distribution', 'desktop-authoring-kit.manifest.json'),
    'utf8'
  )
);

test('Desktop Authoring Kit uses an explicit source allowlist', () => {
  const validated = validateManifest(kitManifest);
  const positivePatterns = validated.files.filter(pattern => !pattern.startsWith('!'));

  for (const requiredPattern of [
    'desktop/**/*',
    'shared/frontend/**/*',
    'studio/**/*',
    'effects/**/*',
    'transitions/**/*',
    'docs/EFFECT_AUTHORING_CONTRACT.md',
    'docs/TRANSITION_AUTHORING_CONTRACT.md'
  ]) {
    assert.ok(
      positivePatterns.includes(requiredPattern),
      `${requiredPattern} must be included`
    );
  }

  assert.equal(positivePatterns.some(pattern => pattern.endsWith('.php')), false);
  assert.equal(positivePatterns.some(pattern => pattern.startsWith('server/')), false);
  assert.equal(positivePatterns.some(pattern => pattern.startsWith('private-data/')), false);

  for (const exclusion of [
    '!examples/**/backups/**/*',
    '!examples/**/*.save.lock',
    '!examples/**/.movement-media-trash/**/*'
  ]) {
    assert.ok(validated.files.includes(exclusion), `${exclusion} must be excluded`);
  }

  for (const forbiddenPath of ['backups', '.save.lock', '.movement-media-trash']) {
    assert.ok(validated.forbiddenPaths.includes(forbiddenPath), `${forbiddenPath} must be forbidden`);
  }
});

test('Desktop Authoring Kit is source-visible and does not change installer packaging', () => {
  const config = createAuthoringKitConfig(packageManifest, validateManifest(kitManifest));
  const desktopMain = fs.readFileSync(path.join(repositoryRoot, 'desktop', 'main.cjs'), 'utf8');

  assert.equal(config.asar, false);
  assert.equal(config.win.target[0].target, 'zip');
  assert.deepEqual(config.win.target[0].arch, ['x64']);
  assert.match(config.win.artifactName, /Authoring-Kit/);
  assert.equal(
    config.extraFiles.some(item => item.to.startsWith('workspace')),
    false
  );
  assert.equal(packageManifest.build.asar, true);
  assert.equal(packageManifest.build.win.target[0].target, 'nsis');
  assert.match(desktopMain, /isAuthoringKit[\s\S]*resolvePortableStorageRoot\(process\.execPath\)/);
});

test('Desktop Authoring Kit required source files exist in the repository', () => {
  for (const relativePath of kitManifest.requiredPaths) {
    const absolutePath = path.join(repositoryRoot, ...relativePath.split('/'));
    assert.ok(fs.existsSync(absolutePath), `missing source file: ${relativePath}`);
  }
});

test('Desktop Authoring Kit verifier rejects generated example state', async t => {
  for (const relativePath of [
    'examples/test-project/backups/flow-old.json',
    'examples/test-project/.save.lock',
    'examples/test-project/.movement-media-trash/item/metadata.json'
  ]) {
    await t.test(relativePath, () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-authoring-kit-'));
      try {
        const applicationRoot = path.join(fixtureRoot, 'resources', 'app');
        const fixtureManifest = {
          ...kitManifest,
          requiredPaths: [],
          forbiddenExtensions: []
        };
        fs.mkdirSync(path.join(applicationRoot, 'distribution'), { recursive: true });
        fs.writeFileSync(
          path.join(applicationRoot, 'distribution', 'desktop-authoring-kit.manifest.json'),
          JSON.stringify(fixtureManifest)
        );
        const forbiddenFile = path.join(applicationRoot, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(forbiddenFile), { recursive: true });
        fs.writeFileSync(forbiddenFile, 'generated state');

        assert.throws(
          () => verifyAuthoringKit(fixtureRoot),
          new RegExp(`forbidden path: ${relativePath.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`)
        );
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});
