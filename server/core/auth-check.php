<?php
require_once __DIR__ . '/web-session.php';
startWebSession();

if (!isset($_SESSION['user_id'], $_SESSION['username'])) {
    header('Location: /login.php');
    exit;
}
