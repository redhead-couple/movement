const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

test('invitation administration and registration enforce the full lifecycle', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-invitations-'));
  const children = [];
  const mysql = Boolean(process.env.MOVEMENT_TEST_MYSQL_BIN);
  t.after(async () => {
    for (const { child, stopped } of children.reverse()) {
      if (child.exitCode === null) child.kill();
      await stopped;
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-invitations-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  const launch = (exe, args) => {
    const child = spawn(exe, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const entry = { child, errors: '', stopped: new Promise(resolve => child.once('close', resolve)) };
    child.stderr.on('data', data => { entry.errors += data; });
    children.push(entry); return entry;
  };
  async function port() {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const number = socket.address().port; await new Promise(resolve => socket.close(resolve)); return number;
  }
  function php(source) {
    const result = spawnSync('php', ['-r', source], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 0, result.stderr + result.stdout); assert.equal(result.stderr, ''); return result.stdout;
  }
  for (const file of ['signup.php', 'login.php', 'admin-invitations.php',
    ...fs.readdirSync(path.join(root, 'server/core')).filter(f => f.endsWith('.php') && !f.startsWith('app-config'))
      .map(f => 'server/core/' + f)]) write(file, fs.readFileSync(path.join(root, file)));
  function configuration(value) {
    write('server/core/app-config.php', `<?php $APP_ENVIRONMENT='development';
      $ADMIN_USER='test-admin'; $ADMIN_PASS='synthetic-password';
      ${value === undefined ? '' : '$INVITE_ONLY_REGISTRATION=' + value + ';'}`);
  }
  configuration(undefined);
  let connection;
  if (mysql) {
    const bin = process.env.MOVEMENT_TEST_MYSQL_BIN, dbPort = await port(), data = path.join(dir, 'mysql');
    const init = spawnSync(path.join(bin, 'mysql_install_db.exe'), [`--datadir=${data}`,
      '--password=synthetic-test-password', `--port=${dbPort}`], { encoding: 'utf8', windowsHide: true, timeout: 45000 });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const database = launch(path.join(bin, 'mysqld.exe'), ['--no-defaults', `--basedir=${path.dirname(bin)}`,
      `--datadir=${data}`, `--port=${dbPort}`, '--bind-address=127.0.0.1', '--console']);
    connection = `new PDO('mysql:host=127.0.0.1;port=${dbPort};charset=utf8mb4', 'root', 'synthetic-test-password',
      [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC])`;
    for (let i = 0; i < 100; i++) {
      const probe = spawnSync('php', ['-r', `$pdo=${connection};`], { encoding: 'utf8', windowsHide: true });
      if (probe.status === 0) break;
      assert.ok(database.child.exitCode === null && i < 99, database.errors + probe.stderr);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    php(`$pdo=${connection}; $pdo->exec('CREATE DATABASE invitation_test');`);
  } else {
    connection = "new PDO('sqlite:' . __DIR__ . '/../../test.sqlite', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC])";
  }
  write('server/core/db.php', `<?php function db(): PDO {
    if (is_file(__DIR__ . '/../../db-unavailable')) throw new RuntimeException('SYNTHETIC_FAILURE');
    static $pdo; if ($pdo) return $pdo; $pdo=${connection};
    ${mysql ? "$pdo->exec('USE invitation_test');" : "$pdo->exec('PRAGMA busy_timeout=10000');"} return $pdo;
  }`);
  const schema = fs.readFileSync(path.join(root, 'server/migrations/2026-10-20-registration-invitations.sql.example'), 'utf8');
  write('schema.sql', schema);
  php(`require 'server/core/db.php'; $pdo=db();
    $pdo->exec('${mysql
      ? 'CREATE TABLE users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) UNIQUE, email VARCHAR(190) UNIQUE, password_hash VARCHAR(255)) ENGINE=InnoDB'
      : 'CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT COLLATE NOCASE UNIQUE, email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT)'}');
    ${mysql ? "$pdo->exec(file_get_contents('schema.sql'));" : "$pdo->exec('CREATE TABLE registration_invitations (id INTEGER PRIMARY KEY, email TEXT COLLATE NOCASE, token_hash TEXT UNIQUE, created_at TEXT, expires_at TEXT, used_at TEXT, revoked_at TEXT, used_by_user_id INTEGER)');"}
    $stmt=$pdo->prepare('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)');
    $stmt->execute(['owner','owner@example.test',password_hash('owner-password',PASSWORD_DEFAULT)]);`);
  write('guard.php', `<?php require 'server/core/security-helpers.php';
    $form=$_GET['form']; $guard=ensureFormGuard($form); $_SESSION['form_guards'][$form]['started_at']=time()-5;
    header('Content-Type: application/json'); echo json_encode($guard);`);
  write('dashboard.php', `<?php require 'server/core/auth-check.php'; echo 'Welcome ' . htmlspecialchars($_SESSION['username']);`);
  fs.mkdirSync(path.join(dir, 'sessions'));
  const ports = [await port(), await port()];
  const admin = 'Basic ' + Buffer.from('test-admin:synthetic-password').toString('base64');
  function request(jar, url, data, authorization, targetPort = ports[0]) {
    return new Promise((resolve, reject) => {
      const body = data ? new URLSearchParams(data).toString() : null;
      const req = http.request({ host: '127.0.0.1', port: targetPort, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(jar.cookie ? { Cookie: jar.cookie } : {}), ...(authorization ? { Authorization: authorization } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', data => { text += data; });
        res.on('end', () => {
          for (const cookie of res.headers['set-cookie'] || []) if (cookie.startsWith('PHPSESSID=')) jar.cookie = cookie.split(';')[0];
          assert.doesNotMatch(text, /Fatal error|Warning:|SYNTHETIC_FAILURE/);
          resolve({ status: res.statusCode, headers: res.headers, body: text });
        });
      });
      req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('HTTP timeout'))); req.end(body);
    });
  }
  for (const number of ports) {
    const entry = launch('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, '-S', `127.0.0.1:${number}`, '-t', dir]);
    for (let i = 0; i < 80; i++) {
      try { await request({}, '/signup.php', null, null, number); break; }
      catch { assert.ok(entry.child.exitCode === null && i < 79, entry.errors); await new Promise(resolve => setTimeout(resolve, 30)); }
    }
  }
  async function form(jar, url, formId, data, auth, targetPort) {
    const guard = JSON.parse((await request(jar, '/guard.php?form=' + formId)).body);
    return request(jar, url, { form_token: guard.token, website: '', ...data }, auth, targetPort);
  }
  const query = sql => JSON.parse(php(`require 'server/core/db.php'; echo json_encode(db()->query(${JSON.stringify(sql)})->fetchAll());`));
  const execute = sql => php(`require 'server/core/db.php'; db()->exec(${JSON.stringify(sql)});`);
  async function create(email) {
    const jar = {};
    const response = await form(jar, '/admin-invitations.php', 'admin_invitations', { action: 'create', email }, admin);
    assert.equal(response.status, 303);
    const page = await request(jar, '/admin-invitations.php', null, admin);
    assert.equal(page.headers['cache-control'], 'no-store');
    const token = /#invite=([a-f0-9]{64})/.exec(page.body)?.[1]; assert.ok(token, page.body);
    assert.doesNotMatch((await request(jar, '/admin-invitations.php', null, admin)).body, new RegExp(token));
    assert.notEqual(query(`SELECT token_hash FROM registration_invitations WHERE email='${email}' ORDER BY id DESC`)[0].token_hash, token);
    return token;
  }
  const inspect = (jar, token) => form(jar, '/signup.php', 'signup', { action: 'inspect', invitation: token });
  const register = (jar, username, email, targetPort) => form(jar, '/signup.php', 'signup',
    { action: 'register', username, email, password: 'test-password', confirm_password: 'test-password' }, null, targetPort);

  await t.test('closed by default; direct requests and query flags cannot bypass invitations', async () => {
    const page = await request({}, '/signup.php?INVITE_ONLY_REGISTRATION=false');
    assert.match(page.body, /Registration is by invitation only/); assert.doesNotMatch(page.body, /name="password"/);
    assert.match(page.headers['x-robots-tag'], /noindex/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match((await register({}, 'uninvited', 'uninvited@example.test')).body, /invitation is unavailable/);
    assert.equal(query('SELECT COUNT(*) AS n FROM users')[0].n, 1);
    const deny = await request({}, '/admin-invitations.php'); assert.equal(deny.status, 401);
    assert.equal((await request({}, '/admin-invitations.php', null, 'Basic ' + Buffer.from('test-admin:wrong').toString('base64'))).status, 401);
    assert.match((await request({}, '/admin-invitations.php', { action: 'create', email: 'csrf@example.test', form_token: 'bad' }, admin)).body, /session expired/);
    assert.equal(query('SELECT COUNT(*) AS n FROM registration_invitations')[0].n, 0);
  });
  await t.test('password confirmation is enforced on the server without consuming the invitation', async () => {
    const token = await create('confirmation@example.test'), jar = {};
    const page = await inspect(jar, token);
    assert.match(page.body, /Confirm password/);
    assert.match(page.body, /src="\/assets\/signup-passwords.js"/);
    const fields = { action: 'register', username: 'confirmation', email: 'confirmation@example.test', password: 'secret-test-password' };
    for (const extra of [{}, { confirm_password: '' }, { confirm_password: 'different-secret' }, { confirm_password: ' secret-test-password' }]) {
      const response = await form(jar, '/signup.php', 'signup', { ...fields, ...extra });
      assert.equal(response.status, 200);
      assert.match(response.body, extra.confirm_password ? /Passwords do not match/ : /Please confirm your password/);
      assert.doesNotMatch(response.body, /secret-test-password|different-secret/);
      assert.match(response.body, /name="confirm_password"/);
      assert.equal(query("SELECT COUNT(*) AS n FROM users WHERE email='confirmation@example.test'")[0].n, 0);
      const invitation = query("SELECT used_at, used_by_user_id FROM registration_invitations WHERE email='confirmation@example.test'")[0];
      assert.equal(invitation.used_at, null);
      assert.equal(invitation.used_by_user_id, null);
    }
    assert.equal((await form(jar, '/signup.php', 'signup', { ...fields, confirm_password: fields.password })).status, 303);
    assert.match((await request(jar, '/dashboard.php')).body, /Welcome confirmation/);
    assert.ok(query("SELECT used_at FROM registration_invitations WHERE email='confirmation@example.test'")[0].used_at);
  });
  await t.test('invitation accepts only its email, survives a duplicate username, and is used once', async () => {
    const token = await create('tester@example.test'), jar = {};
    const page = await inspect(jar, token); assert.match(page.body, /You’re invited/); assert.match(page.body, /readonly aria-describedby/);
    assert.doesNotMatch(page.body, new RegExp(token));
    assert.match((await register(jar, 'tester', 'different@example.test')).body, /invitation is unavailable/);
    assert.match((await register(jar, 'owner', 'tester@example.test')).body, /already exists/);
    assert.equal(query("SELECT used_at FROM registration_invitations WHERE email='tester@example.test'")[0].used_at, null);
    const before = jar.cookie;
    assert.equal((await register(jar, 'tester', 'TESTER@example.test')).status, 303);
    assert.notEqual(jar.cookie, before);
    assert.match((await request(jar, '/dashboard.php')).body, /Welcome tester/);
    const row = query("SELECT used_at,used_by_user_id FROM registration_invitations WHERE email='tester@example.test'")[0];
    assert.ok(row.used_at); assert.ok(row.used_by_user_id);
    assert.match((await inspect({}, token)).body, /invitation is unavailable/);
    assert.match((await form({}, '/admin-invitations.php', 'admin_invitations', { action: 'create', email: 'tester@example.test' }, admin)).body, /already has an account/);
  });
  await t.test('expiry and cancellation are checked again when submitting registration', async () => {
    for (const state of ['expired', 'cancelled']) {
      const email = state + '@example.test', token = await create(email), jar = {};
      await inspect(jar, token);
      if (state === 'expired') execute(`UPDATE registration_invitations SET expires_at='2000-01-01 00:00:00' WHERE email='${email}'`);
      else {
        const id = query(`SELECT id FROM registration_invitations WHERE email='${email}'`)[0].id;
        const response = await form({}, '/admin-invitations.php', 'admin_invitations', { action: 'revoke', id }, admin);
        assert.equal(response.status, 303);
      }
      assert.match((await register(jar, state, email)).body, /invitation is unavailable/);
      assert.match((await inspect({}, token)).body, /invitation is unavailable/);
      assert.equal(query(`SELECT COUNT(*) AS n FROM users WHERE email='${email}'`)[0].n, 0);
    }
  });
  await t.test('simultaneous requests from different sessions create exactly one account', async () => {
    const token = await create('race@example.test'), a = {}, b = {};
    await inspect(a, token); await inspect(b, token);
    const responses = await Promise.all([register(a, 'race_a', 'race@example.test', ports[0]), register(b, 'race_b', 'race@example.test', ports[1])]);
    assert.equal(responses.filter(r => r.status === 303).length, 1);
    assert.equal(query("SELECT COUNT(*) AS n FROM users WHERE email='race@example.test'")[0].n, 1);
  });
  await t.test('existing accounts can log in; open-registration switch restores public signup', async () => {
    const owner = {};
    assert.equal((await form(owner, '/login.php', 'login', { login: 'owner@example.test', password: 'owner-password' })).status, 302);
    assert.match((await request(owner, '/dashboard.php')).body, /Welcome owner/);
    configuration(false);
    const open = await request({}, '/signup.php'); assert.match(open.body, /name="password"/);
    assert.match(open.body, /src="\/assets\/signup-passwords.js"/);
    const mismatch = await form({}, '/signup.php', 'signup', {
      action: 'register', username: 'public_user', email: 'public@example.test',
      password: 'test-password', confirm_password: 'different-password',
    });
    assert.match(mismatch.body, /Passwords do not match/);
    assert.equal(query("SELECT COUNT(*) AS n FROM users WHERE email='public@example.test'")[0].n, 0);
    assert.doesNotMatch((await request({}, '/login.php')).body, /private beta/);
    assert.equal((await register({}, 'public_user', 'public@example.test')).status, 303);
    configuration(true);
    assert.doesNotMatch((await request({}, '/signup.php')).body, /name="password"/);
  });
  await t.test('invalid tokens, CSRF failures, and missing storage never open registration', async () => {
    assert.match((await inspect({}, 'invalid')).body, /invitation is unavailable/);
    const token = await create('safe@example.test'), jar = {};
    await inspect(jar, token);
    assert.match((await request(jar, '/signup.php', { username: 'safe', email: 'safe@example.test', password: 'test-password', form_token: 'bad' })).body, /session expired/);
    write('db-unavailable', '1');
    assert.match((await inspect({}, token)).body, /temporarily unavailable/);
    assert.equal((await request({}, '/admin-invitations.php', null, admin)).status, 503);
    fs.unlinkSync(path.join(dir, 'db-unavailable'));
    execute('DROP TABLE registration_invitations');
    const page = await inspect({}, token); assert.match(page.body, /temporarily unavailable/); assert.doesNotMatch(page.body, /name="password"/);
    assert.match((await register({}, 'no_table', 'safe@example.test')).body, /invitation is unavailable/);
    assert.equal(query("SELECT COUNT(*) AS n FROM users WHERE email='safe@example.test'")[0].n, 0);
  });
});
