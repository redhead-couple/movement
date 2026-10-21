const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const invalid = 'Invalid login or password.';
const blocked = 'Too many login attempts. Please wait a few minutes and try again.';

// Uses separate PHP processes, sessions and real InnoDB connections. Never
// reads the application's database configuration or accesses real accounts.
test('login budgets serialize concurrent attempts on MySQL', {
  skip: !process.env.MOVEMENT_TEST_MYSQL_BIN, timeout: 120000
}, async t => {
  const bin = process.env.MOVEMENT_TEST_MYSQL_BIN;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-login-concurrency-'));
  const children = [];
  t.after(async () => {
    for (const entry of children.slice().reverse()) {
      if (entry.child.exitCode === null) entry.child.kill();
      await entry.stopped;
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-login-concurrency-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  function write(name, value) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  }
  function launch(exe, args, env = {}) {
    const child = spawn(exe, args, { cwd: dir, windowsHide: true,
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { child, output: '', errors: '', done: false };
    child.stdout.on('data', data => { entry.output += data; });
    child.stderr.on('data', data => { entry.errors += data; });
    entry.stopped = new Promise(resolve => child.once('close', code => { entry.done = true; resolve(code); }));
    children.push(entry); return entry;
  }
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const datadir = path.join(dir, 'mysql');
  const init = spawnSync(path.join(bin, 'mysql_install_db.exe'), [`--datadir=${datadir}`,
    '--password=synthetic-test-password', `--port=${port}`], { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const database = launch(path.join(bin, 'mysqld.exe'), ['--no-defaults', `--basedir=${path.dirname(bin)}`,
    `--datadir=${datadir}`, `--port=${port}`, '--bind-address=127.0.0.1', '--console']);
  const connectionArgs = `'mysql:host=127.0.0.1;port=${port};charset=utf8mb4', 'root', 'synthetic-test-password',
    [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]`;
  for (let i = 0; i < 100; i++) {
    const probe = spawnSync('php', ['-r', `$pdo = new PDO(${connectionArgs});`], { windowsHide: true, encoding: 'utf8' });
    if (probe.status === 0) break;
    assert.ok(!database.done && i < 99, database.errors + probe.stderr);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  function php(code) {
    const result = spawnSync('php', ['-r', code], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.stderr, ''); return result.stdout;
  }
  php(`$pdo = new PDO(${connectionArgs}); $pdo->exec('CREATE DATABASE login_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');`);
  for (const file of ['login.php', 'server/core/login-throttle.php', 'server/core/require-guest.php',
    'server/core/security-helpers.php', 'server/core/web-session.php', 'server/core/config-loader.php']) {
    write(file, fs.readFileSync(path.join(root, file)));
  }
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT='development';");
  write('server/core/db.php', `<?php
class TestLoginPdo extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $failure = getenv('TEST_FAIL');
        if (($failure === 'lock' && str_contains($query, 'INSERT INTO login_attempt_locks'))
            || ($failure === 'record' && str_contains($query, 'INSERT INTO login_attempts ('))) {
            throw new RuntimeException('Injected database failure');
        }
        return parent::prepare($query, $options);
    }
    public function commit(): bool {
        if (getenv('TEST_FAIL') === 'commit') throw new RuntimeException('Injected commit failure');
        return parent::commit();
    }
}
function db(): PDO {
    static $pdo; if ($pdo) return $pdo;
    $pdo = new TestLoginPdo(${connectionArgs}); $pdo->exec('USE login_test'); return $pdo;
}`);
  php(`require 'server/core/db.php'; $pdo = db();
    $pdo->exec('CREATE TABLE users (id INT PRIMARY KEY, username VARCHAR(80) UNIQUE, email VARCHAR(190) UNIQUE, password_hash VARCHAR(255)) ENGINE=InnoDB');
    $insert = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?)');
    $insert->execute([1, 'alice', 'alice@example.test', password_hash('alice-password', PASSWORD_DEFAULT)]);
    $insert->execute([2, 'bob', 'bob@example.test', password_hash('bob-password', PASSWORD_DEFAULT)]);`);
  fs.mkdirSync(path.join(dir, 'sessions'));

  // Only the temporary helper copy gains scheduling barriers. Queries, locks,
  // password verification and transaction boundaries are the production code.
  const helper = fs.readFileSync(path.join(dir, 'server/core/login-throttle.php'), 'utf8');
  const marker = '        foreach ($keys as $key) $lock->execute([$key]);';
  assert.ok(helper.includes(marker));
  write('server/core/login-throttle.php', helper.replace(marker, `
        $testId = getenv('TEST_ID');
        if ($testId) file_put_contents(dirname(__DIR__, 2) . '/waiting-' . $testId, '1');
${marker}
        if ($testId) file_put_contents(dirname(__DIR__, 2) . '/locked-' . $testId, '1');
        if (getenv('TEST_HOLD') === '1') {
            $deadline = microtime(true) + 12;
            while (!is_file(dirname(__DIR__, 2) . '/release-' . $testId)) {
                clearstatcache();
                if (microtime(true) > $deadline) throw new RuntimeException('Test barrier timeout');
                usleep(10000);
            }
        }`));
  let sequence = 0;
  function request({ login = 'alice', password = 'wrong', ip = '192.0.2.1', hold = false,
    failure = '', method = 'POST', token = 'test-token' } = {}) {
    const id = String(++sequence);
    const input = Buffer.from(JSON.stringify({ login, password, ip, method, token })).toString('base64');
    const worker = launch('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, '-r', `
      $input = json_decode(base64_decode('${input}'), true);
      $_SERVER['REQUEST_METHOD'] = $input['method']; $_SERVER['REMOTE_ADDR'] = $input['ip'];
      session_start(); $oldSession = session_id();
      $_SESSION['form_guards']['login'] = ['token'=>'test-token', 'started_at'=>time()-5];
      $_POST = ['login'=>$input['login'], 'password'=>$input['password'], 'form_token'=>$input['token'], 'website'=>''];
      ob_start(); register_shutdown_function(static function () use ($oldSession): void {
        ob_end_clean(); echo json_encode(['error'=>$GLOBALS['error'] ?? null, 'session'=>$_SESSION,
            'regenerated'=>session_id() !== $oldSession]);
      }); require 'login.php';`], { TEST_ID: id, TEST_HOLD: hold ? '1' : '0', TEST_FAIL: failure });
    const result = worker.stopped.then(code => {
      assert.equal(code, 0, worker.errors + worker.output); assert.equal(worker.errors, '');
      return JSON.parse(worker.output);
    });
    result.catch(() => {});
    return { ...worker, id, result, release: () => write('release-' + id, '1') };
  }
  async function waitFor(name) {
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(path.join(dir, name))) {
      assert.ok(Date.now() < deadline, 'Missing barrier: ' + name);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  const count = () => Number(php("require 'server/core/db.php'; echo db()->query('SELECT COUNT(*) FROM login_attempts')->fetchColumn();"));
  const clear = () => php("require 'server/core/db.php'; db()->exec('DELETE FROM login_attempts; DELETE FROM login_attempt_locks');");
  function denied(result, message) {
    assert.equal(result.error, message); assert.equal(result.session.user_id, undefined);
  }
  function authenticated(result, username) {
    assert.equal(result.error, ''); assert.equal(result.session.username, username);
    assert.equal(result.regenerated, true); assert.ok(result.session.credential_version);
  }
  // Initialize tables once, then keep/clear real history as each case requires.
  authenticated(await request({ password: 'alice-password' }).result, 'alice');

  for (const mode of ['same-ip-different-account', 'same-account-different-ip']) {
    await t.test(`${mode}: only the fifth failure runs; the waiting request is blocked`, async () => {
      clear();
      for (let i = 0; i < 4; i++) denied(await request().result, invalid);
      // Delete lock rows to cover the first upsert against existing failure history.
      php("require 'server/core/db.php'; db()->exec('DELETE FROM login_attempt_locks');");
      const first = request({ hold: true });
      let second;
      try {
        await waitFor('locked-' + first.id);
        second = request(mode === 'same-ip-different-account'
          ? { login: 'bob', password: 'bob-password' }
          : { login: 'ALICE@EXAMPLE.TEST', password: 'alice-password', ip: '2001:db8::2' });
        await waitFor('waiting-' + second.id);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(fs.existsSync(path.join(dir, 'locked-' + second.id)), false);
      } finally { first.release(); }
      denied(await first.result, invalid); denied(await second.result, blocked);
      assert.equal(count(), 5);
    });
  }
  for (const mode of ['ip', 'account']) {
    await t.test(`a burst of ten requests cannot overspend an initially empty ${mode} budget`, async () => {
      clear();
      const workers = Array.from({ length: 10 }, (_, i) => request(mode === 'ip'
        ? { login: ['alice', 'bob', 'missing'][i % 3] }
        : { login: ['alice', 'alice@example.test', 'ALICE'][i % 3], ip: '192.0.2.' + (i + 1) }));
      const results = await Promise.all(workers.map(worker => worker.result));
      assert.equal(results.filter(result => result.error === invalid).length, 5);
      assert.equal(results.filter(result => result.error === blocked).length, 5);
      results.forEach(result => assert.equal(result.session.user_id, undefined));
      assert.equal(count(), 5);
    });
  }
  await t.test('an unrelated account on another IP can log in while an attempt is held', async () => {
    clear(); const held = request({ hold: true });
    try {
      await waitFor('locked-' + held.id);
      authenticated(await request({ login: 'bob', password: 'bob-password', ip: '192.0.2.9' }).result, 'bob');
    } finally { held.release(); }
    denied(await held.result, invalid);
  });
  await t.test('username/email login and corrected passwords work without resetting either budget', async () => {
    clear(); denied(await request().result, invalid);
    for (const login of ['alice', 'alice@example.test', 'ALICE']) {
      authenticated(await request({ login, password: 'alice-password' }).result, 'alice');
    }
    authenticated(await request({ login: 'bob', password: 'bob-password' }).result, 'bob');
    assert.equal(count(), 1);
  });
  await t.test('legacy alias rows still count, blocks do not extend the window, and expiry permits login', async () => {
    clear();
    php(`require 'server/core/db.php'; $stmt=db()->prepare('INSERT INTO login_attempts (login_identifier,ip) VALUES (?,?)');
      for ($i=0;$i<5;$i++) $stmt->execute([$i%2 ? 'ALICE' : 'Alice@Example.Test',inet_pton('192.0.2.30')]);`);
    denied(await request({ login: 'alice@example.test', password: 'alice-password', ip: '192.0.2.99' }).result, blocked);
    assert.equal(count(), 5);
    php("require 'server/core/db.php'; db()->exec('UPDATE login_attempts SET attempted_at=NOW()-INTERVAL 16 MINUTE');");
    authenticated(await request({ password: 'alice-password' }).result, 'alice');
    assert.equal(count(), 5);
  });
  for (const failure of ['lock', 'record', 'commit']) {
    await t.test(`${failure} failure denies authentication and rolls back/relinquishes locks`, async () => {
      clear();
      const result = await request({ failure, password: failure === 'record' ? 'wrong' : 'alice-password' }).result;
      denied(result, 'Something went wrong during login.');
      assert.equal(count(), 0);
      authenticated(await request({ password: 'alice-password' }).result, 'alice');
      denied(await request().result, invalid); assert.equal(count(), 1);
    });
  }
  await t.test('GET and invalid CSRF submissions neither authenticate nor consume the budget', async () => {
    clear();
    const get = await request({ method: 'GET' }).result;
    assert.equal(get.session.user_id, undefined);
    denied(await request({ password: 'alice-password', token: 'wrong' }).result,
      'Your session expired. Please refresh and try again.');
    assert.equal(count(), 0);
  });
});
