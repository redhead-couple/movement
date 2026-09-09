<?php
// S-01: Explicit production-safe overrides for this guest/unauthenticated page.
// login.php uses the guest guard, not app-init.php, so we suppress here explicitly.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);
require_once __DIR__ . '/server/core/require-guest.php';
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';
$error = '';
$login = '';
$formId = 'login';
$guard = ensureFormGuard($formId);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $login = trim($_POST['login'] ?? '');
    $password = $_POST['password'] ?? '';
    $guardError = validateFormGuard(
        $formId,
        (string)($_POST['form_token'] ?? ''),
        trim((string)($_POST['website'] ?? '')),
        1
    );

    if ($guardError !== null) {
        $error = $guardError;
    } elseif ($login === '' || $password === '') {
        $error = 'Please enter your username or email and password.';
    } else {
        try {
            $pdo = db();
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS login_attempts (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    login_identifier VARCHAR(190) NOT NULL,
                    ip VARBINARY(16) NOT NULL,
                    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_login_attempts_ip_time (ip, attempted_at),
                    INDEX idx_login_attempts_login_time (login_identifier, attempted_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            ");

            $ip = clientIpBinary();

            $attemptStmt = $pdo->prepare("
                SELECT COUNT(*)
                FROM login_attempts
                WHERE ip = ? AND attempted_at > (NOW() - INTERVAL 15 MINUTE)
            ");
            $attemptStmt->execute([$ip]);

            if ((int)$attemptStmt->fetchColumn() >= 5) {
                $error = 'Too many login attempts. Please wait a few minutes and try again.';
            } else {
                $stmt = $pdo->prepare('
                    SELECT id, username, email, password_hash
                    FROM users
                    WHERE username = ? OR email = ?
                    LIMIT 1
                ');
                $stmt->execute([$login, $login]);
                $user = $stmt->fetch();

                if (!$user || !password_verify($password, $user['password_hash'])) {
                    $error = 'Invalid login or password.';

                    $stmt = $pdo->prepare("
                        INSERT INTO login_attempts (login_identifier, ip)
                        VALUES (?, ?)
                    ");
                    $stmt->execute([mb_substr($login, 0, 190), $ip]);
                } else {
                    $stmt = $pdo->prepare("
                        DELETE FROM login_attempts
                        WHERE ip = ? OR login_identifier = ?
                    ");
                    $stmt->execute([$ip, mb_substr($login, 0, 190)]);

                    session_regenerate_id(true);
                    $_SESSION['user_id'] = (int)$user['id'];
                    $_SESSION['username'] = $user['username'];
                    $_SESSION['user'] = [
                        'id' => (int)$user['id'],
                        'username' => $user['username'],
                        'email' => $user['email'],
                    ];
                    resetFormGuard($formId);

                    header('Location: /dashboard.php');
                    exit;
                }
            }
        } catch (Throwable $e) {
            $error = 'Something went wrong during login.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Login</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
</head>

<body class="auth-page login-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Authentication navigation">
                <a class="app-nav__link" href="/signup.php">Create account</a>
            </nav>
        </div>
    </header>
    <main class="page">
        <div class="wrap">
            <section class="panel auth-shell">
                <div class="auth-card">
                    <div class="auth-intro">
                        <div class="auth-copy">
                            <p class="eyebrow">Slideshow Post Login</p>
                            <h1>Sign in to create slideshow posts</h1>
                            <p class="muted">Speak your mind, define your vision, and let AI-generated images bring your intentions to life in standout slideshow posts.</p>
                            <div class="auth-pills">
                                <span class="auth-pill">Local Access</span>
                                <span class="auth-pill">Editor Tools</span>
                                <span class="auth-pill">Backup Control</span>
                            </div>
                        </div>
                    </div>
                    <div class="auth-form-pane">
                        <div class="section-head">
                            <div>
                                <h2>Sign in</h2>
                                <p class="muted">Use your local username to continue into the dashboard.</p>
                            </div>
                        </div>

                        <?php if ($error !== ''): ?>
                            <div class="auth-error">
                                <p><?= htmlspecialchars($error) ?></p>
                            </div>
                        <?php endif; ?>

                        <form method="post" action="" style="display:grid; gap:16px;">
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">

                            <div class="hp">
                                <label for="website">Website</label>
                                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="field">
                                <label for="login">Username or Email</label>
                                <input
                                    class="input"
                                    type="text"
                                    id="login"
                                    name="login"
                                    value="<?= htmlspecialchars($login) ?>"
                                    required
                                    autocomplete="username">
                            </div>

                            <div class="field">
                                <label for="password">Password</label>
                                <input
                                    class="input"
                                    type="password"
                                    id="password"
                                    name="password"
                                    required
                                    autocomplete="current-password">
                            </div>

                            <div class="actions">
                                <button class="button button-primary" type="submit">Login</button>
                            </div>
                        </form>

                        <div class="auth-links">
                            <a class="button-secondary" href="/forgot-password.php">Forgot password?</a>
                            <a class="button-secondary" href="/signup.php">Don't have an account? Sign up</a>
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
</body>

</html>
