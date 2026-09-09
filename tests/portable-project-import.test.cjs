const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return require('node:fs').readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

test('online portable ZIP import validates, normalizes, and installs conflict-safe projects', () => {
  const result = spawnSync(
    'php',
    [path.join('tests', 'php', 'portable-project-import.test.php')],
    {
      cwd: applicationRoot,
      encoding: 'utf8',
      timeout: 30000
    }
  );

  assert.equal(
    result.status,
    0,
    `PHP portable-import tests failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /PORTABLE_IMPORT_TEST_OK/);

  const editorEndpoint = read('json-maker.php');
  assert.match(editorEndpoint, /JSON_HEX_TAG/);
  assert.doesNotMatch(editorEndpoint, /echo file_exists\(\$flowFile\) \? file_get_contents/);
});
