const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

test('password changes revoke old sessions at every web authorization boundary', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-session-revocation-'));
  let child, stopped, log = '';
  t.after(async () => {
    if (child && child.exitCode === null) child.kill();
    if (stopped) await stopped;
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-session-revocation-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (name, content) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  for (const file of ['login.php', 'server/core/login-throttle.php', 'signup.php', 'account-settings.php', 'reset-password.php',
    'player.php', 'media.php', 'server/core/app-init.php', 'server/core/auth-check.php',
    'server/core/current-user.php', 'server/core/current-user-record.php',
    'server/core/require-guest.php', 'server/core/security-helpers.php',
    'server/core/web-session.php', 'server/core/config-loader.php', 'server/core/password-reset.php',
    'server/core/project-paths.php', 'server/core/response.php', '404.php', 'not-found.php',
    'templates/player/player-page-template.php', 'studio/player/player-runtime.js', 'assets/app.css']) {
    write(file, fs.readFileSync(path.join(root, file)));
  }
  // Only the database connection/dialect is substituted. All controllers,
  // guards, password operations and PHP cookie sessions are production code.
  write('server/core/db.php', `<?php
class SessionTestPdo extends PDO {
    public function exec(string $statement): int|false {
        if (str_contains($statement, 'CREATE TABLE IF NOT EXISTS login_attempts')) return 0;
        return parent::exec($statement);
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare(str_replace('NOW() - INTERVAL 15 MINUTE',
            "datetime('now', '-15 minutes')", $query), $options);
    }
}
function db(): PDO {
    if (file_exists(dirname(__DIR__, 2) . '/db-unavailable')) throw new RuntimeException('SYNTHETIC_DB_FAILURE');
    static $pdo;
    return $pdo ??= new SessionTestPdo('sqlite:' . dirname(__DIR__, 2) . '/test.sqlite', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
}`);
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development'; $APP_HTTPS_ORIGIN = 'https://accounts.example.test';");
  write('guard.php', `<?php require 'server/core/security-helpers.php';
    $form = $_GET['form']; $guard = ensureFormGuard($form);
    $_SESSION['form_guards'][$form]['started_at'] = time() - 5;
    header('Content-Type: application/json'); echo json_encode($guard);`);
  write('identity.php', `<?php require 'server/core/auth-check.php';
    header('Content-Type: application/json'); echo json_encode(['username' => $_SESSION['username']]);`);
  fs.mkdirSync(path.join(dir, 'sessions'));
  function php(code, input = {}) {
    const result = spawnSync('php', ['-r', code], { cwd: dir, input: JSON.stringify(input),
      encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.stderr, '');
    return result.stdout;
  }
  php(`require 'server/core/db.php'; $pdo = db();
    $pdo->exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT COLLATE NOCASE UNIQUE, email TEXT COLLATE NOCASE UNIQUE,
      password_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE login_attempts (id INTEGER PRIMARY KEY, login_identifier TEXT COLLATE NOCASE,
      ip BLOB, attempted_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY, user_id INTEGER,
      token_hash TEXT, expires_at TEXT, used_at TEXT, created_at TEXT, request_ip BLOB);
      CREATE TABLE password_reset_attempts (id INTEGER PRIMARY KEY, purpose TEXT,
      email_hash TEXT, ip BLOB, attempted_at TEXT);");
    $stmt = $pdo->prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
    foreach (['alice', 'bob'] as $name) $stmt->execute([$name, $name . '@example.test',
      password_hash($name . '-password', PASSWORD_DEFAULT)]);`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(44 + 16000 * 5);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (const published of [false, true]) {
    const base = `private-data/slidedeck/alice/${published ? 'public' : 'draft'}/`;
    write(base + 'flow.json', JSON.stringify({ schemaVersion: 2, title: 'Session fixture',
      isPublished: published, slides: [{ text: '<b>Public playback</b>', seconds: 60,
        background: { src: 'img/pixel.png' }, audioLayers: [{ src: 'speech/voice.wav' }] }] }));
    write(base + 'img/pixel.png', png);
    write(base + 'speech/voice.wav', wav);
    write(base + 'backups/flow-old.json', '{"title":"PRIVATE_BACKUP"}');
  }
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  child = spawn('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`,
    '-S', `127.0.0.1:${port}`, '-t', dir], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  stopped = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', data => { log += data; });
  function request(jar, url, body) {
    return new Promise((resolve, reject) => {
      const encoded = body ? new URLSearchParams(body).toString() : null;
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(jar.cookie ? { Cookie: jar.cookie } : {}), ...(encoded ? {
          'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(encoded) } : {}) } }, res => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('end', () => {
          for (const cookie of res.headers['set-cookie'] || []) {
            if (cookie.startsWith('PHPSESSID=')) jar.cookie = cookie.split(';')[0];
          }
          resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(parts),
            body: Buffer.concat(parts).toString() });
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
      req.on('error', reject); req.end(encoded);
    });
  }
  for (let i = 0; i < 100; i++) {
    try { await request({}, '/login.php'); break; } catch (error) {
      if (i === 99) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  async function form(jar, url, name, values) {
    const guard = await request(jar, `/guard.php?form=${name}`);
    assert.equal(guard.status, 200, guard.body);
    return request(jar, url, { form_token: JSON.parse(guard.body).token, website: '', ...values });
  }
  const login = (jar, user, password) => form(jar, '/login.php', 'login', { login: user, password });
  const identity = jar => request(jar, '/identity.php');
  function issueReset(email, token) {
    const result = JSON.parse(php(`require 'server/core/db.php'; require 'server/core/password-reset.php';
      $input = json_decode(file_get_contents('php://stdin'), true);
      $result = requestPasswordReset(db(), $input['email'], inet_pton('192.0.2.50'),
        static fn ($recipient, $url, $ttl) => str_contains($url, '#token=' . $input['token']),
        null, static fn () => $input['token']); echo json_encode($result);`, { email, token }));
    assert.equal(result.mailSent, true);
  }
  const inspectReset = token => form({}, '/reset-password.php', 'reset_password', { action: 'inspect', token });
  const oldReset = 'b'.repeat(64), otherReset = 'c'.repeat(64), freshReset = 'a'.repeat(64);
  const playerUrl = '/player.php?username=alice&project=public';
  const media = (project, name) => `/media.php?p=alice/${project}/${name}`;
  const a = {}, b = {}, other = {};
  await t.test('ordinary username/email login, session rotation and signup stay usable', async () => {
    for (const [jar, user, password] of [[a, 'alice', 'alice-password'], [b, 'alice@example.test', 'alice-password'], [other, 'bob', 'bob-password']]) {
      const response = await login(jar, user, password);
      assert.equal(response.status, 302, response.body);
      assert.equal(response.headers.location, '/dashboard.php');
      assert.equal((await identity(jar)).status, 200);
    }
    const newcomer = {};
    const response = await form(newcomer, '/signup.php', 'signup', { username: 'newcomer', email: 'new@example.test', password: 'new-password' });
    assert.equal(response.status, 302, response.body);
    assert.equal((await identity(newcomer)).body, '{"username":"newcomer"}');
    assert.deepEqual((await request(a, media('draft', 'img/pixel.png'))).bytes, png);
  });
  // Preserve genuine pre-change session contents. Give each boundary its own
  // stale session so an earlier redirect cannot turn later checks into mere
  // guest tests by deleting the shared session file first.
  const oldSessionData = fs.readFileSync(path.join(dir, 'sessions', 'sess_' + b.cookie.split('=')[1]));
  let staleSessionNumber = 0;
  function staleSession() {
    const id = 'stalesession' + (++staleSessionNumber);
    write('sessions/sess_' + id, oldSessionData);
    return { cookie: 'PHPSESSID=' + id };
  }
  await t.test('changing the password keeps the changing session and revokes other sessions', async () => {
    issueReset('alice@example.test', oldReset);
    issueReset('bob@example.test', otherReset);
    assert.match((await inspectReset(oldReset)).body, /name="new_password"/);
    const response = await form(a, '/account-settings.php', 'change_password', {
      current_password: 'alice-password', new_password: 'changed-password', confirm_password: 'changed-password' });
    assert.equal(response.status, 200, response.body);
    assert.match(response.body, /Your password has been changed/);
    assert.equal((await identity(a)).status, 200);
    assert.equal((await identity(b)).status, 302);
    assert.equal((await identity(other)).status, 200);
  });
  await t.test('old reset link is rejected both on inspection and submission after password change', async () => {
    assert.match((await inspectReset(oldReset)).body, /This password reset link is invalid or has expired/);
    const response = await form({}, '/reset-password.php', 'reset_password', {
      action: 'reset', token: oldReset, new_password: 'unwanted-password', confirm_password: 'unwanted-password' });
    assert.match(response.body, /This password reset link is invalid or has expired/);
    assert.doesNotMatch(response.body, /Your password has been reset/);
    assert.equal((await identity(a)).status, 200);
    assert.match((await inspectReset(otherReset)).body, /name="new_password"/);
  });
  await t.test('revoked cookies cannot access drafts, private media or backups, but public playback stays available', async () => {
    for (const [url, status] of [['/identity.php', 302], ['/player.php?username=alice&project=draft', 404],
      [media('draft', 'flow.json'), 403], [media('draft', 'img/pixel.png'), 403],
      [media('public', 'backups/flow-old.json'), 403], [playerUrl, 200],
      [media('public', 'flow.json'), 200], [media('public', 'img/pixel.png'), 200]]) {
      const response = await request(staleSession(), url);
      assert.equal(response.status, status, url + response.body);
      assert.doesNotMatch(response.body, /PRIVATE_BACKUP/);
    }
    assert.deepEqual((await request(a, media('public', 'backups/flow-old.json'))).body, '{"title":"PRIVATE_BACKUP"}');
    assert.deepEqual((await request({}, media('public', 'speech/voice.wav'))).bytes, wav);
  });
  const fresh = {};
  await t.test('new password authenticates; a rejected password change does not revoke good sessions', async () => {
    const wrong = await login({}, 'alice', 'alice-password');
    assert.match(wrong.body, /Invalid login or password/);
    assert.equal((await login(fresh, 'alice@example.test', 'changed-password')).status, 302);
    issueReset('alice@example.test', freshReset);
    const failed = await form(a, '/account-settings.php', 'change_password', {
      current_password: 'wrong', new_password: 'unused-password', confirm_password: 'unused-password' });
    assert.match(failed.body, /Current password is incorrect/);
    assert.equal((await identity(a)).status, 200);
    assert.equal((await identity(fresh)).status, 200);
    assert.match((await inspectReset(freshReset)).body, /name="new_password"/);
  });
  await t.test('new reset link issued after password change works, revokes sessions and permits a fresh login', async () => {
    const resetter = {};
    const response = await form(resetter, '/reset-password.php', 'reset_password', {
      action: 'reset', token: freshReset, new_password: 'reset-password', confirm_password: 'reset-password' });
    assert.match(response.body, /Your password has been reset/);
    assert.equal((await request(fresh, media('draft', 'img/pixel.png'))).status, 403);
    assert.equal((await identity(a)).status, 302);
    assert.equal((await identity(fresh)).status, 302);
    assert.equal((await identity(other)).status, 200);
    const next = {};
    assert.equal((await login(next, 'alice', 'reset-password')).status, 302);
    assert.equal((await identity(next)).status, 200);
    assert.deepEqual((await request(next, media('draft', 'img/pixel.png'))).bytes, png);
    assert.match((await inspectReset(freshReset)).body, /This password reset link is invalid or has expired/);
  });
  await t.test('token revocation failure rolls back the password change and preserves the valid link and session', async () => {
    php(`require 'server/core/db.php'; db()->exec("CREATE TRIGGER fail_token_revocation
      BEFORE UPDATE ON password_reset_tokens BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_TOKEN_FAILURE'); END");`);
    try {
      const response = await form(other, '/account-settings.php', 'change_password', {
        current_password: 'bob-password', new_password: 'should-not-commit', confirm_password: 'should-not-commit' });
      assert.match(response.body, /Something went wrong while changing your password/);
      assert.doesNotMatch(response.body, /Your password has been changed/);
      assert.equal((await identity(other)).status, 200);
      assert.match((await inspectReset(otherReset)).body, /name="new_password"/);
      assert.equal((await login({}, 'bob', 'bob-password')).status, 302);
    } finally {
      php(`require 'server/core/db.php'; db()->exec('DROP TRIGGER fail_token_revocation');`);
    }
  });
  await t.test('sessions from before deployment must reauthenticate', async () => {
    write('sessions/sess_legacysession', 'user_id|i:1;username|s:5:"alice";');
    assert.equal((await identity({ cookie: 'PHPSESSID=legacysession' })).status, 302);
    assert.equal((await request({ cookie: 'PHPSESSID=legacysession' }, playerUrl)).status, 200);
  });
  await t.test('database failure denies authenticated access while guests can still play public projects', async () => {
    write('db-unavailable', '1');
    assert.equal((await identity(other)).status, 302);
    assert.equal((await request({}, playerUrl)).status, 200);
    assert.deepEqual((await request({}, media('public', 'img/pixel.png'))).bytes, png);
    fs.unlinkSync(path.join(dir, 'db-unavailable'));
  });
  await t.test('public project actually plays in Chromium with an old session cookie', {
    skip: process.env.MOVEMENT_TEST_SESSION_BROWSER !== '1'
  }, () => {
    const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${port}${playerUrl}` };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'),
      dir, staleSession().cookie.split('=')[1]],
    { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)|SYNTHETIC_DB_FAILURE/.test(line)), []);
});
