<?php
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/password-reset.php';

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');

$formId = 'reset_password';
$guard = ensureFormGuard($formId);
$token = trim((string) ($_POST['token'] ?? ''));
$action = (string) ($_POST['action'] ?? '');
$error = '';
$success = '';
$tokenIsUsable = false;
$awaitingFragmentToken = $_SERVER['REQUEST_METHOD'] !== 'POST';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        $formId,
        (string) ($_POST['form_token'] ?? ''),
        trim((string) ($_POST['website'] ?? '')),
        $action === 'inspect' ? 0 : 1
    );
    $newPassword = (string) ($_POST['new_password'] ?? '');
    $confirmPassword = (string) ($_POST['confirm_password'] ?? '');

    if ($guardError !== null) {
        $error = $guardError;
    } elseif (!passwordResetTokenValidationAllowed(db(), clientIpBinary())) {
        $error = PASSWORD_RESET_INVALID_MESSAGE;
    } elseif (!isValidPasswordResetToken($token)) {
        $error = PASSWORD_RESET_INVALID_MESSAGE;
    } else {
        try {
            $tokenIsUsable = findUsablePasswordResetToken(db(), $token) !== null;
            if (!$tokenIsUsable) {
                $error = PASSWORD_RESET_INVALID_MESSAGE;
            } elseif ($action === 'inspect') {
                // The validated token is carried into the password form below.
            } elseif ($action !== 'reset') {
                $error = PASSWORD_RESET_INVALID_MESSAGE;
                $tokenIsUsable = false;
            } elseif ($newPassword === '' || $confirmPassword === '') {
                $error = 'Please fill in both password fields.';
            } elseif (strlen($newPassword) < 6) {
                $error = 'New password must be at least 6 characters.';
            } elseif ($newPassword !== $confirmPassword) {
                $error = 'New password and confirmation do not match.';
            } else {
                $result = consumePasswordResetToken(db(), $token, $newPassword);
                if ($result === 'success') {
                    destroyWebSession();
                    $success = 'Your password has been reset. You can now log in with your new password.';
                    $tokenIsUsable = false;
                } elseif ($result === 'same_password') {
                    $error = 'Choose a new password that is different from your current password.';
                } else {
                    $error = PASSWORD_RESET_INVALID_MESSAGE;
                    $tokenIsUsable = false;
                }
            }
        } catch (Throwable $e) {
            error_log('Password reset completion failed.');
            $error = 'Unable to reset your password right now. Please request a new link.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reset Password</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
</head>

<body class="auth-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Authentication navigation">
                <a class="app-nav__link" href="/login.php">Login</a>
            </nav>
        </div>
    </header>

    <main class="page">
        <div class="wrap">
            <section class="panel auth-shell">
                <div class="auth-card">
                    <div class="auth-intro">
                        <div class="auth-copy">
                            <p class="eyebrow">Account Recovery</p>
                            <h1>Choose a new password</h1>
                            <p class="muted">A reset link works once and expires after <?= PASSWORD_RESET_TTL_MINUTES ?> minutes.</p>
                        </div>
                    </div>

                    <div class="auth-form-pane">
                        <div class="section-head"><div><h2>Reset password</h2></div></div>

                        <?php if ($error !== ''): ?>
                            <div class="auth-error"><p><?= htmlspecialchars($error) ?></p></div>
                        <?php endif; ?>

                        <?php if ($success !== ''): ?>
                            <div class="status-banner status-banner--success"><p><?= htmlspecialchars($success) ?></p></div>
                        <?php endif; ?>

                        <?php if ($success !== ''): ?>
                            <div class="actions">
                                <a class="button button-primary" href="/login.php">Continue to login</a>
                            </div>
                        <?php elseif ($awaitingFragmentToken): ?>
                            <p class="muted" id="reset-link-status">Checking your reset link&hellip;</p>
                            <form method="post" action="" id="reset-token-form" hidden>
                                <input type="hidden" name="action" value="inspect">
                                <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">
                                <input type="hidden" name="token" id="reset-token-value" value="">
                                <input type="hidden" name="website" value="">
                            </form>
                            <div class="auth-links" id="request-new-reset" hidden>
                                <a class="button-secondary" href="/forgot-password.php">Request a new reset link</a>
                            </div>
                            <noscript>
                                <div class="auth-error"><p>JavaScript is required to open this secure reset link.</p></div>
                            </noscript>
                            <script>
                                (() => {
                                    const params = new URLSearchParams(window.location.hash.slice(1));
                                    const token = params.get('token') || '';
                                    history.replaceState(null, '', window.location.pathname);

                                    if (/^[a-f0-9]{64}$/.test(token)) {
                                        document.getElementById('reset-token-value').value = token;
                                        document.getElementById('reset-token-form').submit();
                                        return;
                                    }

                                    document.getElementById('reset-link-status').textContent = 'This password reset link is invalid or has expired.';
                                    document.getElementById('request-new-reset').hidden = false;
                                })();
                            </script>
                        <?php elseif ($tokenIsUsable): ?>
                            <form method="post" action="" style="display:grid; gap:16px;" novalidate>
                                <input type="hidden" name="action" value="reset">
                                <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">
                                <input type="hidden" name="token" value="<?= htmlspecialchars($token) ?>">

                                <div class="hp">
                                    <label for="website">Website</label>
                                    <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                                </div>

                                <div class="field">
                                    <label for="new_password">New password</label>
                                    <input class="input" type="password" id="new_password" name="new_password" minlength="6" required autocomplete="new-password">
                                </div>

                                <div class="field">
                                    <label for="confirm_password">Confirm new password</label>
                                    <input class="input" type="password" id="confirm_password" name="confirm_password" minlength="6" required autocomplete="new-password">
                                </div>

                                <div class="actions">
                                    <button class="button button-primary" type="submit">Reset password</button>
                                </div>
                            </form>
                        <?php else: ?>
                            <div class="auth-links">
                                <a class="button-secondary" href="/forgot-password.php">Request a new reset link</a>
                            </div>
                        <?php endif; ?>
                    </div>
                </div>
            </section>
        </div>
    </main>
</body>

</html>
