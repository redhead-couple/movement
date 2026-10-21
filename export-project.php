<?php
declare(strict_types=1);

require_once __DIR__ . '/server/core/auth-check.php';
require_once __DIR__ . '/server/core/current-user.php';
require_once __DIR__ . '/server/core/player-module-policy.php';
require_once __DIR__ . '/server/core/storage-quota.php';
require_once __DIR__ . '/templates/player/offline-player-template.php';

function normalizeEngineName(string $raw): string
{
    return safePlayerModuleSlug($raw) ?? '';
}

function extractEngineNameFromSpec($spec): ?string
{
    if (is_string($spec)) {
        $trimmed = trim($spec);
        if ($trimmed === '') {
            return null;
        }

        if ($trimmed[0] === '{' || $trimmed[0] === '[') {
            $decoded = json_decode($trimmed, true);
            if (is_array($decoded)) {
                return extractEngineNameFromSpec($decoded);
            }
        }

        $engineName = normalizeEngineName($trimmed);
        return $engineName !== '' ? $engineName : null;
    }

    if (is_array($spec)) {
        if (!empty($spec['engine']) && is_string($spec['engine'])) {
            $engineName = normalizeEngineName($spec['engine']);
            return $engineName !== '' ? $engineName : null;
        }
        // enginePath is project-controlled and must never choose a file to inline.
    }

    return null;
}

function collectProjectEngines(array $flowData): array
{
    $engines = [];
    foreach (($flowData['slides'] ?? []) as $slide) {
        if (!is_array($slide)) {
            continue;
        }

        $effectSpecs = [];
        if (is_array($slide['background'] ?? null)) {
            $effectSpecs[] = $slide['background']['effect'] ?? null;
        }
        foreach (($slide['foregroundLayers'] ?? []) as $layer) {
            if (is_array($layer)) {
                $effectSpecs[] = $layer['effect'] ?? null;
            }
        }

        foreach ($effectSpecs as $effectSpec) {
            $engineName = extractEngineNameFromSpec($effectSpec);
            if ($engineName !== null) {
                $engines[$engineName] = true;
            }
        }
    }

    ksort($engines);
    return array_keys($engines);
}

function collectProjectTransitionEngines(array $flowData): array
{
    $engines = [];
    foreach (($flowData['slides'] ?? []) as $slide) {
        if (!is_array($slide)) continue;
        $draft = $slide['transitionDraft'] ?? null;
        if (!is_array($draft) || empty($draft['enabled'])) continue;
        $engine = normalizeEngineName((string) ($draft['engine'] ?? 'soft-wipe'));
        if ($engine !== '') $engines[$engine] = true;
    }
    ksort($engines);
    return array_keys($engines);
}

function loadOfflineEngineSources(string $rootDir, array $engineNames, array $approvedEngines): array
{
    $sources = [];

    foreach ($engineNames as $engineName) {
        if (!isset($approvedEngines[$engineName])) {
            http_response_code(400);
            exit('Unregistered effect engine in offline export: ' . $engineName);
        }
        $enginePath = $rootDir . '/effects/' . $engineName . '-engine.js';
        if (!is_file($enginePath)) {
            http_response_code(500);
            exit('Missing engine file for offline export: ' . $engineName);
        }

        $source = @file_get_contents($enginePath);
        if (!is_string($source)) {
            http_response_code(500);
            exit('Could not read engine file for offline export: ' . $engineName);
        }

        $sources[$engineName] = $source;
    }

    return $sources;
}

function loadOfflineTransitionSources(string $rootDir, array $engineNames, array $approvedEngines): array
{
    $sources = [];
    foreach ($engineNames as $engineName) {
        if (safePlayerModuleSlug($engineName) === null) {
            http_response_code(400);
            exit('Invalid transition engine name in offline export.');
        }
        if (!isset($approvedEngines[$engineName])) {
            http_response_code(400);
            exit('Unregistered transition engine in offline export: ' . $engineName);
        }
        $path = $rootDir . '/transitions/' . $engineName . '-engine.js';
        if (!is_file($path)) {
            http_response_code(500);
            exit('Missing transition engine file for offline export: ' . $engineName);
        }
        $source = @file_get_contents($path);
        if (!is_string($source)) {
            http_response_code(500);
            exit('Could not read transition engine file for offline export: ' . $engineName);
        }
        $sources[$engineName] = $source;
    }
    return $sources;
}

if (!class_exists('ZipArchive')) {
    http_response_code(500);
    exit('ZipArchive is not available on this server.');
}

$project = isset($_GET['project']) ? trim((string) $_GET['project']) : '';
if ($project === '') {
    http_response_code(400);
    exit('Missing project slug.');
}

if (!preg_match('/^[A-Za-z0-9_-]+$/', $project)) {
    http_response_code(400);
    exit('Invalid project slug.');
}

$rootDir = rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\');
$userProjectsDir = __DIR__ . '/private-data/slidedeck/' . $currentUser;
$projectDir = $userProjectsDir . '/' . $project;
$flowJsonPath = $projectDir . '/flow.json';

// The export is read-only. Do not keep PHP's session mutex during ZIP creation
// or download; writers coordinate through the same stable account lock instead.
if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
if (!is_dir($userProjectsDir)) {
    http_response_code(404);
    exit('Project not found.');
}
$userStorageLock = acquireUserStorageLock($userProjectsDir);
if ($userStorageLock === false) {
    http_response_code(409);
    exit('Another project or media operation is in progress. Please try again.');
}
clearstatcache();

$realUserProjectsDir = realpath($userProjectsDir);
$realProjectDir = realpath($projectDir);
$realFlowJsonPath = realpath($flowJsonPath);

if ($realUserProjectsDir === false || $realProjectDir === false || !is_dir($realProjectDir)) {
    http_response_code(404);
    exit('Project not found.');
}

if (strpos($realProjectDir, $realUserProjectsDir . DIRECTORY_SEPARATOR) !== 0 && $realProjectDir !== $realUserProjectsDir . DIRECTORY_SEPARATOR . $project) {
    http_response_code(403);
    exit('Unauthorized project access.');
}

if ($realFlowJsonPath === false || !is_file($realFlowJsonPath)) {
    http_response_code(404);
    exit('flow.json was not found for this project.');
}

$flowJson = @file_get_contents($realFlowJsonPath);
if (!is_string($flowJson)) {
    http_response_code(500);
    exit('Could not read flow.json for this project.');
}

$flowData = json_decode($flowJson, true);
if (!is_array($flowData)) {
    http_response_code(500);
    exit('flow.json is invalid.');
}

$appCssPath = $rootDir . '/assets/app.css';
$appCss = @file_get_contents($appCssPath);
if (!is_string($appCss)) {
    http_response_code(500);
    exit('Could not read app.css for offline export.');
}

$approvedEffectEngines = loadApprovedPlayerModuleSlugs($rootDir, 'effects');
$approvedTransitionEngines = loadApprovedPlayerModuleSlugs($rootDir, 'transitions');
$engineSources = loadOfflineEngineSources($rootDir, collectProjectEngines($flowData), $approvedEffectEngines);
$transitionSources = loadOfflineTransitionSources(
    $rootDir,
    collectProjectTransitionEngines($flowData),
    $approvedTransitionEngines
);

$zipTempFile = @tempnam(sys_get_temp_dir(), 'project_export_');
if ($zipTempFile === false) {
    http_response_code(500);
    exit('Could not create temporary export file.');
}

$zip = null;
$zipOpen = false;
$downloadHandle = null;
$cleanupExport = static function () use (&$zip, &$zipOpen, &$downloadHandle, $zipTempFile): void {
    if (is_resource($downloadHandle)) fclose($downloadHandle);
    $downloadHandle = null;
    if ($zipOpen && $zip !== null) {
        try { @$zip->close(); } catch (Throwable $ignored) {}
    }
    $zipOpen = false;
    $zip = null;
    if (is_file($zipTempFile)) @unlink($zipTempFile);
};
// Also clean up when PHP exits after a client disconnect or fatal error.
register_shutdown_function($cleanupExport);

try {
    $offlinePlayerHtml = buildOfflinePlayerHtml($flowJson, $appCss, $engineSources, $transitionSources);
    $zip = new ZipArchive();
    if (@$zip->open($zipTempFile, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('Could not open export archive.');
    }
    $zipOpen = true;
    $archiveRoot = $project . '/';
    if (!@$zip->addEmptyDir($archiveRoot)
        || !@$zip->addFromString($archiveRoot . 'player.html', $offlinePlayerHtml)
        || !@$zip->addFromString($archiveRoot . 'flow.json', $flowJson)) {
        throw new RuntimeException('Could not add project data to export.');
    }

    foreach (['img', 'speech', 'audio'] as $dirName) {
        $sourceDir = $realProjectDir . DIRECTORY_SEPARATOR . $dirName;
        if (!is_dir($sourceDir)) continue;
        if (!@$zip->addEmptyDir($archiveRoot . $dirName . '/')) {
            throw new RuntimeException('Could not add media directory to export.');
        }
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($sourceDir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($iterator as $item) {
            $basename = $item->getBasename();
            if ($basename !== '' && $basename[0] === '.') continue;
            $fullPath = $item->getPathname();
            $relativePath = substr($fullPath, strlen($realProjectDir) + 1);
            $archivePath = $archiveRoot . str_replace(DIRECTORY_SEPARATOR, '/', $relativePath);
            if (strpos('/' . str_replace('\\', '/', $relativePath), '/backups/') !== false) continue;
            if (strcasecmp($basename, 'index.php') === 0) continue;
            if ($item->isDir()) {
                if (!@$zip->addEmptyDir(rtrim($archivePath, '/') . '/')) {
                    throw new RuntimeException('Could not add media directory to export.');
                }
            } elseif ($item->isFile()) {
                if (!@$zip->addFile($fullPath, $archivePath)) {
                    throw new RuntimeException('Could not add media file to export.');
                }
            }
        }
    }

    // addFile may defer reading media until close: keep the lock until close
    // succeeds, and never send ZIP headers or bytes for an unfinished archive.
    if (!@$zip->close()) throw new RuntimeException('Could not finalize export archive.');
    $zipOpen = false;
    $downloadHandle = @fopen($zipTempFile, 'rb');
    if ($downloadHandle === false) throw new RuntimeException('Could not open completed export.');
    $downloadStat = fstat($downloadHandle);
    if ($downloadStat === false || $downloadStat['size'] <= 0) {
        throw new RuntimeException('Export archive is empty or unreadable.');
    }
} catch (Throwable $error) {
    $cleanupExport();
    $userStorageLock = null;
    error_log('ZIP export failed: ' . $error->getMessage());
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Could not create a complete ZIP archive. Please try again.');
}

// The completed ZIP is independent of live project files. A slow download
// must not prevent the owner from saving, changing media or renaming a project.
$userStorageLock = null;
try {
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . rawurlencode($project) . '.zip"');
    header('Content-Length: ' . (string) $downloadStat['size']);
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    if (@fpassthru($downloadHandle) === false) error_log('Could not finish streaming ZIP export.');
} finally {
    $cleanupExport();
}
exit;
