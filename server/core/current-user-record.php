<?php

require_once __DIR__ . '/web-session.php';
startWebSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(403);
    exit('User not authenticated.');
}

require_once __DIR__ . '/db.php';

$pdo = db();

$stmt = $pdo->prepare('
    SELECT id, username, email, created_at
    FROM users
    WHERE id = ?
    LIMIT 1
');
$stmt->execute([$_SESSION['user_id']]);

$currentUserRecord = $stmt->fetch();

if (!$currentUserRecord) {
    destroyWebSession();
    header('Location: /login.php');
    exit;
}
