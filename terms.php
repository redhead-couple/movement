<?php
require_once __DIR__ . '/server/core/web-session.php';
enforceProductionHttps();
setWebPageDiscovery(true);
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Use</title>
    <?= webRobotsMeta() ?>
    <link rel="stylesheet" href="/assets/app.css">
</head>

<body class="legal-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Primary navigation">
                <a class="app-nav__link" href="/feed.php">Public Feed</a>
                <a class="app-nav__link" href="/contact.php">Contact</a>
                <a class="app-nav__link" href="/login.php">Login</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="terms-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Legal</p>
                    <h1 id="terms-title">Terms of Use</h1>
                    <p class="page-intro__description">The current terms for using Early Formation during its development stage.</p>
                </div>
            </div>
        </section>
        <div class="wrap legal-shell">
            <section class="legal-intro">
                <p class="eyebrow">Development Stage</p>
                <p class="muted">These terms are provided as a lightweight baseline for a project that is still being built and may change as the platform grows.</p>
            </section>

            <section class="legal-stack">
                <section class="panel">
                    <div class="panel-body">
                        <h2>Use of the platform</h2>
                        <p>You may use the platform only in a lawful way and only for purposes connected to your own projects, account, and content. You agree not to attempt unauthorized access, disrupt the service, or misuse other users&apos; data or work.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Accounts</h2>
                        <p>You are responsible for keeping your account credentials secure and for activity performed through your account. If you believe your account has been compromised, you should change your password immediately and contact the project through the <a href="/contact.php">contact form</a>.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>User content</h2>
                        <p>You remain responsible for the projects, files, media, and other content you create, upload, or publish through the platform. You should only use content you have the right to use.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Availability</h2>
                        <p>Because the platform is still in development, features may change, break, move, or be removed without notice. Access may be suspended temporarily for maintenance, testing, debugging, or product changes.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Disclaimer</h2>
                        <p>The platform is provided on an &quot;as is&quot; and &quot;as available&quot; basis during development. No guarantee is made that the service will be uninterrupted, error-free, or suitable for any particular purpose.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Changes</h2>
                        <p>These terms may be updated as the project matures. Continued use of the platform after updates may be treated as acceptance of the revised terms.</p>
                        <div class="legal-note">
                            <p>This page is a practical development-stage terms page and is not legal advice.</p>
                        </div>
                    </div>
                </section>
            </section>
        </div>
    </main>
</body>

</html>
