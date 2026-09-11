<?php
declare(strict_types=1);

require_once __DIR__ . '/server/core/web-session.php';
enforceProductionHttps();

// Keep the website download pinned to the published release.
$version = '0.1.0-alpha.1';
$repositoryUrl = 'https://github.com/redhead-couple/movement';
$releaseTag = 'v' . $version;
$releaseName = "Movement.Timeline.Studio-Authoring-Kit-{$version}-x64.zip";
$releaseUrl = $repositoryUrl . '/releases/download/' . $releaseTag . '/' . rawurlencode($releaseName);
$checksumUrl = $releaseUrl . '.sha256';
$releasePageUrl = $repositoryUrl . '/releases/tag/' . $releaseTag;
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download Movement Timeline Studio</title>
    <meta name="description" content="Download the Windows desktop authoring kit for Movement Timeline Studio.">
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .download-page {
            padding-bottom: 0;
        }

        .download-hero {
            position: relative;
            overflow: hidden;
            padding: clamp(52px, 8vw, 96px) 0 clamp(42px, 7vw, 76px);
            border-bottom: 1px solid rgba(238, 232, 223, 0.08);
        }

        .download-hero::after {
            content: "";
            position: absolute;
            width: min(560px, 72vw);
            aspect-ratio: 1;
            right: -12vw;
            top: -45%;
            border: 1px solid rgba(238, 232, 223, 0.08);
            border-radius: 50%;
            box-shadow:
                0 0 0 70px rgba(185, 99, 79, 0.035),
                0 0 0 140px rgba(70, 87, 102, 0.025);
            pointer-events: none;
        }

        .download-hero__grid {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.72fr);
            align-items: center;
            gap: clamp(36px, 7vw, 88px);
        }

        .download-hero h1 {
            max-width: 760px;
            margin: 0;
            font-size: clamp(44px, 7vw, 78px);
            font-weight: 500;
            line-height: 0.98;
            letter-spacing: -0.055em;
        }

        .download-hero__lead {
            max-width: 62ch;
            margin: 22px 0 0;
            color: var(--app-text-muted);
            font-size: clamp(16px, 2vw, 19px);
            line-height: 1.65;
        }

        .release-card {
            position: relative;
            padding: clamp(24px, 4vw, 34px);
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-lg);
            background:
                linear-gradient(145deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.015)),
                var(--app-surface-strong);
            box-shadow: var(--app-shadow);
        }

        .release-card__platform {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 28px;
        }

        .windows-mark {
            display: grid;
            grid-template-columns: repeat(2, 10px);
            gap: 2px;
            width: 22px;
            transform: perspective(30px) rotateY(-7deg);
        }

        .windows-mark span {
            height: 10px;
            background: var(--app-accent-strong);
        }

        .release-card h2 {
            margin: 0;
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.025em;
        }

        .release-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 12px 0 24px;
            color: var(--app-text-muted);
            font-size: 13px;
        }

        .release-meta span + span::before {
            content: "\00b7";
            margin-right: 8px;
            color: rgba(213, 203, 192, 0.44);
        }

        .download-button {
            width: 100%;
            min-height: 52px;
            text-align: center;
        }

        .download-button::before {
            content: "\2193";
            font-size: 19px;
            line-height: 1;
        }

        .release-links {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 18px;
            margin-top: 16px;
            font-size: 13px;
        }

        .release-links a {
            text-decoration: underline;
        }

        .release-note {
            margin: 16px 0 0;
            color: rgba(213, 203, 192, 0.62);
            font-size: 12px;
            line-height: 1.55;
        }

        .download-content {
            padding: clamp(48px, 8vw, 88px) 0;
        }

        .download-section-heading {
            display: grid;
            grid-template-columns: minmax(0, 0.75fr) minmax(0, 1fr);
            gap: 34px;
            align-items: end;
            margin-bottom: 28px;
        }

        .download-section-heading h2 {
            margin: 0;
            font-size: clamp(30px, 4vw, 45px);
            font-weight: 500;
            line-height: 1.05;
            letter-spacing: -0.04em;
        }

        .download-section-heading p {
            margin: 0;
            color: var(--app-text-muted);
            line-height: 1.65;
        }

        .step-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
        }

        .step {
            min-height: 210px;
            padding: 26px;
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
        }

        .step__number {
            display: inline-flex;
            width: 34px;
            height: 34px;
            align-items: center;
            justify-content: center;
            margin-bottom: 36px;
            border: 1px solid rgba(185, 99, 79, 0.35);
            border-radius: 50%;
            color: var(--app-accent-strong);
            background: var(--app-accent-soft);
            font-size: 12px;
            font-weight: 700;
        }

        .step h3 {
            margin: 0 0 10px;
            font-size: 19px;
            letter-spacing: -0.02em;
        }

        .step p {
            margin: 0;
            color: var(--app-text-muted);
            font-size: 14px;
            line-height: 1.65;
        }

        .download-details {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 18px;
            margin-top: 18px;
        }

        .download-details .panel-body {
            height: 100%;
        }

        .download-details h3 {
            margin: 0 0 12px;
            font-size: 20px;
            letter-spacing: -0.02em;
        }

        .download-details p,
        .download-details li {
            color: var(--app-text-muted);
            line-height: 1.65;
        }

        .download-details p {
            margin: 0;
        }

        .download-details ul {
            margin: 0;
            padding-left: 20px;
        }

        .download-footer {
            padding: 30px 0 42px;
            border-top: 1px solid var(--app-line);
            color: var(--app-text-muted);
            font-size: 13px;
        }

        .download-footer__inner {
            display: flex;
            justify-content: space-between;
            gap: 18px;
            flex-wrap: wrap;
        }

        .download-footer__links {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }

        .download-footer a:hover {
            color: var(--app-text);
        }

        @media (max-width: 860px) {
            .download-hero__grid,
            .download-section-heading {
                grid-template-columns: 1fr;
            }

            .release-card {
                max-width: 540px;
            }

            .step-grid {
                grid-template-columns: 1fr;
            }

            .step {
                min-height: 0;
            }

            .step__number {
                margin-bottom: 24px;
            }
        }

        @media (max-width: 620px) {
            .download-details {
                grid-template-columns: 1fr;
            }

            .download-hero h1 {
                font-size: clamp(40px, 13vw, 58px);
            }
        }
    </style>
</head>

<body>
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Primary navigation">
                <a class="app-nav__link" href="/feed.php">Work</a>
                <a class="app-nav__link" href="/concept/">Concept</a>
                <a class="app-nav__link" href="/download.php" aria-current="page">Download</a>
                <a class="app-nav__link" href="/contact.php">Contact</a>
            </nav>
        </div>
    </header>

    <main class="download-page">
        <section class="download-hero" aria-labelledby="download-title">
            <div class="wrap download-hero__grid">
                <div>
                    <p class="eyebrow">Desktop authoring kit</p>
                    <h1 id="download-title">Create locally.<br>Keep the source close.</h1>
                    <p class="download-hero__lead">
                        Download the source-visible Windows edition of Movement Timeline Studio, the desktop application for Movement, published by Redhead Couple. Author and play projects locally, explore the bundled examples, and extend the system without a server or database.
                    </p>
                </div>

                <aside class="release-card" aria-labelledby="release-title">
                    <div class="release-card__platform">
                        <span class="windows-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
                        <div>
                            <p class="eyebrow">Movement Public Alpha 0.1</p>
                            <h2 id="release-title">Movement Timeline Studio</h2>
                        </div>
                    </div>
                    <div class="release-meta" aria-label="Release details">
                        <span>Version <?= htmlspecialchars($version, ENT_QUOTES, 'UTF-8') ?></span>
                        <span>Windows 10 / 11 x64</span>
                    </div>

                    <a class="button-primary download-button" href="<?= htmlspecialchars($releaseUrl, ENT_QUOTES, 'UTF-8') ?>">
                        Download the Windows x64 Authoring Kit
                    </a>
                    <p class="release-note">The recommended Windows download. Extract the complete ZIP, then run <strong>Movement Timeline Studio.exe</strong>.</p>
                    <div class="release-links">
                        <a href="<?= htmlspecialchars($checksumUrl, ENT_QUOTES, 'UTF-8') ?>">SHA-256 checksum</a>
                        <a href="<?= htmlspecialchars($releasePageUrl, ENT_QUOTES, 'UTF-8') ?>">Release notes</a>
                    </div>
                    <p class="release-note">The SHA-256 file is provided to verify your download.</p>
                    <p class="release-note">This Windows Alpha build is currently unsigned. Windows may show an Unknown Publisher or SmartScreen warning.</p>
                </aside>
            </div>
        </section>

        <section class="download-content">
            <div class="wrap">
                <div class="download-section-heading">
                    <div>
                        <p class="eyebrow">Start in three steps</p>
                        <h2>From download to a local workspace.</h2>
                    </div>
                    <p>
                        The kit is portable and self-contained for normal authoring and playback. Your projects live in a visible workspace folder beside the application, so they remain easy to find and back up.
                    </p>
                </div>

                <div class="step-grid">
                    <article class="step">
                        <span class="step__number">01</span>
                        <h3>Download</h3>
                        <p>Save the Windows ZIP to a location with enough room for the application and your future projects.</p>
                    </article>
                    <article class="step">
                        <span class="step__number">02</span>
                        <h3>Extract everything</h3>
                        <p>Unzip the complete folder. Keep the executable, resources, and supporting files together.</p>
                    </article>
                    <article class="step">
                        <span class="step__number">03</span>
                        <h3>Open the studio</h3>
                        <p>Run <strong>Movement Timeline Studio.exe</strong>, explore the read-only examples, then create your own workspace.</p>
                    </article>
                </div>

                <div class="download-details">
                    <section class="panel">
                        <div class="panel-body">
                            <p class="eyebrow">What is included</p>
                            <h3>Authoring, playback, and editable tools</h3>
                            <ul>
                                <li>The complete desktop editor and local player</li>
                                <li>Bundled example projects</li>
                                <li>Source-visible effects, transitions, and makers</li>
                                <li>Authoring contracts and technical documentation</li>
                            </ul>
                        </div>
                    </section>
                    <section class="panel">
                        <div class="panel-body">
                            <p class="eyebrow">Requirements</p>
                            <h3>Built for Windows x64</h3>
                            <p>
                                Normal use does not require PHP, MySQL, Node.js, or an internet connection. Keep backups of important work before replacing the extracted application folder with a newer release.
                            </p>
                        </div>
                    </section>
                </div>
            </div>
        </section>
    </main>

    <footer class="download-footer">
        <div class="wrap download-footer__inner">
            <div>&copy; <?= date('Y') ?> Redhead Couple · Early Formation</div>
            <div class="download-footer__links">
                <a href="/concept/">Concept</a>
                <a href="<?= htmlspecialchars($repositoryUrl, ENT_QUOTES, 'UTF-8') ?>">GitHub repository</a>
                <a href="/privacy.php">Privacy</a>
                <a href="/terms.php">Terms</a>
                <a href="/contact.php">Contact</a>
            </div>
        </div>
    </footer>
</body>

</html>
