<?php
// media.php
// Authorization-aware controller to serve private media files safely.

require_once __DIR__ . '/server/core/web-session.php';
startWebSession();
require_once __DIR__ . '/server/core/project-paths.php';

$currentUser = $_SESSION['username'] ?? '';
// Media responses are read-only. Release PHP's per-session lock before file
// validation and streaming so image/audio preloads can run concurrently.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}
// Publication and session identity can change between requests. Never let a
// browser or shared cache reuse project data without reaching authorization.
// Set this before validation so denied/missing responses cannot be cached either.
header('Cache-Control: private, no-store, max-age=0, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
$p = $_GET['p'] ?? '';
if ($p === '') {
    http_response_code(400);
    die('Missing path.');
}

// Format should be username/project/folder/filename
$parts = explode('/', trim($p, '/'));
if (count($parts) < 3) {
    http_response_code(400);
    die('Invalid path structure.');
}

$reqUser = $parts[0];
$reqProject = $parts[1];
$subPath = implode('/', array_slice($parts, 2));

// Security check: Don't allow traversal
if (strpos($reqUser, '.') !== false || strpos($reqProject, '.') !== false || strpos($subPath, '..') !== false) {
    http_response_code(403);
    die('Invalid path characters.');
}

const MEDIA_MIME_MAP = [
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png'  => 'image/png',
    'gif'  => 'image/gif',
    'webp' => 'image/webp',
    'mp3'  => 'audio/mpeg',
    'wav'  => 'audio/wav',
    'ogg'  => 'audio/ogg',
    'aac'  => 'audio/aac',
    'flac' => 'audio/flac',
    'm4a'  => 'audio/mp4',
    'json' => 'application/json',
];

$ext = strtolower(pathinfo($subPath, PATHINFO_EXTENSION));
if (!isset(MEDIA_MIME_MAP[$ext])) {
    http_response_code(403);
    die('File type not allowed to be served.');
}
$mime = MEDIA_MIME_MAP[$ext];

$privatePaths = getProjectPaths($reqUser, $reqProject);
$projectFsDir = $privatePaths['projectFsDir'];
$fileFsPath = realpath($projectFsDir . '/' . $subPath);

if ($fileFsPath === false || !is_file($fileFsPath)) {
    http_response_code(404);
    die('File not found.');
}

// Authorization Check
$isOwner = (strtolower($reqUser) === strtolower($currentUser));
$isPublished = false;

// If we are not the owner, we can only view if published, AND we cannot view backups
if (!$isOwner) {
    // Authorize the resolved file, not the URL spelling: repeated separators,
    // ./ segments and Windows path aliases can all refer to the same backup.
    $backupFsDir = realpath($privatePaths['backupsFsDir']);
    $checkedFilePath = $fileFsPath;
    if (DIRECTORY_SEPARATOR === '\\') {
        // Windows realpath does not guarantee canonical letter casing.
        $checkedFilePath = strtolower($checkedFilePath);
        $backupFsDir = $backupFsDir === false ? false : strtolower($backupFsDir);
    }
    if ($backupFsDir !== false && str_starts_with($checkedFilePath, $backupFsDir . DIRECTORY_SEPARATOR)) {
        http_response_code(403);
        die('Backups are private.');
    }

    // Check if published
    if (is_file($privatePaths['flowPath'])) {
        $json = @file_get_contents($privatePaths['flowPath']);
        $data = is_string($json) ? json_decode($json, true) : null;
        if (is_array($data) && isset($data['isPublished']) && $data['isPublished']) {
            $isPublished = true;
        }
    }

    if (!$isPublished) {
        http_response_code(403);
        die('Project is not published.');
    }
}

// Serve the file safely
header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($fileFsPath));

readfile($fileFsPath);
exit;
