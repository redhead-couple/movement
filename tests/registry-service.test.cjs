const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  REGISTRY_BACKUP_DIRECTORY,
  createRegistryService
} = require('../desktop/services/registry-service.cjs');

function makeFixture() {
  const applicationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-registry-service-'));
  fs.mkdirSync(path.join(applicationRoot, 'effects'), { recursive: true });
  fs.mkdirSync(path.join(applicationRoot, 'transitions'), { recursive: true });
  fs.writeFileSync(
    path.join(applicationRoot, 'effects', 'wave-engine.js'),
    'export function mount() {}',
    'utf8'
  );
  fs.writeFileSync(
    path.join(applicationRoot, 'effects', 'wave-maker.html'),
    '<base href="../"><script>const ENGINE = "wave"; import("/effects/wave-engine.js");</script>',
    'utf8'
  );
  fs.writeFileSync(
    path.join(applicationRoot, 'effects', 'orphan-engine.js'),
    'export function mount() {}',
    'utf8'
  );
  fs.writeFileSync(
    path.join(applicationRoot, 'transitions', 'soft-wipe-engine.js'),
    'export function runTransition() {}',
    'utf8'
  );
  fs.writeFileSync(
    path.join(applicationRoot, 'transitions', 'soft-wipe-maker.html'),
    '<script>const ENGINE = "soft-wipe";</script>',
    'utf8'
  );
  fs.writeFileSync(
    path.join(applicationRoot, 'effects', 'registry.json'),
    `${JSON.stringify([{ Category: 'Geometry', engines: 'wave, missing' }], null, 4)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(applicationRoot, 'transitions', 'registry.json'),
    `${JSON.stringify([{ Category: 'Wipes', engines: 'soft-wipe' }], null, 4)}\n`,
    'utf8'
  );
  return applicationRoot;
}

function cleanFixture(applicationRoot) {
  const resolved = path.resolve(applicationRoot);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^movement-registry-service-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('registry catalog exposes available and incomplete pairs without filesystem paths', t => {
  const applicationRoot = makeFixture();
  t.after(() => cleanFixture(applicationRoot));
  const service = createRegistryService({ applicationRoot });

  const result = service.listRegistries();

  assert.equal(result.writable, true);
  assert.deepEqual(result.effects.available, [{
    engine: 'orphan',
    maker: 'effects/orphan-maker.html',
    engineFile: 'effects/orphan-engine.js',
    status: 'needs-attention',
    warnings: ['Maker file is missing: effects/orphan-maker.html']
  }, {
    engine: 'wave',
    maker: 'effects/wave-maker.html',
    engineFile: 'effects/wave-engine.js',
    status: 'available',
    warnings: []
  }, {
    engine: 'missing',
    maker: 'effects/missing-maker.html',
    engineFile: 'effects/missing-engine.js',
    status: 'needs-attention',
    warnings: ['The expected maker and engine files were not found.']
  }]);
  assert.deepEqual(result.effects.invalidEntries, ['missing']);
  assert.match(result.effects.issues[0].reason, /Maker file is missing: effects\/orphan-maker\.html/);
  assert.equal(result.transitions.available[0].engine, 'soft-wipe');
  assert.equal(result.effects.registry.at(-1).Category, 'Experimental');
  assert.equal(result.transitions.registry.at(-1).Category, 'Experimental');
  assert.equal(JSON.stringify(result).includes(applicationRoot), false);
});

test('registry saves are revision checked, normalized, and backed up', t => {
  const applicationRoot = makeFixture();
  t.after(() => cleanFixture(applicationRoot));
  const service = createRegistryService({ applicationRoot, maxBackups: 2 });
  const initial = service.listRegistries();

  const saved = service.saveRegistry('effects', [{
    Category: ' Motion ',
    engines: ['wave']
  }], initial.effects.revision);

  assert.equal(saved.registry[0].Category, 'Motion');
  assert.equal(saved.registry[0].engines, 'wave');
  assert.notEqual(saved.revision, initial.effects.revision);
  assert.match(saved.backupName, /^effects-registry-.*\.json$/);
  assert.equal(
    fs.existsSync(path.join(applicationRoot, REGISTRY_BACKUP_DIRECTORY, saved.backupName)),
    true
  );
  assert.throws(
    () => service.saveRegistry(
      'effects',
      [{ Category: 'Motion', engines: ['wave'] }],
      initial.effects.revision
    ),
    error => error.code === 'REGISTRY_CHANGED'
  );
});

test('registry validation rejects duplicates and unsafe names but allows personal entries', t => {
  const applicationRoot = makeFixture();
  t.after(() => cleanFixture(applicationRoot));
  const service = createRegistryService({ applicationRoot });
  const revision = service.listRegistries().effects.revision;

  assert.throws(
    () => service.saveRegistry('effects', [
      { Category: 'One', engines: ['wave'] },
      { Category: 'Two', engines: ['wave'] }
    ], revision),
    error => error.code === 'DUPLICATE_ENGINE'
  );
  const personal = service.saveRegistry(
    'effects',
    [
      { Category: 'One', engines: ['missing'] },
      { Category: 'Experimental', engines: [] }
    ],
    revision
  );
  assert.equal(personal.registry[0].engines, 'missing');
  assert.throws(
    () => service.saveRegistry(
      'effects',
      [{ Category: 'One', engines: ['../outside'] }],
      personal.revision
    ),
    error => error.code === 'UNSAFE_ENGINE_NAME'
  );
});

test('sealed application registries can be inspected but not changed', t => {
  const applicationRoot = makeFixture();
  t.after(() => cleanFixture(applicationRoot));
  const service = createRegistryService({ applicationRoot, forceReadOnly: true });
  const catalog = service.listRegistries();

  assert.equal(catalog.writable, false);
  assert.match(catalog.writeBlockReason, /sealed application edition/i);
  assert.throws(
    () => service.saveRegistry(
      'transitions',
      [{ Category: 'Wipes', engines: ['soft-wipe'] }],
      catalog.transitions.revision
    ),
    error => error.code === 'REGISTRY_READ_ONLY'
  );
});
