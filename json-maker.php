<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';
$project = $_GET['project'] ?? '';
if (!$project) {
    $path = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
    $parts = explode('/', $path);
    if (count($parts) >= 2 && $parts[0] === 'edit') {
        $project = $parts[1];
    }
}
$isJsonRequest = $_SERVER['REQUEST_METHOD'] === 'POST';
if ($project === '') {
    if ($isJsonRequest) {
        respondErrorJson('Missing project.', 400);
    }
    respondNotFoundPage();
}
$paths = getProjectPaths($currentUser, $project);
$projectRenamed = isset($_GET['renamed']) && $_GET['renamed'] === '1';
$projectCreated = isset($_GET['created']) && $_GET['created'] === '1';
$projectRestored = isset($_GET['restored']) && $_GET['restored'] === '1';
$project = basename($project);
$projectFsDir = $paths['projectFsDir'];
$projectWebDir = $paths['projectWebDir'];
$flowPath = $paths['flowPath'];

if (!is_dir($projectFsDir) || !is_file($flowPath)) {
    if ($isJsonRequest) {
        respondErrorJson('Project not found.', 404);
    }
    respondNotFoundPage();
}

if (!is_dir($projectFsDir) && !@mkdir($projectFsDir, 0755, true) && !is_dir($projectFsDir)) {
    error_log("Could not create project directory for {$project}");
    respondErrorJson('Could not initialize project directory.', 500);
}

function requestWantsReplaceExisting(): bool
{
    return isset($_POST['replace_existing']) && $_POST['replace_existing'] === '1';
}

// S-04: Strict MIME allowlist — MIME strings map to a single, server-chosen extension.
// The output extension is NEVER taken from the user's filename.
// SVG is intentionally omitted: it is XML and can trivially carry <script>/XSS payloads.
const UPLOAD_MIME_MAP = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/gif'  => 'gif',
    'image/webp' => 'webp',
    'audio/mpeg' => 'mp3',
    'audio/mp3'  => 'mp3',
    'video/mpeg' => 'mp3',
    'audio/wav'  => 'wav',
    'audio/ogg'  => 'ogg',
    'audio/aac'  => 'aac',
    'audio/flac' => 'flac',
    'audio/mp4'  => 'm4a',
    'audio/x-m4a' => 'm4a',
];

/**
 * Validates an uploaded file and returns a safe [ 'safeName', 'targetDir', 'realMime' ] array.
 * Rejects the request (via respondErrorJson) on any validation failure.
 * For raster images (JPEG, PNG, GIF), re-encodes via GD to strip appended polyglot payloads.
 *
 * @param string $tmpName  The tmp_name from $_FILES
 * @param string $origName The user-supplied original filename
 * @param string $mediaKind 'audio' for background music, 'speech' for TTS audio, else auto
 * @param string $projectFsDir Absolute path to the project directory
 * @return array{safeName: string, targetDir: string, realMime: string}
 */
function validateAndSanitizeUpload(
    string $tmpName,
    string $origName,
    string $mediaKind,
    string $projectFsDir
): array {
    // 1. Server-side MIME detection — never trusts client-reported type.
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $realMime = (string) @$finfo->file($tmpName);

    if (!array_key_exists($realMime, UPLOAD_MIME_MAP)) {
        respondErrorJson('File type not allowed: ' . $realMime, 400);
    }

    // 2. Derive extension from MIME map — NEVER from user filename.
    $ext = UPLOAD_MIME_MAP[$realMime];

    // 3. Sanitize the basename: strip everything except alphanumeric, dash, underscore.
    //    Then re-append the single server-chosen extension.
    $baseName = pathinfo($origName, PATHINFO_FILENAME);
    $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $baseName) . '.' . $ext;
    if ($safeName === '.' . $ext) {
        $safeName = 'upload_' . time() . '.' . $ext;
    }

    // 4. Route to correct directory.
    if (str_starts_with($realMime, 'image/')) {
        $targetDir = $projectFsDir . '/img/';
    } else {
        // audio/* — use mediaKind to distinguish TTS speech vs background audio.
        $targetDir = $projectFsDir . '/' . ($mediaKind === 'audio' ? 'audio' : 'speech') . '/';
    }

    // 5. GD Re-encoding for raster images — strips any polyglot payload appended
    //    after the image data (e.g., a valid GIF with a hidden php payload appended at the tail).
    //    WebP skipped: imagecreatefromwebp requires libwebp; use imagecreatefromstring fallback.
    if ($realMime === 'image/jpeg' || $realMime === 'image/png' || $realMime === 'image/gif') {
        $gdFunctions = [
            'image/jpeg' => ['imagecreatefromjpeg', 'imagejpeg'],
            'image/png'  => ['imagecreatefrompng',  'imagepng'],
            'image/gif'  => ['imagecreatefromgif',  'imagegif'],
        ];
        [$createFn, $saveFn] = $gdFunctions[$realMime];
        if (function_exists($createFn)) {
            $img = @$createFn($tmpName);
            if ($img === false) {
                respondErrorJson('Uploaded image file is corrupted or unreadable.', 400);
            }
            $reEncodedTmp = $tmpName . '.reencoded';
            $saved = $saveFn($img, $reEncodedTmp);
            imagedestroy($img);
            if ($saved) {
                // Atomically replace tmp with the clean re-encoded version.
                rename($reEncodedTmp, $tmpName);
            } else {
                @unlink($reEncodedTmp);
                respondErrorJson('Failed to re-encode uploaded image.', 500);
            }
        }
    }

    return ['safeName' => $safeName, 'targetDir' => $targetDir, 'realMime' => $realMime];
}

function getUploadConflictResponse(array $conflicts): array
{
    $files = array_values(array_unique(array_filter($conflicts)));
    $label = count($files) === 1 ? $files[0] : implode(', ', $files);

    return [
        'status' => 'needs_confirmation',
        'message' => count($files) === 1
            ? "The file \"{$label}\" already exists. Are you sure you want to replace the existing file?"
            : "These files already exist: {$label}. Are you sure you want to replace the existing files?",
        'files' => $files,
    ];
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

$guard = ensureFormGuard('json_maker');

// Handle Backend Save Request
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        'json_maker',
        (string) ($_POST['csrf_token'] ?? ''),
        '',
        0
    );

    if ($guardError !== null) {
        respondErrorJson('Invalid or missing CSRF token.', 403);
    }

    $response = ['status' => 'success', 'messages' => []];
    $projectLock = null;

    try {
        // --- Action-Specific Handlers (These exist early to prevent overwriting flow.json) ---

        // --- Media Library API ---
        if (isset($_POST['action']) && $_POST['action'] === 'list_media') {
            $mediaList = ['img' => [], 'speech' => [], 'audio' => []];

            $imgDir = $projectFsDir . '/img/';
            $speechDir = $projectFsDir . '/speech/';
            $audioDir = $projectFsDir . '/audio/';

            if (is_dir($imgDir)) {
                $files = scandir($imgDir);
                foreach ($files as $file) {
                    if ($file === '.' || $file === '..')
                        continue;
                    if (preg_match('/\.(jpg|jpeg|png|gif|webp|svg)$/i', $file)) {
                        $mediaList['img'][] = $file;
                    }
                }
            }

            if (is_dir($speechDir)) {
                $files = scandir($speechDir);
                foreach ($files as $file) {
                    if ($file === '.' || $file === '..')
                        continue;
                    if (preg_match('/\.(mp3|wav|ogg|m4a|aac)$/i', $file)) {
                        $mediaList['speech'][] = $file;
                    }
                }
            }

            if (is_dir($audioDir)) {
                $files = scandir($audioDir);
                foreach ($files as $file) {
                    if ($file === '.' || $file === '..')
                        continue;
                    if (preg_match('/\.(mp3|wav|ogg|m4a|aac|flac)$/i', $file)) {
                        $mediaList['audio'][] = $file;
                    }
                }
            }

            header('Content-Type: application/json');
            echo json_encode(['status' => 'success', 'media' => $mediaList]);
            exit;
        }

        // Add handler for immediate standalone media uploads
        if (isset($_POST['action']) && $_POST['action'] === 'upload_media') {
            if (!empty($_FILES['file']['name']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
                if ($_FILES['file']['size'] > MAX_UPLOAD_BYTES) {
                    respondErrorJson('File exceeds maximum upload size of 50MB.', 400);
                }
                $tmpName  = $_FILES['file']['tmp_name'];
                $origName = basename($_FILES['file']['name']);
                $mediaKind = (string) ($_POST['media_kind'] ?? '');

                // S-04: Full enterprise MIME validation + GD re-encoding. Extension derived
                // from server-side MIME map, never from the user-supplied filename.
                $validated = validateAndSanitizeUpload($tmpName, $origName, $mediaKind, $projectFsDir);
                $name      = $validated['safeName'];
                $targetDir = $validated['targetDir'];

                $projectLock = acquireProjectLock($projectFsDir);
                if ($projectLock === false) {
                    respondErrorJson('This project is already being saved. Please try again.', 409);
                }
                try {
                    if (!is_dir($targetDir))
                        mkdir($targetDir, 0755, true);

                    $destPath = $targetDir . $name;

                    if (file_exists($destPath) && !requestWantsReplaceExisting()) {
                        http_response_code(409);
                        respondJson(getUploadConflictResponse([$name]));
                    }

                    if (file_exists($destPath) && !@unlink($destPath)) {
                        respondErrorJson('Failed to replace existing file. Is it open elsewhere?', 500);
                    }

                    if (@move_uploaded_file($tmpName, $destPath)) {
                        // S-05: Explicit file permission regardless of server umask.
                        chmod($destPath, 0644);
                        respondJson(['status' => 'success', 'filename' => $name, 'type' => $validated['realMime']]);
                    } else {
                        respondErrorJson('Failed to move uploaded file. Is the file already open elsewhere?', 500);
                    }
                } finally {
                    releaseProjectLock($projectLock);
                }
            } else {
                respondErrorJson('No file uploaded or upload error.', 400);
            }
        }

        // --- Standard Full Project Save ---
        $jsonData = $_POST['json_data'] ?? '{}';
        $title = $_POST['title'] ?? 'timeline';
        $backupDir = $projectFsDir . '/backups';
        $jsonFilePath = $projectFsDir . '/flow.json';

        $projectLock = acquireProjectLock($projectFsDir);
        if ($projectLock === false) {
            respondErrorJson('This project is already being saved. Please try again.', 409);
        }
        try {
            $data = json_decode($jsonData, true);
            if (!is_array($data)) {
                respondErrorJson('Invalid project JSON.', 400);
            }

            // A full save must never silently replace different media. Immediate
            // uploads use the explicit replacement-confirmation route above.
            $conflictingMedia = [];
            if (!empty($_FILES['media']['name']) && is_array($_FILES['media']['name'])) {
                for ($i = 0; $i < count($_FILES['media']['name']); $i++) {
                    if (($_FILES['media']['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                    if (($_FILES['media']['size'][$i] ?? 0) > MAX_UPLOAD_BYTES) continue;

                    $origName  = basename((string) $_FILES['media']['name'][$i]);
                    $tmpName   = (string) $_FILES['media']['tmp_name'][$i];
                    $mediaKind = (string) ($_POST['media_kind'][$i] ?? '');

                    // S-04: Validate MIME server-side; derive folder from real MIME.
                    $validated   = validateAndSanitizeUpload($tmpName, $origName, $mediaKind, $projectFsDir);
                    $safeName    = $validated['safeName'];
                    $folder      = str_starts_with($validated['realMime'], 'image/') ? 'img' : ($mediaKind === 'audio' ? 'audio' : 'speech');
                    $destination = $projectFsDir . '/' . $folder . '/' . $safeName;
                    if (is_file($destination)) {
                        $conflictingMedia[] = $folder . '/' . $safeName;
                    }
                }
            }
            if ($conflictingMedia && !requestWantsReplaceExisting()) {
                http_response_code(409);
                respondJson(getUploadConflictResponse($conflictingMedia));
            }

            $existingData = [];
            if (is_file($jsonFilePath)) {
                $existingJson = @file_get_contents($jsonFilePath);
                $existingData = is_string($existingJson) ? json_decode($existingJson, true) : [];
                if (!is_array($existingData)) {
                    $existingData = [];
                }
            }

            $data['description'] = substr(trim($_POST['description'] ?? ''), 0, 150);
            $data['isPublished'] = isset($existingData['isPublished']) ? (bool)$existingData['isPublished'] : false;
            if (array_key_exists('publishedAt', $existingData)) {
                $data['publishedAt'] = $existingData['publishedAt'];
            }

            $jsonData = json_encode(
                $data,
                JSON_PRETTY_PRINT
                    | JSON_UNESCAPED_SLASHES
                    | JSON_UNESCAPED_UNICODE
                    | JSON_HEX_TAG
                    | JSON_HEX_AMP
                    | JSON_HEX_APOS
                    | JSON_HEX_QUOT
            );
            if ($jsonData === false) {
                respondErrorJson('Failed to encode project JSON.', 500);
            }

            if (!is_dir($backupDir)) {
                mkdir($backupDir, 0755, true);
            }
            if (file_exists($jsonFilePath)) {

                $timestamp = date('Y-m-d-His');

                $backupFile = $backupDir . '/flow-' . $timestamp . '.json';

                copy($jsonFilePath, $backupFile);
            }
            $files = glob($backupDir . '/flow-*.json');

            if (is_array($files) && count($files) > 20) {

                sort($files);

                $remove = array_slice($files, 0, count($files) - 20);

                foreach ($remove as $f) {
                    unlink($f);
                }
            }
            if (!saveJsonAtomically($jsonFilePath, $jsonData)) {
                respondErrorJson('Failed to save project JSON.', 500);
            }
            $response['messages'][] = "Saved flow.json";

            // 2. Handle Media Files — S-04: Full validation via validateAndSanitizeUpload()
            if (!empty($_FILES['media']['name']) && is_array($_FILES['media']['name'])) {
                $imgDir    = $projectFsDir . '/img/';
                $speechDir = $projectFsDir . '/speech/';
                $audioDir  = $projectFsDir . '/audio/';

                if (!is_dir($imgDir))    mkdir($imgDir,    0755, true);
                if (!is_dir($speechDir)) mkdir($speechDir, 0755, true);
                if (!is_dir($audioDir))  mkdir($audioDir,  0755, true);

                for ($i = 0; $i < count($_FILES['media']['name']); $i++) {
                    if ($_FILES['media']['error'][$i] !== UPLOAD_ERR_OK) continue;
                    if (($_FILES['media']['size'][$i] ?? 0) > MAX_UPLOAD_BYTES) continue;

                    $tmpName   = (string) $_FILES['media']['tmp_name'][$i];
                    $origName  = basename((string) $_FILES['media']['name'][$i]);
                    $mediaKind = (string) ($_POST['media_kind'][$i] ?? '');

                    $validated = validateAndSanitizeUpload($tmpName, $origName, $mediaKind, $projectFsDir);
                    $safeName  = $validated['safeName'];
                    $realMime  = $validated['realMime'];

                    if (str_starts_with($realMime, 'image/')) {
                        $dest = $imgDir . $safeName;
                        if (!file_exists($dest) || requestWantsReplaceExisting()) {
                            if (file_exists($dest) && !@unlink($dest)) {
                                $response['messages'][] = "Failed to replace image: {$safeName}";
                                continue;
                            }
                            if (@move_uploaded_file($tmpName, $dest)) {
                                chmod($dest, 0644); // S-05
                                $response['messages'][] = "Saved image: {$safeName}";
                            } else {
                                $response['messages'][] = "Failed to save image: {$safeName}";
                            }
                        }
                    } else {
                        $audioTargetDir = $mediaKind === 'audio' ? $audioDir : $speechDir;
                        $dest = $audioTargetDir . $safeName;
                        if (!file_exists($dest) || requestWantsReplaceExisting()) {
                            if (file_exists($dest) && !@unlink($dest)) {
                                $response['messages'][] = "Failed to replace audio: {$safeName}";
                                continue;
                            }
                            if (@move_uploaded_file($tmpName, $dest)) {
                                chmod($dest, 0644); // S-05
                                $response['messages'][] = ($mediaKind === 'audio' ? "Saved audio: {$safeName}" : "Saved speech: {$safeName}");
                            } else {
                                $response['messages'][] = "Failed to save audio: {$safeName}";
                            }
                        }
                    }
                }
            }

            respondJson($response);
        } finally {
            releaseProjectLock($projectLock);
        }
    } catch (Exception $e) {
        error_log($e->getMessage());
        respondErrorJson('An internal error occurred while saving.', 500);
    }
}
function acquireProjectLock(string $projectFsDir)
{
    $lockPath = $projectFsDir . '/.save.lock';
    $handle = fopen($lockPath, 'c');

    if ($handle === false) {
        return false;
    }

    if (!flock($handle, LOCK_EX | LOCK_NB)) {
        fclose($handle);
        return false;
    }

    return $handle;
}

function releaseProjectLock($handle): void
{
    if (is_resource($handle)) {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
function saveJsonAtomically(string $targetPath, string $json): bool
{
    $dir = dirname($targetPath);

    if (!is_dir($dir)) {
        return false;
    }

    $tmpPath = $dir . '/flow.tmp.json';

    $decoded = json_decode($json, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return false;
    }

    $normalizedJson = json_encode(
        $decoded,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
    );

    if ($normalizedJson === false) {
        return false;
    }

    if (file_put_contents($tmpPath, $normalizedJson, LOCK_EX) === false) {
        return false;
    }

    if (!rename($tmpPath, $targetPath)) {
        @unlink($tmpPath);
        return false;
    }

    return true;
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Timeline JSON Studio</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        /* Base Styles embedded for quick development, will be moved later if needed */
        :root {
            --bg-color: var(--app-bg);
            --header-bg: rgba(24, 22, 21, 0.90);
            --panel-bg: var(--app-surface-strong);
            --border-color: var(--app-line);
            --button-text: var(--app-text);
            --text-main: var(--app-text);
            --text-muted: var(--app-text-muted);
            --primary: var(--app-accent);
            --primary-hover: var(--app-accent-strong);
            --danger: var(--app-danger);
            --danger-hover: #ce625d;
            --tab-active: rgba(255, 255, 255, 0.10);
            --tab-inactive: rgba(255, 255, 255, 0.04);
        }

        * {
            box-sizing: border-box;
        }

        body,
        html {
            margin: 0;
            padding: 0;
            font-family: var(--app-font-body);
            background-color: var(--bg-color);
            color: var(--text-main);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .page-studio {
            min-height: 100vh;
            padding: 0;
        }

        /* Top Header Navigation */
        .app-header {
            background: linear-gradient(to bottom, rgba(24, 22, 21, 0.94), rgba(24, 22, 21, 0.72));
            padding: 10px 20px 0 20px;
            display: flex;
            gap: 10px;
            flex-shrink: 0;
            /* Prevent header from shrinking */
            border-bottom: 1px solid var(--border-color);
        }

        .dashboard-link {
            width: auto;
            margin-left: auto;
            margin-bottom: 0;
            align-self: stretch;
            display: inline-flex;
            align-items: center;
            text-decoration: none;
            background-color: #7d927f;
            color: #fffdf8;
        }

        .dashboard-link:hover {
            background-color: #6b816d;
        }

        .tab {
            padding: 10px 20px;
            background-color: var(--tab-inactive);
            color: var(--text-main);
            border-radius: 12px 12px 0 0;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.9rem;
            border: 1px solid transparent;
            transition: all 0.2s;
        }

        .tab.active {
            background-color: var(--tab-active);
            color: var(--text-main);
            border-color: var(--border-color);
            border-bottom-color: transparent;
        }

        /* Main 3-Column Workspace */
        .workspace {
            display: grid;
            grid-template-columns: 380px 1fr 2fr;
            gap: 20px;
            padding: 20px;
            flex: 1;
            min-height: 0;
            align-items: stretch;
            /* Stretch to fill exactly the remaining space from body */
            overflow: hidden;
        }

        .panel {
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: var(--app-radius-lg);
            box-shadow: var(--app-shadow);
            display: flex;
            flex-direction: column;
            min-height: 0;
            height: 100%;
            overflow: hidden;
        }

        .workspace>.panel {
            margin-top: 0;
        }

        .panel-header {
            padding: 16px;
            border-bottom: 1px solid var(--border-color);
            font-weight: 700;
            font-size: 1.1rem;
        }

        .panel-content {
            padding: 16px;
            overflow-y: auto;
            flex: 1;
        }

        .project-settings-content {
            padding: 0;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        .project-settings-scroll {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 16px;
        }

        .project-settings-footer {
            flex: 0 0 auto;
            padding: 14px 16px 16px;
            border-top: 1px solid var(--border-color);
            background:
                linear-gradient(180deg, rgba(43, 39, 35, 0.92), rgba(35, 31, 28, 0.98)),
                var(--panel-bg);
            box-shadow: 0 -12px 24px rgba(0, 0, 0, 0.18);
        }

        .project-settings-footer .btn:last-child {
            margin-bottom: 0;
        }

        /* Forms & Inputs */
        .field {
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .field label {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-main);
        }

        .field input[type="text"],
        .field input[type="number"],
        .field select,
        .field textarea {
            padding: 10px 12px;
            border: 1px solid var(--border-color);
            border-radius: var(--app-radius-sm);
            font-size: 0.9rem;
            font-family: inherit;
            background: rgba(255, 255, 255, 0.05);
            color: var(--text-main);
        }

        .field input:focus,
        .field select:focus,
        .field textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(185, 99, 79, 0.14);
        }

        #editTransition {
            color: var(--text-main);
        }

        #editTransition option {
            color: var(--text-main);
            background: #25211e;
        }

        .advanced-transition-row {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }

        .advanced-transition-row input[type="text"] {
            flex: 1;
            min-width: 0;
            background: rgba(255, 255, 255, 0.05);
        }

        /* Buttons */
        .btn {
            background-color: var(--primary);
            color: #32150f;
            border: 1px solid transparent;
            padding: 10px 16px;
            border-radius: 999px;
            font-weight: 600;
            cursor: pointer;
            font-size: 0.9rem;
            transition: background-color 0.2s, transform 0.2s;
            width: 100%;
            margin-bottom: 10px;
        }

        .btn:hover {
            background-color: var(--primary-hover);
            transform: translateY(-1px);
        }

        .btn.secondary {
            background-color: rgba(255, 255, 255, 0.05);
            color: var(--text-main);
            border-color: var(--border-color);
        }

        .btn.secondary:hover {
            background-color: rgba(255, 255, 255, 0.09);
        }

        .btn.outline {
            background-color: transparent;
            border: 1px solid var(--border-color);
            color: var(--button-text);
        }

        .btn.outline:hover {
            background-color: rgba(255, 255, 255, 0.07);
        }

        /* Timeline Items */
        .slide-item {
            display: flex;
            gap: 12px;
            padding: 12px;
            border-bottom: 1px solid var(--border-color);
            cursor: pointer;
            transition: background-color 0.15s;
        }

        .slide-item:hover {
            background-color: rgba(255, 255, 255, 0.04);
        }

        .slide-item.active {
            background-color: rgba(185, 99, 79, 0.14);
            border-right: 3px solid var(--primary);
        }

        .slide-thumb {
            width: 80px;
            height: 45px;
            background-color: var(--app-surface-soft);
            border-radius: 6px;
            flex-shrink: 0;
            background-size: cover;
            background-position: center;
        }

        .slide-info {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .slide-index {
            font-weight: 700;
            font-size: 0.9rem;
            margin-right: 6px;
        }

        .slide-text-preview {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        .slide-icons {
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-muted);
        }

        /* Preview Area */
        .preview-box {
            width: 100%;
            height: 250px;
            /* Fixed maximum height so it doesn't push the form away */
            background-color: rgba(14, 10, 9, 0.92);
            border-radius: var(--app-radius-md);
            border: 1px solid var(--border-color);
            margin-bottom: 12px;
            position: relative;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .preview-box img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            /* Ensure the image fits nicely without stretching the box */
            position: absolute;
        }

        .preview-btn-row {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .preview-btn-row .btn {
            margin-bottom: 0;
        }

        /* Flex rows */
        .row {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .row>* {
            flex: 1;
        }

        /* File input wrapper styling */
        .file-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .file-wrapper input[type="text"] {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
        }

        /* Hub Modals */
        #effects-modal,
        #transitions-modal {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(10, 7, 6, 0.86);
            z-index: 1000;
            padding: 40px;
        }

        #effects-modal.open,
        #transitions-modal.open {
            display: flex;
            flex-direction: column;
        }

        #effects-iframe,
        #transitions-iframe {
            flex: 1;
            border: none;
            border-radius: 8px;
            background: #120d0c;
        }

        .modal-header {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
        }

        .modal-close {
            background: rgba(255, 255, 255, 0.08);
            color: var(--text-main);
            border: 1px solid var(--border-color);
            padding: 8px 16px;
            border-radius: 999px;
            cursor: pointer;
            font-weight: bold;
        }

        .creation-banner {
            display: inline-flex;
            align-items: center;
            min-height: 44px;
            padding: 0 18px;
            border: 1px solid rgba(180, 106, 85, 0.24);
            border-radius: 999px;
            background:
                linear-gradient(180deg, rgba(185, 99, 79, 0.14), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.04);
            box-shadow: var(--app-shadow-soft);
        }

        .creation-banner p {
            margin: 0;
            color: var(--text-main);
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.02em;
        }
    </style>
    <link rel="stylesheet" href="/studio/editor/editor-layout.css">
</head>

<body class="page page-studio">

    <!-- Header Navigation -->
    <div class="app-header" id="editorToolbar">
        <a class="app-return-link app-return-link--back" href="/dashboard.php" aria-label="Back to My Library">My Library</a>
        <button class="tab" id="playSlideshowBtn" style="background-color: #7d927f; color: #fffdf8;" title="Play the slideshow from the beginning">▶ Play Slideshow</button>
        <button class="tab" id="playFromCurrentBtn" style="background-color: #465766; color: #fffdf8;" title="Play the slideshow starting from the current slide">▶ Play from Current Slide</button>
        <a class="tab" href="/project-media.php?project=<?php echo rawurlencode($project); ?>" style="background-color: #b9634f; color: #fff8f1;">Media</a>
        <?php if ($projectCreated): ?>
            <div class="creation-banner" role="status" aria-live="polite">
                <p>Project created successfully.</p>
            </div>
        <?php
        endif; ?>
        <?php if ($projectRenamed): ?>
            <div class="creation-banner" style="margin-bottom:20px;">
                <p class="muted" style="margin:0;">
                    Project renamed successfully.
                </p>
            </div>
        <?php
        endif; ?>
        <?php if ($projectRestored): ?>
            <div class="creation-banner" style="margin-bottom:20px;">
                <p class="muted" style="margin:0;">
                    Backup restored successfully.
                </p>
            </div>
        <?php
        endif; ?>
        <div class="editor-save-group">
            <span class="editor-save-status" id="saveStatus" role="status" aria-live="polite"></span>
            <button class="tab editor-save" id="saveProjectBtn" type="button">Save Slideshow</button>
        </div>
    </div>

    <!-- Main Workspace -->
    <div class="workspace" id="editorWorkspace">

        <!-- Left Panel: Project Settings -->
        <div class="panel project-settings-panel" id="projectSettingsPanel">
            <div class="panel-header project-settings-header">
                <span class="project-settings-title">Project Settings</span>
                <button
                    class="project-settings-toggle"
                    id="projectSettingsToggle"
                    type="button"
                    aria-controls="projectSettingsContent"
                    aria-expanded="true"
                    aria-label="Collapse Project Settings"
                    title="Collapse Project Settings"
                ></button>
            </div>
            <div class="panel-content project-settings-content" id="projectSettingsContent">
                <div class="project-settings-scroll">
                    <div class="field">
                        <label>Title <span style="color:var(--danger)">*</span>:</label>
                        <input type="text" id="projectTitle" placeholder="Ending the Most Harmful Industry...">
                    </div>

                    <div class="field">
                        <label>Description:</label>
                        <textarea id="projectDescription" name="description" rows="3" maxlength="300" placeholder="Short description of this slideshow..."></textarea>
                    </div>

                    <div class="field">
                        <label>Opening Image <span style="color:var(--danger)">*</span>:</label>
                        <div style="display: flex; gap: 12px; align-items: stretch; height: 80px;">
                            <div style="flex: 1; background: rgba(255,255,255,0.04); border: 1px dashed var(--border-color); border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                                <img id="openingImagePreview" src="" style="width: 100%; height: 100%; object-fit: cover; display: none;">
                                <span id="openingImagePlaceholder" style="color: var(--text-muted); font-size: 0.85rem;">No Image</span>
                            </div>
                            <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
                                <button class="btn outline" style="width: auto;" onclick="document.getElementById('openingImageInput').click()">Upload</button>
                                <button class="btn outline" style="width: auto;" onclick="openMediaLibrary('img', 'openingImageName')">Browse Lib</button>
                            </div>
                            <input type="hidden" id="openingImageName">
                            <input type="file" id="openingImageInput" accept="image/*" style="display:none">
                        </div>
                    </div>

                    <div class="field">
                        <label>Default Slide Duration:</label>
                        <div class="row">
                            <input type="number" id="defaultDuration" value="5" min="1" step="1">
                            <span style="font-size: 0.9rem; color: var(--text-muted);">seconds</span>
                        </div>
                    </div>

                    <div class="field">
                        <label>Global Audio:</label>
                        <div id="globalAudioLayersList" style="display: grid; gap: 8px; min-width: 0; max-width: 100%;"></div>
                        <button class="btn outline" type="button" id="addGlobalAudioLayerBtn" style="width: auto; margin-top: 8px;">+ Add Global Audio</button>
                    </div>
                </div>

                <div class="project-settings-footer">
                    <div style="display: flex; gap: 8px; margin-top: 8px; text-align: center ;">
                        <a class="btn secondary" id="exportJsonBtn" style="flex: 1;" title="Download an offline player ZIP with player.html, flow.json, img/, speech/, and audio/" href="/export-project.php?project=<?php echo rawurlencode($project); ?>">Export Offline Player</a>
                    </div>
                    <div style="font-size: 0.82rem; color: var(--text-muted); text-align: center; margin-top: 8px;">
                        Extract the ZIP, then open <code>player.html</code>.
                    </div>
                </div>
            </div>
        </div>

        <!-- Center Panel: Timeline -->
        <div class="panel" id="slidesTimelinePanel">
            <div class="panel-header">Slides Timeline</div>
            <div class="panel-content" style="padding: 0; display: flex; flex-direction: column;">
                <div id="timelineContainer" style="flex:1; overflow-y:auto; border-bottom: 1px solid var(--border-color);">
                    <!-- Slides injected here -->
                </div>
                <div style="padding: 16px; text-align: center;">
                    <button class="btn outline" style="width: auto;" id="addSlideBtn">+ Add Slide</button>
                </div>
            </div>
        </div>

        <!-- Right Panel: Preview & Editor -->
        <div class="panel">
            <div class="panel-header" id="editorHeader">Edit Slide 1</div>
            <div class="panel-content" style="padding: 20px;">
                <!-- Preview Sub-pane seamlessly integrated -->
                <div class="preview-box">
                    <img id="previewBg" src="" style="display: none; object-fit: cover; width: 100%; height: 100%;">
                    <img id="previewFg" src="" style="display: none; object-fit: contain; width: 100%; height: 100%; z-index: 2;">
                    <span id="previewPlaceholder" style="color: var(--text-muted); font-size: 0.9rem;">No image selected</span>
                </div>
                <!--
                <div class="preview-btn-row">
                    <button class="btn">▶ Play Slide</button>
                    <button class="btn">▶ Play From Here</button>
                </div>
                -->

                <!-- Editor Form -->
                <div id="editorContent">

                    <div class="field">
                        <label>Slide Text:</label>
                        <textarea id="editSlideText" rows="3" placeholder="Look at these images..."></textarea>
                    </div>
                    <div class="field">
                        <label>Narration (Audio):</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="editAudioName" placeholder="No file selected" style="flex: 1;">
                            <button class="btn outline" style="width: auto;" onclick="document.getElementById('editAudioInput').click()">Upload</button>
                            <button class="btn outline" style="width: auto;" onclick="openMediaLibrary('speech', 'editAudioName')">Browse Lib</button>
                            <button class="btn outline" id="playAudioBtn" onclick="toggleAudioPreview(this)" style="display:none; width: auto; padding: 8px 12px;" title="Play Audio">▶️</button>
                            <input type="file" id="editAudioInput" accept="audio/*" style="display:none">
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
                            <label style="margin: 0; min-width: 58px;">Volume</label>
                            <input type="range" id="editAudioVolume" min="0" max="1" step="0.05" value="1" style="flex: 1;">
                            <span id="editAudioVolumeValue" style="min-width: 40px; color: var(--text-muted); font-size: 0.85rem;">100%</span>
                        </div>
                        <div id="audioLayersList" style="display: grid; gap: 8px; margin-top: 10px;"></div>
                        <button class="btn outline" type="button" id="addAudioLayerBtn" style="width: auto; margin-top: 8px;">+ Add Audio Layer</button>
                    </div>

                    <div class="field">
                        <label>Background:</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="editBgName" placeholder="No file selected" style="flex: 1;">
                            <button class="btn outline" style="width: auto;" onclick="document.getElementById('editBgInput').click()">Upload</button>
                            <button class="btn outline" style="width: auto;" onclick="openMediaLibrary('img', 'editBgName')">Browse Lib</button>
                            <input type="file" id="editBgInput" accept="image/*" style="display:none">
                        </div>
                        <div class="file-wrapper">
                            <input type="text" id="editBgEffect" placeholder="No effect" readonly>
                            <button class="btn outline" style="width: auto;" id="editBgBtn" onclick="openEffectInHub('bg')">Edit</button>
                            <button class="btn outline" style="width: auto;" onclick="openEffectsHub('bg')">Hub</button>
                            <button class="btn outline" style="width: auto; padding: 8px 12px;" id="jsonBgBtn" onclick="openEffectEditor('bg')" title="Edit Effect JSON">JSON</button>
                            <button class="btn outline" style="width: auto;" id="clearBgBtn" onclick="clearEffect('bg')" style="color:var(--danger)">X</button>
                        </div>
                    </div>

                    <div class="field">
                        <label>Foreground Layers:</label>
                        <div id="foregroundLayersList" style="display: grid; gap: 8px;"></div>
                        <button class="btn outline" type="button" id="addForegroundLayerBtn" style="width: auto; margin-top: 8px;">+ Add Foreground Layer</button>
                    </div>
                    <div class="field">
                        <label>Transition:</label>
                        <select id="editTransition">
                            <option value="fade">Fade (Default)</option>
                            <option value="none">None</option>
                            <option value="push-up">Push Up</option>
                            <option value="push-left">Push Left</option>
                            <option value="push-right">Push Right</option>
                            <option value="zoom">Zoom</option>
                            <option value="dissolve">Dissolve</option>
                        </select>
                        <label>Advanced Transition:</label>
                        <div class="advanced-transition-row">
                            <input type="text" id="transitionAdvancedName" placeholder="No advanced transition" readonly>
                            <button class="btn outline" type="button" id="transitionEditBtn" style="width:auto;">Edit</button>
                            <button class="btn outline" type="button" id="transitionHubBtn" style="width:auto;">Hub</button>
                            <button class="btn outline" type="button" id="transitionJsonBtn" style="width:auto; padding:8px 12px;">JSON</button>
                            <button class="btn outline" type="button" id="transitionClearBtn" style="width:auto;">X</button>
                        </div>
                    </div>

                    <div class="field">
                        <label>Duration override:</label>
                        <div class="row">
                            <input type="number" id="editDuration" placeholder="Auto" min="1" step="0.5">
                            <span style="font-size: 0.9rem; color: var(--text-muted);">seconds (optional)</span>
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px;">
                        <button class="btn outline" style="width: auto;" id="duplicateSlideBtn">Duplicate Slide</button>
                        <button class="btn outline" style="width: auto; color: var(--danger); border-color: var(--danger);" id="deleteSlideBtn">Delete Slide</button>
                    </div>

                </div>
            </div>
        </div>
    </div>
    </div>

    <!-- Media Library Modal -->
    <div id="media-library-modal" style="display: none; position: fixed; inset: 0; background: rgba(10,7,6,0.94); z-index: 2500;">
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; max-width: 900px; max-height: 80vh; background: var(--panel-bg); border-radius: var(--app-radius-lg); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-color); box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
            <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0;" id="mediaLibTitle">Server Media Library</h3>
                <button onclick="document.getElementById('media-library-modal').style.display='none'" style="background: none; border: none; font-size: 1.5rem; color: var(--text-muted); cursor: pointer;">&times;</button>
            </div>
            <div id="mediaLibGrid" style="padding: 20px; overflow-y: auto; flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; align-content: start; align-items: start;">
                <!-- Items injected here -->
            </div>
        </div>
    </div>

    <!-- Effects Hub Modal -->
    <div id="effects-modal">
        <div class="modal-header">
            <button class="modal-close" onclick="closeEffectsHub()">Close Effects Hub</button>
        </div>
        <iframe id="effects-iframe" src=""></iframe>
    </div>

    <!-- Transitions Hub Modal -->
    <div id="transitions-modal">
        <div class="modal-header">
            <button class="modal-close" onclick="closeTransitionsHub()">Close Transitions Hub</button>
        </div>
        <iframe id="transitions-iframe" src=""></iframe>
    </div>

    <!-- Slideshow Playback Modal -->
    <div id="playback-modal" style="display: none; position: fixed; inset: 0; background: rgba(10,7,6,0.94); z-index: 2000;">
        <div style="position: absolute; top: 20px; right: 20px; z-index: 2001;">
            <button class="btn" style="background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; border: 1px solid rgba(255,255,255,0.4);" onclick="closePlaybackModal()">✖ Close Player</button>
        </div>
        <iframe id="playback-iframe" src="" style="width: 100%; height: 100%; border: none;" allow="autoplay"></iframe>
    </div>

    <!-- Effect JSON Editor Modal -->
    <div id="effect-edit-modal" style="display: none; position: fixed; inset: 0; background: rgba(10,7,6,0.86); z-index: 1000; padding: 40px;">
        <div class="panel" style="max-width: 800px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; height: 100%;">
            <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center;">
                <span>Edit Effect JSON</span>
                <button class="modal-close" onclick="closeEffectEditor()">Close</button>
            </div>
            <div class="panel-content" style="display: flex; flex-direction: column; gap: 16px;">
                <div class="field">
                    <label>Effect Name:</label>
                    <input type="text" id="effectEditName" placeholder="e.g. morph-effect-123">
                </div>
                <div class="field" style="flex: 1; display: flex; flex-direction: column;">
                    <label>Effect JSON:</label>
                    <textarea id="effectEditJson" style="flex: 1; font-family: monospace; resize: none;" spellcheck="false"></textarea>
                </div>
                <p id="effectEditError" style="color: var(--danger); font-size: 0.9rem; margin: 0; display: none;">Invalid JSON.</p>
                <button class="btn" style="width: auto;" onclick="saveEffectEditor()">Save Changes</button>
            </div>
        </div>
    </div>

    <!-- Inject Existing Project Data -->
    <script>
        window.PROJECT_CONTEXT = {
            project: <?php echo json_encode($project); ?>,
            projectDir: <?php echo json_encode($projectWebDir); ?>,
            makerEndpoint: <?php echo json_encode('/json-maker.php?project=' . rawurlencode($project)); ?>,
            playerUrl: <?php echo json_encode('/player.php?username=' . rawurlencode($currentUser) . '&project=' . rawurlencode($project)); ?>,
            flowUrl: <?php echo json_encode($paths['mediaWebDir'] . 'flow.json'); ?>,
            imgBaseUrl: <?php echo json_encode($paths['imgWebDir']); ?>,
            speechBaseUrl: <?php echo json_encode($paths['speechWebDir']); ?>,
            audioBaseUrl: <?php echo json_encode($paths['audioWebDir']); ?>,
            csrfToken: <?php echo json_encode($guard['token']); ?>
        };
        window.INITIAL_PROJECT_DATA = <?php
                                        $flowFile = $projectFsDir . '/flow.json';
                                        $initialFlow = is_file($flowFile)
                                            ? json_decode((string) file_get_contents($flowFile), true)
                                            : null;
                                        $initialFlowJson = is_array($initialFlow)
                                            ? json_encode(
                                                $initialFlow,
                                                JSON_UNESCAPED_SLASHES
                                                    | JSON_UNESCAPED_UNICODE
                                                    | JSON_HEX_TAG
                                                    | JSON_HEX_AMP
                                                    | JSON_HEX_APOS
                                                    | JSON_HEX_QUOT
                                            )
                                            : false;
                                        echo is_string($initialFlowJson) ? $initialFlowJson : 'null';
                                        ?>;
    </script>

    <!-- Main Logic Script -->
    <script src="/studio/editor/json-maker-logic.js?v=<?php echo time(); ?>"></script>
    <script src="/studio/editor/editor-layout.js"></script>
</body>

</html>
