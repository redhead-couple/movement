<?php
ini_set('display_errors', '0');
require_once __DIR__ . '/server/core/require-guest.php';
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/registration-invitations.php';
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$error = '';
$username = '';
$email = '';
$formId = 'signup';
$guard = ensureFormGuard($formId);
$inviteOnly = inviteOnlyRegistration();
$invitation = null;
$action = is_string($_POST['action'] ?? null) ? $_POST['action'] : 'register';
$postString = static fn(string $key): string => is_string($_POST[$key] ?? null) ? $_POST[$key] : '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'inspect') {
    unset($_SESSION['registration_invitation']);
    $guardError = validateFormGuard($formId, $postString('form_token'), '', 0);
    if ($guardError !== null) {
        $error = $guardError;
    } elseif ($inviteOnly) {
        $token = $postString('invitation');
        try {
            if (findRegistrationInvitation(db(), $token) !== null) {
                $_SESSION['registration_invitation'] = $token;
            } else {
                $error = REGISTRATION_INVITATION_INVALID;
            }
        } catch (Throwable $e) {
            $error = 'Invitations are temporarily unavailable. Please try again later.';
        }
    }
}
if ($inviteOnly && isset($_SESSION['registration_invitation'])) {
    try {
        $invitation = findRegistrationInvitation(db(), (string) $_SESSION['registration_invitation']);
        if ($invitation === null) {
            unset($_SESSION['registration_invitation']);
            $error = REGISTRATION_INVITATION_INVALID;
        } else {
            $email = $invitation['email'];
        }
    } catch (Throwable $e) {
        $error = 'Invitations are temporarily unavailable. Please try again later.';
    }
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action !== 'inspect') {
    $username = trim($postString('username'));
    $email = strtolower(trim($postString('email')));
    $password = $postString('password');
    $confirmPassword = $postString('confirm_password');
    $guardError = validateFormGuard($formId, $postString('form_token'), trim($postString('website')), 2);
    if ($guardError !== null) {
        $error = $guardError;
    } elseif ($inviteOnly && ($invitation === null || strcasecmp($email, $invitation['email']) !== 0)) {
        $error = REGISTRATION_INVITATION_INVALID;
    } elseif ($action !== 'register') {
        $error = 'Please refresh the page and try again.';
    } elseif (!preg_match('/^[a-zA-Z0-9_-]{3,50}$/', $username)) {
        $error = 'Username must be 3-50 characters and use only letters, numbers, underscores, or hyphens.';
    } elseif (strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Please enter a valid email address.';
    } elseif (strlen($password) < 6) {
        $error = 'Password must be at least 6 characters.';
    } elseif ($confirmPassword === '') {
        $error = 'Please confirm your password.';
    } elseif ($password !== $confirmPassword) {
        $error = 'Passwords do not match. Please try again.';
    } else {
        try {
            $user = createRegisteredUser(db(), $username, $email, $password,
                $inviteOnly ? (string) $_SESSION['registration_invitation'] : null);
            session_regenerate_id(true);
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            bindWebSessionToPassword($user['password_hash']);
            unset($user['password_hash'], $_SESSION['registration_invitation']);
            $_SESSION['user'] = $user;
            resetFormGuard($formId);
            header('Location: /dashboard.php', true, 303);
            exit;
        } catch (DomainException $e) {
            $error = $e->getMessage();
        } catch (Throwable $e) {
            $error = 'Something went wrong while creating the account. Please try again later.';
        }
    }
    if ($inviteOnly && $invitation !== null) $email = $invitation['email'];
}
$canRegister = !$inviteOnly || $invitation !== null;
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $inviteOnly ? "Invitation to Early Formation" : "Create an account" ?></title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
</head>

<body class="auth-page signup-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Authentication navigation">
                <a class="app-nav__link" href="/login.php">Log in</a>
            </nav>
        </div>
    </header>
    <main class="page">
        <div class="wrap">
            <section class="panel auth-shell">
                <div class="auth-card auth-card-signup">
                    <div class="auth-intro">
                        <div class="auth-copy auth-copy-signup">
                            <p class="eyebrow"><?= $inviteOnly ? "Private Beta" : "Create Account" ?></p>
                            <h1><?= $inviteOnly ? ($invitation !== null ? "You’re invited" : "A small group. A shared beginning.") : "Start building your slideshow space" ?></h1>
                            <p class="muted"><?= $inviteOnly ? "We’re developing Early Formation with a small group of testers. Explore, create, and help shape what comes next." : "Create an account to manage projects and publish your slideshows." ?></p>
                            <div class="auth-pills">
                                <span class="auth-pill">Project Dashboard</span>
                                <span class="auth-pill">Publishing</span>
                                <span class="auth-pill">Creative Workspace</span>
                            </div>
                        </div>
                    </div>
                    <div class="auth-form-pane">
                        <div class="section-head">
                            <div>
                                <h2><?= $canRegister ? "Create your account" : "Registration is by invitation only" ?></h2>
                                <p class="muted"><?= $canRegister ? "Choose a username and password to get started." : "If you’ve received an invitation, open the link sent to you. Already have an account? You can log in as usual." ?></p>
                            </div>
                        </div>

                        <?php if ($error !== ''): ?>
                            <div class="auth-error" role="alert">
                                <p><?= htmlspecialchars($error) ?></p>
                            </div>
                        <?php endif; ?>

                        <?php if ($canRegister): ?>
                        <form method="post" action="/signup.php" style="display:grid; gap:16px;">
                            <input type="hidden" name="action" value="register">
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">

                            <div class="hp">
                                <label for="website">Website</label>
                                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="field">
                                <label for="username">Username</label>
                                <input
                                    class="input"
                                    type="text"
                                    id="username"
                                    name="username"
                                    value="<?= htmlspecialchars($username) ?>"
                                    required
                                    autocomplete="username">
                            </div>

                            <div class="field">
                                <label for="email">Email</label>
                                <input
                                    class="input"
                                    type="email"
                                    id="email"
                                    name="email"
                                    value="<?= htmlspecialchars($email) ?>"
                                    required
                                    autocomplete="email" <?= $inviteOnly ? 'readonly aria-describedby="invited-email-note"' : '' ?>>
                                <?php if ($inviteOnly): ?><p id="invited-email-note" class="muted">This invitation is for this email address.</p><?php endif; ?>
                            </div>

                            <div class="field">
                                <label for="password">Create password</label>
                                <p id="password-help" class="muted">Choose a password for your new account. Use at least 6 characters.</p>
                                <input
                                    class="input"
                                    type="password"
                                    id="password"
                                    name="password"
                                    required
                                    minlength="6"
                                    aria-describedby="password-help"
                                    autocomplete="new-password">
                                <button class="button-secondary" type="button" data-password-toggle="password" aria-controls="password" style="display: none; align-self: flex-start;" hidden>Show password</button>
                            </div>

                            <div class="field">
                                <label for="confirm_password">Confirm password</label>
                                <input
                                    class="input"
                                    type="password"
                                    id="confirm_password"
                                    name="confirm_password"
                                    required
                                    autocomplete="new-password">
                                <button class="button-secondary" type="button" data-password-toggle="confirm_password" aria-controls="confirm_password" style="display: none; align-self: flex-start;" hidden>Show confirmation</button>
                            </div>

                            <div class="actions">
                                <button class="button-primary" type="submit">Create Account</button>
                            </div>
                        </form>
                        <?php endif; ?>

                        <div class="auth-links">
                            <a class="button-secondary" href="/login.php">Already have an account? Log in</a>
                        </div>

                        <div class="auth-legal">
                            <a href="/privacy.php">Privacy</a>
                            <a href="/terms.php">Terms</a>
                            <a href="/contact.php">Contact</a>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </main>
<?php if ($inviteOnly): ?>
    <form id="invitation-inspect" method="post" action="/signup.php" hidden>
        <input type="hidden" name="action" value="inspect">
        <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">
        <input type="hidden" name="invitation" value="">
    </form>
    <noscript><p class="wrap">Please enable JavaScript to open your invitation link.</p></noscript>
    <script src="/assets/invitation-signup.js" defer></script>
<?php endif; ?>
<?php if ($canRegister): ?>
    <script src="/assets/signup-passwords.js" defer></script>
<?php endif; ?>
</body>

</html>
