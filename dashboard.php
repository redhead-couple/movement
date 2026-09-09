<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$flashError = '';
if (isset($_SESSION['flash_error'])) {
    $flashError = (string) $_SESSION['flash_error'];
    unset($_SESSION['flash_error']);
}

$publishGuard = ensureFormGuard('publish_project');
$dupGuard = ensureFormGuard('duplicate_project');
$importGuard = ensureFormGuard('import_project');

$root = $_SERVER['DOCUMENT_ROOT'];
$userProjectsDir = __DIR__ . '/private-data/slidedeck/' . $currentUser;
$items = is_dir($userProjectsDir) ? scandir($userProjectsDir) : [];

$publishedProject = $_GET['published'] ?? '';
$publishedProject = basename(trim($publishedProject));

$unpublishedProject = $_GET['unpublished'] ?? '';
$unpublishedProject = basename(trim($unpublishedProject));

$deletedProject = $_GET['deleted'] ?? '';
$deletedProject = basename(trim($deletedProject));

$importedProject = $_GET['imported'] ?? '';
$importedProject = basename(trim($importedProject));

$projects = [];

if (is_array($items)) {
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }

        $fullPath = $userProjectsDir . '/' . $item;
        $flowFile = $fullPath . '/flow.json';

        if (is_dir($fullPath) && file_exists($flowFile)) {
            $title = '';
            $isPublished = false;
            $openingImage = '';
            $description = '';
            $slideCount = 0;
            $status = 'Empty project';

            $json = @file_get_contents($flowFile);
            $data = is_string($json) ? json_decode($json, true) : null;

            if (is_array($data)) {
                if (!empty($data['title'])) {
                    $title = trim($data['title']);
                }

                if (!empty($data['slides']) && is_array($data['slides'])) {
                    $slideCount = count($data['slides']);
                }

                if (!empty($data['openingImage'])) {
                    $openingImage = trim($data['openingImage']);
                }

                if (!empty($data['description'])) {
                    $description = trim((string) $data['description']);
                }

                if (isset($data['isPublished'])) {
                    $isPublished = (bool)$data['isPublished'];
                }

                if ($slideCount > 0) {
                    $status = 'Started';
                }

                if ($slideCount >= 5) {
                    $status = 'In progress';
                }
            }

            $thumbUrl = '';
            if ($openingImage !== '') {
                $thumbPath = $fullPath . '/img/' . $openingImage;
                if (is_file($thumbPath)) {
                    $thumbUrl = '/media.php?p=' . rawurlencode($currentUser) . '/' . rawurlencode($item) . '/img/' . rawurlencode($openingImage);
                }
            }

            $projects[] = [
                'slug' => $item,
                'title' => $title !== '' ? $title : $item,
                'description' => $description,
                'webDir' => '/player.php?username=' . rawurlencode($currentUser) . '&project=' . rawurlencode($item),
                'isPublished' => $isPublished,
                'status' => $status,
                'slideCount' => $slideCount,
                'openingImage' => $openingImage,
                'thumbUrl' => $thumbUrl,
            ];
        }
    }
}

usort($projects, function ($a, $b) {
    return strcasecmp($a['title'], $b['title']);
});
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>My Slideshows</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/shared/frontend/project-library.css">
    <link rel="stylesheet" href="/assets/dashboard.css">
</head>

<body class="dashboard-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Account navigation">
                <a class="app-nav__link" href="/feed.php">Public Feed</a>
                <a class="app-nav__link" href="/change-password.php">Account</a>
                <form class="app-nav__form" method="post" action="/logout.php">
                    <?php $logoutGuard = ensureFormGuard('logout_form'); ?>
                    <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($logoutGuard['token']); ?>">
                    <button type="submit" class="app-nav__button app-nav__button--quiet">Log out</button>
                </form>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro" aria-labelledby="dashboard-library-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Online project library</p>
                    <h1 id="dashboard-library-title">Your slideshows</h1>
                    <p class="page-intro__description">
                        Manage, publish, and export <?php echo count($projects); ?> <?php echo count($projects) === 1 ? 'slideshow' : 'slideshows'; ?> in your online library.
                    </p>
                </div>
                <div class="page-intro__actions">
                    <a class="button button-primary" href="/new-project.php">New Slideshow</a>
                    <form
                        class="dashboard-import-form"
                        id="dashboard-import-form"
                        method="post"
                        action="/import-project.php"
                        enctype="multipart/form-data"
                    >
                        <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($importGuard['token']); ?>">
                        <div class="hp" aria-hidden="true">
                            <label for="import-website">Website</label>
                            <input type="text" id="import-website" name="website" tabindex="-1" autocomplete="off">
                        </div>
                        <input
                            id="portable-project-input"
                            name="portable_zip"
                            type="file"
                            accept=".zip,application/zip"
                            hidden
                            required
                        >
                        <button class="button dashboard-import-button" id="import-project-button" type="button">Import slideshow</button>
                    </form>
                    <details class="creator-tools">
                        <summary class="button creator-tools__trigger">Creator tools</summary>
                        <div class="creator-tools__menu">
                            <a
                                class="creator-tools__action"
                                href="/studio/authoring/effect-prompt-builder.html?kind=effect"
                                target="_blank"
                                rel="noopener"
                            >
                                <strong>Design or improve effect</strong>
                                <span>Shape an effect idea into a complete development prompt.</span>
                            </a>
                            <a
                                class="creator-tools__action"
                                href="/studio/authoring/effect-prompt-builder.html?kind=transition"
                                target="_blank"
                                rel="noopener"
                            >
                                <strong>Design or improve transition</strong>
                                <span>Describe how one slide should give way to the next.</span>
                            </a>
                        </div>
                    </details>
                </div>
            </div>

            <?php if ($flashError !== '' || $publishedProject !== '' || $unpublishedProject !== ''): ?>
                <div class="wrap notice-stack">
                    <?php if ($flashError !== ''): ?>
                        <div class="notice-banner notice-banner--error">
                            <div class="notice-copy">
                                <p class="notice-label">Error</p>
                                <p class="muted"><strong><?php echo htmlspecialchars($flashError); ?></strong></p>
                            </div>
                        </div>
                    <?php endif; ?>

                    <?php if ($publishedProject !== ''): ?>
                        <div class="notice-banner notice-banner--success">
                            <div class="notice-copy">
                                <p class="notice-label">Published</p>
                                <p class="muted"><strong><?php echo htmlspecialchars($publishedProject); ?></strong></p>
                            </div>
                        </div>
                    <?php endif; ?>

                    <?php if ($unpublishedProject !== ''): ?>
                        <div class="notice-banner notice-banner--warning">
                            <div class="notice-copy">
                                <p class="notice-label">Unpublished</p>
                                <p class="muted"><strong><?php echo htmlspecialchars($unpublishedProject); ?></strong></p>
                            </div>
                        </div>
                    <?php endif; ?>
                </div>
            <?php endif; ?>
        </section>

        <section class="wrap dashboard-library" aria-labelledby="dashboard-library-title">
            <?php if ($deletedProject !== ''): ?>
                <div class="status-banner">
                    <strong>Project deleted</strong>
                    <p class="muted"><?php echo htmlspecialchars($deletedProject); ?> was removed successfully.</p>
                </div>
            <?php endif; ?>

            <?php if ($importedProject !== ''): ?>
                <div class="status-banner status-banner--success" role="status">
                    <strong>Slideshow imported</strong>
                    <p class="muted"><?php echo htmlspecialchars($importedProject); ?> is ready in your online library.</p>
                </div>
            <?php endif; ?>

            <?php if (empty($projects)): ?>
                <div class="project-library project-library-empty">
                    <h2>No slideshows here yet</h2>
                    <p>Create your first online slideshow to begin.</p>
                </div>
            <?php else: ?>
                <div class="project-library project-grid">
                    <?php foreach ($projects as $project): ?>
                        <?php
                        $projectSlug = rawurlencode($project['slug']);
                        $playUrl = $project['webDir'];
                        $editUrl = '/edit/' . $projectSlug . '/';
                        $description = $project['description'] !== ''
                            ? $project['description']
                            : 'Project slug: ' . $project['slug'];
                        ?>
                        <article class="project-card">
                            <a class="project-image" href="<?php echo htmlspecialchars($playUrl); ?>" aria-label="Play <?php echo htmlspecialchars($project['title']); ?>">
                                <?php if (!empty($project['thumbUrl'])): ?>
                                    <img src="<?php echo htmlspecialchars($project['thumbUrl']); ?>" alt="">
                                <?php else: ?>
                                    <div class="project-placeholder" aria-hidden="true">
                                        <span></span><span></span><span></span>
                                    </div>
                                <?php endif; ?>
                                <span class="project-access">Online</span>
                            </a>

                            <div class="project-copy">
                                <div class="project-title-row">
                                    <h2>
                                        <a class="project-title-link" href="<?php echo htmlspecialchars($editUrl); ?>">
                                            <?php echo htmlspecialchars($project['title']); ?>
                                        </a>
                                    </h2>
                                </div>

                                <p class="project-description"><?php echo htmlspecialchars($description); ?></p>

                                <div class="project-meta">
                                    <span class="<?php echo $project['isPublished'] ? 'published' : 'draft'; ?>">
                                        <?php echo $project['isPublished'] ? 'Published' : 'Draft'; ?>
                                    </span>
                                    <span>
                                        <?php if ((int) $project['slideCount'] === 0): ?>
                                            No slides yet
                                        <?php elseif ((int) $project['slideCount'] === 1): ?>
                                            1 slide
                                        <?php else: ?>
                                            <?php echo (int) $project['slideCount']; ?> slides
                                        <?php endif; ?>
                                    </span>
                                    <span><?php echo htmlspecialchars($project['status']); ?></span>
                                </div>

                                <div class="project-actions">
                                    <a class="card-action card-action-primary" href="<?php echo htmlspecialchars($editUrl); ?>">Edit</a>
                                    <a class="card-action" href="<?php echo htmlspecialchars($playUrl); ?>">Play</a>
                                    <a class="card-action" href="/project-media.php?project=<?php echo $projectSlug; ?>">Media</a>
                                    <a class="card-action" href="/export-project.php?project=<?php echo $projectSlug; ?>">Export ZIP</a>

                                    <form method="post" action="/publish-project.php">
                                        <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($publishGuard['token']); ?>">
                                        <input type="hidden" name="project" value="<?php echo htmlspecialchars($project['slug']); ?>">
                                        <div class="hp">
                                            <input type="text" name="website" tabindex="-1" autocomplete="off">
                                        </div>
                                        <button class="card-action" type="submit">
                                            <?php echo $project['isPublished'] ? 'Unpublish' : 'Publish'; ?>
                                        </button>
                                    </form>

                                    <form method="post" action="/duplicate-project.php">
                                        <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($dupGuard['token']); ?>">
                                        <input type="hidden" name="project" value="<?php echo htmlspecialchars($project['slug']); ?>">
                                        <div class="hp">
                                            <input type="text" name="website" tabindex="-1" autocomplete="off">
                                        </div>
                                        <button class="card-action" type="submit">Duplicate</button>
                                    </form>

                                    <a class="card-action" href="/rename-project.php?project=<?php echo $projectSlug; ?>">Rename</a>
                                    <a class="card-action" href="/restore-flow.php?project=<?php echo $projectSlug; ?>">Restore</a>
                                    <a class="card-action card-action-danger" href="/delete-project.php?project=<?php echo $projectSlug; ?>">Delete</a>
                                </div>
                            </div>
                        </article>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>

            <footer class="dashboard-footer" aria-label="Legal links">
                <a href="/privacy.php">Privacy</a>
                <a href="/terms.php">Terms</a>
            </footer>
        </section>
    </main>
    <script src="/shared/frontend/creator-tools.js"></script>
    <script src="/assets/dashboard.js"></script>
</body>

</html>
