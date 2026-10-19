const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const blocked = 'Too many login attempts. Please wait a few minutes and try again.';
const invalid = 'Invalid login or password.';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-login-throttle-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-login-throttle-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(file, content) {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  for (const file of ['login.php', 'server/core/login-throttle.php', 'server/core/require-guest.php',
    'server/core/security-helpers.php', 'server/core/web-session.php',
    'server/core/config-loader.php']) write(file, fs.readFileSync(path.join(root, file)));
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  // Run the real controller and queries against an isolated SQLite database.
  // Translate only MySQL's table declaration and date-interval syntax; do not
  // mock query results, account lookup, password checks, guards, or sessions.
  write('server/core/db.php', `<?php
class LoginTestPdo extends PDO {
    public function exec(string $statement): int|false {
        if (str_contains($statement, 'CREATE TABLE IF NOT EXISTS login_attempts')) {
            $statement = 'CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                login_identifier TEXT COLLATE NOCASE NOT NULL,
                ip BLOB NOT NULL, attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)';
        }
        return parent::exec($statement);
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare(str_replace('NOW() - INTERVAL 15 MINUTE',
            "datetime('now', '-15 minutes')", $query), $options);
    }
}
function db(): PDO {
    static $pdo;
    return $pdo ??= new LoginTestPdo('sqlite:' . dirname(__DIR__, 2) . '/test.sqlite', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
}
`);
  fs.mkdirSync(path.join(dir, 'sessions'));
  function php(code, input = {}) {
    const result = spawnSync('php', ['-d', 'display_errors=stderr', '-d', `session.save_path=${path.join(dir, 'sessions')}`, '-r', code],
      { cwd: dir, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.stderr, '');
    return result.stdout;
  }
  php(`require 'server/core/db.php'; $pdo = db();
    $pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT COLLATE NOCASE UNIQUE,
        email TEXT COLLATE NOCASE UNIQUE, password_hash TEXT)');
    $stmt = $pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?)');
    $stmt->execute([1, 'alice', 'alice@example.test', password_hash('alice-password', PASSWORD_DEFAULT)]);
    $stmt->execute([2, 'bob', 'bob@example.test', password_hash('bob-password', PASSWORD_DEFAULT)]);
    $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempts');`);
  function request(login, password, ip = '192.0.2.1', options = {}) {
    return JSON.parse(php(`$input = json_decode(stream_get_contents(STDIN), true);
      $_SERVER['REQUEST_METHOD'] = $input['method'] ?? 'POST';
      $_SERVER['REMOTE_ADDR'] = $input['ip'];
      session_start();
      $_SESSION['form_guards']['login'] = ['token' => 'test-token', 'started_at' => time() - 5];
      $oldSession = session_id();
      $_POST = ['login' => $input['login'], 'password' => $input['password'],
        'form_token' => $input['token'] ?? 'test-token', 'website' => ''];
      ob_start();
      register_shutdown_function(static function () use ($oldSession): void {
        $html = ob_get_clean();
        echo json_encode(['error' => $GLOBALS['error'] ?? null, 'session' => $_SESSION,
          'regenerated' => session_id() !== $oldSession,
          'hasLoginForm' => str_contains($html, 'name="password"')]);
      });
      require 'login.php';`, { login, password, ip, ...options }));
  }
  function sql(query, params = []) {
    return JSON.parse(php(`require 'server/core/db.php'; $input = json_decode(stream_get_contents(STDIN), true);
      $stmt = db()->prepare($input['query']); $stmt->execute($input['params']);
      echo json_encode($stmt->fetchAll());`, { query, params }));
  }
  return { request, sql };
}

function authenticated(result, username) {
  assert.equal(result.error, '');
  assert.equal(result.session.username, username);
  assert.equal(result.session.user.username, username);
  assert.equal(result.session.user.email, `${username}@example.test`);
  assert.ok(result.session.user_id > 0);
  assert.equal(result.regenerated, true);
  assert.notEqual(result.session.form_guards.login.token, 'test-token');
}

function rejected(result, message) {
  assert.equal(result.error, message);
  assert.equal(result.session.user_id, undefined);
  assert.equal(result.hasLoginForm, true);
}

test('login to another account cannot erase the IP failure budget', t => {
  const { request, sql } = fixture(t);
  for (let i = 0; i < 4; i++) rejected(request('alice', 'wrong'), invalid);
  authenticated(request('bob', 'bob-password'), 'bob');
  assert.equal(sql('SELECT COUNT(*) AS count FROM login_attempts')[0].count, 4);
  rejected(request('alice', 'wrong'), invalid);
  rejected(request('alice', 'alice-password'), blocked);
  rejected(request('bob', 'bob-password'), blocked);
});

test('username, email and letter-case variants share the account limit across IP addresses', t => {
  const { request } = fixture(t);
  const aliases = ['alice', 'alice@example.test', 'ALICE', 'Alice@Example.Test', 'alice'];
  aliases.forEach((alias, i) => rejected(request(alias, 'wrong', `192.0.2.${i + 1}`), invalid));
  rejected(request('alice@example.test', 'alice-password', '192.0.2.100'), blocked);
  rejected(request('ALICE', 'wrong', '192.0.2.101'), blocked);
  authenticated(request('bob', 'bob-password', '192.0.2.100'), 'bob');
});

test('ordinary username/email logins and a corrected password still authenticate', t => {
  const { request, sql } = fixture(t);
  authenticated(request('alice', 'alice-password'), 'alice');
  authenticated(request('alice@example.test', 'alice-password'), 'alice');
  authenticated(request(' ALICE ', 'alice-password'), 'alice');
  rejected(request('alice', 'mistyped-password'), invalid);
  authenticated(request('alice@example.test', 'alice-password'), 'alice');
  assert.equal(sql('SELECT COUNT(*) AS count FROM login_attempts')[0].count, 1);
});

test('existing failure rows under either account alias continue to count after deployment', t => {
  const { request, sql } = fixture(t);
  for (let i = 0; i < 5; i++) {
    sql('INSERT INTO login_attempts (login_identifier, ip) VALUES (?, ?)',
      [i % 2 ? 'Alice@Example.Test' : 'ALICE', `legacy-ip-${i}`]);
  }
  rejected(request('alice', 'alice-password'), blocked);
  rejected(request('alice@example.test', 'alice-password'), blocked);
});

test('IP protection also covers nonexistent accounts and different target accounts', t => {
  const { request } = fixture(t);
  for (let i = 0; i < 5; i++) rejected(request(`missing-${i}`, 'wrong'), invalid);
  rejected(request('bob', 'bob-password'), blocked);
  authenticated(request('bob', 'bob-password', '2001:db8::1'), 'bob');
});

test('the failure window expires without a manual reset and blocked requests do not extend it', t => {
  const { request, sql } = fixture(t);
  for (let i = 0; i < 5; i++) rejected(request('alice', 'wrong'), invalid);
  rejected(request('alice', 'alice-password'), blocked);
  assert.equal(sql('SELECT COUNT(*) AS count FROM login_attempts')[0].count, 5);
  sql("UPDATE login_attempts SET attempted_at = datetime('now', '-16 minutes')");
  authenticated(request('alice', 'alice-password'), 'alice');
  authenticated(request('alice@example.test', 'alice-password', '192.0.2.100'), 'alice');
  rejected(request('alice', 'wrong'), invalid);
});

test('GET and invalid form submissions do not authenticate or consume the failure budget', t => {
  const { request, sql } = fixture(t);
  const get = request('', '', '192.0.2.1', { method: 'GET' });
  assert.equal(get.hasLoginForm, true);
  assert.equal(get.session.user_id, undefined);
  rejected(request('alice', 'alice-password', '192.0.2.1', { token: 'wrong-token' }),
    'Your session expired. Please refresh and try again.');
  rejected(request('alice', ''), 'Please enter your username or email and password.');
  assert.equal(sql('SELECT COUNT(*) AS count FROM login_attempts')[0].count, 0);
});
