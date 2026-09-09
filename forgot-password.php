<?php
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

require_once __DIR__ . '/server/core/require-guest.php';
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/password-reset.php';

$formId = 'forgot_password';
$guard = ensureFormGuard($formId);
$email = '';
$error = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim((string) ($_POST['email'] ?? ''));
    $guardError = validateFormGuard(
        $formId,
        (string) ($_POST['form_token'] ?? ''),
        trim((string) ($_POST['website'] ?? '')),
        1
    );

    if ($guardError !== null) {
        $error = $guardError;
    } elseif (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        $error = 'Please enter a valid email address.';
    } else {
        try {
            requestPasswordReset(db(), $email, clientIpBinary());
        } catch (Throwable $e) {
            error_log('Password reset request processing failed.');
        }

        $success = PASSWORD_RESET_PUBLIC_MESSAGE;
        $email = '';
        $guard = resetFormGuard($formId);
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Forgot Password</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
</head>

<body class="auth-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Authentication navigation">
                <a class="app-nav__link" href="/login.php">Back to login</a>
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
                            <h1>Reset your password securely</h1>
                            <p class="muted">Enter your account email. If it matches an account, we will send a single-use reset link.</p>
                        </div>
                    </div>

                    <div class="auth-form-pane">
                        <div class="section-head">
                            <div>
                                <h2>Forgot password?</h2>
                                <p class="muted">Reset links expire after <?= PASSWORD_RESET_TTL_MINUTES ?> minutes.</p>
                            </div>
                        </div>

                        <?php if ($error !== ''): ?>
                            <div class="auth-error"><p><?= htmlspecialchars($error) ?></p></div>
                        <?php endif; ?>

                        <?php if ($success !== ''): ?>
                            <div class="status-banner status-banner--success"><p><?= htmlspecialchars($success) ?></p></div>
                        <?php endif; ?>

                        <form method="post" action="" style="display:grid; gap:16px;" novalidate>
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">

                            <div class="hp">
                                <label for="website">Website</label>
                                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="field">
                                <label for="email">Email</label>
                                <input
                                    class="input"
                                    type="email"
                                    id="email"
                                    name="email"
                                    value="<?= htmlspecialchars($email) ?>"
                                    maxlength="190"
                                    required
                                    autocomplete="email">
                            </div>

                            <div class="actions">
                                <button class="button button-primary" type="submit">Send reset link</button>
                            </div>
                        </form>

                        <div class="auth-links">
                            <a class="button-secondary" href="/login.php">Return to login</a>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </main>
</body>

</html>
