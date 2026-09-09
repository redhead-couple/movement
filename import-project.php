<?php
declare(strict_types=1);

require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';
require_once __DIR__ . '/server/core/portable-project-import.php';

const IMPORT_FORM_ID = 'import_project';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit('Method not allowed.');
}

$guardError = validateFormGuard(
    IMPORT_FORM_ID,
    (string) ($_POST['form_token'] ?? ''),
    trim((string) ($_POST['website'] ?? '')),
    0
);
if ($guardError !== null) {
    $_SESSION['flash_error'] = $guardError;
    header('Location: /dashboard.php');
    exit;
}

$upload = $_FILES['portable_zip'] ?? null;
if (!is_array($upload)) {
    $_SESSION['flash_error'] = 'Choose a portable slideshow ZIP to import.';
    resetFormGuard(IMPORT_FORM_ID);
    header('Location: /dashboard.php');
    exit;
}

$uploadError = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
if ($uploadError !== UPLOAD_ERR_OK) {
    $message = match ($uploadError) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'The ZIP exceeds the server upload limit of 40 MB.',
        UPLOAD_ERR_PARTIAL => 'The ZIP upload was interrupted. Please try again.',
        UPLOAD_ERR_NO_FILE => 'Choose a portable slideshow ZIP to import.',
        default => 'The ZIP could not be uploaded. Please try again.',
    };
    $_SESSION['flash_error'] = $message;
    resetFormGuard(IMPORT_FORM_ID);
    header('Location: /dashboard.php');
    exit;
}

$temporaryPath = (string) ($upload['tmp_name'] ?? '');
$originalFilename = basename((string) ($upload['name'] ?? 'slideshow.zip'));
if (
    $temporaryPath === ''
    || !is_uploaded_file($temporaryPath)
    || strtolower(pathinfo($originalFilename, PATHINFO_EXTENSION)) !== 'zip'
) {
    $_SESSION['flash_error'] = 'Choose a valid .zip file exported by Movement.';
    resetFormGuard(IMPORT_FORM_ID);
    header('Location: /dashboard.php');
    exit;
}

try {
    $userPaths = getProjectPaths($currentUser, 'import-placeholder');
    $result = importPortableProjectZip(
        $temporaryPath,
        $originalFilename,
        $userPaths['userFsDir']
    );
    resetFormGuard(IMPORT_FORM_ID);
    header('Location: /dashboard.php?imported=' . rawurlencode($result['project']));
    exit;
} catch (PortableProjectImportException $error) {
    $_SESSION['flash_error'] = $error->getMessage();
} catch (Throwable $error) {
    error_log('Portable slideshow import failed: ' . $error->getMessage());
    $_SESSION['flash_error'] = 'The slideshow could not be imported.';
}

resetFormGuard(IMPORT_FORM_ID);
header('Location: /dashboard.php');
exit;
