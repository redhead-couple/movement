<?php
// Shared player behavior lives in studio/player/player-runtime.js and templates/player/player-page-template.php.
// Keep this file focused on the live/server bootstrap only.

require_once __DIR__ . '/server/core/web-session.php';
startWebSession();

require_once __DIR__ . '/server/core/project-paths.php';
require_once __DIR__ . '/server/core/response.php';
require_once __DIR__ . '/templates/player/player-page-template.php';

$example = trim((string) ($_GET['example'] ?? ''));
$playerTitle = 'Timeline Player v2';

if ($example !== '') {
    $paths = getExampleProjectPaths($example);
    if ($paths === null) {
        respondNotFoundPage();
    }

    $projectWebDir = $paths['projectWebDir'];
    $flowFile = $paths['flowPath'];
    $mediaBase = $projectWebDir;
    $json = @file_get_contents($flowFile);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data) || (int) ($data['schemaVersion'] ?? 0) !== 2) {
        respondNotFoundPage();
    }

    if (isset($data['title']) && is_string($data['title']) && trim($data['title']) !== '') {
        $playerTitle = trim($data['title']);
    }
} else {
    $username = (string) ($_GET['username'] ?? '');
    $project = (string) ($_GET['project'] ?? '');
    $isOwner = isset($_SESSION['username']) && $_SESSION['username'] === $username;

    $paths = getProjectPaths($username, $project);
    $projectWebDir = $paths['projectWebDir'];
    $projectFsDir = $paths['projectFsDir'];
    $flowFile = $paths['flowPath'];

    if ($project === '' || !is_dir($projectFsDir) || !is_file($flowFile)) {
        respondNotFoundPage();
    }

    $json = @file_get_contents($flowFile);
    $data = is_string($json) ? json_decode($json, true) : null;
    $isPublished = is_array($data) && isset($data['isPublished']) ? (bool) $data['isPublished'] : false;

    if (!$isPublished && !$isOwner) {
        respondNotFoundPage();
    }

    $mediaBase = $paths['mediaWebDir'];
}

// Publication is the existing feed/discovery rule. Owner access to a draft
// grants playback only, never indexing. Invalid/unsupported data stays excluded.
setWebPageDiscovery(is_array($data) && !empty($data['isPublished'])
    && (int) ($data['schemaVersion'] ?? 0) === 2
    && isset($data['slides']) && is_array($data['slides']));

$bootstrapConfig = [
    'projectBase' => $projectWebDir,
    'flowUrl' => $mediaBase . 'flow.json',
    'imgBase' => $mediaBase . 'img/',
    'speechBase' => $mediaBase . 'speech/',
    'audioBase' => $mediaBase . 'audio/',
    'engineBase' => '/effects/',
    'transitionEngineBase' => '/transitions/',
    'cacheBustSpeech' => true,
    // Keep this many slides ahead fully preloaded. Change this number to tune the window.
    'preloadAheadSlides' => 6,
];

$headAssetsHtml = <<<'HTML'
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css">
HTML;

echo renderPlayerPage([
    'robotsMetaHtml' => webRobotsMeta(),
    'title' => $playerTitle,
    'headAssetsHtml' => $headAssetsHtml,
    'bootstrapScript' => 'window.PLAYER_BOOTSTRAP = ' . json_encode($bootstrapConfig, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ';',
]);
