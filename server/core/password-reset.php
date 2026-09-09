<?php

require_once __DIR__ . '/web-session.php';

const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TTL_MINUTES = 60;
const PASSWORD_RESET_EMAIL_LIMIT_PER_HOUR = 3;
const PASSWORD_RESET_IP_LIMIT_PER_HOUR = 5;
const PASSWORD_RESET_TOKEN_VALIDATION_IP_LIMIT_PER_15_MINUTES = 20;
const PASSWORD_RESET_PUBLIC_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';
const PASSWORD_RESET_INVALID_MESSAGE = 'This password reset link is invalid or has expired.';

function passwordResetNow(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('UTC'));
}

function passwordResetTimestamp(DateTimeImmutable $date): string
{
    return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

function normalizePasswordResetEmail(string $email): string
{
    return strtolower(trim($email));
}

function passwordResetEmailHash(string $email): string
{
    return hash('sha256', normalizePasswordResetEmail($email));
}

function generatePasswordResetToken(): string
{
    return bin2hex(random_bytes(PASSWORD_RESET_TOKEN_BYTES));
}

function isValidPasswordResetToken(string $token): bool
{
    return preg_match('/\A[a-f0-9]{64}\z/', $token) === 1;
}

function passwordResetTokenHash(string $token): string
{
    return hash('sha256', $token);
}

function passwordResetRequestAllowed(
    PDO $pdo,
    string $emailHash,
    string $ip,
    DateTimeImmutable $now
): bool {
    $attemptedAt = passwordResetTimestamp($now);
    $cutoff = passwordResetTimestamp($now->modify('-1 hour'));
    $cleanupCutoff = passwordResetTimestamp($now->modify('-24 hours'));

    $cleanup = $pdo->prepare('DELETE FROM password_reset_attempts WHERE attempted_at < ?');
    $cleanup->execute([$cleanupCutoff]);

    $insert = $pdo->prepare("
        INSERT INTO password_reset_attempts (purpose, email_hash, ip, attempted_at)
        VALUES ('request', ?, ?, ?)
    ");
    $insert->execute([$emailHash, $ip, $attemptedAt]);

    $byEmail = $pdo->prepare("
        SELECT COUNT(*)
        FROM password_reset_attempts
        WHERE purpose = 'request' AND email_hash = ? AND attempted_at >= ?
    ");
    $byEmail->execute([$emailHash, $cutoff]);

    $byIp = $pdo->prepare("
        SELECT COUNT(*)
        FROM password_reset_attempts
        WHERE purpose = 'request' AND ip = ? AND attempted_at >= ?
    ");
    $byIp->execute([$ip, $cutoff]);

    return (int) $byEmail->fetchColumn() <= PASSWORD_RESET_EMAIL_LIMIT_PER_HOUR
        && (int) $byIp->fetchColumn() <= PASSWORD_RESET_IP_LIMIT_PER_HOUR;
}

function passwordResetTokenValidationAllowed(PDO $pdo, string $ip, ?DateTimeImmutable $now = null): bool
{
    $now = $now ?? passwordResetNow();
    $attemptedAt = passwordResetTimestamp($now);
    $cutoff = passwordResetTimestamp($now->modify('-15 minutes'));
    $cleanupCutoff = passwordResetTimestamp($now->modify('-24 hours'));

    $cleanup = $pdo->prepare('DELETE FROM password_reset_attempts WHERE attempted_at < ?');
    $cleanup->execute([$cleanupCutoff]);

    $insert = $pdo->prepare("\n        INSERT INTO password_reset_attempts (purpose, email_hash, ip, attempted_at)\n        VALUES ('token_validation', NULL, ?, ?)\n    ");
    $insert->execute([$ip, $attemptedAt]);

    $count = $pdo->prepare("\n        SELECT COUNT(*)\n        FROM password_reset_attempts\n        WHERE purpose = 'token_validation' AND ip = ? AND attempted_at >= ?\n    ");
    $count->execute([$ip, $cutoff]);

    return (int) $count->fetchColumn() <= PASSWORD_RESET_TOKEN_VALIDATION_IP_LIMIT_PER_15_MINUTES;
}

function configuredPasswordResetOrigin(): ?string
{
    return productionHttpsOrigin();
}

function buildPasswordResetUrl(string $token): ?string
{
    if (!isValidPasswordResetToken($token)) {
        return null;
    }

    $origin = configuredPasswordResetOrigin();
    if ($origin === null) {
        return null;
    }

    // URL fragments are not sent in HTTP requests, keeping the raw token out
    // of ordinary web-server access logs. reset-password.php moves it into a
    // same-origin POST body before performing any database lookup.
    return $origin . '/reset-password.php#token=' . rawurlencode($token);
}

function configuredPasswordResetFromEmail(): ?string
{
    $email = webConfigValue(
        'PASSWORD_RESET_FROM_EMAIL',
        'MOVEMENT_PASSWORD_RESET_FROM_EMAIL',
        ''
    );
    if (!is_string($email)) {
        return null;
    }

    $email = trim($email);
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false ? $email : null;
}

function deliverPasswordResetEmail(string $recipient, string $resetUrl, int $ttlMinutes): bool
{
    $from = configuredPasswordResetFromEmail();
    if (
        filter_var($recipient, FILTER_VALIDATE_EMAIL) === false ||
        filter_var($resetUrl, FILTER_VALIDATE_URL) === false ||
        !str_starts_with($resetUrl, 'https://') ||
        $from === null
    ) {
        error_log('Password reset email configuration is unavailable.');
        return false;
    }

    $subject = 'Reset your Early Formation password';
    $body = implode("\n", [
        'A password reset was requested for your Early Formation account.',
        '',
        'Use this single-use link to choose a new password:',
        $resetUrl,
        '',
        "This link expires in {$ttlMinutes} minutes.",
        'If you did not request this reset, you can ignore this email.',
    ]);
    $headers = implode("\r\n", [
        'From: ' . $from,
        'Content-Type: text/plain; charset=UTF-8',
        'X-Auto-Response-Suppress: All',
    ]);

    $sent = @mail($recipient, $subject, $body, $headers);
    if (!$sent) {
        error_log('Password reset email delivery failed.');
    }

    return $sent;
}

function invalidatePasswordResetToken(PDO $pdo, int $tokenId, DateTimeImmutable $now): void
{
    $stmt = $pdo->prepare('
        UPDATE password_reset_tokens
        SET used_at = ?
        WHERE id = ? AND used_at IS NULL
    ');
    $stmt->execute([passwordResetTimestamp($now), $tokenId]);
}

function requestPasswordReset(
    PDO $pdo,
    string $email,
    string $ip,
    ?callable $mailer = null,
    ?DateTimeImmutable $now = null,
    ?callable $tokenGenerator = null
): array {
    $now = $now ?? passwordResetNow();
    $email = normalizePasswordResetEmail($email);
    $result = [
        'publicMessage' => PASSWORD_RESET_PUBLIC_MESSAGE,
        'mailAttempted' => false,
        'mailSent' => false,
    ];

    if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return $result;
    }

    if (!passwordResetRequestAllowed($pdo, passwordResetEmailHash($email), $ip, $now)) {
        return $result;
    }

    $findUser = $pdo->prepare('
        SELECT id, email
        FROM users
        WHERE LOWER(email) = ?
        LIMIT 1
    ');
    $findUser->execute([$email]);
    $user = $findUser->fetch(PDO::FETCH_ASSOC);
    if (!is_array($user)) {
        return $result;
    }

    $token = $tokenGenerator === null ? generatePasswordResetToken() : (string) $tokenGenerator();
    if (!isValidPasswordResetToken($token)) {
        throw new RuntimeException('Password reset token generation failed.');
    }

    $tokenHash = passwordResetTokenHash($token);
    $createdAt = passwordResetTimestamp($now);
    $expiresAt = passwordResetTimestamp($now->modify('+' . PASSWORD_RESET_TTL_MINUTES . ' minutes'));

    $pdo->beginTransaction();
    try {
        $invalidate = $pdo->prepare('
            UPDATE password_reset_tokens
            SET used_at = ?
            WHERE user_id = ? AND used_at IS NULL
        ');
        $invalidate->execute([$createdAt, (int) $user['id']]);

        $insert = $pdo->prepare('
            INSERT INTO password_reset_tokens
                (user_id, token_hash, expires_at, used_at, created_at, request_ip)
            VALUES (?, ?, ?, NULL, ?, ?)
        ');
        $insert->execute([
            (int) $user['id'],
            $tokenHash,
            $expiresAt,
            $createdAt,
            $ip,
        ]);
        $tokenId = (int) $pdo->lastInsertId();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    $resetUrl = buildPasswordResetUrl($token);
    $result['mailAttempted'] = true;
    $mailer = $mailer ?? 'deliverPasswordResetEmail';
    $sent = $resetUrl !== null
        && (bool) $mailer((string) $user['email'], $resetUrl, PASSWORD_RESET_TTL_MINUTES);
    $result['mailSent'] = $sent;

    if (!$sent) {
        invalidatePasswordResetToken($pdo, $tokenId, $now);
    }

    return $result;
}

function findUsablePasswordResetToken(
    PDO $pdo,
    string $token,
    ?DateTimeImmutable $now = null
): ?array {
    if (!isValidPasswordResetToken($token)) {
        return null;
    }

    $now = $now ?? passwordResetNow();
    $hash = passwordResetTokenHash($token);
    $stmt = $pdo->prepare('
        SELECT id, user_id, token_hash, expires_at, used_at
        FROM password_reset_tokens
        WHERE token_hash = ?
        LIMIT 1
    ');
    $stmt->execute([$hash]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (
        !is_array($row) ||
        !is_string($row['token_hash'] ?? null) ||
        !hash_equals($row['token_hash'], $hash) ||
        $row['used_at'] !== null ||
        !is_string($row['expires_at'] ?? null) ||
        $row['expires_at'] <= passwordResetTimestamp($now)
    ) {
        return null;
    }

    return $row;
}

function consumePasswordResetToken(
    PDO $pdo,
    string $token,
    string $newPassword,
    ?DateTimeImmutable $now = null
): string {
    if (!isValidPasswordResetToken($token)) {
        return 'invalid';
    }

    $now = $now ?? passwordResetNow();
    $nowString = passwordResetTimestamp($now);
    $hash = passwordResetTokenHash($token);

    $pdo->beginTransaction();
    try {
        $find = $pdo->prepare('
            SELECT id, user_id, token_hash, expires_at, used_at
            FROM password_reset_tokens
            WHERE token_hash = ?
            LIMIT 1
        ');
        $find->execute([$hash]);
        $row = $find->fetch(PDO::FETCH_ASSOC);

        if (
            !is_array($row) ||
            !is_string($row['token_hash'] ?? null) ||
            !hash_equals($row['token_hash'], $hash) ||
            $row['used_at'] !== null ||
            !is_string($row['expires_at'] ?? null) ||
            $row['expires_at'] <= $nowString
        ) {
            $pdo->rollBack();
            return 'invalid';
        }

        $claim = $pdo->prepare('
            UPDATE password_reset_tokens
            SET used_at = ?
            WHERE id = ? AND used_at IS NULL AND expires_at > ?
        ');
        $claim->execute([$nowString, (int) $row['id'], $nowString]);
        if ($claim->rowCount() !== 1) {
            $pdo->rollBack();
            return 'invalid';
        }

        $findUser = $pdo->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
        $findUser->execute([(int) $row['user_id']]);
        $user = $findUser->fetch(PDO::FETCH_ASSOC);
        if (!is_array($user) || !is_string($user['password_hash'] ?? null)) {
            $pdo->rollBack();
            return 'invalid';
        }

        if (password_verify($newPassword, $user['password_hash'])) {
            $pdo->rollBack();
            return 'same_password';
        }

        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        if (!is_string($newHash)) {
            throw new RuntimeException('Password hashing failed.');
        }

        $updateUser = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $updateUser->execute([$newHash, (int) $row['user_id']]);

        $invalidate = $pdo->prepare('
            UPDATE password_reset_tokens
            SET used_at = ?
            WHERE user_id = ? AND used_at IS NULL
        ');
        $invalidate->execute([$nowString, (int) $row['user_id']]);

        $pdo->commit();
        return 'success';
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
