<?php

require_once __DIR__ . '/web-session.php';

const REGISTRATION_INVITATION_DAYS = 7;
const REGISTRATION_INVITATION_INVALID = 'This invitation is unavailable. It may have expired, been cancelled, or already been used. Please ask the person who invited you for a new link.';

function inviteOnlyRegistration(): bool
{
    // Only an explicit boolean false opens registration. Missing/invalid is closed.
    return ($GLOBALS['INVITE_ONLY_REGISTRATION'] ?? true) !== false;
}

function invitationTimestamp(?int $time = null): string
{
    return gmdate('Y-m-d H:i:s', $time ?? time());
}

function validInvitationToken(string $token): bool
{
    return preg_match('/\A[a-f0-9]{64}\z/', $token) === 1;
}

function findRegistrationInvitation(PDO $pdo, string $token): ?array
{
    if (!validInvitationToken($token)) return null;
    $stmt = $pdo->prepare('SELECT id, email, expires_at FROM registration_invitations
        WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?');
    $stmt->execute([hash('sha256', $token), invitationTimestamp()]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function createRegistrationInvitation(PDO $pdo, string $email): string
{
    $email = strtolower(trim($email));
    if (strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new DomainException('Please enter a valid email address (up to 190 characters).');
    }
    $existing = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
    $existing->execute([$email]);
    if ($existing->fetchColumn() !== false) {
        throw new DomainException('This email already has an account. They can log in or reset their password.');
    }
    $token = bin2hex(random_bytes(32));
    $now = time();
    $stmt = $pdo->prepare('INSERT INTO registration_invitations
        (email, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)');
    $stmt->execute([$email, hash('sha256', $token), invitationTimestamp($now),
        invitationTimestamp($now + REGISTRATION_INVITATION_DAYS * 86400)]);
    return $token;
}

function registrationInvitationUrl(string $token): string
{
    // Local links are resolved by the browser. Never trust a request Host header.
    $origin = isProductionWebEnvironment() ? productionHttpsOrigin() : '';
    if ($origin === null) throw new RuntimeException('Invitation origin is not configured.');
    return $origin . '/signup.php#invite=' . $token;
}

function revokeRegistrationInvitation(PDO $pdo, int $id): bool
{
    $stmt = $pdo->prepare('UPDATE registration_invitations SET revoked_at = ?
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?');
    $now = invitationTimestamp();
    $stmt->execute([$now, $id, $now]);
    return $stmt->rowCount() === 1;
}

function createRegisteredUser(PDO $pdo, string $username, string $email, string $password, ?string $token): array
{
    $email = strtolower(trim($email));
    $required = inviteOnlyRegistration();
    if ($required && ($token === null || !validInvitationToken($token))) {
        throw new DomainException(REGISTRATION_INVITATION_INVALID);
    }
    // Hash before acquiring a DB lock, but never establish a session until commit.
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    $pdo->beginTransaction();
    try {
        if ($required) {
            // Claim atomically: this write serializes concurrent use and cancellation.
            // Roll back the claim if account creation fails for any reason.
            $now = invitationTimestamp();
            $claim = $pdo->prepare('UPDATE registration_invitations SET used_at = ?
                WHERE token_hash = ? AND email = ? AND used_at IS NULL
                AND revoked_at IS NULL AND expires_at > ?');
            $claim->execute([$now, hash('sha256', $token), $email, $now]);
            if ($claim->rowCount() !== 1) throw new DomainException(REGISTRATION_INVITATION_INVALID);
        }
        $existing = $pdo->prepare('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1');
        $existing->execute([$username, $email]);
        if ($existing->fetchColumn() !== false) throw new DomainException('Username or email already exists.');
        $insert = $pdo->prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
        $insert->execute([$username, $email, $passwordHash]);
        $userId = (int) $pdo->lastInsertId();
        if ($required) {
            $mark = $pdo->prepare('UPDATE registration_invitations SET used_by_user_id = ? WHERE token_hash = ?');
            $mark->execute([$userId, hash('sha256', $token)]);
        }
        $pdo->commit();
        return ['id' => $userId, 'username' => $username, 'email' => $email, 'password_hash' => $passwordHash];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($error instanceof PDOException && (string) $error->getCode() === '23000') {
            throw new DomainException('Username or email already exists.');
        }
        throw $error;
    }
}
