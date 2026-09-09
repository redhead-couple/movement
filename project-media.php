<?php
require_once __DIR__ . '/server/core/auth-check.php';
require_once __DIR__ . '/server/core/current-user.php';
require_once __DIR__ . '/server/core/project-paths.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$formId = 'project_media';
$guard = ensureFormGuard($formId);

function renderProjectMediaCsrfFields(array $guard): void
{
    echo '<input type="hidden" name="form_token" value="' . htmlspecialchars($guard['token'], ENT_QUOTES, 'UTF-8') . '">';
    echo '<div class="hp"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>';
}

function mediaError(string $message, int $statusCode = 400): void
{
    http_response_code($statusCode);
?>
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <title>Project Media</title>
        <meta name="robots" content="noindex, nofollow">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="/assets/app.css">
    </head>

    <body class="project-media-page">
        <a class="app-return-link app-return-link--back app-return-link--floating" href="/dashboard.php" aria-label="Back to My Library">My Library</a>
        <main class="page">
            <div class="wrap">
                <section class="panel">
                    <div class="panel-body">
                        <p class="eyebrow">Project Media</p>
                        <h1><?php echo htmlspecialchars($message, ENT_QUOTES, 'UTF-8'); ?></h1>
                        <div class="actions" style="margin-top: 18px;">
                            <a class="button button-secondary" href="/dashboard.php">Back to dashboard</a>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    </body>

    </html>
<?php
    exit;
}

function redirectToProjectMedia(string $project): void
{
    header('Location: /project-media.php?project=' . rawurlencode($project));
    exit;
}

function listAllowedFiles(string $directory, array $allowedExtensions): array
{
    if (!is_dir($directory)) {
        return [];
    }

    $files = [];
    $items = scandir($directory);

    if (!is_array($items)) {
        return [];
    }

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }

        $path = $directory . '/' . $item;
        if (!is_file($path)) {
            continue;
        }

        $extension = strtolower(pathinfo($item, PATHINFO_EXTENSION));
        if (!in_array($extension, $allowedExtensions, true)) {
            continue;
        }

        $files[] = $item;
    }

    natcasesort($files);

    return array_values($files);
}

function normalizeMediaFilename(string $value, string $folder): string
{
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    $value = str_replace('\\', '/', $value);
    $prefix = $folder . '/';

    if (stripos($value, $prefix) === 0) {
        $value = substr($value, strlen($prefix));
    }

    return basename($value);
}

function addUsageReference(array &$usageMap, string $filename, int $slideNumber, string $label = ''): void
{
    if ($filename === '') {
        return;
    }

    if (!isset($usageMap[$filename])) {
        $usageMap[$filename] = [];
    }

    if (!isset($usageMap[$filename][$slideNumber])) {
        $usageMap[$filename][$slideNumber] = [];
    }

    if ($label !== '' && !in_array($label, $usageMap[$filename][$slideNumber], true)) {
        $usageMap[$filename][$slideNumber][] = $label;
    }
}

function collectSlideMediaUsage(
    array $value,
    int $slideNumber,
    array &$imageUsage,
    array &$speechUsage,
    array &$audioUsage,
    string $context = ''
): void {
    foreach ($value as $key => $item) {
        if ($key === 'speech' && is_string($item)) {
            addUsageReference($speechUsage, normalizeMediaFilename($item, 'speech'), $slideNumber, 'speech');
            continue;
        }

        if ($key === 'audioLayers' && is_array($item)) {
            foreach ($item as $layerIndex => $layer) {
                if (!is_array($layer) || empty($layer['src']) || !is_string($layer['src'])) {
                    continue;
                }

                $src = str_replace('\\', '/', $layer['src']);
                $name = (string) ($layer['name'] ?? '');
                $isSpeechLayer = (int) $layerIndex === 0 || stripos($src, 'speech/') === 0 || strcasecmp($name, 'Speech') === 0;
                if (stripos($src, 'audio/') === 0) {
                    $isSpeechLayer = false;
                }

                if ($isSpeechLayer) {
                    addUsageReference($speechUsage, normalizeMediaFilename($src, 'speech'), $slideNumber, 'speech');
                } else {
                    addUsageReference($audioUsage, normalizeMediaFilename($src, 'audio'), $slideNumber, 'audio');
                }
            }
            continue;
        }

        if ($key === 'src' && is_string($item) && in_array($context, ['background', 'foregroundLayers', 'foregroundLayer'], true)) {
            $label = $context === 'background' ? 'background' : 'foreground';
            addUsageReference($imageUsage, normalizeMediaFilename($item, 'img'), $slideNumber, $label);
            continue;
        }

        if (in_array($key, ['background', 'foreground', 'imgSrc', 'imgSrc2'], true) && is_string($item)) {
            $label = $key;
            if ($key === 'imgSrc' || $key === 'imgSrc2') {
                if ($context === 'bgEffect') {
                    $label = 'bgEffect ' . $key;
                } elseif ($context === 'fgEffect' || $context === 'frEffect') {
                    $label = 'fgEffect ' . $key;
                }
            }

            addUsageReference($imageUsage, normalizeMediaFilename($item, 'img'), $slideNumber, $label);
            continue;
        }

        if ($key === 'images' && is_array($item)) {
            foreach ($item as $imageItem) {
                if (is_string($imageItem)) {
                    $label = $context === 'bgEffect' ? 'bgEffect images' : 'images';
                    addUsageReference($imageUsage, normalizeMediaFilename($imageItem, 'img'), $slideNumber, $label);
                }
            }
            continue;
        }

        if ($key === 'frames' && is_array($item)) {
            foreach ($item as $frameItem) {
                if (is_string($frameItem)) {
                    $label = $context === 'bgEffect' ? 'bgEffect frames' : ($context === 'fgEffect' || $context === 'frEffect' ? 'fgEffect frames' : 'frames');
                    addUsageReference($imageUsage, normalizeMediaFilename($frameItem, 'img'), $slideNumber, $label);
                }
            }
            continue;
        }

        if (is_array($item)) {
            $nextContext = $context;
            if ($key === 'background') {
                $nextContext = 'background';
            } elseif ($key === 'foregroundLayers') {
                $nextContext = 'foregroundLayers';
            } elseif ($context === 'foregroundLayers' && is_int($key)) {
                $nextContext = 'foregroundLayer';
            } elseif ($key === 'bgEffect' || $key === 'fgEffect' || $key === 'frEffect') {
                $nextContext = $key;
            }

            collectSlideMediaUsage($item, $slideNumber, $imageUsage, $speechUsage, $audioUsage, $nextContext);
        }
    }
}

function getMediaUsageFromFlow(string $flowPath): array
{
    $imageUsage = [];
    $speechUsage = [];
    $audioUsage = [];
    $openingImage = '';

    if (!is_file($flowPath) || !is_readable($flowPath)) {
        return [
            'img' => $imageUsage,
            'speech' => $speechUsage,
            'audio' => $audioUsage,
            'openingImage' => $openingImage,
        ];
    }

    $json = file_get_contents($flowPath);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data) || empty($data['slides']) || !is_array($data['slides'])) {
        return [
            'img' => $imageUsage,
            'speech' => $speechUsage,
            'audio' => $audioUsage,
            'openingImage' => $openingImage,
        ];
    }

    if (!empty($data['openingImage']) && is_string($data['openingImage'])) {
        $openingImage = normalizeMediaFilename($data['openingImage'], 'img');
    }

    if (!empty($data['globalAudioLayers']) && is_array($data['globalAudioLayers'])) {
        foreach ($data['globalAudioLayers'] as $layer) {
            if (!is_array($layer) || empty($layer['src']) || !is_string($layer['src'])) {
                continue;
            }

            addUsageReference($audioUsage, normalizeMediaFilename($layer['src'], 'audio'), 0, 'global');
        }
    }

    foreach ($data['slides'] as $index => $slide) {
        if (!is_array($slide)) {
            continue;
        }

        collectSlideMediaUsage($slide, $index + 1, $imageUsage, $speechUsage, $audioUsage);
    }

    return [
        'img' => $imageUsage,
        'speech' => $speechUsage,
        'audio' => $audioUsage,
        'openingImage' => $openingImage,
    ];
}

function buildOrderedMediaItems(array $files, array $usageMap, string $openingImage = ''): array
{
    $items = [];

    foreach ($files as $filename) {
        $slideMap = $usageMap[$filename] ?? [];
        $slides = array_map('intval', array_keys($slideMap));
        sort($slides, SORT_NUMERIC);

        $items[] = [
            'filename' => $filename,
            'slides' => $slides,
            'slideMap' => $slideMap,
            'firstSlide' => $slides === [] ? PHP_INT_MAX : (int) $slides[0],
            'isUnused' => $slides === [],
            'isOpeningImage' => $openingImage !== '' && strcasecmp($filename, $openingImage) === 0,
        ];
    }

    usort($items, function (array $a, array $b): int {
        if ($a['firstSlide'] !== $b['firstSlide']) {
            return $a['firstSlide'] <=> $b['firstSlide'];
        }

        return strcasecmp($a['filename'], $b['filename']);
    });

    return $items;
}

function renderUsageLabel(array $slides): string
{
    if ($slides === []) {
        return 'Unused';
    }

    if ($slides === [0]) {
        return 'Used globally';
    }

    if (count($slides) === 1) {
        return 'Used in slide ' . $slides[0];
    }

    return 'Used in slides ' . implode(', ', $slides);
}

function renderImageUsageLabel(array $item): string
{
    $parts = [];

    if (!empty($item['isOpeningImage'])) {
        $parts[] = 'Used as opening image';
    }

    $parts[] = renderUsageLabel($item['slides']);

    return implode(' | ', $parts);
}

function renderImageUsageDetails(array $item, ?int $currentSlide = null): string
{
    $details = [];
    $slideMap = $item['slideMap'] ?? [];

    if ($currentSlide !== null) {
        $labels = $slideMap[$currentSlide] ?? [];
        if ($labels !== []) {
            $details[] = 'This slide: ' . implode(', ', $labels);
        }
    } else {
        foreach ($item['slides'] as $slideNumber) {
            $labels = $slideMap[$slideNumber] ?? [];
            if ($labels === []) {
                continue;
            }

            $details[] = 'Slide ' . $slideNumber . ': ' . implode(', ', $labels);
        }
    }

    return implode(' | ', $details);
}

function buildSlideRows(array $imageItems, array $speechItems, array $audioItems): array
{
    $rows = [];

    foreach ($imageItems as $item) {
        if (!empty($item['isUnused'])) {
            continue;
        }

        foreach ($item['slides'] as $slideNumber) {
            if (!isset($rows[$slideNumber])) {
                $rows[$slideNumber] = [
                    'slideNumber' => $slideNumber,
                    'images' => [],
                    'speech' => [],
                    'audio' => [],
                ];
            }

            $rows[$slideNumber]['images'][] = $item;
        }
    }

    foreach ($speechItems as $item) {
        if (!empty($item['isUnused'])) {
            continue;
        }

        foreach ($item['slides'] as $slideNumber) {
            if (!isset($rows[$slideNumber])) {
                $rows[$slideNumber] = [
                    'slideNumber' => $slideNumber,
                    'images' => [],
                    'speech' => [],
                    'audio' => [],
                ];
            }

            $rows[$slideNumber]['speech'][] = $item;
        }
    }

    foreach ($audioItems as $item) {
        if (!empty($item['isUnused'])) {
            continue;
        }

        foreach ($item['slides'] as $slideNumber) {
            if (!isset($rows[$slideNumber])) {
                $rows[$slideNumber] = [
                    'slideNumber' => $slideNumber,
                    'images' => [],
                    'speech' => [],
                    'audio' => [],
                ];
            }

            $rows[$slideNumber]['audio'][] = $item;
        }
    }

    ksort($rows, SORT_NUMERIC);

    return array_values($rows);
}

function filterUnusedItems(array $items): array
{
    return array_values(array_filter($items, function (array $item): bool {
        return !empty($item['isUnused']);
    }));
}

function findOpeningImageItem(array $items): ?array
{
    foreach ($items as $item) {
        if (!empty($item['isOpeningImage'])) {
            return $item;
        }
    }

    return null;
}

$project = basename(trim((string) ($_GET['project'] ?? '')));
if ($project === '') {
    mediaError('Missing project.', 400);
}

$paths = getProjectPaths($currentUser, $project);
$projectDir = $paths['projectFsDir'];

if (!is_dir($projectDir)) {
    mediaError('Project not found.', 404);
}

$imgDir = $projectDir . '/img';
$speechDir = $projectDir . '/speech';
$audioDir = $projectDir . '/audio';

if (!is_dir($imgDir) && !mkdir($imgDir, 0755, true) && !is_dir($imgDir)) {
    mediaError('Unable to prepare the image folder.', 500);
}

if (!is_dir($speechDir) && !mkdir($speechDir, 0755, true) && !is_dir($speechDir)) {
    mediaError('Unable to prepare the speech folder.', 500);
}

if (!is_dir($audioDir) && !mkdir($audioDir, 0755, true) && !is_dir($audioDir)) {
    mediaError('Unable to prepare the audio folder.', 500);
}

$projectMediaWebDir = $paths['mediaWebDir'];
$flowPath = $paths['flowPath'];

$imageExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
// SVG intentionally excluded: it is XML and can carry <script>/XSS payloads without spoofing.
$speechExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
$audioExtensions = $speechExtensions;

// S-04: Strict MIME → canonical extension map. Extension is NEVER derived from the user filename.
// Any MIME not present here is rejected unconditionally.
const MEDIA_MIME_MAP = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
    'audio/mpeg' => 'mp3',
    'audio/wav'  => 'wav',
    'audio/ogg'  => 'ogg',
    'audio/aac'  => 'aac',
    'audio/flac' => 'flac',
    'audio/mp4'  => 'm4a',
    'audio/x-m4a' => 'm4a',
];
$allowedFolders = [
    'img' => [
        'dir' => $imgDir,
        'extensions' => $imageExtensions,
    ],
    'speech' => [
        'dir' => $speechDir,
        'extensions' => $speechExtensions,
    ],
    'audio' => [
        'dir' => $audioDir,
        'extensions' => $audioExtensions,
    ],
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        $formId,
        (string) ($_POST['form_token'] ?? ''),
        trim((string) ($_POST['website'] ?? '')),
        0
    );

    if ($guardError !== null) {
        mediaError('Invalid or missing CSRF token.', 403);
    }

    $action = (string) ($_POST['action'] ?? '');
    $folder = (string) ($_POST['folder'] ?? '');

    if (!isset($allowedFolders[$folder])) {
        mediaError('Invalid folder.', 400);
    }

    $targetDir = $allowedFolders[$folder]['dir'];
    $allowedExtensions = $allowedFolders[$folder]['extensions'];

    if ($action === 'upload') {
        if (!isset($_FILES['media_file']) || !is_array($_FILES['media_file'])) {
            mediaError('No file uploaded.', 400);
        }

        $upload = $_FILES['media_file'];
        $originalName = trim((string) ($upload['name'] ?? ''));
        $tmpName = (string) ($upload['tmp_name'] ?? '');
        $errorCode = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);

        if ($errorCode !== UPLOAD_ERR_OK) {
            mediaError('Upload failed.', 400);
        }

        $MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
        if (($upload['size'] ?? 0) > $MAX_UPLOAD_BYTES) {
            mediaError('File exceeds maximum upload size of 50MB.', 400);
        }

        if ($originalName === '' || $tmpName === '' || !is_uploaded_file($tmpName)) {
            mediaError('Invalid uploaded file.', 400);
        }

        // S-04 Step 1: Server-side MIME detection — never trust $_FILES['type'].
        $finfo    = new finfo(FILEINFO_MIME_TYPE);
        $realMime = (string) $finfo->file($tmpName);

        if (!array_key_exists($realMime, MEDIA_MIME_MAP)) {
            mediaError('File type not allowed: ' . $realMime, 400);
        }

        // S-04 Step 2: Validate folder matches the real content type.
        // Prevents uploading an audio file into the img/ directory, for instance.
        $mimeIsImage = str_starts_with($realMime, 'image/');
        $mimeIsAudio = str_starts_with($realMime, 'audio/');
        if (($folder === 'img' && !$mimeIsImage) || (in_array($folder, ['speech', 'audio'], true) && !$mimeIsAudio)) {
            mediaError('File content does not match the target folder type.', 400);
        }

        // S-04 Step 3: Derive canonical extension from MIME — NEVER from user filename.
        $ext = MEDIA_MIME_MAP[$realMime];

        // S-04 Step 4: Sanitize basename — strip unsafe chars, re-append single safe extension.
        $baseName = pathinfo($originalName, PATHINFO_FILENAME);
        $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $baseName) . '.' . $ext;
        if ($safeName === '.' . $ext) {
            $safeName = 'upload_' . time() . '.' . $ext;
        }

        // S-04 Step 5: GD re-encode raster images to strip any appended polyglot payload.
        if (in_array($realMime, ['image/jpeg', 'image/png', 'image/gif'], true)) {
            $gdMap = [
                'image/jpeg' => ['imagecreatefromjpeg', 'imagejpeg'],
                'image/png'  => ['imagecreatefrompng',  'imagepng'],
                'image/gif'  => ['imagecreatefromgif',  'imagegif'],
            ];
            [$createFn, $saveFn] = $gdMap[$realMime];
            if (function_exists($createFn)) {
                $img = @$createFn($tmpName);
                if ($img === false) {
                    mediaError('Uploaded image is corrupted or unreadable.', 400);
                }
                $reEncodedTmp = $tmpName . '.reencoded';
                if ($saveFn($img, $reEncodedTmp)) {
                    rename($reEncodedTmp, $tmpName);
                } else {
                    @unlink($reEncodedTmp);
                    mediaError('Failed to re-encode uploaded image.', 500);
                }
                imagedestroy($img);
            }
        }

        $destination = $targetDir . '/' . $safeName;
        if (is_file($destination)) {
            mediaError('A file named "' . htmlspecialchars($safeName) . '" already exists in this folder. Rename the new file before uploading it.', 409);
        }
        if (!move_uploaded_file($tmpName, $destination)) {
            mediaError('Could not save uploaded file.', 500);
        }
        // S-05: Explicitly set file permissions regardless of server umask.
        chmod($destination, 0644);

        redirectToProjectMedia($project);
    }

    if ($action === 'delete') {
        $filename = trim((string) ($_POST['filename'] ?? ''));
        if ($filename === '') {
            mediaError('Missing file name.', 400);
        }

        $safeName = basename($filename);
        if ($safeName !== $filename) {
            mediaError('Invalid file name.', 400);
        }

        $extension = strtolower(pathinfo($safeName, PATHINFO_EXTENSION));
        if ($extension === '' || !in_array($extension, $allowedExtensions, true)) {
            mediaError('File type not allowed.', 400);
        }

        $filePath = $targetDir . '/' . $safeName;
        if (!is_file($filePath)) {
            mediaError('File not found.', 404);
        }

        if (!unlink($filePath)) {
            mediaError('Could not delete the file.', 500);
        }

        redirectToProjectMedia($project);
    }

    mediaError('Unsupported action.', 400);
}

$imageFiles = listAllowedFiles($imgDir, $imageExtensions);
$speechFiles = listAllowedFiles($speechDir, $speechExtensions);
$audioFiles = listAllowedFiles($audioDir, $audioExtensions);
$mediaUsage = getMediaUsageFromFlow($flowPath);
$imageItems = buildOrderedMediaItems($imageFiles, $mediaUsage['img'], $mediaUsage['openingImage']);
$speechItems = buildOrderedMediaItems($speechFiles, $mediaUsage['speech']);
$audioItems = buildOrderedMediaItems($audioFiles, $mediaUsage['audio']);
$slideRows = buildSlideRows($imageItems, $speechItems, $audioItems);
$unusedImageItems = filterUnusedItems($imageItems);
$unusedSpeechItems = filterUnusedItems($speechItems);
$unusedAudioItems = filterUnusedItems($audioItems);
$openingImageItem = findOpeningImageItem($imageItems);
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Project Media</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .project-media-page .media-shell {
            margin-top: var(--app-space-6);
        }

        .project-media-page .media-layout {
            display: grid;
            gap: var(--app-space-4);
        }

        .project-media-page .media-section,
        .project-media-page .slide-usage-panel {
            display: grid;
            gap: var(--app-space-4);
            min-width: 0;
        }

        .project-media-page .upload-card,
        .project-media-page .file-list {
            display: grid;
            gap: var(--app-space-3);
            padding: var(--app-space-4);
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.04);
        }

        .project-media-page .upload-card h2,
        .project-media-page .file-list h2 {
            margin: 0;
            font-size: 20px;
        }

        .project-media-page .upload-row {
            display: flex;
            flex-wrap: wrap;
            gap: var(--app-space-2);
            align-items: center;
        }

        .project-media-page input[type="file"] {
            max-width: 100%;
            color: var(--app-text);
        }

        .project-media-page .file-items {
            display: grid;
            gap: var(--app-space-3);
        }

        .project-media-page .slide-rows {
            display: grid;
            gap: var(--app-space-3);
        }

        .project-media-page .slide-row {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: var(--app-space-4);
            padding: var(--app-space-4);
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.04);
        }

        .project-media-page .slide-row-head {
            grid-column: 1 / -1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--app-space-3);
        }

        .project-media-page .slide-row-head h3 {
            margin: 0;
            font-size: 18px;
        }

        .project-media-page .slide-column {
            display: grid;
            gap: var(--app-space-3);
            min-width: 0;
        }

        .project-media-page .slide-column h4 {
            margin: 0;
            font-size: 14px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--app-text-muted);
        }

        .project-media-page .file-item {
            display: grid;
            grid-template-columns: minmax(0, 120px) minmax(0, 1fr) auto;
            gap: var(--app-space-3);
            align-items: center;
            padding: var(--app-space-3);
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-sm);
            background: rgba(255, 255, 255, 0.05);
        }

        .project-media-page .thumb-preview {
            width: 120px;
            height: 90px;
            object-fit: cover;
            border-radius: var(--app-radius-sm);
            border: 1px solid var(--app-line);
            background: var(--app-surface-soft);
        }

        .project-media-page .audio-preview {
            width: 100%;
            max-width: 320px;
        }

        .project-media-page .file-name {
            overflow-wrap: anywhere;
            font-weight: 600;
        }

        .project-media-page .usage-note {
            margin-top: 6px;
            color: var(--app-text-muted);
            font-size: 13px;
        }

        .project-media-page .empty-state {
            margin: 0;
            color: var(--app-text-muted);
        }

        @media (max-width: 860px) {
            .project-media-page .slide-row {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 640px) {
            .project-media-page .file-item {
                grid-template-columns: 1fr;
            }

            .project-media-page .thumb-preview,
            .project-media-page .audio-preview {
                max-width: 100%;
            }
        }
    </style>
</head>

<body class="project-media-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Project navigation">
                <a class="app-nav__link app-nav__back" href="/dashboard.php">My Library</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="media-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Project Media</p>
                    <h1 id="media-title"><?php echo htmlspecialchars($project, ENT_QUOTES, 'UTF-8'); ?></h1>
                    <p class="page-intro__description">Manage this project's image, speech, and audio files.</p>
                </div>
                <div class="page-intro__actions">
                    <a class="button button-primary" href="/edit/<?php echo rawurlencode($project); ?>/">Edit Project</a>
                </div>
            </div>
        </section>
        <div class="wrap media-shell">
            <section class="panel">
                <div class="panel-body">
                    <div class="media-layout">
                        <section class="media-section">
                            <div class="upload-card">
                                <h2>Images</h2>
                                <p class="muted">Upload to <code>img/</code>. Allowed: jpg, jpeg, png, webp, gif, avif, svg.</p>
                                <form method="post" enctype="multipart/form-data" onsubmit="return confirmUniqueMediaUpload(this);">
                                    <?php renderProjectMediaCsrfFields($guard); ?>
                                    <input type="hidden" name="action" value="upload">
                                    <input type="hidden" name="folder" value="img">
                                    <div class="upload-row">
                                        <input type="file" name="media_file" accept=".jpg,.jpeg,.png,.webp,.gif,.avif,.svg,image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml" required>
                                        <button type="submit" class="button button-primary">Upload Image</button>
                                    </div>
                                </form>
                            </div>

                            <div class="file-list">
                                <h2>Unused Images</h2>
                                <?php if ($unusedImageItems === []): ?>
                                    <p class="empty-state">No unused image files.</p>
                                <?php else: ?>
                                    <div class="file-items">
                                        <?php foreach ($unusedImageItems as $item): ?>
                                            <?php $filename = $item['filename']; ?>
                                            <article class="file-item">
                                                <img class="thumb-preview"
                                                    src="<?php echo htmlspecialchars($projectMediaWebDir . 'img/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>"
                                                    alt="">
                                                <div>
                                                    <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                    <div class="usage-note"><?php echo htmlspecialchars(renderImageUsageLabel($item), ENT_QUOTES, 'UTF-8'); ?></div>
                                                    <?php $detailLabel = renderImageUsageDetails($item); ?>
                                                    <?php if ($detailLabel !== ''): ?>
                                                        <div class="usage-note"><?php echo htmlspecialchars($detailLabel, ENT_QUOTES, 'UTF-8'); ?></div>
                                                    <?php endif; ?>
                                                </div>
                                                <form method="post" onsubmit="return confirm('Delete this file?');">
                                                    <?php renderProjectMediaCsrfFields($guard); ?>
                                                    <input type="hidden" name="action" value="delete">
                                                    <input type="hidden" name="folder" value="img">
                                                    <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                    <button type="submit" class="button button-secondary">Delete</button>
                                                </form>
                                            </article>
                                        <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </section>

                        <section class="media-section">
                            <div class="upload-card">
                                <h2>Audio</h2>
                                <p class="muted">Upload music and sound effects to <code>audio/</code>. Allowed: mp3, wav, ogg, m4a, aac, flac.</p>
                                <form method="post" enctype="multipart/form-data" onsubmit="return confirmUniqueMediaUpload(this);">
                                    <?php renderProjectMediaCsrfFields($guard); ?>
                                    <input type="hidden" name="action" value="upload">
                                    <input type="hidden" name="folder" value="audio">
                                    <div class="upload-row">
                                        <input type="file" name="media_file" accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac" required>
                                        <button type="submit" class="button button-primary">Upload Audio</button>
                                    </div>
                                </form>
                            </div>

                            <div class="file-list">
                                <h2>Unused Audio</h2>
                                <?php if ($unusedAudioItems === []): ?>
                                    <p class="empty-state">No unused audio files.</p>
                                <?php else: ?>
                                    <div class="file-items">
                                        <?php foreach ($unusedAudioItems as $item): ?>
                                            <?php $filename = $item['filename']; ?>
                                            <article class="file-item">
                                                <audio class="audio-preview" controls preload="none">
                                                    <source src="<?php echo htmlspecialchars($projectMediaWebDir . 'audio/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>">
                                                    Your browser does not support the audio element.
                                                </audio>
                                                <div>
                                                    <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                    <div class="usage-note"><?php echo htmlspecialchars(renderUsageLabel($item['slides']), ENT_QUOTES, 'UTF-8'); ?></div>
                                                </div>
                                                <form method="post" onsubmit="return confirm('Delete this file?');">
                                                    <?php renderProjectMediaCsrfFields($guard); ?>
                                                    <input type="hidden" name="action" value="delete">
                                                    <input type="hidden" name="folder" value="audio">
                                                    <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                    <button type="submit" class="button button-secondary">Delete</button>
                                                </form>
                                            </article>
                                        <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </section>

                        <section class="media-section">
                            <div class="upload-card">
                                <h2>Speech</h2>
                                <p class="muted">Upload to <code>speech/</code>. Allowed: mp3, wav, ogg, m4a, aac, flac.</p>
                                <form method="post" enctype="multipart/form-data" onsubmit="return confirmUniqueMediaUpload(this);">
                                    <?php renderProjectMediaCsrfFields($guard); ?>
                                    <input type="hidden" name="action" value="upload">
                                    <input type="hidden" name="folder" value="speech">
                                    <div class="upload-row">
                                        <input type="file" name="media_file" accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac" required>
                                        <button type="submit" class="button button-primary">Upload Speech</button>
                                    </div>
                                </form>
                            </div>

                            <div class="file-list">
                                <h2>Unused Speech</h2>
                                <?php if ($unusedSpeechItems === []): ?>
                                    <p class="empty-state">No unused speech files.</p>
                                <?php else: ?>
                                    <div class="file-items">
                                        <?php foreach ($unusedSpeechItems as $item): ?>
                                            <?php $filename = $item['filename']; ?>
                                            <article class="file-item">
                                                <audio class="audio-preview" controls preload="none">
                                                    <source src="<?php echo htmlspecialchars($projectMediaWebDir . 'speech/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>">
                                                    Your browser does not support the audio element.
                                                </audio>
                                                <div>
                                                    <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                    <div class="usage-note"><?php echo htmlspecialchars(renderUsageLabel($item['slides']), ENT_QUOTES, 'UTF-8'); ?></div>
                                                </div>
                                                <form method="post" onsubmit="return confirm('Delete this file?');">
                                                    <?php renderProjectMediaCsrfFields($guard); ?>
                                                    <input type="hidden" name="action" value="delete">
                                                    <input type="hidden" name="folder" value="speech">
                                                    <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                    <button type="submit" class="button button-secondary">Delete</button>
                                                </form>
                                            </article>
                                        <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </section>

                        <section class="slide-usage-panel">
                            <div class="file-list">
                                <h2>Media By Slide</h2>
                                <p class="muted">Images, speech, and audio files used by the same slide are shown on the same row.</p>
                                <?php if ($slideRows === []): ?>
                                    <p class="empty-state">No slide-linked media found yet.</p>
                                <?php else: ?>
                                    <div class="slide-rows">
                                        <?php if ($openingImageItem !== null): ?>
                                            <?php $filename = $openingImageItem['filename']; ?>
                                            <article class="slide-row">
                                                <div class="slide-row-head">
                                                    <h3>Opening Image</h3>
                                                </div>
                                                <div class="slide-column">
                                                    <h4>Images</h4>
                                                    <div class="file-items">
                                                        <article class="file-item">
                                                            <img class="thumb-preview"
                                                                src="<?php echo htmlspecialchars($projectMediaWebDir . 'img/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>"
                                                                alt="">
                                                            <div>
                                                                <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                                <div class="usage-note"><?php echo htmlspecialchars(renderImageUsageLabel($openingImageItem), ENT_QUOTES, 'UTF-8'); ?></div>
                                                                <?php $detailLabel = renderImageUsageDetails($openingImageItem); ?>
                                                                <?php if ($detailLabel !== ''): ?>
                                                                    <div class="usage-note"><?php echo htmlspecialchars($detailLabel, ENT_QUOTES, 'UTF-8'); ?></div>
                                                                <?php endif; ?>
                                                            </div>
                                                            <form method="post" onsubmit="return confirm('Delete this file?');">
                                                                <?php renderProjectMediaCsrfFields($guard); ?>
                                                                <input type="hidden" name="action" value="delete">
                                                                <input type="hidden" name="folder" value="img">
                                                                <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                                <button type="submit" class="button button-secondary">Delete</button>
                                                            </form>
                                                        </article>
                                                    </div>
                                                </div>
                                                <div class="slide-column">
                                                    <h4>Speech</h4>
                                                    <p class="empty-state">No speech file for the opening image row.</p>
                                                </div>
                                                <div class="slide-column">
                                                    <h4>Audio</h4>
                                                    <p class="empty-state">No audio file for the opening image row.</p>
                                                </div>
                                            </article>
                                        <?php endif; ?>
                                        <?php foreach ($slideRows as $row): ?>
                                            <article class="slide-row">
                                                <div class="slide-row-head">
                                                    <h3>Slide <?php echo (int) $row['slideNumber']; ?></h3>
                                                </div>
                                                <div class="slide-column">
                                                    <h4>Images</h4>
                                                    <?php if ($row['images'] === []): ?>
                                                        <p class="empty-state">No image files linked to this slide.</p>
                                                    <?php else: ?>
                                                        <div class="file-items">
                                                            <?php foreach ($row['images'] as $item): ?>
                                                                <?php $filename = $item['filename']; ?>
                                                                <article class="file-item">
                                                                    <img class="thumb-preview"
                                                                        src="<?php echo htmlspecialchars($projectMediaWebDir . 'img/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>"
                                                                        alt="">
                                                                    <div>
                                                                        <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                                        <div class="usage-note"><?php echo htmlspecialchars(renderImageUsageLabel($item), ENT_QUOTES, 'UTF-8'); ?></div>
                                                                        <?php $detailLabel = renderImageUsageDetails($item, (int) $row['slideNumber']); ?>
                                                                        <?php if ($detailLabel !== ''): ?>
                                                                            <div class="usage-note"><?php echo htmlspecialchars($detailLabel, ENT_QUOTES, 'UTF-8'); ?></div>
                                                                        <?php endif; ?>
                                                                    </div>
                                                                    <form method="post" onsubmit="return confirm('Delete this file?');">
                                                                        <?php renderProjectMediaCsrfFields($guard); ?>
                                                                        <input type="hidden" name="action" value="delete">
                                                                        <input type="hidden" name="folder" value="img">
                                                                        <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                                        <button type="submit" class="button button-secondary">Delete</button>
                                                                    </form>
                                                                </article>
                                                            <?php endforeach; ?>
                                                        </div>
                                                    <?php endif; ?>
                                                </div>
                                                <div class="slide-column">
                                                    <h4>Speech</h4>
                                                    <?php if ($row['speech'] === []): ?>
                                                        <p class="empty-state">No speech files linked to this slide.</p>
                                                    <?php else: ?>
                                                        <div class="file-items">
                                                            <?php foreach ($row['speech'] as $item): ?>
                                                                <?php $filename = $item['filename']; ?>
                                                                <article class="file-item">
                                                                    <audio class="audio-preview" controls preload="none">
                                                                        <source src="<?php echo htmlspecialchars($projectMediaWebDir . 'speech/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>">
                                                                        Your browser does not support the audio element.
                                                                    </audio>
                                                                    <div>
                                                                        <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                                        <div class="usage-note"><?php echo htmlspecialchars(renderUsageLabel($item['slides']), ENT_QUOTES, 'UTF-8'); ?></div>
                                                                    </div>
                                                                    <form method="post" onsubmit="return confirm('Delete this file?');">
                                                                        <?php renderProjectMediaCsrfFields($guard); ?>
                                                                        <input type="hidden" name="action" value="delete">
                                                                        <input type="hidden" name="folder" value="speech">
                                                                        <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                                        <button type="submit" class="button button-secondary">Delete</button>
                                                                    </form>
                                                                </article>
                                                            <?php endforeach; ?>
                                                        </div>
                                                    <?php endif; ?>
                                                </div>
                                                <div class="slide-column">
                                                    <h4>Audio</h4>
                                                    <?php if ($row['audio'] === []): ?>
                                                        <p class="empty-state">No audio files linked to this slide.</p>
                                                    <?php else: ?>
                                                        <div class="file-items">
                                                            <?php foreach ($row['audio'] as $item): ?>
                                                                <?php $filename = $item['filename']; ?>
                                                                <article class="file-item">
                                                                    <audio class="audio-preview" controls preload="none">
                                                                        <source src="<?php echo htmlspecialchars($projectMediaWebDir . 'audio/' . rawurlencode($filename), ENT_QUOTES, 'UTF-8'); ?>">
                                                                        Your browser does not support the audio element.
                                                                    </audio>
                                                                    <div>
                                                                        <div class="file-name"><?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?></div>
                                                                        <div class="usage-note"><?php echo htmlspecialchars(renderUsageLabel($item['slides']), ENT_QUOTES, 'UTF-8'); ?></div>
                                                                    </div>
                                                                    <form method="post" onsubmit="return confirm('Delete this file?');">
                                                                        <?php renderProjectMediaCsrfFields($guard); ?>
                                                                        <input type="hidden" name="action" value="delete">
                                                                        <input type="hidden" name="folder" value="audio">
                                                                        <input type="hidden" name="filename" value="<?php echo htmlspecialchars($filename, ENT_QUOTES, 'UTF-8'); ?>">
                                                                        <button type="submit" class="button button-secondary">Delete</button>
                                                                    </form>
                                                                </article>
                                                            <?php endforeach; ?>
                                                        </div>
                                                    <?php endif; ?>
                                                </div>
                                            </article>
                                        <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </section>
                    </div>
                </div>
            </section>
        </div>
    </main>
    <script>
        const existingProjectMedia = <?php echo json_encode([
            'img' => array_values($imageFiles),
            'speech' => array_values($speechFiles),
            'audio' => array_values($audioFiles),
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;

        function confirmUniqueMediaUpload(form) {
            const folder = form.elements.folder ? form.elements.folder.value : '';
            const input = form.elements.media_file;
            const file = input && input.files ? input.files[0] : null;
            if (!file) return true;
            const names = existingProjectMedia[folder] || [];
            if (names.some(name => String(name).toLowerCase() === file.name.toLowerCase())) {
                alert(`A file named "${file.name}" already exists in this folder. Rename the new file before uploading it.`);
                return false;
            }
            return true;
        }
    </script>
</body>

</html>
