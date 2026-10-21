<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/project-storage.php';

ensureFormGuard('publish_project');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(403);
    exit('Forbidden');
}

$project = $_POST['project'] ?? '';
$project = basename(trim($project));

$guardError = validateFormGuard(
    'publish_project',
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
$projectDir = $userProjectsDir . '/' . $project;
$flowFile = $projectDir . '/flow.json';

if (!is_dir($projectDir) || !file_exists($flowFile)) {
    respondNotFoundPage();
}

$projectLock = acquireProjectLock($projectDir);
if ($projectLock === false) {
    http_response_code(409);
    exit('This project is already being saved. Please try again.');
}

try {
    $json = @file_get_contents($flowFile);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        http_response_code(500);
        exit('Invalid flow.json.');
    }

    $current = isset($data['isPublished']) ? (bool)$data['isPublished'] : false;
    $data['isPublished'] = !$current;
    $data['publishedAt'] = time();

    $updatedJson = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (is_string($updatedJson)) assertUserStorageCapacity($userProjectsDir, strlen($updatedJson));
    if (!is_string($updatedJson) || !saveJsonAtomically($flowFile, $updatedJson)) {
        http_response_code(500);
        exit('Could not update project publication. Please try again.');
    }

    $status = $data['isPublished'] ? 'published' : 'unpublished';
} catch (StorageQuotaException $e) {
    http_response_code($e->getCode());
    exit($e->getMessage());
} finally {
    releaseProjectLock($projectLock);
}

header('Location: /dashboard.php?' . $status . '=' . rawurlencode($project));
exit;
