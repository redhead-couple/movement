<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$error = '';
$success = '';
$formId = 'change_password';
$guard = ensureFormGuard($formId);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        $formId,
        (string) ($_POST['form_token'] ?? ''),
        trim((string) ($_POST['website'] ?? '')),
        2
    );

    if ($guardError !== null) {
        $error = $guardError;
    } else {
    $currentPassword = $_POST['current_password'] ?? '';
    $newPassword = $_POST['new_password'] ?? '';
    $confirmPassword = $_POST['confirm_password'] ?? '';

    if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') {
        $error = 'Please fill in all password fields.';
    } elseif (strlen($newPassword) < 6) {
        $error = 'New password must be at least 6 characters.';
    } elseif ($newPassword !== $confirmPassword) {
        $error = 'New password and confirmation do not match.';
    } else {
        try {
            $stmt = $pdo->prepare('
                SELECT password_hash
                FROM users
                WHERE id = ?
                LIMIT 1
            ');
            $stmt->execute([$_SESSION['user_id']]);
            $user = $stmt->fetch();

            if (!$user || !password_verify($currentPassword, $user['password_hash'])) {
                $error = 'Current password is incorrect.';
            } elseif (password_verify($newPassword, $user['password_hash'])) {
                $error = 'Choose a new password that is different from the current password.';
            } else {
                $newHash = password_hash($newPassword, PASSWORD_DEFAULT);

                $stmt = $pdo->prepare('
                    UPDATE users
                    SET password_hash = ?
                    WHERE id = ?
                    LIMIT 1
                ');
                $stmt->execute([$newHash, $_SESSION['user_id']]);

                session_regenerate_id(true);
                $success = 'Your password was updated successfully.';
            }
        } catch (Throwable $e) {
            $error = 'Something went wrong while changing your password.';
        }
    }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Change Password</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .account-page .account-shell {
            display: grid;
            padding-top: var(--app-space-6);
            gap: var(--app-space-5);
        }

        .account-page .account-grid {
            display: grid;
            grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
            gap: var(--app-space-5);
        }

        .account-page .panel-body {
            display: grid;
            gap: var(--app-space-4);
        }

        .account-page .account-summary {
            display: grid;
            gap: 12px;
        }

        .account-page .account-meta {
            display: grid;
            gap: 10px;
        }

        .account-page .account-meta-item {
            padding: 12px 14px;
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
        }

        .account-page .account-meta-item strong,
        .account-page .account-meta-item span {
            display: block;
        }

        .account-page .account-meta-item strong {
            margin-bottom: 4px;
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--app-text-muted);
        }

        .account-page .form-stack {
            display: grid;
            gap: 16px;
        }

        .account-page .status-banner {
            padding: 14px 16px;
            border-radius: var(--app-radius-md);
            border: 1px solid var(--app-line);
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .account-page .status-banner--success {
            border-color: rgba(114, 179, 138, 0.28);
            background:
                linear-gradient(180deg, rgba(114, 179, 138, 0.14), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .account-page .status-banner--error {
            border-color: rgba(181, 106, 90, 0.28);
            background:
                linear-gradient(180deg, rgba(181, 106, 90, 0.16), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .account-page .status-banner p {
            margin: 0;
        }

        .account-page .helper-copy {
            margin: 0;
            font-size: 13px;
            line-height: 1.6;
        }

        @media (max-width: 860px) {
            .account-page .account-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body class="account-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Account navigation">
                <a class="app-nav__link" href="/feed.php">Public Feed</a>
                <a class="app-nav__link" href="/dashboard.php">My Library</a>
                <form class="app-nav__form" method="post" action="/logout.php">
                    <?php $logoutGuard = ensureFormGuard('logout_form'); ?>
                    <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($logoutGuard['token']); ?>">
                    <button type="submit" class="app-nav__button app-nav__button--quiet">Log out</button>
                </form>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="account-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Account</p>
                    <h1 id="account-title">Change Password</h1>
                    <p class="page-intro__description">Manage the password for your Early Formation account.</p>
                </div>
            </div>
        </section>
        <div class="wrap account-shell">
            <section class="account-grid">
                <aside class="panel">
                    <div class="panel-body account-summary">
                        <div>
                            <p class="eyebrow">Signed In</p>
                            <h2><?= htmlspecialchars($currentUserRecord['username']) ?></h2>
                            <p class="muted">Update the password for this local account.</p>
                        </div>

                        <div class="account-meta">
                            <div class="account-meta-item">
                                <strong>Username</strong>
                                <span><?= htmlspecialchars($currentUserRecord['username']) ?></span>
                            </div>
                            <div class="account-meta-item">
                                <strong>Email</strong>
                                <span><?= htmlspecialchars($currentUserRecord['email']) ?></span>
                            </div>
                        </div>
                    </div>
                </aside>

                <section class="panel">
                    <div class="panel-body">
                        <div class="section-head">
                            <div>
                                <h2>Password settings</h2>
                                <p class="muted">Enter your current password first, then choose a new one.</p>
                            </div>
                        </div>

                        <?php if ($error !== ''): ?>
                            <div class="status-banner status-banner--error">
                                <p><?= htmlspecialchars($error) ?></p>
                            </div>
                        <?php endif; ?>

                        <?php if ($success !== ''): ?>
                            <div class="status-banner status-banner--success">
                                <p><?= htmlspecialchars($success) ?></p>
                            </div>
                        <?php endif; ?>

                        <form method="post" action="" class="form-stack">
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">

                            <div class="hp">
                                <label for="website">Website</label>
                                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="field">
                                <label for="current_password">Current Password</label>
                                <input
                                    class="input"
                                    type="password"
                                    id="current_password"
                                    name="current_password"
                                    required
                                    autocomplete="current-password">
                            </div>

                            <div class="field">
                                <label for="new_password">New Password</label>
                                <input
                                    class="input"
                                    type="password"
                                    id="new_password"
                                    name="new_password"
                                    required
                                    minlength="6"
                                    autocomplete="new-password">
                            </div>

                            <div class="field">
                                <label for="confirm_password">Confirm New Password</label>
                                <input
                                    class="input"
                                    type="password"
                                    id="confirm_password"
                                    name="confirm_password"
                                    required
                                    minlength="6"
                                    autocomplete="new-password">
                            </div>

                            <div class="actions">
                                <button class="button button-primary" type="submit">Update Password</button>
                            </div>
                        </form>

                        <p class="helper-copy muted">For stronger security, use a long unique password you do not reuse anywhere else.</p>
                    </div>
                </section>
            </section>
        </div>
    </main>
</body>

</html>
