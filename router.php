<?php
// router.php
// A routing script for the PHP built-in web server (php -S)
// This intercepts "clean" URLs and maps them to the actual PHP scripts, mimicking Apache's .htaccess.

require_once __DIR__ . '/server/core/web-session.php';
enforceProductionHttps();

$path = (string) parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);

$developmentRouterNormalizePath = static function (string $path): string {
    if (DIRECTORY_SEPARATOR === '\\') $path = str_replace('\\', '/', $path);
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if (DIRECTORY_SEPARATOR === '\\') $part = rtrim($part, ' ');
        if ($part === '' || $part === '.') continue;
        if ($part === '..') {
            array_pop($parts);
            continue;
        }
        // Windows treats trailing dots/spaces as aliases for the same name.
        if (DIRECTORY_SEPARATOR === '\\') $part = rtrim($part, '. ');
        if ($part !== '') $parts[] = $part;
    }
    return '/' . implode('/', $parts);
};

$developmentRouterPrivatePath = static function (string $path): bool {
    return preg_match('#^/(?:private-data|server)(?:/|$)#i', $path)
        || preg_match('#^/examples/[^/]+/(?:backups(?:/|$)|\.movement-media-trash(?:/|$)|.*\.save\.lock$)#i', $path)
        || preg_match('#^/(?:users|login_attempts)/?#i', $path);
};

// PHP's development server ignores .htaccess. Check both the decoded path and
// the actual filesystem destination before allowing its static/PHP fallback.
$accessPath = rawurldecode($path);
$denyDirectAccess = str_contains($accessPath, "\0")
    // Colons in Windows URL paths can address alternate NTFS streams.
    || (DIRECTORY_SEPARATOR === '\\' && str_contains($accessPath, ':'))
    || $developmentRouterPrivatePath($developmentRouterNormalizePath($accessPath));

$developmentRouterResolvedPrivatePath = static function (string $accessPath) use (
    $developmentRouterNormalizePath,
    $developmentRouterPrivatePath
): bool {
    $candidate = __DIR__ . '/' . ltrim($accessPath, '/\\');
    // An existing PHP script can also be served with a PATH_INFO suffix. Resolve
    // the closest existing ancestor when the complete requested path is absent.
    while (($resolved = @realpath($candidate)) === false) {
        $parent = dirname($candidate);
        if ($parent === $candidate) break;
        $candidate = $parent;
    }
    if ($resolved !== false) {
        $resolved = str_replace('\\', '/', $resolved);
        if (DIRECTORY_SEPARATOR === '\\') $resolved = strtolower($resolved);
        foreach (['private-data', 'server', 'examples', 'users', 'login_attempts'] as $directory) {
            $protectedRoot = realpath(__DIR__ . '/' . $directory);
            if ($protectedRoot === false) continue;
            $protectedRoot = str_replace('\\', '/', $protectedRoot);
            if (DIRECTORY_SEPARATOR === '\\') $protectedRoot = strtolower($protectedRoot);
            if ($resolved === $protectedRoot || str_starts_with($resolved, $protectedRoot . '/')) {
                $relative = '/' . $directory . substr($resolved, strlen($protectedRoot));
                if ($developmentRouterPrivatePath($developmentRouterNormalizePath($relative))) {
                    return true;
                }
            }
        }
    }
    return false;
};

if ($denyDirectAccess) {
    http_response_code(403);
    echo "Forbidden";
    return true;
}

if ($path === '/concept/' || $path === '/concept/index.html') {
    require __DIR__ . '/concept/index.php';
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

// For all other requests (like /login.php, /assets/app.css, /img/logo.png),
// check the physical destination before handing it to the built-in server.
// Virtual player/media routes above retain their controller authorization.
if ($developmentRouterResolvedPrivatePath($accessPath)) {
    http_response_code(403);
    echo "Forbidden";
    return true;
}
return false;
