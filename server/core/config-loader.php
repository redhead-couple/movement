<?php

/**
 * Keep configuration outside the hosted document root. Local PHP development
 * may continue using server/core/app-config.php. Never derive this path from
 * request headers, query parameters, or DOCUMENT_ROOT.
 */
function movementConfigUnavailable(): void
{
    ini_set('display_errors', '0');
    error_log('Movement application configuration is unavailable.');
    http_response_code(500);
    exit('Application configuration is unavailable.');
}

function movementResolveConfigPath(): ?string
{
    $applicationRoot = dirname(__DIR__, 2);
    foreach ([dirname($applicationRoot) . '/app-config.php', __DIR__ . '/app-config.php'] as $candidate) {
        // A permission/open_basedir error must not silently select another
        // configuration. Suppress path-bearing PHP warnings and fail closed.
        $inspectionFailed = false;
        set_error_handler(static function () use (&$inspectionFailed): bool {
            $inspectionFailed = true;
            return true;
        });
        try {
            $exists = file_exists($candidate) || is_link($candidate);
            $readable = $exists && is_file($candidate) && is_readable($candidate);
        } finally {
            restore_error_handler();
        }
        if ($inspectionFailed || ($exists && !$readable)) {
            movementConfigUnavailable();
        }
        if ($exists) {
            return $candidate;
        }
    }
    return null;
}

$movementConfigPath = movementResolveConfigPath();
if ($movementConfigPath !== null) {
    // Include at file scope: existing DB, admin, and session settings are globals.
    // Do not disclose parse errors, include warnings, or credential-bearing errors.
    set_error_handler(static function (): bool {
        throw new RuntimeException('Configuration could not be loaded.');
    });
    try {
        require_once $movementConfigPath;
    } catch (Throwable $error) {
        movementConfigUnavailable();
    } finally {
        restore_error_handler();
    }
}
define('MOVEMENT_CONFIG_LOADED', $movementConfigPath !== null);
unset($movementConfigPath);

function movementRequireConfig(): void
{
    if (!MOVEMENT_CONFIG_LOADED) {
        movementConfigUnavailable();
    }
}
