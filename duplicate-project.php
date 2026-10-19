<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/storage-quota.php';

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

// Prepare a private draft before creating any destination files. Decode as an
// object so empty objects and numeric-key objects in slide settings stay intact.
$userStorageLock = acquireUserStorageLock($userProjectsDir);
if ($userStorageLock === false) {
    http_response_code(409);
    exit('Another storage operation is in progress. Please try again.');
}
try {
    $sourceJson = @file_get_contents($flowFile);
    if (!is_string($sourceJson)) throw new RuntimeException('Cannot read source flow.');
    $draft = json_decode($sourceJson, false, 512, JSON_THROW_ON_ERROR);
    if (!$draft instanceof stdClass) throw new RuntimeException('Invalid source flow.');
    $draft->isPublished = false;
    unset($draft->publishedAt);
    $draftJson = json_encode($draft, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    http_response_code(500);
    exit('Could not read project for duplication.');
}

/* generate and reserve a new slug without overwriting an existing copy */

try {
    // Include the copied tree, private flow and small generated .htaccess.
    // The bound conservatively includes the source flow even though it is skipped.
    assertUserStorageCapacity($userProjectsDir, storageTreeBytes($sourceDir) + strlen($draftJson) + 1024);
} catch (StorageQuotaException $e) {
    http_response_code($e->getCode());
    exit($e->getMessage());
}

$newSlug = $project . '-copy';
$counter = 2;

while (true) {
    $targetDir = $userProjectsDir . '/' . $newSlug;
    if (@mkdir($targetDir, 0755)) break;
    if (!file_exists($targetDir)) {
        http_response_code(500);
        exit('Could not create project copy.');
    }
    $newSlug = $project . '-copy-' . $counter;
    $counter++;
}

/* recursive copy */

function copyProjectFolder($src, $dst, $isRoot = true)
{
    $items = @scandir($src);
    if ($items === false) throw new RuntimeException('Cannot read project folder.');

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        // Never place the source's publication state in the new project, even
        // temporarily. Nested files (including backups) are copied unchanged.
        if ($isRoot && $item === 'flow.json') continue;

        $srcPath = $src . '/' . $item;
        $dstPath = $dst . '/' . $item;

        if (is_dir($srcPath)) {
            if (!@mkdir($dstPath, 0755)) throw new RuntimeException('Cannot create folder.');
            copyProjectFolder($srcPath, $dstPath, false);
        } else {
            // S-05: Explicitly lock copied files to 0644 regardless of server umask.
            if (!@copy($srcPath, $dstPath) || !@chmod($dstPath, 0644)) {
                throw new RuntimeException('Cannot copy project file.');
            }
        }
    }
}

// Called only for the new directory reserved above; never follow symlinks.
function removeIncompleteProjectCopy($dir)
{
    foreach (@scandir($dir) ?: [] as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        if (is_dir($path) && !is_link($path)) removeIncompleteProjectCopy($path);
        else @unlink($path);
    }
    @rmdir($dir);
}

try {
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
    if (@file_put_contents($htaccess, $htaccessContent) !== strlen($htaccessContent) || !@chmod($htaccess, 0644)) {
        throw new RuntimeException('Cannot protect project copy.');
    }

    // Create the live flow only after the content/media copy has succeeded.
    // A missing/incomplete flow is not public, and the completed flow is private.
    $targetFlow = $targetDir . '/flow.json';
    if (@file_put_contents($targetFlow, $draftJson) !== strlen($draftJson) || !@chmod($targetFlow, 0644)) {
        throw new RuntimeException('Cannot write project draft.');
    }
} catch (Throwable $e) {
    removeIncompleteProjectCopy($targetDir);
    http_response_code(500);
    exit('Could not duplicate project. Please try again.');
}

/* redirect to editor */

header("Location: /edit/" . rawurlencode($newSlug) . "/");
exit;
