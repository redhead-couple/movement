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
    'avif' => 'image/avif',
    'bmp'  => 'image/bmp',
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
$trashPreview = ($_GET['trash_preview'] ?? '') === '1';
if ($trashPreview) {
    require_once __DIR__ . '/server/core/media-trash.php';
    $segments = explode('/', $subPath);
    $type = $segments[2] ?? '';
    $extensions = $type === 'img' ? ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']
        : (in_array($type, ['audio', 'speech'], true) ? ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'] : []);
    if ($currentUser === '' || strtolower($reqUser) !== strtolower($currentUser)
        || count($segments) !== 4 || $segments[0] !== '.movement-media-trash'
        || !mediaTrashSafeName($segments[1]) || !mediaTrashSafeName($segments[3]) || !in_array($ext, $extensions, true)) {
        http_response_code(403); exit('Media preview is private.');
    }
    try { mediaTrashPlainPath($projectFsDir, ...$segments); }
    catch (RuntimeException $e) { http_response_code(403); exit('Media preview not available.'); }
}
$fileFsPath = realpath($projectFsDir . '/' . $subPath);

if ($fileFsPath === false || !is_file($fileFsPath)) {
    http_response_code(404);
    die('File not found.');
}

// Removed images must never remain public through a published project's media URL.
// Compare resolved paths so aliases/casing cannot bypass the trash boundary.
$trashFsDir = realpath($projectFsDir . '/.movement-media-trash');
$trashCheckedPath = $fileFsPath;
if (DIRECTORY_SEPARATOR === '\\') {
    $trashCheckedPath = strtolower($trashCheckedPath);
    $trashFsDir = $trashFsDir === false ? false : strtolower($trashFsDir);
}
if (!$trashPreview && $trashFsDir !== false && str_starts_with($trashCheckedPath, $trashFsDir . DIRECTORY_SEPARATOR)) {
    http_response_code(403);
    die('Restore this file from Media Trash before using it.');
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

// Only authorized, live project images may use a presentation copy. Cache files
// live outside all projects and are never exposed through a public cache URL.
if (!$trashPreview && ($_GET['variant'] ?? '') === 'player' && str_starts_with($mime, 'image/')) {
    $imagesRoot = realpath($privatePaths['imgFsDir']);
    if ($imagesRoot !== false && str_starts_with($fileFsPath, $imagesRoot . DIRECTORY_SEPARATOR)) {
        require_once __DIR__ . '/server/core/player-image.php';
        $copy = playerImageCopy($fileFsPath, __DIR__ . '/private-data/player-image-cache');
        // Open before serving: eviction in another request cannot truncate an
        // already-open copy. If it disappeared, fall through to the original.
        $copyStream = $copy ? @fopen($copy, 'rb') : false;
        if ($copyStream !== false) {
            header('Content-Type: image/webp');
            header('Content-Length: ' . fstat($copyStream)['size']);
            header('X-Content-Type-Options: nosniff');
            if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') fpassthru($copyStream);
            fclose($copyStream); exit;
        }
    }
}

// Serve the file safely
header('Content-Type: ' . $mime);
if ($trashPreview) {
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: sandbox; default-src 'none'");
    header('Accept-Ranges: bytes');
    $size = filesize($fileFsPath);
    $start = 0; $end = $size - 1;
    if (isset($_SERVER['HTTP_RANGE'])) {
        if (!preg_match('/^bytes=(\d*)-(\d*)$/D', $_SERVER['HTTP_RANGE'], $range)
            || ($range[1] === '' && $range[2] === '')) {
            http_response_code(416); header('Content-Range: bytes */' . $size); exit;
        }
        if ($range[1] === '') $start = max(0, $size - (int) $range[2]);
        else { $start = (int) $range[1]; if ($range[2] !== '') $end = min($end, (int) $range[2]); }
        if ($start > $end || $start >= $size) {
            http_response_code(416); header('Content-Range: bytes */' . $size); exit;
        }
        http_response_code(206); header("Content-Range: bytes $start-$end/$size");
    }
    $file = @fopen($fileFsPath, 'rb');
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Length: ' . max(0, $end - $start + 1));
    if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') {
        fseek($file, $start);
        $remaining = $end - $start + 1;
        while ($remaining > 0 && !feof($file) && !connection_aborted()) {
            $chunk = fread($file, min(65536, $remaining));
            if ($chunk === false || $chunk === '') break;
            echo $chunk; $remaining -= strlen($chunk);
        }
    }
    fclose($file); exit;
}
header('Content-Length: ' . filesize($fileFsPath));

readfile($fileFsPath);
exit;
