<?php
declare(strict_types=1);

require_once __DIR__ . '/server/core/auth-check.php';
require_once __DIR__ . '/server/core/current-user.php';
require_once __DIR__ . '/server/core/player-module-policy.php';
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
$offlinePlayerHtml = buildOfflinePlayerHtml($flowJson, $appCss, $engineSources, $transitionSources);

$tempZipPath = tempnam(sys_get_temp_dir(), 'project_export_');
if ($tempZipPath === false) {
    http_response_code(500);
    exit('Could not create temporary export file.');
}

$zipTempFile = $tempZipPath . '.zip';
if (!@rename($tempZipPath, $zipTempFile)) {
    @unlink($tempZipPath);
    http_response_code(500);
    exit('Could not prepare temporary export file.');
}

$zip = new ZipArchive();
if ($zip->open($zipTempFile, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    @unlink($zipTempFile);
    http_response_code(500);
    exit('Could not create ZIP archive.');
}

$archiveRoot = $project . '/';
$zip->addEmptyDir($archiveRoot);
$zip->addFromString($archiveRoot . 'player.html', $offlinePlayerHtml);
$zip->addFromString($archiveRoot . 'flow.json', $flowJson);

$includeDirs = ['img', 'speech', 'audio'];

foreach ($includeDirs as $dirName) {
    $sourceDir = $realProjectDir . DIRECTORY_SEPARATOR . $dirName;
    if (!is_dir($sourceDir)) {
        continue;
    }

    $zip->addEmptyDir($archiveRoot . $dirName . '/');

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($sourceDir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $item) {
        $basename = $item->getBasename();
        if ($basename !== '' && $basename[0] === '.') {
            continue;
        }

        $fullPath = $item->getPathname();
        $relativePath = substr($fullPath, strlen($realProjectDir) + 1);
        $archivePath = $archiveRoot . str_replace(DIRECTORY_SEPARATOR, '/', $relativePath);

        if (strpos('/' . str_replace('\\', '/', $relativePath), '/backups/') !== false) {
            continue;
        }

        if (strcasecmp($basename, 'index.php') === 0) {
            continue;
        }

        if ($item->isDir()) {
            $zip->addEmptyDir(rtrim($archivePath, '/') . '/');
            continue;
        }

        if ($item->isFile()) {
            $zip->addFile($fullPath, $archivePath);
        }
    }
}

$zip->close();

if (!is_file($zipTempFile)) {
    http_response_code(500);
    exit('ZIP archive could not be finalized.');
}

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . rawurlencode($project) . '.zip"');
header('Content-Length: ' . (string) filesize($zipTempFile));
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$handle = fopen($zipTempFile, 'rb');
if ($handle === false) {
    @unlink($zipTempFile);
    http_response_code(500);
    exit('Could not open ZIP archive for download.');
}

while (!feof($handle)) {
    echo fread($handle, 8192);
}

fclose($handle);
@unlink($zipTempFile);
exit;
