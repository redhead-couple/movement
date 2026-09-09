<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$flashError = '';
if (isset($_SESSION['flash_error'])) {
    $flashError = (string) $_SESSION['flash_error'];
    unset($_SESSION['flash_error']);
}

$guard = ensureFormGuard('create_project');
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>New Project</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .new-project-page .hero {
            display: grid;
            grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
            margin-top: var(--app-space-6);
            gap: var(--app-space-5);
            align-items: start;
        }

        .new-project-page .panel-body {
            padding: var(--app-space-6);
        }

        .new-project-page .hero-copy h2,
        .new-project-page .hero-aside h3 {
            margin: 0 0 var(--app-space-2);
            line-height: 1.05;
            letter-spacing: -0.03em;
        }

        .new-project-page .hero-copy p,
        .new-project-page .hero-aside p {
            margin: 0;
        }

        .new-project-page .hero-aside {
            display: grid;
            gap: var(--app-space-3);
        }

        .new-project-page .hero-aside .panel {
            background:
                linear-gradient(180deg, rgba(180, 106, 85, 0.10), rgba(255, 255, 255, 0)),
                var(--app-surface-soft);
            box-shadow: var(--app-shadow-soft);
        }

        .new-project-page .hero-aside .panel-body {
            padding: var(--app-space-5);
        }

        .new-project-page .hint-list {
            margin: 0;
            padding-left: 18px;
            color: var(--app-text-muted);
            display: grid;
            gap: 8px;
        }

        .new-project-page .field-note {
            margin: 0;
            font-size: 13px;
            color: var(--app-text-muted);
        }

        .new-project-page .actions {
            margin-top: var(--app-space-5);
        }

        @media (max-width: 900px) {
            .new-project-page .hero {
                grid-template-columns: 1fr;
            }

            .new-project-page .panel-body {
                padding: var(--app-space-5);
            }
        }
    </style>
</head>

<body class="new-project-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Project navigation">
                <a class="app-nav__link app-nav__back" href="/dashboard.php">My Library</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="new-project-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Project Studio</p>
                    <h1 id="new-project-title">Create a New Project</h1>
                    <p class="page-intro__description">Start a new online slideshow and open it in the editor.</p>
                </div>
            </div>
        </section>
        <div class="wrap">
            <section class="hero">
                <article class="panel">
                    <div class="panel-body">
                        <div class="section-head">
                            <div class="hero-copy">
                                <h2>Start with a clean slug</h2>
                                <p class="muted">Use a short project identifier. The system will create the project folder, starter timeline, and editor route automatically.</p>
                            </div>
                        </div>

                        <?php if ($flashError !== ''): ?>
                            <div class="status-banner status-banner--error" style="margin-bottom: var(--app-space-4); padding: 14px 16px; border-radius: var(--app-radius-md); border: 1px solid rgba(181, 106, 90, 0.28); background: linear-gradient(180deg, rgba(181, 106, 90, 0.16), rgba(255, 255, 255, 0)), rgba(255, 255, 255, 0.03);">
                                <p style="margin: 0;"><?= htmlspecialchars($flashError) ?></p>
                            </div>
                        <?php endif; ?>

                        <form action="/create-project.php" method="post">
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">

                            <div class="hp">
                                <label for="website">Website</label>
                                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="field">
                                <label for="project">Project Slug</label>
                                <input
                                    class="input"
                                    type="text"
                                    id="project"
                                    name="project"
                                    required
                                    pattern="[a-zA-Z0-9_-]+"
                                    placeholder="my-first-project"
                                    autocomplete="off">
                                <p class="field-note">Allowed characters: letters, numbers, hyphens, and underscores.</p>
                            </div>

                            <div class="actions">
                                <button class="button button-primary" type="submit">Create Project</button>
                            </div>
                        </form>
                    </div>
                </article>

                <aside class="hero-aside">
                    <section class="panel">
                        <div class="panel-body">
                            <h3>What gets created</h3>
                            <p class="muted">Each new project includes the base structure needed to start editing immediately.</p>
                            <ul class="hint-list">
                                <li>Project folder in the site root</li>
                                <li>`img/` and `speech/` asset directories</li>
                                <li>A starter `flow.json` timeline file</li>
                                <li>An `index.php` entry wired to the player</li>
                            </ul>
                        </div>
                    </section>
                </aside>
            </section>
        </div>
    </main>
</body>

</html>
