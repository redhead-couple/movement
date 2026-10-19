const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

// Opt-in integration test: starts a disposable MariaDB, never connects to the
// application's configured database, and sends no email. Point this variable
// at a MariaDB bin directory containing mysql_install_db.exe and mysqld.exe.
test('password changes and reset operations serialize on the actual MySQL user row', {
  skip: !process.env.MOVEMENT_TEST_MYSQL_BIN, timeout: 120000
}, async t => {
  const bin = process.env.MOVEMENT_TEST_MYSQL_BIN;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-reset-concurrency-'));
  const children = [];
  t.after(async () => {
    for (const entry of children.slice().reverse()) {
      if (entry.child.exitCode === null) entry.child.kill();
      await entry.stopped;
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-reset-concurrency-'));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  };
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const datadir = path.join(dir, 'mysql');
  const init = spawnSync(path.join(bin, 'mysql_install_db.exe'), [
    `--datadir=${datadir}`, '--password=synthetic-test-password', `--port=${port}`
  ], { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  function launch(exe, args, options = {}) {
    const child = spawn(exe, args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    const entry = { child, output: '', errors: '', done: false };
    child.stdout.on('data', data => { entry.output += data; });
    child.stderr.on('data', data => { entry.errors += data; });
    entry.stopped = new Promise(resolve => child.once('close', code => { entry.done = true; resolve(code); }));
    children.push(entry); return entry;
  }
  const database = launch(path.join(bin, 'mysqld.exe'), ['--no-defaults', `--basedir=${path.dirname(bin)}`,
    `--datadir=${datadir}`, `--port=${port}`, '--bind-address=127.0.0.1', '--console']);
  const connection = `new PDO('mysql:host=127.0.0.1;port=${port};charset=utf8mb4', 'root', 'synthetic-test-password',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])`;
  for (let i = 0; i < 100; i++) {
    const probe = spawnSync('php', ['-r', `$pdo = ${connection};`], { windowsHide: true, encoding: 'utf8' });
    if (probe.status === 0) break;
    assert.ok(!database.done && i < 99, database.errors + probe.stderr);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  for (const file of ['account-settings.php', 'server/core/password-reset.php', 'server/core/app-init.php',
    'server/core/security-helpers.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/web-session.php', 'server/core/config-loader.php',
    'server/core/project-paths.php', 'server/core/response.php', 'tests/php/password-reset.test.php']) {
    write(file, fs.readFileSync(path.join(root, file)));
  }
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development'; $APP_HTTPS_ORIGIN = 'https://accounts.example.test';");
  write('server/core/db.php', `<?php function db(): PDO {
    static $pdo; if ($pdo) return $pdo; $pdo = ${connection}; $pdo->exec('USE reset_test'); return $pdo;
  }`);
  fs.mkdirSync(path.join(dir, 'sessions'));
  function php(code) {
    const result = spawnSync('php', ['-r', code], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.stderr, ''); return result.stdout;
  }
  php(`$pdo = ${connection}; $pdo->exec("CREATE DATABASE reset_test; USE reset_test;
    CREATE TABLE users (id INT PRIMARY KEY, username VARCHAR(80), email VARCHAR(190), password_hash VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE password_reset_tokens (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
      token_hash CHAR(64) UNIQUE, expires_at DATETIME, used_at DATETIME NULL, created_at DATETIME,
      request_ip VARBINARY(16), INDEX(user_id)) ENGINE=InnoDB;
    CREATE TABLE password_reset_attempts (id INT AUTO_INCREMENT PRIMARY KEY, purpose VARCHAR(32),
      email_hash CHAR(64) NULL, ip VARBINARY(16), attempted_at DATETIME) ENGINE=InnoDB;
    INSERT INTO users (id, username, email) VALUES (1, 'alice', 'alice@example.test');");`);
  // Re-run the pre-existing PHP regression suite in a configured temporary app.
  assert.match(php("require 'tests/php/password-reset.test.php';"), /PASSWORD_RESET_TEST_OK/);

  // Test-only barriers surround the real SELECT FOR UPDATE. No production
  // locking or transaction logic is substituted, and each worker is a separate
  // process/connection (session locking cannot serialize these tests).
  const helperPath = path.join(dir, 'server/core/password-reset.php');
  const source = fs.readFileSync(helperPath, 'utf8');
  const beforeLock = "$stmt->execute([$userId]);\n    $user = $stmt->fetch(PDO::FETCH_ASSOC);";
  assert.ok(source.replaceAll('\r\n', '\n').includes(beforeLock));
  write('server/core/password-reset.php', source.replaceAll('\r\n', '\n').replace(beforeLock, `
    if (getenv('TEST_ATTEMPT')) file_put_contents(getenv('TEST_ATTEMPT'), '1');
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (getenv('TEST_HOLD')) {
        file_put_contents(getenv('TEST_HOLD') . '-ready', '1');
        $deadline = microtime(true) + 15;
        while (!is_file(getenv('TEST_HOLD') . '-release')) {
            clearstatcache();
            if (microtime(true) > $deadline) throw new RuntimeException('Test barrier timed out');
            usleep(10000);
        }
    }`));
  write('worker.php', `<?php
    $_SERVER['REQUEST_METHOD'] = 'POST'; $_SERVER['DOCUMENT_ROOT'] = __DIR__;
    require 'server/core/db.php'; require 'server/core/password-reset.php';
    $input = json_decode(file_get_contents('php://stdin'), true);
    if ($input['operation'] === 'change') {
        require 'server/core/security-helpers.php';
        $_SESSION['user_id'] = 1; $_SESSION['username'] = 'alice';
        bindWebSessionToPassword(db()->query('SELECT password_hash FROM users WHERE id = 1')->fetchColumn());
        $guard = ensureFormGuard('change_password');
        $_SESSION['form_guards']['change_password']['started_at'] = time() - 5;
        $_POST = ['form_token' => $guard['token'], 'website' => '', 'current_password' => 'old-password',
          'new_password' => 'changed-password', 'confirm_password' => 'changed-password'];
        ob_start(); require 'account-settings.php'; $html = ob_get_clean();
        $result = str_contains($html, 'Your password has been changed.') ? 'success' : 'rejected';
    } elseif ($input['operation'] === 'consume') {
        $result = consumePasswordResetToken(db(), str_repeat('a', 64), 'reset-password');
    } else {
        $result = requestPasswordReset(db(), 'alice@example.test', inet_pton('192.0.2.1'),
          static fn () => true, null, static fn () => str_repeat('b', 64));
    }
    echo json_encode($result);`);
  let sequence = 0;
  function job(operation, hold = false) {
    const flag = path.join(dir, 'job-' + (++sequence));
    const entry = launch('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, 'worker.php'], {
      env: { ...process.env, TEST_ATTEMPT: flag + '-attempt', TEST_HOLD: hold ? flag : '' }
    });
    entry.child.stdin.end(JSON.stringify({ operation }));
    entry.flag = flag; return entry;
  }
  async function waitFile(file) {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(file)) {
      assert.ok(Date.now() < deadline, 'Missing barrier: ' + path.basename(file));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async function result(entry) {
    assert.equal(await entry.stopped, 0, entry.errors + entry.output);
    assert.equal(entry.errors, ''); return JSON.parse(entry.output);
  }
  for (const [first, second] of [['change', 'consume'], ['consume', 'change'], ['request', 'change'], ['change', 'request']]) {
    await t.test(`${first} excludes ${second} until commit`, async () => {
      php(`require 'server/core/db.php'; $pdo = db();
        $pdo->exec('DELETE FROM password_reset_tokens; DELETE FROM password_reset_attempts');
        $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = 1');
        $stmt->execute([password_hash('old-password', PASSWORD_DEFAULT)]);
        $stmt = $pdo->prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
          VALUES (1, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), UTC_TIMESTAMP())");
        $stmt->execute([hash('sha256', str_repeat('a', 64))]);`);
      const one = job(first, true);
      await waitFile(one.flag + '-ready');
      const two = job(second);
      try {
        await waitFile(two.flag + '-attempt');
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(two.done, false, 'competing operation did not wait for the user lock');
      } finally { fs.writeFileSync(one.flag + '-release', '1'); }
      const [a, b] = await Promise.all([result(one), result(two)]);
      if (first === 'request') assert.equal(a.mailSent, true); else assert.equal(a, 'success');
      if (second === 'request') assert.equal(b.mailSent, true);
      else assert.equal(b, first === 'consume' ? 'rejected' : first === 'change' ? 'invalid' : 'success');
      const state = JSON.parse(php(`require 'server/core/db.php'; require 'server/core/password-reset.php';
        $hash = db()->query('SELECT password_hash FROM users WHERE id = 1')->fetchColumn();
        echo json_encode(['changed' => password_verify('changed-password', $hash),
          'reset' => password_verify('reset-password', $hash),
          'oldLink' => findUsablePasswordResetToken(db(), str_repeat('a', 64)) !== null,
          'newLink' => findUsablePasswordResetToken(db(), str_repeat('b', 64)) !== null]);`));
      assert.equal(state.changed, first !== 'consume');
      assert.equal(state.reset, first === 'consume');
      assert.equal(state.oldLink, false);
      assert.equal(state.newLink, second === 'request');
    });
  }
});
