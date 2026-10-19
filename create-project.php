<?php
require_once __DIR__ . '/server/core/auth-check.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/storage-quota.php';

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

require_once __DIR__ . '/server/core/current-user.php';

$userProjectsDir = __DIR__ . '/private-data/slidedeck/' . $currentUser;

/* ensure the user folder exists */
if (!is_dir($userProjectsDir) && !@mkdir($userProjectsDir, 0755, true) && !is_dir($userProjectsDir)) {
    http_response_code(500);
    exit('Could not prepare your project library. Please try again.');
}

$userStorageLock = acquireUserStorageLock($userProjectsDir);
if ($userStorageLock === false) {
    http_response_code(409);
    exit('Another storage operation is in progress. Please try again.');
}

$projectDir = $userProjectsDir . '/' . $project;
clearstatcache();
if (file_exists($projectDir) || is_link($projectDir)) {
    $_SESSION['flash_error'] = 'Project already exists.';
    header('Location: /new-project.php');
    exit;
}

// S-05 Defense-in-depth: prevent the web server from executing any uploaded file
// inside this project tree, even if a future upload bypass slips through.
$htaccessContent = <<<'HTACCESS'
# Deny execution of PHP (and other server-side scripts) in this project folder.
# This is a hard server-level guardrail applied automatically on project creation.
<FilesMatch "\.ph(p[0-9]?|tml)$">
    Require all denied
</FilesMatch>
HTACCESS;
$starterJson = [
    'title' => '',
    'isPublished' => false,
    'schemaVersion' => 2,
    'defaultBeatSeconds' => 5,
    'slides' => [],
    'openingImage' => ''
];

$serializedFlow = json_encode($starterJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
try {
    assertUserStorageCapacity($userProjectsDir, strlen($serializedFlow) + strlen($htaccessContent));
} catch (StorageQuotaException $e) {
    http_response_code($e->getCode());
    exit($e->getMessage());
}

// Prepare in a private container on the same filesystem, then install with one
// rename. No flow.json at the container root: library readers cannot mistake
// incomplete work for a project. Never clean up the requested destination.
$stagingRoot = null;
$cleanupCreation = static function () use (&$stagingRoot): void {
    if ($stagingRoot === null) return;
    $stagedProject = $stagingRoot . '/project';
    $clean = true;
    // Only these fixed paths can be created here. Do not recurse or follow links.
    foreach (['flow.json', '.htaccess'] as $file) {
        $path = $stagedProject . '/' . $file;
        if (is_file($path) || is_link($path)) $clean = @unlink($path) && $clean;
    }
    foreach (['img', 'speech', 'audio'] as $folder) {
        $path = $stagedProject . '/' . $folder;
        if (is_dir($path)) $clean = @rmdir($path) && $clean;
    }
    if (is_dir($stagedProject)) $clean = @rmdir($stagedProject) && $clean;
    if (is_dir($stagingRoot)) $clean = @rmdir($stagingRoot) && $clean;
    if ($clean) $stagingRoot = null;
    else error_log('Could not clean up new project staging directory: ' . $stagingRoot);
};
register_shutdown_function($cleanupCreation);

try {
    $candidate = $userProjectsDir . '/.create-' . bin2hex(random_bytes(12));
    if (!@mkdir($candidate, 0700)) throw new RuntimeException('Could not create staging container.');
    $stagingRoot = $candidate; // Own it only after mkdir succeeds.
    $stagedProject = $stagingRoot . '/project';
    if (!@mkdir($stagedProject, 0755)) throw new RuntimeException('Could not create project directory.');
    foreach (['img', 'speech', 'audio'] as $folder) {
        if (!@mkdir($stagedProject . '/' . $folder, 0755)) throw new RuntimeException('Could not create media directory.');
    }
    foreach (['.htaccess' => $htaccessContent, 'flow.json' => $serializedFlow] as $name => $contents) {
        $path = $stagedProject . '/' . $name;
        if (@file_put_contents($path, $contents, LOCK_EX) !== strlen($contents)
            || !@chmod($path, 0644)) {
            throw new RuntimeException('Could not write or protect new project file.');
        }
    }
    if (!@chmod($stagedProject, 0755)) throw new RuntimeException('Could not set project permissions.');
    clearstatcache();
    if (file_exists($projectDir) || is_link($projectDir) || !@rename($stagedProject, $projectDir)) {
        throw new RuntimeException('Could not finish creating project.');
    }
} catch (Throwable $e) {
    error_log('Project creation failed: ' . $e->getMessage());
    http_response_code(500);
    exit('Could not create project. Please try again.');
} finally {
    // Keep the account lock until staging cleanup finishes. Shutdown also
    // performs cleanup on exit/fatal errors; it is safe to run more than once.
    $cleanupCreation();
}
$userStorageLock = null;

header("Location: /edit/" . rawurlencode($project) . "/?created=1");
exit;
