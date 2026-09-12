const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');
const failure = 'Application configuration is unavailable.';

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-config-'));
  const root = path.join(parent, 'public_html');
  fs.mkdirSync(path.join(root, 'server/core'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sessions'));
  for (const file of ['config-loader.php', 'db.php', 'web-session.php', 'security-helpers.php', 'http-basic-auth.php']) {
    fs.copyFileSync(path.join(applicationRoot, 'server/core', file), path.join(root, 'server/core', file));
  }
  fs.copyFileSync(path.join(applicationRoot, 'admin-messages.php'), path.join(root, 'admin-messages.php'));
  t.after(() => {
    assert.equal(path.dirname(parent), path.resolve(os.tmpdir()));
    assert.ok(path.basename(parent).startsWith('movement-config-'));
    fs.rmSync(parent, { recursive: true, force: true });
  });
  return {
    parent, root,
    external: path.join(parent, 'app-config.php'),
    local: path.join(root, 'server/core/app-config.php'),
    run(source, options = []) {
      const result = spawnSync('php', ['-d', 'display_errors=1', '-d', `session.save_path=${path.join(root, 'sessions')}`, ...options], {
        cwd: root, input: `<?php\n${source}`, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, MOVEMENT_APP_ENV: 'development', MOVEMENT_HTTPS_ORIGIN: '', MOVEMENT_TRUST_PROXY: '0' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    },
  };
}

function config(marker) {
  return `<?php
$CONFIG_TEST_SOURCE = '${marker}';
$CONFIG_TEST_COUNT = ($CONFIG_TEST_COUNT ?? 0) + 1;
$DB_HOST = 'fixture.invalid'; $DB_PORT = '3306'; $DB_NAME = 'fixture';
$DB_USER = 'fixture'; $DB_PASS = 'SYNTHETIC_SECRET';
$ADMIN_USER = 'fixture'; $ADMIN_PASS = 'SYNTHETIC_ADMIN_SECRET';
$APP_ENVIRONMENT = 'production'; $APP_HTTPS_ORIGIN = 'https://example.test';
$PASSWORD_RESET_FROM_EMAIL = 'noreply@example.test';
`;
}

for (const order of [['web-session.php', 'db.php'], ['db.php', 'web-session.php']]) {
  test(`external config wins and is loaded once: ${order.join(' then ')}`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.external, config('external'));
    fs.writeFileSync(f.local, "<?php throw new RuntimeException('Local must never execute');");
    const output = f.run(`
$_SERVER['DOCUMENT_ROOT'] = '/untrusted/path';
require 'server/core/${order[0]}'; require 'server/core/${order[1]}';
echo json_encode([
  $CONFIG_TEST_SOURCE === 'external', $CONFIG_TEST_COUNT === 1,
  $DB_PASS === 'SYNTHETIC_SECRET', $ADMIN_PASS === 'SYNTHETIC_ADMIN_SECRET',
  $PASSWORD_RESET_FROM_EMAIL === 'noreply@example.test',
  productionHttpsRedirectUrl(['REQUEST_URI' => '/login.php']) === 'https://example.test/login.php',
  webSessionCookieOptions()['secure'] === true,
]);`);
    assert.deepEqual(JSON.parse(output), Array(7).fill(true));
  });
}

test('existing local config works when external config is absent', t => {
  const f = fixture(t);
  fs.writeFileSync(f.local, config('local') + "$APP_ENVIRONMENT = 'development';\n");
  assert.equal(f.run(`require 'server/core/web-session.php'; require 'server/core/db.php';
echo ($CONFIG_TEST_SOURCE === 'local' && !webSessionCookieOptions()['secure']) ? 'OK' : 'FAIL';`), 'OK');
});

test('external config works with no public configuration file', t => {
  const f = fixture(t);
  fs.writeFileSync(f.external, config('external'));
  assert.equal(f.run("require 'server/core/db.php'; echo MOVEMENT_CONFIG_LOADED ? 'OK' : 'FAIL';"), 'OK');
});

test('admin route uses external configuration without a public config file', t => {
  const f = fixture(t);
  fs.writeFileSync(f.external, config('external') + "$APP_ENVIRONMENT = 'development';\n");
  assert.equal(f.run("register_shutdown_function(function () { echo ':' . http_response_code(); }); require 'admin-messages.php';"), 'Unauthorized:401');
});

for (const invalid of ['directory', 'parse error', 'exception']) {
  test(`invalid external config fails safely without local fallback: ${invalid}`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.local, config('local'));
    if (invalid === 'directory') fs.mkdirSync(f.external);
    else fs.writeFileSync(f.external, invalid === 'parse error'
      ? '<?php SYNTHETIC_SECRET invalid syntax'
      : "<?php throw new RuntimeException('SYNTHETIC_SECRET');");
    assert.equal(f.run("register_shutdown_function(function () { echo ':' . http_response_code(); }); require 'server/core/db.php';"), `${failure}:500`);
  });
}

test('open_basedir denial fails safely instead of selecting the local config', t => {
  const f = fixture(t);
  fs.writeFileSync(f.external, config('external'));
  fs.writeFileSync(f.local, config('local'));
  assert.equal(f.run("require 'server/core/db.php'; echo 'UNEXPECTED';", ['-d', `open_basedir=${f.root}`]), failure);
});

test('missing configuration keeps environment-only sessions but blocks database setup', t => {
  const f = fixture(t);
  assert.equal(f.run("require 'server/core/web-session.php'; echo !MOVEMENT_CONFIG_LOADED ? 'OK' : 'FAIL';"), 'OK');
  assert.equal(f.run("require 'server/core/db.php'; echo 'UNEXPECTED';"), failure);
});
