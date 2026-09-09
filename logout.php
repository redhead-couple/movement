<?php
require_once __DIR__ . '/server/core/app-init.php';
require_once __DIR__ . '/server/core/security-helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    die('Method Not Allowed');
}

$guardError = validateFormGuard('logout_form', (string)($_POST['form_token'] ?? ''), '', 0);
if ($guardError !== null) {
    http_response_code(403);
    die('Invalid CSRF token: ' . $guardError);
}

destroyWebSession();

header('Location: /login.php');
exit;
