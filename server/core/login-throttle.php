<?php
declare(strict_types=1);

/**
 * Check credentials while holding both failure-budget locks. The existing
 * login_attempts history remains authoritative, including pre-deployment rows.
 * Return only after commit; database/locking failures must never authenticate.
 *
 * @return array{status: string, user?: array}
 */
function authenticateWithLoginThrottle(PDO $pdo, string $login, string $password, string $ip): array
{
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $pdo->exec($sqlite
        ? 'CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, login_identifier TEXT COLLATE NOCASE NOT NULL,
            ip BLOB NOT NULL, attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
        : 'CREATE TABLE IF NOT EXISTS login_attempts (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            login_identifier VARCHAR(190) NOT NULL, ip VARBINARY(16) NOT NULL,
            attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_login_attempts_ip_time (ip, attempted_at),
            INDEX idx_login_attempts_login_time (login_identifier, attempted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempt_locks (
        lock_key VARCHAR(80) NOT NULL PRIMARY KEY
    )' . ($sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin'));

    // Resolve account aliases before starting the transaction, so this lookup
    // cannot establish a stale REPEATABLE READ snapshot before waiting for locks.
    $lookup = $pdo->prepare('SELECT id, username, email, password_hash FROM users
        WHERE username = ? OR email = ? LIMIT 1');
    $lookup->execute([$login, $login]);
    $user = $lookup->fetch(PDO::FETCH_ASSOC);
    $lookup->closeCursor();
    $identifier = $user ? $user['username'] : mb_substr($login, 0, 190);
    $accountKey = $user ? 'user:' . $user['id'] : 'unknown:' . hash('sha256', mb_strtolower($identifier));
    $keys = ['ip:' . bin2hex($ip), $accountKey];
    sort($keys, SORT_STRING);

    $pdo->beginTransaction();
    try {
        // Upsert takes a row/write lock even when there are no failures yet.
        // Consistent ordering avoids deadlocks between overlapping IP/accounts.
        $lock = $pdo->prepare('INSERT INTO login_attempt_locks (lock_key) VALUES (?)'
            . ($sqlite ? ' ON CONFLICT(lock_key) DO UPDATE SET lock_key = excluded.lock_key'
                : ' ON DUPLICATE KEY UPDATE lock_key = lock_key'));
        foreach ($keys as $key) $lock->execute([$key]);

        // No consistent reads inside this transaction until BOTH locks are held.
        // This request therefore sees failures committed by preceding waiters.
        $since = $sqlite ? "datetime('now', '-15 minutes')" : '(NOW() - INTERVAL 15 MINUTE)';
        $ipCount = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > ' . $since);
        $ipCount->execute([$ip]);
        $accountCount = $pdo->prepare('SELECT COUNT(*) FROM login_attempts
            WHERE login_identifier IN (?, ?) AND attempted_at > ' . $since);
        $accountCount->execute([$identifier, $user ? $user['email'] : $identifier]);

        if ((int) $ipCount->fetchColumn() >= 5 || (int) $accountCount->fetchColumn() >= 5) {
            $result = ['status' => 'blocked'];
        } elseif (!$user || !password_verify($password, $user['password_hash'])) {
            $insert = $pdo->prepare('INSERT INTO login_attempts (login_identifier, ip) VALUES (?, ?)');
            $insert->execute([$identifier, $ip]);
            $result = ['status' => 'invalid'];
        } else {
            // Success neither spends nor resets either failure budget.
            $result = ['status' => 'authenticated', 'user' => $user];
        }
        $pdo->commit();
        return $result;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
