<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

ensureFormGuard('duplicate_project');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(403);
    exit('Forbidden');
}

$project = $_POST['project'] ?? '';
$project = basename(trim($project));

$guardError = validateFormGuard(
    'duplicate_project',
    (string) ($_POST['form_token'] ?? ''),
    trim((string) ($_POST['website'] ?? '')),
    0
);

if ($guardError !== null) {
    $_SESSION['flash_error'] = $guardError;
    header('Location: /dashboard.php');
    exit;
}

$paths = getProjectPaths($currentUser, $project);

if ($project === '') {
    respondNotFoundPage();
}

$userProjectsDir = $paths['userFsDir'];
$sourceDir = $userProjectsDir . '/' . $project;
$flowFile = $sourceDir . '/flow.json';

if (!is_dir($sourceDir) || !file_exists($flowFile)) {
    respondNotFoundPage();
}

/* generate new slug */

$newSlug = $project . '-copy';
$counter = 2;

while (file_exists($userProjectsDir . '/' . $newSlug)) {
    $newSlug = $project . '-copy-' . $counter;
    $counter++;
}

$targetDir = $userProjectsDir . '/' . $newSlug;

/* recursive copy */

function copyProjectFolder($src, $dst)
{
    mkdir($dst, 0755, true);

    $items = scandir($src);

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;

        $srcPath = $src . '/' . $item;
        $dstPath = $dst . '/' . $item;

        if (is_dir($srcPath)) {
            copyProjectFolder($srcPath, $dstPath);
        } else {
            copy($srcPath, $dstPath);
            // S-05: Explicitly lock copied files to 0644 regardless of server umask.
            chmod($dstPath, 0644);
        }
    }
}

copyProjectFolder($sourceDir, $targetDir);

// S-05 Defense-in-depth: Overwrite/inject .htaccess in the duplicated project tree
// to deny PHP execution, even if the source project's .htaccess was absent.
$htaccess = $targetDir . '/.htaccess';
$htaccessContent = <<<'HTACCESS'
# Deny execution of PHP (and other server-side scripts) in this project folder.
# This is a hard server-level guardrail applied automatically on project creation.
<FilesMatch "\.ph(p[0-9]?|tml)$">
    Require all denied
</FilesMatch>
HTACCESS;
file_put_contents($htaccess, $htaccessContent);
chmod($htaccess, 0644);

/* redirect to editor */

header("Location: /edit/" . rawurlencode($newSlug) . "/");
exit;
