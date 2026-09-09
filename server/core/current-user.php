<?php
require_once __DIR__ . '/web-session.php';
startWebSession();

if (!isset($_SESSION['username'])) {
    http_response_code(403);
    exit('User not authenticated.');
}

$currentUser = $_SESSION['username'];
