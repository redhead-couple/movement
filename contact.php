<?php
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$formId = 'contact';
$guard = ensureFormGuard($formId);

$name = '';
$email = '';
$message = '';
$error = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim($_POST['name'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $message = trim($_POST['message'] ?? '');

    $guardError = validateFormGuard(
        $formId,
        (string)($_POST['form_token'] ?? ''),
        trim((string)($_POST['_support_pin'] ?? '')),
        3
    );

    if ($guardError !== null) {
        $error = $guardError;
    } elseif ($name === '' || $email === '' || $message === '') {
        $error = 'Please fill in all fields.';
    } elseif (mb_strlen($name) > 120) {
        $error = 'Name is too long.';
    } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Please enter a valid email address.';
    } elseif (mb_strlen($message) > 4000) {
        $error = 'Message is too long.';
    } else {
        try {
            $pdo = db();

            $pdo->exec("
                CREATE TABLE IF NOT EXISTS contact_messages (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    email VARCHAR(190) NOT NULL,
                    message TEXT NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ip VARBINARY(16) NOT NULL,
                    user_agent VARCHAR(255) NULL,
                    status ENUM('new','read','archived') NOT NULL DEFAULT 'new',
                    INDEX idx_contact_created_at (created_at),
                    INDEX idx_contact_ip_created_at (ip, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            ");

            $ip = clientIpBinary();
            $ua = currentUserAgent();

            $stmt = $pdo->prepare("
                SELECT COUNT(*)
                FROM contact_messages
                WHERE ip = ? AND created_at > (NOW() - INTERVAL 1 HOUR)
            ");
            $stmt->execute([$ip]);

            if ((int)$stmt->fetchColumn() >= 3) {
                $error = 'Too many messages were sent from this network. Please try again later.';
            } else {
                $stmt = $pdo->prepare("
                    INSERT INTO contact_messages (name, email, message, ip, user_agent)
                    VALUES (?, ?, ?, ?, ?)
                ");
                $stmt->execute([$name, $email, $message, $ip, $ua]);

                $success = 'Your message was sent successfully.';
                $name = '';
                $email = '';
                $message = '';
                $guard = resetFormGuard($formId);
            }
        } catch (Throwable $e) {
            $error = 'Unable to send your message right now.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .contact-shell {
            display: grid;
            padding-top: var(--app-space-6);
            gap: var(--app-space-5);
        }

        .contact-grid {
            display: grid;
            grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
            gap: var(--app-space-5);
        }

        .contact-page .panel-body {
            display: grid;
            gap: var(--app-space-4);
        }

        .contact-aside {
            align-content: start;
        }

        .contact-meta {
            display: grid;
            gap: 12px;
        }

        .contact-meta-item {
            padding: 14px 16px;
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
        }

        .contact-meta-item strong {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--app-text-muted);
        }

        .contact-form {
            display: grid;
            gap: 16px;
        }

        .contact-status {
            padding: 14px 16px;
            border-radius: var(--app-radius-md);
            border: 1px solid var(--app-line);
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .contact-status p {
            margin: 0;
        }

        .contact-status--error {
            border-color: rgba(181, 106, 90, 0.28);
            background:
                linear-gradient(180deg, rgba(181, 106, 90, 0.16), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .contact-status--success {
            border-color: rgba(114, 179, 138, 0.28);
            background:
                linear-gradient(180deg, rgba(114, 179, 138, 0.14), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .contact-note {
            margin: 0;
            font-size: 13px;
            line-height: 1.7;
        }

        @media (max-width: 860px) {
            .contact-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body class="contact-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Primary navigation">
                <a class="app-nav__link" href="/feed.php">Public Feed</a>
                <a class="app-nav__link" href="/privacy.php">Privacy</a>
                <a class="app-nav__link" href="/terms.php">Terms</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="contact-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Contact</p>
                    <h1 id="contact-title">Send a Message</h1>
                    <p class="page-intro__description">Share a question, problem, or idea with the Early Formation team.</p>
                </div>
            </div>
        </section>
        <div class="wrap contact-shell">
            <section class="contact-grid">
                <aside class="panel contact-aside">
                    <div class="panel-body">
                        <div>
                            <p class="eyebrow">Reach Out</p>
                            <h2>Thoughtful messages are welcome.</h2>
                            <p class="muted">Messages from this form are stored in the project database so they can be reviewed in the admin message list.</p>
                        </div>

                        <div class="contact-meta">
                            <div class="contact-meta-item">
                                <strong>Response Path</strong>
                                <span>Replies can be sent to the email address you include in your message.</span>
                            </div>
                            <div class="contact-meta-item">
                                <strong>Privacy</strong>
                                <span>No public contact email needs to be shown on the site.</span>
                            </div>
                            <div class="contact-meta-item">
                                <strong>Spam Protection</strong>
                                <span>This form uses a session token, honeypot field, submission delay, and per-IP rate limit.</span>
                            </div>
                        </div>
                    </div>
                </aside>

                <section class="panel">
                    <div class="panel-body">
                        <div class="section-head">
                            <div>
                                <h2>Contact form</h2>
                                <p class="muted">A short and clear message is enough.</p>
                            </div>
                        </div>

                        <?php if ($error !== ''): ?>
                            <div class="contact-status contact-status--error">
                                <p><?= htmlspecialchars($error) ?></p>
                            </div>
                        <?php endif; ?>

                        <?php if ($success !== ''): ?>
                            <div class="contact-status contact-status--success">
                                <p><?= htmlspecialchars($success) ?></p>
                            </div>
                        <?php endif; ?>

                        <form method="post" action="" class="contact-form" novalidate>
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">

                            <div class="hp">
                                <label for="_support_pin">Support Pin</label>
                                <input type="text" id="_support_pin" name="_support_pin" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="field">
                                <label for="name">Name</label>
                                <input
                                    class="input"
                                    type="text"
                                    id="name"
                                    name="name"
                                    value="<?= htmlspecialchars($name) ?>"
                                    maxlength="120"
                                    required>
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
                                    required>
                            </div>

                            <div class="field">
                                <label for="message">Message</label>
                                <textarea
                                    class="textarea"
                                    id="message"
                                    name="message"
                                    maxlength="4000"
                                    required><?= htmlspecialchars($message) ?></textarea>
                            </div>

                            <div class="actions">
                                <button class="button button-primary" type="submit">Send Message</button>
                            </div>
                        </form>

                        <p class="contact-note muted">Messages are stored in the database table <code>contact_messages</code>. You can review them in <code>admin-messages.php</code> after setting its admin credentials.</p>
                    </div>
                </section>
            </section>
        </div>
    </main>
</body>

</html>
