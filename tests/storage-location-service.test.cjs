const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  getPortableStorageLocationLabel,
  getStorageLocationLabel,
  prepareWritableStorageRoot,
  resolvePackagedStorageRoot,
  resolvePortableStorageRoot
} = require('../desktop/services/storage-location-service.cjs');

function makeTemporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'movement-storage-location-'));
}

function cleanTemporaryRoot(temporaryRoot) {
  const resolved = path.resolve(temporaryRoot);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^movement-storage-location-/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('packaged storage is located beneath the user Documents folder', () => {
  const documentsRoot = path.resolve('C:\\Users\\Test Person\\Documents');
  assert.equal(
    resolvePackagedStorageRoot(documentsRoot),
    path.join(
      documentsRoot,
      'Movement Timeline Studio',
      'private-data',
      'slidedeck'
    )
  );
});

test('portable storage is located beside the extracted executable', () => {
  const executablePath = path.resolve(
    'C:\\Users\\Test Person\\Movement Kit\\Movement Timeline Studio.exe'
  );
  assert.equal(
    resolvePortableStorageRoot(executablePath),
    path.join(path.dirname(executablePath), 'workspace')
  );
  assert.equal(getPortableStorageLocationLabel(), 'Extracted application / workspace');
});

test('storage preparation creates nested folders and leaves no write probe', t => {
  const temporaryRoot = makeTemporaryRoot();
  t.after(() => cleanTemporaryRoot(temporaryRoot));
  const storageRoot = path.join(temporaryRoot, 'Documents', 'Movement', 'slidedeck');

  assert.equal(prepareWritableStorageRoot(storageRoot), path.resolve(storageRoot));
  assert.equal(fs.statSync(storageRoot).isDirectory(), true);
  assert.deepEqual(
    fs.readdirSync(storageRoot).filter(name => name.startsWith('.movement-write-test-')),
    []
  );
});

test('storage preparation preserves existing project files', t => {
  const temporaryRoot = makeTemporaryRoot();
  t.after(() => cleanTemporaryRoot(temporaryRoot));
  const storageRoot = path.join(temporaryRoot, 'slidedeck');
  const existingProject = path.join(storageRoot, 'Stories', 'welcome', 'flow.json');
  fs.mkdirSync(path.dirname(existingProject), { recursive: true });
  fs.writeFileSync(existingProject, '{"title":"Welcome"}', 'utf8');

  prepareWritableStorageRoot(storageRoot);

  assert.equal(fs.readFileSync(existingProject, 'utf8'), '{"title":"Welcome"}');
});

test('storage preparation rejects an unavailable project library', t => {
  const temporaryRoot = makeTemporaryRoot();
  t.after(() => cleanTemporaryRoot(temporaryRoot));
  const blockingFile = path.join(temporaryRoot, 'not-a-folder');
  fs.writeFileSync(blockingFile, 'blocked', 'utf8');

  assert.throws(
    () => prepareWritableStorageRoot(path.join(blockingFile, 'slidedeck')),
    error => error.code === 'STORAGE_NOT_WRITABLE'
      && /cannot write to its project library/i.test(error.message)
  );
});

test('storage paths must be absolute and renderer labels do not expose them', () => {
  assert.throws(
    () => resolvePackagedStorageRoot('Documents'),
    /must be an absolute path/
  );
  assert.throws(
    () => prepareWritableStorageRoot('private-data/slidedeck'),
    /must be an absolute path/
  );
  assert.throws(
    () => resolvePortableStorageRoot('Movement Timeline Studio.exe'),
    /must be an absolute path/
  );
  assert.equal(
    getStorageLocationLabel(true),
    'Documents / Movement Timeline Studio / private-data / slidedeck'
  );
  assert.equal(
    getStorageLocationLabel(false),
    'Development project / private-data / slidedeck'
  );
});
