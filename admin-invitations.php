<?php
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/http-basic-auth.php';
require_once __DIR__ . '/server/core/admin-login-throttle.php';
require_once __DIR__ . '/server/core/registration-invitations.php';
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$authenticated = false;
if (isset($ADMIN_USER, $ADMIN_PASS) && is_string($ADMIN_USER) && $ADMIN_USER !== ''
    && is_string($ADMIN_PASS) && $ADMIN_PASS !== '' && httpBasicCredentials() !== null) {
    $authenticated = httpBasicCredentialsMatch($ADMIN_USER, $ADMIN_PASS);
    try {
        $retryAfter = recordAdminLoginAttempt(db(), clientIpBinary(), $authenticated);
    } catch (Throwable $e) {
        http_response_code(503);
        exit('Admin sign-in is temporarily unavailable. Please try again later.');
    }
    if ($retryAfter > 0) {
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        exit('Too many admin sign-in attempts. Please try again later.');
    }
}
if (!$authenticated) {
    header('WWW-Authenticate: Basic realm="Messages"');
    http_response_code(401);
    exit('Unauthorized');
}

$escape = static fn($value): string => htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
$formId = 'admin_invitations';
$guard = ensureFormGuard($formId);
$error = '';
$notice = $_SESSION['invitation_notice'] ?? '';
$newLink = $_SESSION['invitation_new_link'] ?? '';
unset($_SESSION['invitation_notice'], $_SESSION['invitation_new_link']);
$email = '';
$rows = [];
$post = static fn(string $key): string => is_string($_POST[$key] ?? null) ? $_POST[$key] : '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $error = validateFormGuard($formId, $post('form_token'), trim($post('website')), 0) ?? '';
    if ($error === '') {
        try {
            if ($post('action') === 'create') {
                $email = trim($post('email'));
                registrationInvitationUrl(''); // Validate production origin before creating a row.
                $token = createRegistrationInvitation(db(), $email);
                $_SESSION['invitation_new_link'] = registrationInvitationUrl($token);
                $_SESSION['invitation_notice'] = 'Invitation created for ' . strtolower($email) . '. Send the link privately to this person. No email has been sent automatically.';
            } elseif ($post('action') === 'revoke' && ctype_digit($post('id')) && (int) $post('id') > 0) {
                $_SESSION['invitation_notice'] = revokeRegistrationInvitation(db(), (int) $post('id'))
                    ? 'Invitation cancelled.' : 'This invitation is no longer active.';
            } else {
                throw new DomainException('Please choose a valid action.');
            }
            resetFormGuard($formId);
            header('Location: /admin-invitations.php', true, 303);
            exit;
        } catch (DomainException $e) {
            $error = $e->getMessage();
        } catch (Throwable $e) {
            $error = 'Unable to update invitations right now. Please check that the invitations table is installed and try again.';
        }
    }
}
try {
    $rows = db()->query('SELECT id, email, created_at, expires_at, used_at, revoked_at
        FROM registration_invitations ORDER BY id DESC LIMIT 100')->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    $error = 'Invitations are unavailable. Please check that the invitations table is installed.';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Invitations — Early Formation</title>
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/invitations.css">
</head>
<body>
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Admin navigation">
                <a class="app-nav__link" href="/admin-messages.php">Messages</a>
                <a class="app-nav__link" href="/dashboard.php">My Library</a>
            </nav>
        </div>
    </header>
    <main class="page">
        <div class="wrap invitations-shell">
            <div>
                <p class="eyebrow">Private Beta · Admin</p>
                <h1>Invite someone to create</h1>
                <p class="muted">A personal invitation opens the door to Early Formation. Each link works once, for one email address, and expires after seven days.</p>
                <p><strong><?= inviteOnlyRegistration() ? 'Registration is by invitation only.' : 'Public registration is open.' ?></strong></p>
            </div>
            <?php if ($error !== ''): ?><div class="auth-error" role="alert"><?= $escape($error) ?></div><?php endif; ?>
            <?php if ($notice !== ''): ?><div class="invitation-notice" role="status"><?= $escape($notice) ?></div><?php endif; ?>
            <?php if ($newLink !== ''): ?>
            <section class="panel invitation-panel">
                <h2>Your invitation link</h2>
                <p class="muted">Copy this link now. It is only shown once. If you lose it, cancel the invitation and create a new one.</p>
                <label for="invitation-link">Personal invitation link</label>
                <input class="input" id="invitation-link" value="<?= $escape($newLink) ?>" readonly>
                <div class="actions"><button type="button" class="button-primary" id="copy-invitation">Copy link</button><span id="copy-status" role="status"></span></div>
            </section>
            <?php endif; ?>
            <section class="panel invitation-panel">
                <h2>Create an invitation</h2>
                <form method="post" action="/admin-invitations.php" class="invitation-create">
                    <input type="hidden" name="action" value="create">
                    <input type="hidden" name="form_token" value="<?= $escape($guard['token']) ?>">
                    <div class="hp"><label for="website">Website</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off"></div>
                    <div class="field"><label for="email">Tester’s email address</label><input class="input" id="email" name="email" type="email" maxlength="190" required value="<?= $escape($email) ?>" autocomplete="off"></div>
                    <button class="button-primary" type="submit">Create invitation</button>
                </form>
            </section>
            <section class="panel invitation-panel">
                <h2>Recent invitations</h2>
                <p class="muted">The latest 100 invitations. All dates are in UTC. Cancelling an invitation does not remove an existing account.</p>
                <?php if ($rows === []): ?><p>No invitations to show yet.</p><?php else: ?>
                <div class="invitation-table-scroll" tabindex="0" role="region" aria-label="Recent invitations">
                    <table class="invitation-table">
                        <thead><tr><th>Email</th><th>Status</th><th>Created</th><th>Expires</th><th>Action</th></tr></thead>
                        <tbody>
                        <?php foreach ($rows as $row):
                            $status = $row['used_at'] !== null ? 'Used' : ($row['revoked_at'] !== null ? 'Cancelled' : ($row['expires_at'] <= invitationTimestamp() ? 'Expired' : 'Active'));
                        ?>
                            <tr>
                                <td><?= $escape($row['email']) ?></td><td><?= $status ?></td>
                                <td><?= $escape($row['created_at']) ?></td><td><?= $escape($row['expires_at']) ?></td>
                                <td><?php if ($status === 'Active'): ?>
                                    <form method="post" action="/admin-invitations.php">
                                        <input type="hidden" name="action" value="revoke">
                                        <input type="hidden" name="id" value="<?= (int) $row['id'] ?>">
                                        <input type="hidden" name="form_token" value="<?= $escape($guard['token']) ?>">
                                        <button class="button-secondary" type="submit">Cancel</button>
                                    </form>
                                <?php else: ?>—<?php endif; ?></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
                <?php endif; ?>
            </section>
        </div>
    </main>
    <script src="/assets/invitation-admin.js" defer></script>
</body>
</html>
