<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$formId = 'delete_project';
$guard = ensureFormGuard($formId);

$project = $_GET['project'] ?? '';
$project = basename(trim($project));
$paths = getProjectPaths($currentUser, $project);
if ($project === '') {
    respondNotFoundPage();
}

$userProjectsDir = $paths['userFsDir'];
$projectDir = $userProjectsDir . '/' . $project;
$flowFile = $projectDir . '/flow.json';

if (!is_dir($projectDir) || !file_exists($flowFile)) {
    respondNotFoundPage();
}

$json = @file_get_contents($flowFile);
$data = is_string($json) ? json_decode($json, true) : null;
$title = (is_array($data) && !empty($data['title'])) ? trim($data['title']) : $project;
$error = '';

function deleteProjectFolder(string $dir): bool
{
    if (!is_dir($dir)) return false;

    $items = scandir($dir);
    if (!is_array($items)) return false;

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;

        $path = $dir . '/' . $item;

        if (is_dir($path)) {
            if (!deleteProjectFolder($path)) return false;
        } else {
            if (!unlink($path)) return false;
        }
    }

    return rmdir($dir);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        $formId,
        (string) ($_POST['form_token'] ?? ''),
        trim((string) ($_POST['website'] ?? '')),
        0
    );

    if ($guardError !== null) {
        $error = $guardError;
    } else {
    $confirm = $_POST['confirm'] ?? '';

    if ($confirm === 'yes') {
        $deleted = deleteProjectFolder($projectDir);

        if ($deleted) {
            header('Location: /dashboard.php?deleted=' . rawurlencode($project));
            exit;
        }

        $error = 'Could not delete project folder.';
    } else {
        header('Location: /dashboard.php');
        exit;
    }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Delete Project</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .delete-project-page .hero {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
            margin-top: var(--app-space-6);
            gap: var(--app-space-5);
            align-items: start;
        }

        .delete-project-page .panel-body {
            padding: var(--app-space-6);
        }

        .delete-project-page .hero-copy h2,
        .delete-project-page .hero-aside h3 {
            margin: 0 0 var(--app-space-2);
            line-height: 1.05;
            letter-spacing: -0.03em;
        }

        .delete-project-page .hero-copy p,
        .delete-project-page .hero-aside p,
        .delete-project-page .project-meta p {
            margin: 0;
        }

        .delete-project-page .project-meta {
            display: grid;
            gap: var(--app-space-3);
            margin-top: var(--app-space-5);
            padding: var(--app-space-4);
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
        }

        .delete-project-page .project-meta strong {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }

        .delete-project-page .hero-aside {
            display: grid;
            gap: var(--app-space-3);
        }

        .delete-project-page .hero-aside .panel {
            background:
                linear-gradient(180deg, rgba(181, 106, 90, 0.16), rgba(255, 255, 255, 0)),
                var(--app-surface-soft);
            box-shadow: var(--app-shadow-soft);
        }

        .delete-project-page .hero-aside .panel-body {
            padding: var(--app-space-5);
        }

        .delete-project-page .warning-list {
            margin: var(--app-space-3) 0 0;
            padding-left: 18px;
            display: grid;
            gap: 8px;
            color: var(--app-text-muted);
        }

        .delete-project-page .error-message {
            margin-top: var(--app-space-4);
            padding: 14px 16px;
            border-radius: var(--app-radius-sm);
            border: 1px solid rgba(181, 106, 90, 0.4);
            background: rgba(181, 106, 90, 0.14);
            color: #ffd2c7;
        }

        .delete-project-page .button-danger {
            background: linear-gradient(135deg, #d18b7c, #b56a5a);
            color: #160f0c;
        }

        .delete-project-page .button-danger:hover {
            background: linear-gradient(135deg, #dda394, #be7565);
        }

        .delete-project-page .actions {
            margin-top: var(--app-space-5);
        }

        @media (max-width: 900px) {
            .delete-project-page .hero {
                grid-template-columns: 1fr;
            }

            .delete-project-page .panel-body {
                padding: var(--app-space-5);
            }
        }
    </style>
</head>

<body class="delete-project-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Project navigation">
                <a class="app-nav__link app-nav__back" href="/dashboard.php">My Library</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="delete-project-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Project Studio</p>
                    <h1 id="delete-project-title">Delete Project</h1>
                    <p class="page-intro__description">Review the project details before removing it from your online library.</p>
                </div>
            </div>
        </section>
        <div class="wrap">
            <section class="hero">
                <article class="panel">
                    <div class="panel-body">
                        <div class="section-head">
                            <div class="hero-copy">
                                <h2><?php echo htmlspecialchars($title); ?></h2>
                                <p class="muted">This action permanently removes the project folder and all timeline assets from the site.</p>
                            </div>
                        </div>

                        <?php if (!empty($error)): ?>
                            <p class="error-message"><?php echo htmlspecialchars($error); ?></p>
                        <?php endif; ?>

                        <div class="project-meta">
                            <div>
                                <strong>Project Slug</strong>
                                <p class="muted">/<?php echo htmlspecialchars($project); ?>/</p>
                            </div>
                            <div>
                                <strong>Deleted Content</strong>
                                <p class="muted">`flow.json`, `img/`, `speech/`, and the project entry point.</p>
                            </div>
                        </div>

                        <form method="post">
                            <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($guard['token']); ?>">
                            <div class="hp">
                                <input type="text" name="website" tabindex="-1" autocomplete="off">
                            </div>
                            <div class="actions">
                                <button class="button button-danger" type="submit" name="confirm" value="yes">
                                    Yes, Delete Project
                                </button>
                                <a class="button button-secondary" href="/dashboard.php">Cancel</a>
                            </div>
                        </form>
                    </div>
                </article>

                <aside class="hero-aside">
                    <section class="panel">
                        <div class="panel-body">
                            <h3>Before you confirm</h3>
                            <p class="muted">Deletion cannot be undone from the dashboard.</p>
                            <ul class="warning-list">
                                <li>All project images and speech files will be removed.</li>
                                <li>The player and editor routes for this project will stop working.</li>
                                <li>Make sure you no longer need the current timeline data.</li>
                            </ul>
                        </div>
                    </section>
                </aside>
            </section>
        </div>
    </main>
</body>

</html>
