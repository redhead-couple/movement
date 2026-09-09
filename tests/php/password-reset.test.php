<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/server/core/password-reset.php';

function passwordResetAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function passwordResetTestDatabase(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used_at TEXT NULL,
            created_at TEXT NOT NULL,
            request_ip BLOB NOT NULL
        );
        CREATE TABLE password_reset_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purpose TEXT NOT NULL,
            email_hash TEXT NULL,
            ip BLOB NOT NULL,
            attempted_at TEXT NOT NULL
        );
    ');
    return $pdo;
}

function insertPasswordResetUser(PDO $pdo, string $username, string $email, string $password): int
{
    $stmt = $pdo->prepare('
        INSERT INTO users (username, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
    ');
    $stmt->execute([
        $username,
        $email,
        password_hash($password, PASSWORD_DEFAULT),
        '2026-09-01 00:00:00',
    ]);
    return (int) $pdo->lastInsertId();
}

$pdo = passwordResetTestDatabase();
$aliceId = insertPasswordResetUser($pdo, 'alice', 'alice@example.test', 'old-password');
$now = new DateTimeImmutable('2026-09-01 12:00:00', new DateTimeZone('UTC'));
$GLOBALS['APP_HTTPS_ORIGIN'] = 'https://accounts.example.test';

$deliveries = [];
$mailer = static function (string $recipient, string $url, int $ttl) use (&$deliveries): bool {
    $deliveries[] = compact('recipient', 'url', 'ttl');
    return true;
};

$tokenA = str_repeat('a', 64);
$existing = requestPasswordReset(
    $pdo,
    'Alice@Example.Test',
    inet_pton('192.0.2.10'),
    $mailer,
    $now,
    static fn (): string => $tokenA
);
passwordResetAssert($existing['publicMessage'] === PASSWORD_RESET_PUBLIC_MESSAGE, 'Existing account response was not neutral.');
passwordResetAssert(!array_key_exists('token', $existing), 'Raw token escaped in the request result.');
passwordResetAssert($existing['mailAttempted'] === true && $existing['mailSent'] === true, 'Existing account email was not sent.');
passwordResetAssert(count($deliveries) === 1, 'Expected one reset email.');
passwordResetAssert($deliveries[0]['recipient'] === 'alice@example.test', 'Reset email recipient changed unexpectedly.');
passwordResetAssert($deliveries[0]['ttl'] === 60, 'Reset email TTL is incorrect.');
passwordResetAssert(
    $deliveries[0]['url'] === 'https://accounts.example.test/reset-password.php#token=' . $tokenA,
    'Reset link did not use the configured HTTPS origin.'
);

$storedA = $pdo->query('SELECT token_hash, expires_at, used_at FROM password_reset_tokens ORDER BY id DESC LIMIT 1')->fetch();
passwordResetAssert(is_array($storedA), 'Reset token row was not stored.');
passwordResetAssert($storedA['token_hash'] === hash('sha256', $tokenA), 'Reset token hash is incorrect.');
passwordResetAssert($storedA['token_hash'] !== $tokenA, 'Raw reset token was stored in the database.');
passwordResetAssert($storedA['expires_at'] === '2026-09-01 13:00:00', 'Reset expiration is not 60 minutes.');
passwordResetAssert(findUsablePasswordResetToken($pdo, $tokenA, $now) !== null, 'New reset token should be usable.');

$nonexistentMailerCalled = false;
$nonexistent = requestPasswordReset(
    $pdo,
    'missing@example.test',
    inet_pton('192.0.2.11'),
    static function () use (&$nonexistentMailerCalled): bool {
        $nonexistentMailerCalled = true;
        return true;
    },
    $now,
    static function (): string {
        throw new RuntimeException('A token must not be generated for a missing account.');
    }
);
passwordResetAssert($nonexistent['publicMessage'] === $existing['publicMessage'], 'Missing account response reveals account existence.');
passwordResetAssert($nonexistent['mailAttempted'] === false, 'Mail was attempted for a missing account.');
passwordResetAssert($nonexistentMailerCalled === false, 'Mailer ran for a missing account.');

$tokenB = str_repeat('b', 64);
requestPasswordReset(
    $pdo,
    'alice@example.test',
    inet_pton('192.0.2.12'),
    $mailer,
    $now->modify('+1 minute'),
    static fn (): string => $tokenB
);
passwordResetAssert(findUsablePasswordResetToken($pdo, $tokenA, $now->modify('+1 minute')) === null, 'Second request did not invalidate the first token.');
passwordResetAssert(findUsablePasswordResetToken($pdo, $tokenB, $now->modify('+1 minute')) !== null, 'Replacement token is not usable.');

$resetResult = consumePasswordResetToken($pdo, $tokenB, 'new-password', $now->modify('+2 minutes'));
passwordResetAssert($resetResult === 'success', 'Valid reset token did not reset the password.');
$newHash = $pdo->query("SELECT password_hash FROM users WHERE id = {$aliceId}")->fetchColumn();
passwordResetAssert(is_string($newHash), 'Updated password hash is missing.');
passwordResetAssert(!password_verify('old-password', $newHash), 'Old password still works after reset.');
passwordResetAssert(password_verify('new-password', $newHash), 'New password does not work after reset.');
passwordResetAssert(consumePasswordResetToken($pdo, $tokenB, 'another-password', $now->modify('+3 minutes')) === 'invalid', 'Used token was reusable.');
passwordResetAssert(findUsablePasswordResetToken($pdo, $tokenB, $now->modify('+3 minutes')) === null, 'Used token remained visible as usable.');

$tokenC = str_repeat('c', 64);
requestPasswordReset(
    $pdo,
    'alice@example.test',
    inet_pton('192.0.2.13'),
    $mailer,
    $now->modify('+4 minutes'),
    static fn (): string => $tokenC
);
$expire = $pdo->prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?');
$expire->execute(['2026-09-01 12:03:59', hash('sha256', $tokenC)]);
passwordResetAssert(consumePasswordResetToken($pdo, $tokenC, 'third-password', $now->modify('+4 minutes')) === 'invalid', 'Expired token was accepted.');
passwordResetAssert(findUsablePasswordResetToken($pdo, '../bad-token', $now) === null, 'Malformed token was accepted.');
passwordResetAssert(consumePasswordResetToken($pdo, str_repeat('d', 64), 'third-password', $now) === 'invalid', 'Unknown token was accepted.');

$mailCountBeforeLimit = count($deliveries);
$tokenD = str_repeat('d', 64);
$limited = requestPasswordReset(
    $pdo,
    'alice@example.test',
    inet_pton('192.0.2.14'),
    $mailer,
    $now->modify('+5 minutes'),
    static fn (): string => $tokenD
);
passwordResetAssert($limited['publicMessage'] === PASSWORD_RESET_PUBLIC_MESSAGE, 'Rate-limit response was not neutral.');
passwordResetAssert($limited['mailAttempted'] === false, 'Per-email rate limit did not stop the fourth hourly email.');
passwordResetAssert(count($deliveries) === $mailCountBeforeLimit, 'Rate-limited request sent an email.');

$bobId = insertPasswordResetUser($pdo, 'bob', 'bob@example.test', 'bob-password');
$sharedIp = inet_pton('198.51.100.9');
for ($i = 0; $i < 5; $i++) {
    requestPasswordReset(
        $pdo,
        "missing{$i}@example.test",
        $sharedIp,
        $mailer,
        $now,
        static fn (): string => str_repeat('e', 64)
    );
}
$ipLimited = requestPasswordReset(
    $pdo,
    'bob@example.test',
    $sharedIp,
    $mailer,
    $now,
    static fn (): string => str_repeat('f', 64)
);
passwordResetAssert($ipLimited['mailAttempted'] === false, 'Per-IP hourly rate limit did not stop the sixth request.');
$bobTokens = $pdo->query("SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = {$bobId}")->fetchColumn();
passwordResetAssert((int) $bobTokens === 0, 'IP-limited request created a token.');

$validationIp = inet_pton('203.0.113.99');
for ($i = 0; $i < 20; $i++) {
    passwordResetAssert(
        passwordResetTokenValidationAllowed($pdo, $validationIp, $now) === true,
        'Token validation was limited too early.'
    );
}
passwordResetAssert(
    passwordResetTokenValidationAllowed($pdo, $validationIp, $now) === false,
    'Token validation guessing was not rate limited.'
);

$charlieId = insertPasswordResetUser($pdo, 'charlie', 'charlie@example.test', 'charlie-password');
$tokenE = str_repeat('e', 64);
$mailFailure = requestPasswordReset(
    $pdo,
    'charlie@example.test',
    inet_pton('203.0.113.20'),
    static fn (): bool => false,
    $now,
    static fn (): string => $tokenE
);
passwordResetAssert($mailFailure['mailSent'] === false, 'Failed mail transport was reported as successful.');
passwordResetAssert(findUsablePasswordResetToken($pdo, $tokenE, $now) === null, 'Token remained usable after mail delivery failed.');
$charlieStored = $pdo->query("SELECT token_hash FROM password_reset_tokens WHERE user_id = {$charlieId}")->fetchColumn();
passwordResetAssert($charlieStored === hash('sha256', $tokenE), 'Mail-failure token was not hash-only in storage.');

$logPath = tempnam(sys_get_temp_dir(), 'password-reset-log-');
passwordResetAssert(is_string($logPath), 'Could not create temporary log file.');
$previousLog = ini_set('error_log', $logPath);
$GLOBALS['PASSWORD_RESET_FROM_EMAIL'] = '';
deliverPasswordResetEmail('charlie@example.test', 'https://accounts.example.test/reset-password.php#token=' . $tokenE, 60);
$logContents = (string) file_get_contents($logPath);
passwordResetAssert(!str_contains($logContents, $tokenE), 'Raw reset token was written to the error log.');
if ($previousLog !== false) {
    ini_set('error_log', $previousLog);
}
unlink($logPath);

ini_set('session.use_cookies', '0');
ini_set('session.save_path', sys_get_temp_dir());
require_once dirname(__DIR__, 2) . '/server/core/security-helpers.php';
$guard = ensureFormGuard('password_reset_csrf_test');
$csrfError = validateFormGuard('password_reset_csrf_test', str_repeat('0', 64), '', 0);
passwordResetAssert($csrfError !== null, 'Incorrect CSRF token was accepted.');
passwordResetAssert(validateFormGuard('password_reset_csrf_test', $guard['token'], '', 0) === null, 'Correct CSRF token was rejected.');
if (session_status() === PHP_SESSION_ACTIVE) {
    destroyWebSession();
}

echo "PASSWORD_RESET_TEST_OK\n";
