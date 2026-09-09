<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

$formId = 'rename_project';
$guard = ensureFormGuard($formId);

$currentProject = $_GET['project'] ?? '';
$currentProject = basename(trim($currentProject));
$paths = getProjectPaths($currentUser, $currentProject);
if ($currentProject === '') {
    respondNotFoundPage();
}

$userProjectsDir = $paths['userFsDir'];
$currentDir = $userProjectsDir . '/' . $currentProject;
$flowFile = $currentDir . '/flow.json';

if (!is_dir($currentDir) || !file_exists($flowFile)) {
    respondNotFoundPage();
}

$json = @file_get_contents($flowFile);
$data = is_string($json) ? json_decode($json, true) : null;
$title = (is_array($data) && !empty($data['title'])) ? trim($data['title']) : $currentProject;

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
    $newSlug = $_POST['new_slug'] ?? '';
    $newSlug = basename(trim($newSlug));

    if ($newSlug === '') {
        $error = 'Please enter a new slug.';
    } elseif (!preg_match('/^[a-zA-Z0-9_-]+$/', $newSlug)) {
        $error = 'Use only letters, numbers, hyphens, and underscores.';
    } elseif ($newSlug === $currentProject) {
        $error = 'The new slug is the same as the current slug.';
    } elseif (file_exists($userProjectsDir . '/' . $newSlug)) {
        $error = 'That slug already exists.';
    } else {
        $newDir = $userProjectsDir . '/' . $newSlug;

        if (rename($currentDir, $newDir)) {
            header('Location: /edit/' . rawurlencode($newSlug) . '/?renamed=1');
            exit;
        } else {
            $error = 'Could not rename the project folder.';
        }
    }
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Rename Project</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
</head>

<body>
    <a class="app-return-link app-return-link--back app-return-link--floating" href="/dashboard.php" aria-label="Back to My Library">My Library</a>
    <main class="page">
        <div class="wrap">
            <section class="panel" style="max-width: 760px; margin: 40px auto;">
                <div class="section-head">
                    <div>
                        <p class="eyebrow">Rename Project</p>
                        <h1><?php echo htmlspecialchars($title); ?></h1>
                        <p class="muted">Change the project slug used in the folder name and URL.</p>
                    </div>
                </div>

                <div class="panel-body">
                    <p><strong>Current slug:</strong> <?php echo htmlspecialchars($currentProject); ?></p>

                    <?php if ($error !== ''): ?>
                        <p class="muted" style="color:#ff8a8a;"><?php echo htmlspecialchars($error); ?></p>
                    <?php endif; ?>

                    <form method="post" style="display:grid; gap:16px; max-width:520px;">
                        <input type="hidden" name="form_token" value="<?php echo htmlspecialchars($guard['token']); ?>">
                        <div class="hp">
                            <input type="text" name="website" tabindex="-1" autocomplete="off">
                        </div>
                        <div class="field">
                            <label for="new_slug">New Slug</label>
                            <input
                                class="input"
                                type="text"
                                id="new_slug"
                                name="new_slug"
                                required
                                pattern="[a-zA-Z0-9_-]+"
                                value="<?php echo htmlspecialchars($currentProject); ?>">
                        </div>

                        <div class="actions">
                            <button class="button button-primary" type="submit">Rename Project</button>
                            <a class="button button-secondary" href="/dashboard.php">Cancel</a>
                        </div>
                    </form>
                </div>
            </section>
        </div>
    </main>
</body>

</html>
