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

// With MOVEMENT_TEST_MYSQL_BIN this runs against a disposable MariaDB server.
// Otherwise it uses SQLite. Neither mode uses live configuration or user data.
test('admin sign-in throttles failures without breaking authorized management', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-admin-throttle-'));
  const children = [];
  const mysql = Boolean(process.env.MOVEMENT_TEST_MYSQL_BIN);
  let serverLog = '';
  t.after(async () => {
    for (const entry of children.slice().reverse()) {
      if (entry.child.exitCode === null) entry.child.kill();
      await entry.stopped;
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-admin-throttle-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  function write(name, value) {
    const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  }
  function launch(exe, args) {
    const child = spawn(exe, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const entry = { child, errors: '' };
    child.stderr.on('data', data => { entry.errors += data; });
    entry.stopped = new Promise(resolve => child.once('close', resolve)); children.push(entry); return entry;
  }
  async function reservePort() {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
  }
  function php(code) {
    const result = spawnSync('php', ['-r', code], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr + result.stdout); assert.equal(result.stderr, ''); return result.stdout;
  }
  for (const file of ['admin-messages.php', 'server/core/http-basic-auth.php', 'server/core/admin-login-throttle.php',
    'server/core/security-helpers.php', 'server/core/web-session.php', 'server/core/config-loader.php']) {
    write(file, fs.readFileSync(path.join(root, file)));
  }
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT='development'; $ADMIN_USER='test-admin'; $ADMIN_PASS='synthetic-password:with-colons';");
  if (mysql) {
    const bin = process.env.MOVEMENT_TEST_MYSQL_BIN, port = await reservePort(), datadir = path.join(dir, 'mysql');
    const init = spawnSync(path.join(bin, 'mysql_install_db.exe'), [`--datadir=${datadir}`,
      '--password=synthetic-test-password', `--port=${port}`], { encoding: 'utf8', windowsHide: true, timeout: 45000 });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const database = launch(path.join(bin, 'mysqld.exe'), ['--no-defaults', `--basedir=${path.dirname(bin)}`,
      `--datadir=${datadir}`, `--port=${port}`, '--bind-address=127.0.0.1', '--console']);
    const connection = `new PDO('mysql:host=127.0.0.1;port=${port};charset=utf8mb4', 'root', 'synthetic-test-password',
      [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC])`;
    for (let i = 0; i < 100; i++) {
      const probe = spawnSync('php', ['-r', `$pdo = ${connection};`], { windowsHide: true, encoding: 'utf8' });
      if (probe.status === 0) break;
      assert.ok(database.child.exitCode === null && i < 99, database.errors + probe.stderr);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    php(`$pdo = ${connection}; $pdo->exec('CREATE DATABASE admin_test');`);
    write('server/core/db.php', `<?php function db(): PDO {
      if (is_file(dirname(__DIR__, 2) . '/db-unavailable')) throw new RuntimeException('SYNTHETIC_DB_FAILURE');
      static $pdo; if ($pdo) return $pdo; $pdo = ${connection}; $pdo->exec('USE admin_test'); return $pdo;
    }`);
  } else {
    write('server/core/db.php', `<?php class AdminTestPdo extends PDO {
      public function exec(string $statement): int|false {
        if (str_contains($statement, 'CREATE TABLE IF NOT EXISTS contact_messages')) return 0;
        return parent::exec($statement);
      }
    }
    function db(): PDO {
      if (is_file(dirname(__DIR__, 2) . '/db-unavailable')) throw new RuntimeException('SYNTHETIC_DB_FAILURE');
      static $pdo; return $pdo ??= new AdminTestPdo('sqlite:' . dirname(__DIR__, 2) . '/test.sqlite', null, null,
        [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    }`);
    php(`require 'server/core/db.php'; db()->exec('CREATE TABLE contact_messages (id INTEGER PRIMARY KEY, name TEXT,
      email TEXT, message TEXT, created_at TEXT, ip BLOB, user_agent TEXT, status TEXT)');`);
  }
  let now = 1800000000;
  write('clock', String(now));
  const helper = fs.readFileSync(path.join(dir, 'server/core/admin-login-throttle.php'), 'utf8');
  assert.ok(helper.includes('$now = $now ?? time();'));
  // Substitute only the clock, leaving state transitions and SQL untouched.
  write('server/core/admin-login-throttle.php', helper.replace('$now = $now ?? time();',
    "$now = $now ?? (int) file_get_contents(dirname(__DIR__, 2) . '/clock');"));
  write('router.php', "<?php $_SERVER['REMOTE_ADDR'] = $_GET['test_ip'] ?? '192.0.2.1'; return false;");
  fs.mkdirSync(path.join(dir, 'sessions'));
  async function server() {
    const port = await reservePort();
    const entry = launch('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, '-S', `127.0.0.1:${port}`, '-t', dir, 'router.php']);
    entry.child.stderr.on('data', data => { serverLog += data; }); return port;
  }
  const ports = [await server(), await server()];
  const auth = (user, password) => 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
  const valid = auth('test-admin', 'synthetic-password:with-colons');
  const invalid = auth('test-admin', 'wrong');
  function request({ ip = '192.0.2.1', authorization, cookie, query = '', body, port = ports[0], headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? new URLSearchParams(body).toString() : null;
      const req = http.request({ hostname: '127.0.0.1', port,
        path: '/admin-messages.php?test_ip=' + encodeURIComponent(ip) + query, method: data ? 'POST' : 'GET',
        headers: { ...(authorization ? { Authorization: authorization } : {}), ...(cookie ? { Cookie: cookie } : {}),
          ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers }
      }, res => { const chunks = []; res.on('data', data => chunks.push(data));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
      req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('HTTP timeout'))); req.end(data);
    });
  }
  for (const port of ports) for (let i = 0; i < 100; i++) {
    try { await request({ port }); break; } catch (error) {
      if (i === 99) throw error; await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const state = ip => JSON.parse(php(`require 'server/core/db.php'; $stmt = db()->prepare('SELECT failures, window_started, blocked_until FROM admin_login_throttle WHERE ip = ?');
    $stmt->execute([inet_pton('${ip}')]); echo json_encode($stmt->fetch());`));
  const advance = seconds => { now += seconds; write('clock', String(now)); };

  await t.test('missing or malformed credentials retain the Basic Auth prompt without consuming attempts', async () => {
    for (const authorization of [undefined, 'Basic malformed', 'Bearer unrelated']) {
      for (let i = 0; i < 6; i++) {
        const res = await request({ authorization });
        assert.equal(res.status, 401); assert.match(res.headers['www-authenticate'], /Basic realm="Messages"/);
      }
    }
    assert.equal((await request({ authorization: valid })).status, 200);
    assert.equal(Number(state('192.0.2.1').failures), 0);
  });
  php(`require 'server/core/db.php'; db()->exec("INSERT INTO contact_messages (id, name, email, message, created_at, status, ip)
    VALUES (1, 'Fixture', 'fixture@example.test', 'PRIVATE_ADMIN_MESSAGE', '2026-01-01', 'new', X'C0000201')");`);
  await t.test('valid login, CSV export, CSRF protection and authorized updates still work', async () => {
    const page = await request({ authorization: valid });
    assert.equal(page.status, 200); assert.match(page.body, /PRIVATE_ADMIN_MESSAGE/);
    const cookie = page.headers['set-cookie'].find(value => value.startsWith('PHPSESSID=')).split(';')[0];
    const token = page.body.match(/name="form_token" value="([^"]+)"/)[1];
    const bad = await request({ authorization: valid, cookie, body: { bulk_action: 'delete', 'selected_ids[]': '1', form_token: 'bad' } });
    assert.match(bad.body, /Your session expired/); assert.match(bad.body, /PRIVATE_ADMIN_MESSAGE/);
    const updated = await request({ authorization: valid, cookie, body: { bulk_action: 'mark_filtered_read', form_token: token, website: '' } });
    assert.match(updated.body, /Filtered messages marked as read/);
    assert.equal(php("require 'server/core/db.php'; echo db()->query('SELECT status FROM contact_messages WHERE id = 1')->fetchColumn();"), 'read');
    const csv = await request({ authorization: valid, query: '&export=csv' });
    assert.equal(csv.status, 200); assert.match(csv.headers['content-type'], /text\/csv/); assert.match(csv.body, /PRIVATE_ADMIN_MESSAGE/);
    assert.equal(Number(state('192.0.2.1').failures), 0);
  });
  await t.test('five failures block every admin action for 15 minutes, regardless of cookies, username or forwarded headers', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await request({ ip: '192.0.2.2', authorization: auth('name-' + i, 'wrong'), cookie: 'PHPSESSID=attempt' + i });
      assert.equal(res.status, i < 5 ? 401 : 429);
      if (i === 5) assert.equal(Number(res.headers['retry-after']), 900);
      assert.doesNotMatch(res.body, /PRIVATE_ADMIN_MESSAGE/);
    }
    const initial = state('192.0.2.2');
    advance(120);
    for (const options of [{}, { query: '&export=csv' }, { body: { bulk_action: 'delete', 'selected_ids[]': '1' } }]) {
      const res = await request({ ip: '192.0.2.2', authorization: valid,
        headers: { 'X-Forwarded-For': '203.0.113.99', 'X-Real-IP': '203.0.113.99' }, ...options });
      assert.equal(res.status, 429); assert.equal(Number(res.headers['retry-after']), 780);
      assert.equal(res.headers['www-authenticate'], undefined); assert.doesNotMatch(res.body, /PRIVATE_ADMIN_MESSAGE/);
      assert.match(res.headers['cache-control'], /no-store/);
    }
    assert.deepEqual(state('192.0.2.2'), initial);
    assert.equal((await request({ ip: '192.0.2.3', authorization: valid })).status, 200);
  });
  await t.test('the block expires automatically and does not require a manual reset', async () => {
    advance(780);
    assert.equal((await request({ ip: '192.0.2.2', authorization: valid })).status, 200);
    assert.equal(Number(state('192.0.2.2').failures), 0);
    assert.equal((await request({ ip: '192.0.2.2', authorization: invalid })).status, 401);
    assert.equal(Number(state('192.0.2.2').failures), 1);
  });
  await t.test('a corrected password works before the threshold but does not erase prior failures', async () => {
    const ip = '192.0.2.4';
    for (let i = 0; i < 4; i++) assert.equal((await request({ ip, authorization: invalid })).status, 401);
    assert.equal((await request({ ip, authorization: valid })).status, 200);
    assert.equal(Number(state(ip).failures), 4);
    assert.equal((await request({ ip, authorization: invalid })).status, 429);
    const aged = '192.0.2.5';
    for (let i = 0; i < 4; i++) await request({ ip: aged, authorization: invalid });
    advance(900);
    assert.equal((await request({ ip: aged, authorization: invalid })).status, 401);
    assert.equal(Number(state(aged).failures), 1);
  });
  await t.test('parallel requests on separate servers cannot race past the shared limit', async () => {
    const ip = '192.0.2.6';
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => request({ ip, authorization: invalid,
      cookie: 'PHPSESSID=parallel' + i, port: ports[i % ports.length] })));
    assert.equal(results.filter(res => res.status === 401).length, 4);
    assert.equal(results.filter(res => res.status === 429).length, 12);
    assert.equal(Number(state(ip).failures), 5);
    assert.equal((await request({ ip, authorization: valid })).status, 429);
  });
  await t.test('IPv6 addresses have independent limits and old rows are cleaned up', async () => {
    const ip = '2001:db8::1';
    for (let i = 0; i < 5; i++) await request({ ip, authorization: invalid });
    assert.equal((await request({ ip, authorization: valid })).status, 429);
    assert.equal((await request({ ip: '2001:db8::2', authorization: valid })).status, 200);
    advance(86401);
    assert.equal((await request({ ip: '2001:db8::2', authorization: valid })).status, 200);
    assert.equal(state(ip), false);
  });
  await t.test('database failure cannot bypass the limiter or expose admin content', async () => {
    write('db-unavailable', '1');
    try {
      const res = await request({ authorization: valid, query: '&export=csv' });
      assert.equal(res.status, 503); assert.equal(res.headers['retry-after'], '60');
      assert.doesNotMatch(res.body, /PRIVATE_ADMIN_MESSAGE|SYNTHETIC_DB_FAILURE|PDO|SQLSTATE/);
    } finally { fs.unlinkSync(path.join(dir, 'db-unavailable')); }
    assert.equal((await request({ authorization: valid })).status, 200);
  });
  assert.deepEqual(serverLog.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
