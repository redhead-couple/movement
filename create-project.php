<?php
require_once __DIR__ . '/server/core/auth-check.php';
require_once __DIR__ . '/server/core/security-helpers.php';

ensureFormGuard('create_project');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(403);
    exit('Forbidden');
}

$project = $_POST['project'] ?? '';
$project = basename(trim($project));

$guardError = validateFormGuard(
    'create_project',
    (string) ($_POST['form_token'] ?? ''),
    trim((string) ($_POST['website'] ?? '')),
    0
);

if ($guardError !== null) {
    $_SESSION['flash_error'] = $guardError;
    header('Location: /new-project.php');
    exit;
}

if ($project === '') {
    $_SESSION['flash_error'] = 'Missing project name.';
    header('Location: /new-project.php');
    exit;
}

if (!preg_match('/^[a-zA-Z0-9_-]+$/', $project)) {
    $_SESSION['flash_error'] = 'Invalid project slug. Use only letters, numbers, hyphens, and underscores.';
    header('Location: /new-project.php');
    exit;
}

$rootDir = $_SERVER['DOCUMENT_ROOT'];

require_once __DIR__ . '/server/core/current-user.php';

$userProjectsDir = __DIR__ . '/private-data/slidedeck/' . $currentUser;

/* ensure the user folder exists */
if (!is_dir($userProjectsDir)) {
    mkdir($userProjectsDir, 0755, true);
}

$projectDir = $userProjectsDir . '/' . $project;

$imgDir = $projectDir . '/img';
$speechDir = $projectDir . '/speech';
$audioDir = $projectDir . '/audio';

$flowFile = $projectDir . '/flow.json';

if (file_exists($projectDir)) {
    $_SESSION['flash_error'] = 'Project already exists.';
    header('Location: /new-project.php');
    exit;
}

/* create project folders — 0755 so web server can read/traverse but others cannot write */
mkdir($projectDir, 0755, true);
mkdir($imgDir, 0755, true);
mkdir($speechDir, 0755, true);
mkdir($audioDir, 0755, true);

// S-05 Defense-in-depth: prevent the web server from executing any uploaded file
// inside this project tree, even if a future upload bypass slips through.
$htaccess = $projectDir . '/.htaccess';
$htaccessContent = <<<'HTACCESS'
# Deny execution of PHP (and other server-side scripts) in this project folder.
# This is a hard server-level guardrail applied automatically on project creation.
<FilesMatch "\.ph(p[0-9]?|tml)$">
    Require all denied
</FilesMatch>
HTACCESS;
file_put_contents($htaccess, $htaccessContent);
chmod($htaccess, 0644);

$starterJson = [
    'title' => '',
    'isPublished' => false,
    'schemaVersion' => 2,
    'defaultBeatSeconds' => 5,
    'slides' => [],
    'openingImage' => ''
];

file_put_contents(
    $flowFile,
    json_encode($starterJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);
// S-05: Assert safe file permission regardless of server umask.
chmod($flowFile, 0644);

header("Location: /edit/" . rawurlencode($project) . "/?created=1");
exit;
