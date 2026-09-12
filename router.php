<?php
// router.php
// A routing script for the PHP built-in web server (php -S)
// This intercepts "clean" URLs and maps them to the actual PHP scripts, mimicking Apache's .htaccess.

require_once __DIR__ . '/server/core/web-session.php';
enforceProductionHttps();

$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

if ($path === '/concept/' || $path === '/concept/index.html') {
    require __DIR__ . '/concept/index.php';
    return true;
}

// User projects, media, backups, and runtime state live below private-data.
// Deny the whole tree here because PHP's built-in server ignores .htaccess.
$accessPath = rawurldecode((string) $path);
if (preg_match('#^/private-data(?:/|$)#i', $accessPath)) {
    http_response_code(403);
    echo "Forbidden";
    return true;
}

// Internal PHP support code is never a public route.
if (preg_match('#^/server(?:/|$)#', $path)) {
    http_response_code(403);
    echo "Forbidden";
    return true;
}

// Backup history, editor locks, and discarded media are not public example assets.
if (preg_match('#^/examples/[^/]+/(?:backups(?:/|$)|\.movement-media-trash(?:/|$)|.*\.save\.lock$)#i', $accessPath)) {
    http_response_code(403);
    echo "Forbidden";
    return true;
}

// 1. Handle Media and Play URLs: /slidedeck/...
if (str_starts_with($path, '/slidedeck/')) {
    if (preg_match('#^/slidedeck/([^/]+)/([^/]+)/?$#', $path, $matches)) {
        $_GET['username'] = urldecode($matches[1]);
        $_GET['project'] = urldecode($matches[2]);
        require 'player.php';
        return true;
    }

    $_GET['p'] = substr($path, strlen('/slidedeck/'));
    require 'media.php';
    return true;
}

// 2. Handle Editor URLs: /edit/{project}/
if (preg_match('#^/edit/([a-zA-Z0-9_-]+)/?$#', $path, $matches)) {
    $_GET['project'] = urldecode($matches[1]);
    require 'json-maker.php';
    return true;
}

// 3. Block direct access to sensitive storage paths.
if (preg_match('#^/(users|login_attempts)/?#', $path)) {
    http_response_code(403);
    echo "Forbidden";
    return true;
}

// For all other requests (like /login.php, /assets/app.css, /img/logo.png),
// return false so the built-in PHP server will serve the physical file naturally!
return false;
