<?php
declare(strict_types=1);

const ADMIN_LOGIN_FAILURE_LIMIT = 5;
const ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60;

// Return seconds until another credential attempt is allowed (0 = not blocked).
// State belongs to the client IP, not a PHP session or the supplied username.
function recordAdminLoginAttempt(PDO $pdo, string $ip, bool $credentialsMatch, ?int $now = null): int
{
    $now = $now ?? time();
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $pdo->exec('CREATE TABLE IF NOT EXISTS admin_login_throttle (
        ip VARBINARY(16) NOT NULL PRIMARY KEY,
        failures INT NOT NULL,
        window_started BIGINT NOT NULL,
        blocked_until BIGINT NOT NULL'
        . ($sqlite ? '' : ', INDEX idx_admin_login_window (window_started)')
        . ')' . ($sqlite ? '' : ' ENGINE=InnoDB'));

    // Keep only recent state. Blocked requests never extend their own timeout.
    $cleanup = $pdo->prepare('DELETE FROM admin_login_throttle WHERE window_started < ? AND blocked_until <= ?');
    $cleanup->execute([$now - 86400, $now]);

    $pdo->beginTransaction();
    try {
        // The upsert reserves the row even for the first concurrent attempts.
        // MySQL's row lock / SQLite's write lock lasts until commit or rollback.
        $insert = $pdo->prepare('INSERT INTO admin_login_throttle (ip, failures, window_started, blocked_until)
            VALUES (?, 0, ?, 0)' . ($sqlite ? ' ON CONFLICT(ip) DO NOTHING' : ' ON DUPLICATE KEY UPDATE ip = ip'));
        $insert->execute([$ip, $now]);
        $read = $pdo->prepare('SELECT failures, window_started, blocked_until FROM admin_login_throttle WHERE ip = ?'
            . ($sqlite ? '' : ' FOR UPDATE'));
        $read->execute([$ip]);
        $state = $read->fetch(PDO::FETCH_ASSOC);
        if (!is_array($state)) throw new RuntimeException('Admin throttle state is unavailable.');

        $blockedUntil = (int) $state['blocked_until'];
        if ($blockedUntil > $now) {
            $pdo->commit();
            return $blockedUntil - $now;
        }

        $failures = (int) $state['failures'];
        $windowStarted = (int) $state['window_started'];
        if ($windowStarted + ADMIN_LOGIN_WINDOW_SECONDS <= $now) {
            $failures = 0;
            $windowStarted = $now;
            $blockedUntil = 0;
        }
        if (!$credentialsMatch) {
            $failures++;
            if ($failures >= ADMIN_LOGIN_FAILURE_LIMIT) {
                $blockedUntil = $now + ADMIN_LOGIN_WINDOW_SECONDS;
            }
        }
        // A successful login must not erase previous failures from this IP.
        $update = $pdo->prepare('UPDATE admin_login_throttle SET failures = ?, window_started = ?, blocked_until = ? WHERE ip = ?');
        $update->execute([$failures, $windowStarted, $blockedUntil, $ip]);
        $pdo->commit();
        return max(0, $blockedUntil - $now);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
