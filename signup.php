<?php
require_once __DIR__ . '/server/core/require-guest.php';
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$error = '';
$username = '';
$email = '';
$formId = 'signup';
$guard = ensureFormGuard($formId);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';
    $guardError = validateFormGuard(
        $formId,
        (string)($_POST['form_token'] ?? ''),
        trim((string)($_POST['website'] ?? '')),
        2
    );

    if ($guardError !== null) {
        $error = $guardError;
    } elseif ($username === '' || $email === '' || $password === '') {
        $error = 'Please fill in all fields.';
    } elseif (!preg_match('/^[a-zA-Z0-9_-]{3,50}$/', $username)) {
        $error = 'Username must be 3-50 characters and use only letters, numbers, underscores, or hyphens.';
    } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Please enter a valid email address.';
    } elseif (strlen($password) < 6) {
        $error = 'Password must be at least 6 characters.';
    } else {
        try {
            $pdo = db();

            $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1');
            $stmt->execute([$username, $email]);
            $existingUser = $stmt->fetch();

            if ($existingUser) {
                $error = 'Username or email already exists.';
            } else {
                $passwordHash = password_hash($password, PASSWORD_DEFAULT);

                $stmt = $pdo->prepare('
                    INSERT INTO users (username, email, password_hash)
                    VALUES (?, ?, ?)
                ');
                $stmt->execute([$username, $email, $passwordHash]);

                $userId = (int)$pdo->lastInsertId();

                session_regenerate_id(true);
                $_SESSION['user_id'] = $userId;
                $_SESSION['username'] = $username;
                $_SESSION['user'] = [
                    'id' => $userId,
                    'username' => $username,
                    'email' => $email,
                ];
                resetFormGuard($formId);

                header('Location: /dashboard.php');
                exit;
            }
        } catch (Throwable $e) {
            $error = 'Something went wrong while creating the account.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign Up</title>
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
                            <p class="eyebrow">Create Account</p>
                            <h1>Start building your slideshow space</h1>
                            <p class="muted">Create a local account to manage projects, publish public slideshows, and keep your editor flow tied to one dashboard.</p>
                            <div class="auth-pills">
                                <span class="auth-pill">Project Dashboard</span>
                                <span class="auth-pill">Publishing</span>
                                <span class="auth-pill">Local Workspace</span>
                            </div>
                        </div>
                    </div>
                    <div class="auth-form-pane">
                        <div class="section-head">
                            <div>
                                <h2>Sign up</h2>
                                <p class="muted">Pick a username, add your email, and we’ll create your local workspace.</p>
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
                                    autocomplete="email">
                            </div>

                            <div class="field">
                                <label for="password">Password</label>
                                <input
                                    class="input"
                                    type="password"
                                    id="password"
                                    name="password"
                                    required
                                    autocomplete="new-password">
                            </div>

                            <div class="actions">
                                <button class="button-primary" type="submit">Create Account</button>
                            </div>
                        </form>

                        <div class="auth-links">
                            <a class="button-secondary" href="/login.php">Already have an account? Login</a>
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
