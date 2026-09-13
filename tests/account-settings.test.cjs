const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function php(code, database) {
  const result = spawnSync('php', ['-r', code, database], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function fixture() {
  // Copy only source into a disposable site; never load real config or user data.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-account-test-'));
  const core = path.join(directory, 'server/core');
  fs.mkdirSync(core, { recursive: true });
  fs.mkdirSync(path.join(directory, 'sessions'));
  fs.mkdirSync(path.join(directory, 'assets'));
  for (const name of ['app.css', 'account-settings.js']) {
    fs.copyFileSync(path.join(root, 'assets', name), path.join(directory, 'assets', name));
  }
  for (const name of fs.readdirSync(path.join(root, 'server/core'))) {
    if (name.endsWith('.php') && !name.startsWith('app-config') && name !== 'db.php') {
      fs.copyFileSync(path.join(root, 'server/core', name), path.join(core, name));
    }
  }
  for (const name of ['account-settings.php', 'dashboard.php', 'feed.php',
    'login.php', 'logout.php', 'forgot-password.php', 'reset-password.php']) {
    fs.copyFileSync(path.join(root, name), path.join(directory, name));
  }
  fs.writeFileSync(path.join(core, 'app-config.php'), '<?php $APP_ENVIRONMENT = "development";');
  // SQLite adapter only translates the existing MySQL login DDL/time expression.
  // Controllers, password functions, CSRF/session guards, and reset code are real.
  fs.writeFileSync(path.join(core, 'db.php'), `<?php
class AccountTestPDO extends PDO {
    public function exec(string $statement): int|false {
        if (str_contains($statement, 'CREATE TABLE IF NOT EXISTS login_attempts')) return 0;
        return parent::exec($statement);
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $query = str_replace('(NOW() - INTERVAL 15 MINUTE)', "datetime('now', '-15 minutes')", $query);
        return parent::prepare($query, $options);
    }
}
function db(): PDO {
    static $pdo;
    return $pdo ??= new AccountTestPDO('sqlite:' . dirname(__DIR__, 2) . '/test.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}
`);
  const database = path.join(directory, 'test.sqlite');
  php(`$pdo = new PDO('sqlite:' . $argv[1]);
    $pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT, created_at TEXT)');
    $pdo->exec('CREATE TABLE login_attempts (id INTEGER PRIMARY KEY, login_identifier TEXT, ip BLOB, attempted_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    $pdo->exec('CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY, user_id INTEGER, token_hash TEXT, expires_at TEXT, used_at TEXT, created_at TEXT, request_ip BLOB)');
    $pdo->exec('CREATE TABLE password_reset_attempts (id INTEGER PRIMARY KEY, purpose TEXT, email_hash TEXT, ip BLOB, attempted_at TEXT)');
    $insert = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
    $insert->execute([1, 'alice', 'alice@example.test', password_hash('old-password', PASSWORD_DEFAULT)]);
    $insert->execute([2, 'bob<&>', 'bob+<tag>@example.test', password_hash('bob-password', PASSWORD_DEFAULT)]);
  `, database);
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const child = spawn('php', ['-d', `session.save_path=${path.join(directory, 'sessions')}`,
    '-S', `127.0.0.1:${port}`, '-t', directory], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const stop = async () => {
    if (child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  };
  function client(initialCookie = '') {
    let cookie = initialCookie;
    return {
      get cookie() { return cookie; },
      async request(url, fields) {
        const body = fields === undefined ? null : new URLSearchParams(fields).toString();
        const response = await new Promise((resolve, reject) => {
          const request = http.request({ hostname: '127.0.0.1', port, path: url,
            method: body === null ? 'GET' : 'POST', headers: {
              Cookie: cookie,
              ...(body === null ? {} : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }),
            } }, response => {
            let html = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { html += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, html }));
          });
          request.on('error', reject);
          request.end(body);
        });
        for (const value of response.headers['set-cookie'] ?? []) {
          if (value.startsWith('PHPSESSID=')) cookie = value.split(';')[0];
        }
        return response;
      },
    };
  }
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await client().request('/login.php'); return { client, database, port, stop }; }
      catch { await pause(25); }
    }
    throw new Error(`Test PHP server did not start: ${errors}`);
  } catch (error) { await stop(); throw error; }
}

function token(response, action) {
  const form = response.html.match(new RegExp(`<form[^>]*action="${action}"[^>]*>([\\s\\S]*?)</form>`));
  assert.ok(form, `Missing form for ${action}`);
  return form[1].match(/name="form_token" value="([^"]+)"/)[1];
}

async function login(client, login = 'alice', password = 'old-password') {
  const page = await client.request('/login.php');
  await pause(1100);
  return client.request('/login.php', { form_token: token(page, ''), login, password });
}

test('account settings requests use the existing authentication and password flows', async t => {
  const site = await fixture();
  t.after(site.stop);
  const guest = site.client();
  const alice = site.client();
  let guard;
  const hashes = () => JSON.parse(php(`$pdo = new PDO('sqlite:' . $argv[1]); echo json_encode($pdo->query('SELECT id, password_hash FROM users ORDER BY id')->fetchAll(PDO::FETCH_KEY_PAIR));`, site.database));
  const originalHashes = hashes();

  await t.test('logged-out GET and POST redirect to login; feed hides settings', async () => {
    for (const url of ['/account-settings.php', '/dashboard.php']) {
      for (const fields of [undefined, { user_id: '1', new_password: 'attack-password' }]) {
        const response = await guest.request(url, fields);
        assert.equal(response.status, 302);
        assert.equal(response.headers.location, '/login.php');
        assert.doesNotMatch(response.html, /alice@example|name="new_password"/);
      }
    }
    assert.doesNotMatch((await guest.request('/feed.php')).html, /href="\/account-settings.php"/);
    assert.deepEqual(hashes(), originalHashes);
  });

  await t.test('existing login works; authenticated navigation and read-only details render', async () => {
    const response = await login(alice);
    assert.equal(response.headers.location, '/dashboard.php');
    for (const url of ['/dashboard.php', '/feed.php', '/account-settings.php']) {
      const page = await alice.request(url);
      assert.equal(page.status, 200);
      assert.match(page.html, /href="\/account-settings.php"[^>]*>Account settings<\/a>/);
    }
    const page = await alice.request('/account-settings.php?user_id=2');
    assert.match(page.html, /<span>alice<\/span>/);
    assert.match(page.html, /<span>alice@example.test<\/span>/);
    assert.match(page.html, /Back to My Library/);
    assert.match(page.headers['cache-control'], /no-store/);
    assert.doesNotMatch(page.html, /name="(?:user_id|username|email)"/);
    assert.ok(!page.html.includes(originalHashes['1']));
    guard = token(page, '/account-settings.php');
    await pause(2100);
  });

  const valid = () => ({ form_token: guard, current_password: 'old-password', new_password: 'new-password', confirm_password: 'new-password' });
  await t.test('CSRF, honeypot, required fields, length, confirmation, and current password are enforced', async () => {
    const cases = [
      [{ form_token: '' }, /session expired/],
      [{ form_token: 'wrong' }, /session expired/],
      [{ website: 'bot' }, /could not verify/],
      [{ current_password: '' }, /fill in all password fields/],
      [{ new_password: '' }, /fill in all password fields/],
      [{ confirm_password: '' }, /fill in all password fields/],
      [{ new_password: 'short', confirm_password: 'short' }, /at least 6 characters/],
      [{ confirm_password: 'different' }, /confirmation do not match/],
      [{ current_password: 'incorrect' }, /Current password is incorrect/],
      [{ new_password: 'old-password', confirm_password: 'old-password' }, /different from the current password/],
      [{ current_password: undefined, 'current_password[]': 'old-password' }, /fill in all password fields/],
    ];
    for (const [overrides, message] of cases) {
      const fields = { ...valid(), ...overrides };
      for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
      const page = await alice.request('/account-settings.php', fields);
      assert.equal(page.status, 200);
      assert.match(page.html, /role="alert"/);
      assert.match(page.html, /<details id="password-settings"[^>]* open>/);
      assert.doesNotMatch(page.html, /id="password-success"/);
      assert.match(page.html, message);
      assert.doesNotMatch(page.html, /value="(?:old-password|new-password|incorrect)"/);
      assert.deepEqual(hashes(), originalHashes);
    }
    await alice.request('/account-settings.php?current_password=old-password&new_password=attack-password&confirm_password=attack-password');
    assert.deepEqual(hashes(), originalHashes);
  });

  await t.test('valid submission changes only session account and rotates session/CSRF', async () => {
    const oldCookie = alice.cookie;
    const page = await alice.request('/account-settings.php', { ...valid(), user_id: '2', username: 'bob<&>', email: 'changed@example.test' });
    assert.match(page.html, /role="status"/);
    assert.match(page.html, /Your password has been changed\./);
    assert.match(page.html, /id="password-success"[^>]*aria-live="polite"[^>]*tabindex="-1"/);
    assert.match(page.html, /<details id="password-settings" class="password-settings">/);
    assert.match(page.html, /<summary class="button">Change password<\/summary>/);
    assert.doesNotMatch(page.html, /value="(?:old-password|new-password)"/);
    assert.match(page.html, /<span>alice@example.test<\/span>/);
    assert.notEqual(alice.cookie, oldCookie);
    assert.notEqual(token(page, '/account-settings.php'), guard);
    assert.notEqual(hashes()['1'], originalHashes['1']);
    assert.equal(hashes()['2'], originalHashes['2']);
    const replay = await alice.request('/account-settings.php', valid());
    assert.match(replay.html, /session expired/);
    const stale = site.client(oldCookie);
    // PHP rejects the destroyed old session, even if a browser reuses its cookie.
    assert.equal((await stale.request('/account-settings.php')).headers.location, '/login.php');
    assert.equal((await alice.request('/account-settings.php')).status, 200);
  });

  await t.test('old password stops working, new password logs in, and logout remains guarded', async () => {
    const fresh = site.client();
    assert.match((await login(fresh)).html, /Invalid login or password/);
    const response = await login(fresh, 'alice@example.test', 'new-password');
    assert.equal(response.headers.location, '/dashboard.php');
    const page = await fresh.request('/account-settings.php');
    const logout = await fresh.request('/logout.php', { form_token: token(page, '/logout.php') });
    assert.equal(logout.status, 302);
    assert.equal((await fresh.request('/account-settings.php')).headers.location, '/login.php');
  });

  await t.test('stored account text is escaped and accounts without a usable hash cannot set a password', async () => {
    const bob = site.client();
    assert.equal((await login(bob, 'bob<&>', 'bob-password')).headers.location, '/dashboard.php');
    const page = await bob.request('/account-settings.php');
    assert.match(page.html, /bob&lt;&amp;&gt;/);
    assert.match(page.html, /bob\+&lt;tag&gt;@example.test/);
    assert.doesNotMatch(page.html, /bob<&>|bob\+<tag>/);
    php(`$pdo = new PDO('sqlite:' . $argv[1]); $pdo->exec("UPDATE users SET password_hash = '' WHERE id = 2");`, site.database);
    const unavailable = await bob.request('/account-settings.php');
    assert.match(unavailable.html, /Password login is not available/);
    assert.doesNotMatch(unavailable.html, /name="current_password"/);
    await pause(2100);
    const submitted = await bob.request('/account-settings.php', { ...valid(), form_token: token(page, '/account-settings.php'), current_password: 'bob-password' });
    assert.match(submitted.html, /Password changes are unavailable/);
    assert.equal(hashes()['2'], '');
  });

  await t.test('existing reset page still consumes a token once and the reset password logs in', async () => {
    const resetToken = 'ab'.repeat(32);
    php(`$pdo = new PDO('sqlite:' . $argv[1]); $stmt = $pdo->prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (1, ?, datetime('now', '+1 hour'), CURRENT_TIMESTAMP)"); $stmt->execute([hash('sha256', str_repeat('ab', 32))]);`, site.database);
    const recovery = site.client();
    const start = await recovery.request('/reset-password.php');
    const inspect = await recovery.request('/reset-password.php', { action: 'inspect', token: resetToken, form_token: token(start, '') });
    assert.match(inspect.html, /name="new_password"/);
    await pause(1100);
    const fields = { action: 'reset', token: resetToken, form_token: token(inspect, ''), new_password: 'reset-password', confirm_password: 'reset-password' };
    const reset = await recovery.request('/reset-password.php', fields);
    assert.match(reset.html, /Your password has been reset/);
    const next = await recovery.request('/reset-password.php');
    const used = await recovery.request('/reset-password.php', { action: 'inspect', token: resetToken, form_token: token(next, '') });
    assert.match(used.html, /invalid or has expired/);
    assert.equal((await login(site.client(), 'alice', 'reset-password')).headers.location, '/dashboard.php');
  });
});
