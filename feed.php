<?php

require_once __DIR__ . '/server/core/web-session.php';
startWebSession();
require_once __DIR__ . '/server/core/published-projects.php';
$user = $_GET['user'] ?? '';
$user = basename(trim($user));
if ($user !== '') {
    $items = getPublishedProjectsByUser($user);
} else {
    $items = getPublishedProjects();
}
function formatPublishedDate(int $timestamp): string
{
    if ($timestamp <= 0) {
        return '';
    }

    $now = time();
    $diff = $now - $timestamp;

    if ($diff < 60) {
        return 'Just now';
    }

    if ($diff < 3600) {
        $mins = floor($diff / 60);
        return $mins . ' min' . ($mins > 1 ? 's' : '') . ' ago';
    }

    if ($diff < 86400) {
        $hours = floor($diff / 3600);
        return $hours . ' hour' . ($hours > 1 ? 's' : '') . ' ago';
    }

    if ($diff < 604800) {
        $days = floor($diff / 86400);
        return $days . ' day' . ($days > 1 ? 's' : '') . ' ago';
    }

    return date('M j, Y', $timestamp);
}
$page = max(1, (int)($_GET['page'] ?? 1));
$perPage = 12;

$totalItems = count($items);
$totalPages = max(1, (int)ceil($totalItems / $perPage));
$page = min($page, $totalPages);

$offset = ($page - 1) * $perPage;
$items = array_slice($items, $offset, $perPage);

$queryBase = '/feed.php';
if ($user !== '') {
    $queryBase .= '?user=' . urlencode($user);
}

function feedPageUrl(int $page, string $user = ''): string
{
    $params = ['page' => $page];

    if ($user !== '') {
        $params['user'] = $user;
    }

    return '/feed.php?' . http_build_query($params);
}
$projectCount = count($items);
$isLoggedIn = isset($_SESSION['user_id'], $_SESSION['username']);
setWebPageDiscovery(true);
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Slideshow Feed</title>
    <?= webRobotsMeta() ?>

    <link rel="stylesheet" href="/assets/app.css">

    <link rel="stylesheet" href="/shared/frontend/project-library.css">
    <link rel="stylesheet" href="/assets/feed.css">
</head>

<body class="feed-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Primary navigation">
                <a class="app-nav__link" href="/feed.php" aria-current="page">Public Feed</a>
                <?php if ($isLoggedIn): ?>
                    <a class="app-nav__link" href="/dashboard.php">My Library</a>
                    <a class="app-nav__link" href="/account-settings.php">Account settings</a>
                <?php else: ?>
                    <a class="app-nav__link" href="/login.php">Login</a>
                <?php endif; ?>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro" aria-labelledby="feed-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Public project library</p>
                    <?php if ($user): ?>
                        <h1 id="feed-title">Slideshows by <?= htmlspecialchars($user) ?></h1>
                    <?php else: ?>
                        <h1 id="feed-title">The public gallery</h1>
                    <?php endif; ?>
                    <p class="page-intro__description">
                        Discover <?= $totalItems ?> <?= $totalItems === 1 ? 'published slideshow' : 'published slideshows' ?> shared by the community.
                    </p>
                </div>
                <?php if ($isLoggedIn): ?>
                    <div class="page-intro__actions">
                        <a class="button button-primary" href="/new-project.php">New Slideshow</a>
                    </div>
                <?php endif; ?>
            </div>
        </section>

        <div class="wrap feed-content">
            <section aria-label="Published slideshows">
                <?php if ($user !== ''): ?>
                    <a class="feed-back" href="/feed.php">← Back to all slideshows</a>
                <?php endif; ?>

                <?php if (empty($items)): ?>
                    <div class="project-library project-library-empty">
                        <?php if ($user !== ''): ?>
                            <h2>No published slideshows by <?= htmlspecialchars($user) ?> yet</h2>
                            <p>This creator has not published any slideshows yet.</p>
                        <?php else: ?>
                            <h2>No published slideshows yet</h2>
                            <p>Projects will appear here after they are marked as published.</p>
                        <?php endif; ?>
                    </div>
                <?php else: ?>
                    <div class="project-library project-grid">
                        <?php foreach ($items as $item): ?>
                            <article class="project-card">
                                <a class="project-image" href="<?= htmlspecialchars($item['projectUrl']) ?>" aria-label="Play <?= htmlspecialchars($item['title']) ?>">
                                    <?php if ($item['imageUrl']): ?>
                                        <img src="<?= htmlspecialchars($item['imageUrl']) ?>" alt="">
                                    <?php else: ?>
                                        <div class="project-placeholder" aria-hidden="true">
                                            <span></span><span></span><span></span>
                                        </div>
                                    <?php endif; ?>
                                    <span class="project-access">Public</span>
                                </a>

                                <div class="project-copy">
                                    <div class="project-title-row">
                                        <h2>
                                            <a class="project-title-link" href="<?= htmlspecialchars($item['projectUrl']) ?>">
                                                <?= htmlspecialchars($item['title']) ?>
                                            </a>
                                        </h2>
                                    </div>

                                    <p class="project-description">
                                        <?= htmlspecialchars($item['description'] ?: 'Open this slideshow to view the full sequence and project story.') ?>
                                    </p>

                                    <div class="project-meta">
                                        <a class="feed-author-link" href="/feed.php?user=<?= urlencode($item['username']) ?>">
                                            by <?= htmlspecialchars($item['username']) ?>
                                        </a>
                                        <?php if (!empty($item['publishedAt'])): ?>
                                            <span><?= htmlspecialchars(formatPublishedDate((int) $item['publishedAt'])) ?></span>
                                        <?php endif; ?>
                                    </div>

                                    <div class="project-actions">
                                        <a class="card-action card-action-primary" href="<?= htmlspecialchars($item['projectUrl']) ?>">Play Slideshow</a>
                                        <?php if ($user === ''): ?>
                                            <a class="card-action" href="/feed.php?user=<?= urlencode($item['username']) ?>">More by Creator</a>
                                        <?php endif; ?>
                                    </div>
                                </div>
                            </article>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </section>

            <?php if ($totalPages > 1): ?>
                <nav class="feed-pagination" aria-label="Feed pages">
                    <?php if ($page > 1): ?>
                        <a class="feed-page-link" href="<?= htmlspecialchars(feedPageUrl($page - 1, $user)) ?>">← Previous</a>
                    <?php endif; ?>

                    <span class="feed-page-current">Page <?= $page ?> of <?= $totalPages ?></span>

                    <?php if ($page < $totalPages): ?>
                        <a class="feed-page-link" href="<?= htmlspecialchars(feedPageUrl($page + 1, $user)) ?>">Next →</a>
                    <?php endif; ?>
                </nav>
            <?php endif; ?>
        </div>
    </main>
</body>

</html>
