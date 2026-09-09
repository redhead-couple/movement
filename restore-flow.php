<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$formId = 'restore_flow';
$guard = ensureFormGuard($formId);

function ensureBackupDirectory(string $backupDir): bool
{
    return is_dir($backupDir) || mkdir($backupDir, 0755, true);
}

function createSafetyBackup(string $flowFile, string $backupDir, string $prefix = 'flow-before-restore-'): bool
{
    if (!is_file($flowFile) || !ensureBackupDirectory($backupDir)) {
        return false;
    }

    $timestamp = date('Y-m-d-His');
    $destination = $backupDir . '/' . $prefix . $timestamp . '.json';

    return copy($flowFile, $destination);
}

function validateFlowStructure(array $data): ?string
{
    $requiredKeys = ['title', 'isPublished', 'schemaVersion', 'defaultBeatSeconds', 'slides', 'openingImage'];
    $allowedKeys = array_merge($requiredKeys, ['description', 'publishedAt']);
    $actualKeys = array_keys($data);

    foreach ($requiredKeys as $key) {
        if (!array_key_exists($key, $data)) {
            return 'The uploaded file is missing the required top-level field: ' . $key . '.';
        }
    }

    foreach ($actualKeys as $key) {
        if (!in_array($key, $allowedKeys, true)) {
            return 'The uploaded file contains an unsupported top-level field: ' . $key . '.';
        }
    }

    if (!is_string($data['title'])) {
        return 'The `title` field must be a string.';
    }

    if (!is_bool($data['isPublished'])) {
        return 'The `isPublished` field must be true or false.';
    }

    if (!is_int($data['schemaVersion']) || $data['schemaVersion'] !== 2) {
        return 'The `schemaVersion` field must be the number 2.';
    }

    if (!is_int($data['defaultBeatSeconds']) && !is_float($data['defaultBeatSeconds'])) {
        return 'The `defaultBeatSeconds` field must be a number.';
    }

    if (!is_array($data['slides'])) {
        return 'The `slides` field must be an array.';
    }

    if (!is_string($data['openingImage'])) {
        return 'The `openingImage` field must be a string.';
    }

    return null;
}

$project = $_GET['project'] ?? '';
$project = basename(trim($project));
$paths = getProjectPaths($currentUser, $project);
if ($project === '') {
    respondNotFoundPage();
}

$userProjectsDir = $paths['userFsDir'];
$projectDir = $userProjectsDir . '/' . $project;
$flowFile = $projectDir . '/flow.json';
$backupDir = $projectDir . '/backups';

if (!is_dir($projectDir) || !is_file($flowFile)) {
    respondNotFoundPage();
}

if (($_GET['action'] ?? '') === 'download-current') {
    $downloadName = $project . '-flow.json';
    header('Content-Type: application/json; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . rawurlencode($downloadName) . '"');
    header('Content-Length: ' . (string) filesize($flowFile));
    readfile($flowFile);
    exit;
}

$files = glob($backupDir . '/flow-*.json');
$files = is_array($files) ? $files : [];
rsort($files);

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        $formId,
        (string) ($_POST['form_token'] ?? ''),
        trim((string) ($_POST['website'] ?? '')),
        0
    );

    if ($guardError !== null) {
        $error = $guardError;
    } else {
    $action = trim((string) ($_POST['action'] ?? 'restore'));

    if ($action === 'restore') {
        $backupName = $_POST['backup'] ?? '';
        $backupName = basename(trim($backupName));
        $selectedBackup = $backupDir . '/' . $backupName;

        if ($backupName === '' || !is_file($selectedBackup)) {
            $error = 'Invalid backup selected.';
        } elseif (!createSafetyBackup($flowFile, $backupDir)) {
            $error = 'Could not create a safety backup before restore.';
        } elseif (copy($selectedBackup, $flowFile)) {
            header('Location: /edit/' . rawurlencode($project) . '/?restored=1');
            exit;
        } else {
            $error = 'Could not restore backup.';
        }
    } elseif ($action === 'upload') {
        $upload = $_FILES['flow_file'] ?? null;

        if (!is_array($upload)) {
            $error = 'Please choose a flow.json file to upload.';
        } elseif ((int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $error = 'The upload failed. Please try again.';
        } else {
            $originalName = basename((string) ($upload['name'] ?? ''));
            $tmpName = (string) ($upload['tmp_name'] ?? '');
            $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

            if ($tmpName === '' || !is_uploaded_file($tmpName)) {
                $error = 'The uploaded file is invalid.';
            } elseif ($extension !== 'json') {
                $error = 'Only .json files can be uploaded.';
            } else {
                // S-04: Validate MIME type server-side via finfo before buffering to memory
                $finfo = new finfo(FILEINFO_MIME_TYPE);
                $realMime = (string) $finfo->file($tmpName);
                if (!in_array($realMime, ['application/json', 'text/plain'], true)) {
                    $error = 'File content is not valid JSON text: ' . $realMime;
                } else {
                    $uploadedJson = file_get_contents($tmpName);
                $decoded = is_string($uploadedJson) ? json_decode($uploadedJson, true) : null;

                if (!is_string($uploadedJson) || trim($uploadedJson) === '') {
                    $error = 'The uploaded file is empty.';
                } elseif (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
                    $error = 'The uploaded file does not contain valid JSON.';
                } else {
                    $structureError = validateFlowStructure($decoded);
                    if ($structureError !== null) {
                        $error = $structureError;
                    } elseif (!createSafetyBackup($flowFile, $backupDir, 'flow-before-upload-')) {
                        $error = 'Could not create a safety backup before upload.';
                    } elseif (file_put_contents(
                        $flowFile,
                        json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
                    ) === false) {
                        $error = 'Could not save the uploaded flow.json.';
                    } else {
                        // S-05: Explicitly set file permissions regardless of server umask.
                        chmod($flowFile, 0644);
                        header('Location: /edit/' . rawurlencode($project) . '/?restored=1');
                        exit;
                    }
                }
            }
        }
        }
    } else {
        $error = 'Unsupported action.';
    }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Restore Flow Backup</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .restore-page .restore-shell {
            margin-top: var(--app-space-6);
        }

        .restore-page .panel {
            overflow: hidden;
        }

        .restore-page .restore-shell {
            width: min(920px, 100%);
            margin: 0 auto;
        }

        .restore-page .panel-body {
            display: grid;
            gap: var(--app-space-4);
        }

        .restore-page .restore-intro {
            display: grid;
            gap: 10px;
        }

        .restore-page .restore-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .restore-page .summary-pill {
            display: inline-flex;
            align-items: center;
            min-height: 32px;
            padding: 0 14px;
            border-radius: 999px;
            border: 1px solid var(--app-line);
            background: rgba(255, 255, 255, 0.04);
            color: var(--app-text-muted);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .restore-page .restore-banner {
            padding: var(--app-space-4);
            border-radius: var(--app-radius-md);
            border: 1px solid rgba(181, 106, 90, 0.28);
            background:
                linear-gradient(180deg, rgba(181, 106, 90, 0.16), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .restore-page .restore-banner p {
            margin: 0;
            color: #ffd1c7;
        }

        .restore-page .backup-list {
            display: grid;
            gap: var(--app-space-3);
        }

        .restore-page .upload-panel {
            display: grid;
            gap: var(--app-space-3);
            padding: var(--app-space-4);
            border-radius: var(--app-radius-md);
            border: 1px solid var(--app-line);
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.025);
        }

        .restore-page .upload-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--app-space-3);
        }

        .restore-page input[type="file"] {
            max-width: 100%;
        }

        .restore-page .backup-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--app-space-4);
            padding: var(--app-space-4);
            border-radius: var(--app-radius-md);
            border: 1px solid var(--app-line);
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.025);
        }

        .restore-page .backup-copy {
            display: grid;
            gap: 8px;
            min-width: 0;
        }

        .restore-page .backup-name {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            letter-spacing: -0.02em;
            word-break: break-word;
        }

        .restore-page .backup-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .restore-page .backup-meta span {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            padding: 0 12px;
            border-radius: 999px;
            border: 1px solid var(--app-line);
            background: rgba(255, 255, 255, 0.03);
            color: var(--app-text-muted);
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.03em;
        }

        .restore-page .restore-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--app-space-3);
            padding-top: var(--app-space-2);
        }

        .restore-page .restore-actions .muted {
            margin: 0;
        }

        .restore-page form {
            margin: 0;
        }

        @media (max-width: 780px) {

            .restore-page .backup-row,
            .restore-page .restore-actions {
                flex-direction: column;
                align-items: flex-start;
            }

            .restore-page .backup-row .actions,
            .restore-page .restore-actions .actions {
                width: 100%;
            }
        }
    </style>
</head>

<body class="restore-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Project navigation">
                <a class="app-nav__link app-nav__back" href="/dashboard.php">My Library</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="restore-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Restore Backup</p>
                    <h1 id="restore-title"><?php echo htmlspecialchars($project); ?></h1>
                    <p class="page-intro__description">Inspect and restore an earlier timeline backup for this project.</p>
                </div>
                <div class="page-intro__actions">
                    <a class="button button-secondary" href="/edit/<?php echo rawurlencode($project); ?>/">Back to Editor</a>
                </div>
            </div>
        </section>
        <div class="wrap">
            <section class="panel restore-shell">
                <div class="panel-body">
                    <div class="restore-intro">
                        <div class="section-head">
                            <div>
                                <h2>Choose a backup to restore</h2>
                                <p class="muted">Restoring will replace the current `flow.json` with the selected backup and create a fresh safety copy first.</p>
                            </div>
                        </div>
                        <div class="restore-summary">
                            <span class="summary-pill">Project <?php echo htmlspecialchars($project); ?></span>
                            <span class="summary-pill"><?php echo count($files); ?> backup<?php echo count($files) === 1 ? '' : 's'; ?></span>
                        </div>
                    </div>

                    <?php if ($error !== ''): ?>
                        <div class="restore-banner">
                            <p><?php echo htmlspecialchars($error); ?></p>
                        </div>
                    <?php endif; ?>

                    <section class="upload-panel">
                        <div class="section-head">
                            <div>
                                <h2>Upload or Download Current Flow</h2>
                                <p class="muted">Upload a valid <code>flow.json</code> to replace the current one. A safety backup of the current file is saved first.</p>
                            </div>
                        </div>
                        <form method="post" enctype="multipart/form-data">
                            <input type="hidden" name="action" value="upload">
                            <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($guard['token']); ?>">
                            <div class="hp">
                                <input type="text" name="website" tabindex="-1" autocomplete="off">
                            </div>
                            <div class="upload-row">
                                <input type="file" name="flow_file" accept=".json,application/json" required>
                                <button class="button button-primary" type="submit">Upload flow.json</button>
                                <a class="button button-secondary" href="/restore-flow.php?project=<?php echo rawurlencode($project); ?>&action=download-current">Download current flow.json</a>
                            </div>
                        </form>
                    </section>

                    <?php if (empty($files)): ?>
                        <p class="muted">No backups found.</p>
                    <?php else: ?>
                        <div class="backup-list">
                            <?php foreach ($files as $file): ?>
                                <?php
                                $name = basename($file);
                                $modifiedAt = @filemtime($file);
                                $fileSize = @filesize($file);
                                ?>
                                <article class="backup-row">
                                    <div class="backup-copy">
                                        <p class="backup-name"><?php echo htmlspecialchars($name); ?></p>
                                        <div class="backup-meta">
                                            <?php if ($modifiedAt): ?>
                                                <span><?php echo htmlspecialchars(date('M j, Y g:i A', $modifiedAt)); ?></span>
                                            <?php endif; ?>
                                            <?php if (is_int($fileSize) || is_float($fileSize)): ?>
                                                <span><?php echo htmlspecialchars(number_format($fileSize / 1024, 1)); ?> KB</span>
                                            <?php endif; ?>
                                        </div>
                                    </div>
                                    <div class="actions">
                                        <form method="post">
                                            <input type="hidden" name="action" value="restore">
                                            <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($guard['token']); ?>">
                                            <div class="hp">
                                                <input type="text" name="website" tabindex="-1" autocomplete="off">
                                            </div>
                                            <input type="hidden" name="backup" value="<?php echo htmlspecialchars($name); ?>">
                                            <button class="button button-primary" type="submit">Restore</button>
                                        </form>
                                    </div>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>

                    <div class="restore-actions">
                        <p class="muted">Pick carefully. The current timeline will be replaced immediately after restore.</p>
                        <div class="actions">
                            <a class="button button-secondary" href="/edit/<?php echo rawurlencode($project); ?>/">Back to Editor</a>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </main>
</body>

</html>
