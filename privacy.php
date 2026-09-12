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
    <title>Privacy Policy</title>
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
        <section class="page-intro page-intro--compact" aria-labelledby="privacy-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Legal</p>
                    <h1 id="privacy-title">Privacy Policy</h1>
                    <p class="page-intro__description">How Early Formation handles account, project, and contact information.</p>
                </div>
            </div>
        </section>
        <div class="wrap legal-shell">
            <section class="legal-intro">
                <p class="eyebrow">Development Stage</p>
                <p class="muted">This platform is currently in development. The information on this page is intended as a simple baseline and may be updated as features, integrations, and operating practices evolve.</p>
            </section>

            <section class="legal-stack">
                <section class="panel">
                    <div class="panel-body">
                        <h2>What we collect</h2>
                        <p>We may collect account details you provide directly, such as username, email address, and a securely stored password hash. We also process basic session data needed to keep you signed in and operate the platform.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Why we use it</h2>
                        <ul>
                            <li>To create and manage your account.</li>
                            <li>To authenticate you and protect access to your projects and dashboard.</li>
                            <li>To operate, maintain, and improve the platform while it is under development.</li>
                            <li>To respond to messages sent through the contact form.</li>
                        </ul>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Cookies and sessions</h2>
                        <p>This site currently uses essential session cookies required for login and basic account security. At this stage, the platform does not intend to rely on advertising cookies or optional tracking cookies for normal operation.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Sharing</h2>
                        <p>We do not intend to sell personal data. Information may be handled by service providers or infrastructure used to run the project if that becomes necessary as the platform develops.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Retention and security</h2>
                        <p>We try to keep account information only as long as needed for operating the project and protecting user access. Reasonable technical measures may be used to protect stored credentials and related account information, but no system can be guaranteed to be perfectly secure.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-body">
                        <h2>Contact</h2>
                        <p>If you have privacy-related questions, please use the <a href="/contact.php">contact form</a>. A public email address is not currently listed for this development-stage project.</p>
                        <div class="legal-note">
                            <p>This page is a practical development-stage policy and is not legal advice.</p>
                        </div>
                    </div>
                </section>
            </section>
        </div>
    </main>
</body>

</html>
