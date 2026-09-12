<?php

/**
 * Shared transport and PHP-session boundary for the hosted web application.
 *
 * Production is explicit: set APP_ENVIRONMENT to "production" in the private
 * app-config.php (or MOVEMENT_APP_ENV in the PHP process environment). Local
 * development remains HTTP-capable by default. X-Forwarded-Proto is considered
 * only when APP_TRUST_PROXY/MOVEMENT_TRUST_PROXY is explicitly enabled.
 */

// Public controllers opt in only after their normal access/publication checks.
// Recheck status when headers are sent so errors cannot inherit that permission.
header_register_callback(static function (): void {
    if (!isWebPageIndexable()) {
        header('X-Robots-Tag: noindex, nofollow');
    }
});

require_once __DIR__ . '/config-loader.php';

function setWebPageDiscovery(bool $publicDiscovery): void
{
    $GLOBALS['movementPublicDiscovery'] = $publicDiscovery;
}

function isWebPageIndexable(): bool
{
    return !empty($GLOBALS['movementPublicDiscovery'])
        && isProductionWebEnvironment()
        && (http_response_code() ?: 200) === 200
        && in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);
}

function webRobotsMeta(): string
{
    return isWebPageIndexable() ? '' : '<meta name="robots" content="noindex, nofollow">';
}

function webConfigValue(string $globalName, string $environmentName, $default)
{
    if (array_key_exists($globalName, $GLOBALS)) {
        return $GLOBALS[$globalName];
    }

    $environmentValue = getenv($environmentName);
    return $environmentValue === false ? $default : $environmentValue;
}

function webConfigBoolean(string $globalName, string $environmentName, bool $default = false): bool
{
    $value = webConfigValue($globalName, $environmentName, $default);
    if (is_bool($value)) {
        return $value;
    }

    $filtered = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    return $filtered ?? $default;
}

function isProductionWebEnvironment(): bool
{
    $environment = webConfigValue('APP_ENVIRONMENT', 'MOVEMENT_APP_ENV', 'development');
    return is_string($environment) && strtolower(trim($environment)) === 'production';
}

function trustsHttpsProxyHeader(): bool
{
    return webConfigBoolean('APP_TRUST_PROXY', 'MOVEMENT_TRUST_PROXY');
}

function isWebRequestHttps(?array $server = null): bool
{
    $server = $server ?? $_SERVER;
    $https = strtolower(trim((string) ($server['HTTPS'] ?? '')));
    if ($https === 'on' || $https === '1') {
        return true;
    }

    if ((string) ($server['SERVER_PORT'] ?? '') === '443') {
        return true;
    }

    if (!trustsHttpsProxyHeader()) {
        return false;
    }

    $forwarded = explode(',', (string) ($server['HTTP_X_FORWARDED_PROTO'] ?? ''), 2)[0];
    return strtolower(trim($forwarded)) === 'https';
}

function productionHttpsOrigin(): ?string
{
    $origin = webConfigValue('APP_HTTPS_ORIGIN', 'MOVEMENT_HTTPS_ORIGIN', '');
    if (!is_string($origin)) {
        return null;
    }

    $origin = rtrim(trim($origin), '/');
    $parts = parse_url($origin);
    if (
        filter_var($origin, FILTER_VALIDATE_URL) === false ||
        !is_array($parts) ||
        strtolower((string) ($parts['scheme'] ?? '')) !== 'https' ||
        !isset($parts['host']) ||
        isset($parts['user']) ||
        isset($parts['pass']) ||
        isset($parts['query']) ||
        isset($parts['fragment']) ||
        (($parts['path'] ?? '') !== '')
    ) {
        return null;
    }

    return $origin;
}

function productionHttpsRedirectUrl(?array $server = null): ?string
{
    if (!isProductionWebEnvironment() || isWebRequestHttps($server)) {
        return null;
    }

    $origin = productionHttpsOrigin();
    if ($origin === null) {
        return null;
    }

    $server = $server ?? $_SERVER;
    $requestUri = str_replace(["\r", "\n"], '', (string) ($server['REQUEST_URI'] ?? '/'));
    if ($requestUri === '' || $requestUri[0] !== '/') {
        $requestUri = '/';
    }

    return $origin . $requestUri;
}

function enforceProductionHttps(): void
{
    if (!isProductionWebEnvironment() || isWebRequestHttps()) {
        return;
    }

    $redirectUrl = productionHttpsRedirectUrl();
    if ($redirectUrl === null) {
        error_log('Production HTTPS is required, but APP_HTTPS_ORIGIN is missing or invalid.');
        http_response_code(500);
        exit('Secure transport is temporarily unavailable.');
    }

    header('Location: ' . $redirectUrl, true, 308);
    exit;
}

function webSessionCookieOptions(?int $expires = null): array
{
    $options = [
        'path' => '/',
        'domain' => '',
        'secure' => isProductionWebEnvironment(),
        'httponly' => true,
        'samesite' => 'Lax',
    ];

    if ($expires !== null) {
        $options['expires'] = $expires;
    } else {
        $options['lifetime'] = 0;
    }

    return $options;
}

function startWebSession(): void
{
    enforceProductionHttps();

    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }

    session_set_cookie_params(webSessionCookieOptions());
    session_start();
}

function destroyWebSession(): void
{
    $_SESSION = [];

    if (session_status() === PHP_SESSION_ACTIVE && (bool) ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => (string) ($params['path'] ?? '/'),
            'domain' => (string) ($params['domain'] ?? ''),
            'secure' => (bool) ($params['secure'] ?? false),
            'httponly' => (bool) ($params['httponly'] ?? true),
            'samesite' => (string) ($params['samesite'] ?? 'Lax'),
        ]);
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}
