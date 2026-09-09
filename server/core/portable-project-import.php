<?php
declare(strict_types=1);

const PORTABLE_IMPORT_MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const PORTABLE_IMPORT_MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const PORTABLE_IMPORT_MAX_FLOW_BYTES = 20 * 1024 * 1024;
const PORTABLE_IMPORT_MAX_PLAYER_BYTES = 50 * 1024 * 1024;
const PORTABLE_IMPORT_MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const PORTABLE_IMPORT_MAX_ENTRIES = 2000;

const PORTABLE_IMPORT_MEDIA_EXTENSIONS = [
    'img' => ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'],
    'speech' => ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'],
    'audio' => ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'],
];

final class PortableProjectImportException extends RuntimeException
{
}

function portableImportError(string $message): never
{
    throw new PortableProjectImportException($message);
}

function portableImportValidateArchiveName(string $rawName): string
{
    if ($rawName === '' || str_contains($rawName, "\0") || str_contains($rawName, '\\')) {
        portableImportError('The ZIP contains an unsafe file path.');
    }
    if (!mb_check_encoding($rawName, 'UTF-8')) {
        portableImportError('The ZIP contains an invalid filename.');
    }
    if ($rawName[0] === '/' || preg_match('/^[A-Za-z]:/', $rawName)) {
        portableImportError('The ZIP contains an unsafe file path.');
    }

    $trimmed = rtrim($rawName, '/');
    if ($trimmed === '') {
        portableImportError('The ZIP contains an unsafe file path.');
    }
    foreach (explode('/', $trimmed) as $part) {
        if ($part === '' || $part === '.' || $part === '..') {
            portableImportError('The ZIP contains an unsafe file path.');
        }
    }
    return $rawName;
}

function portableImportIsIgnoredMetadata(string $name): bool
{
    return str_starts_with($name, '__MACOSX/')
        || preg_match('#(?:^|/)\.DS_Store$#i', $name) === 1;
}

function portableImportValidateFilename(string $filename): void
{
    if (
        $filename === ''
        || strlen($filename) > 240
        || $filename[0] === '.'
        || preg_match('/[\x00-\x1F\x7F<>:"|?*]/u', $filename)
        || preg_match('/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i', $filename)
    ) {
        portableImportError('The ZIP contains an unsafe media filename.');
    }
}

function portableImportInspectArchive(ZipArchive $zip): array
{
    if ($zip->numFiles <= 0 || $zip->numFiles > PORTABLE_IMPORT_MAX_ENTRIES) {
        portableImportError('The ZIP is empty or contains too many files.');
    }

    $allNames = [];
    $files = [];
    $expandedBytes = 0;

    for ($index = 0; $index < $zip->numFiles; $index++) {
        $stat = $zip->statIndex($index);
        if (!is_array($stat) || !isset($stat['name'])) {
            portableImportError('The ZIP directory could not be read.');
        }
        $name = portableImportValidateArchiveName((string) $stat['name']);
        $nameKey = strtolower($name);
        if (isset($allNames[$nameKey])) {
            portableImportError('The ZIP contains duplicate filenames.');
        }
        $allNames[$nameKey] = true;

        $operatingSystem = 0;
        $attributes = 0;
        if ($zip->getExternalAttributesIndex($index, $operatingSystem, $attributes)) {
            $unixType = ($attributes >> 16) & 0xF000;
            if ($unixType === 0xA000) {
                portableImportError('Symbolic links are not allowed in portable slideshows.');
            }
        }

        if (str_ends_with($name, '/')) {
            continue;
        }
        if (portableImportIsIgnoredMetadata($name)) {
            continue;
        }

        $size = (int) ($stat['size'] ?? -1);
        if ($size < 0) {
            portableImportError('The ZIP contains an invalid file size.');
        }
        $expandedBytes += $size;
        if ($expandedBytes > PORTABLE_IMPORT_MAX_EXPANDED_BYTES) {
            portableImportError('The expanded slideshow is too large.');
        }
        $files[] = [
            'index' => $index,
            'archiveName' => $name,
            'size' => $size,
        ];
    }

    $rootPrefix = '';
    $rootFlows = array_values(array_filter(
        $files,
        static fn(array $entry): bool => strtolower($entry['archiveName']) === 'flow.json'
    ));
    if (count($rootFlows) > 1) {
        portableImportError('The ZIP must contain one slideshow.');
    }
    if (!$rootFlows) {
        $nestedFlows = array_values(array_filter($files, static function (array $entry): bool {
            $parts = explode('/', $entry['archiveName']);
            return count($parts) === 2 && strtolower($parts[1]) === 'flow.json';
        }));
        if (count($nestedFlows) !== 1) {
            portableImportError('The ZIP must contain one project folder with flow.json.');
        }
        $rootPrefix = explode('/', $nestedFlows[0]['archiveName'], 2)[0] . '/';
    }

    $normalized = [];
    $relativeNames = [];
    foreach ($files as $entry) {
        if ($rootPrefix !== '' && !str_starts_with($entry['archiveName'], $rootPrefix)) {
            portableImportError('The ZIP must contain only one project folder.');
        }
        $relativeName = $rootPrefix === ''
            ? $entry['archiveName']
            : substr($entry['archiveName'], strlen($rootPrefix));
        if ($relativeName === '') {
            continue;
        }
        $relativeKey = strtolower($relativeName);
        if (isset($relativeNames[$relativeKey])) {
            portableImportError('The ZIP contains duplicate project filenames.');
        }
        $relativeNames[$relativeKey] = true;

        if ($relativeKey === 'flow.json') {
            if ($entry['size'] <= 0 || $entry['size'] > PORTABLE_IMPORT_MAX_FLOW_BYTES) {
                portableImportError('flow.json is empty or too large.');
            }
            $normalized[] = $entry + ['relativeName' => 'flow.json', 'type' => 'flow'];
            continue;
        }
        if ($relativeKey === 'player.html') {
            if ($entry['size'] > PORTABLE_IMPORT_MAX_PLAYER_BYTES) {
                portableImportError('player.html is too large.');
            }
            continue;
        }

        $parts = explode('/', $relativeName);
        if (count($parts) !== 2) {
            portableImportError('Portable slideshows may contain only flow.json and flat media folders.');
        }
        $type = strtolower($parts[0]);
        $filename = $parts[1];
        if (!array_key_exists($type, PORTABLE_IMPORT_MEDIA_EXTENSIONS)) {
            portableImportError('The ZIP contains an unsupported project folder.');
        }
        portableImportValidateFilename($filename);
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        if (!in_array($extension, PORTABLE_IMPORT_MEDIA_EXTENSIONS[$type], true)) {
            portableImportError('Unsupported project media file: ' . $filename);
        }
        if ($entry['size'] <= 0 || $entry['size'] > PORTABLE_IMPORT_MAX_MEDIA_BYTES) {
            portableImportError('Project media is empty or too large: ' . $filename);
        }
        $normalized[] = $entry + [
            'relativeName' => $type . '/' . $filename,
            'type' => $type,
            'filename' => $filename,
            'extension' => $extension,
        ];
    }

    $flowEntries = array_values(array_filter(
        $normalized,
        static fn(array $entry): bool => $entry['type'] === 'flow'
    ));
    if (count($flowEntries) !== 1) {
        portableImportError('The ZIP must contain exactly one flow.json.');
    }

    return [
        'entries' => $normalized,
        'flowEntry' => $flowEntries[0],
        'rootName' => $rootPrefix === '' ? '' : substr($rootPrefix, 0, -1),
    ];
}

function portableImportRejectUnsafeKeys(array $value): void
{
    foreach ($value as $key => $child) {
        if (is_string($key) && in_array(strtolower($key), ['__proto__', 'prototype', 'constructor'], true)) {
            portableImportError('flow.json contains an unsafe object key.');
        }
        if (is_array($child)) {
            portableImportRejectUnsafeKeys($child);
        }
    }
}

function portableImportTruncate(string $value, int $length): string
{
    $value = trim($value);
    return mb_strlen($value) > $length ? mb_substr($value, 0, $length) : $value;
}

function portableImportNormalizeFlow(string $rawFlow, string $fallbackTitle, array $imageNames): array
{
    try {
        $flow = json_decode($rawFlow, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        portableImportError('flow.json is not valid JSON.');
    }
    if (!is_array($flow) || !isset($flow['slides']) || !is_array($flow['slides']) || !array_is_list($flow['slides'])) {
        portableImportError('flow.json does not contain a valid slides timeline.');
    }
    if (count($flow['slides']) > 10000) {
        portableImportError('The slideshow contains too many slides.');
    }
    foreach ($flow['slides'] as $slide) {
        if (!is_array($slide)) {
            portableImportError('flow.json contains an invalid slide.');
        }
    }
    portableImportRejectUnsafeKeys($flow);

    $title = isset($flow['title']) && is_string($flow['title'])
        ? portableImportTruncate($flow['title'], 200)
        : '';
    $flow['title'] = $title !== '' ? $title : portableImportTruncate($fallbackTitle, 200);
    $flow['description'] = isset($flow['description']) && is_string($flow['description'])
        ? portableImportTruncate($flow['description'], 300)
        : '';
    $flow['isPublished'] = false;
    unset($flow['publishedAt']);
    $flow['schemaVersion'] = 2;
    $duration = isset($flow['defaultBeatSeconds']) && is_numeric($flow['defaultBeatSeconds'])
        ? (float) $flow['defaultBeatSeconds']
        : 5.0;
    $flow['defaultBeatSeconds'] = max(1, min(3600, $duration));

    $openingImage = isset($flow['openingImage']) && is_string($flow['openingImage'])
        ? $flow['openingImage']
        : '';
    $flow['openingImage'] = isset($imageNames[strtolower($openingImage)])
        ? $imageNames[strtolower($openingImage)]
        : '';
    return $flow;
}

function portableImportSlug(string $value): string
{
    $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
    $value = is_string($transliterated) ? $transliterated : $value;
    $value = strtolower($value);
    $value = preg_replace('/[^a-z0-9_-]+/', '-', $value) ?? '';
    $value = trim($value, '-_');
    $value = substr($value, 0, 80);
    return $value !== '' ? $value : 'imported-slideshow';
}

function portableImportNextSlug(string $userProjectsDir, string $baseSlug): string
{
    $candidate = $baseSlug;
    $suffix = 2;
    while (file_exists($userProjectsDir . DIRECTORY_SEPARATOR . $candidate)) {
        $ending = '-' . $suffix;
        $candidate = substr($baseSlug, 0, 80 - strlen($ending)) . $ending;
        $suffix++;
        if ($suffix > 10000) {
            portableImportError('Could not choose a project name for the imported slideshow.');
        }
    }
    return $candidate;
}

function portableImportMediaSignatureMatches(string $extension, string $header): bool
{
    $length = strlen($header);
    if ($extension === 'png') return str_starts_with($header, "\x89PNG\r\n\x1A\n");
    if (in_array($extension, ['jpg', 'jpeg'], true)) {
        return $length >= 3 && ord($header[0]) === 0xFF && ord($header[1]) === 0xD8 && ord($header[2]) === 0xFF;
    }
    if ($extension === 'gif') return str_starts_with($header, 'GIF87a') || str_starts_with($header, 'GIF89a');
    if ($extension === 'webp') return $length >= 12 && substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'WEBP';
    if ($extension === 'avif') return $length >= 12 && substr($header, 4, 4) === 'ftyp' && str_contains(substr($header, 8, 24), 'avif');
    if ($extension === 'wav') return $length >= 12 && substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'WAVE';
    if ($extension === 'ogg') return str_starts_with($header, 'OggS');
    if ($extension === 'flac') return str_starts_with($header, 'fLaC');
    if ($extension === 'm4a') return $length >= 12 && substr($header, 4, 4) === 'ftyp';
    if ($extension === 'aac') {
        return $length >= 2 && ord($header[0]) === 0xFF && (ord($header[1]) & 0xF6) === 0xF0;
    }
    if ($extension === 'mp3') {
        return str_starts_with($header, 'ID3')
            || ($length >= 2 && ord($header[0]) === 0xFF && (ord($header[1]) & 0xE0) === 0xE0);
    }
    return false;
}

function portableImportCopyEntry(ZipArchive $zip, array $entry, string $destination): void
{
    $source = $zip->getStream($entry['archiveName']);
    if (!is_resource($source)) {
        portableImportError('A ZIP entry could not be opened.');
    }
    $target = @fopen($destination, 'xb');
    if (!is_resource($target)) {
        fclose($source);
        portableImportError('Could not create an imported media file.');
    }

    $written = 0;
    try {
        while (!feof($source)) {
            $chunk = fread($source, 1024 * 1024);
            if ($chunk === false) {
                portableImportError('A ZIP entry could not be read.');
            }
            if ($chunk === '') continue;
            $written += strlen($chunk);
            if ($written > $entry['size'] || $written > PORTABLE_IMPORT_MAX_MEDIA_BYTES) {
                portableImportError('A media file expanded beyond its declared size.');
            }
            if (fwrite($target, $chunk) !== strlen($chunk)) {
                portableImportError('Could not write an imported media file.');
            }
        }
    } finally {
        fclose($source);
        fclose($target);
    }
    if ($written !== $entry['size']) {
        portableImportError('A media file did not match its declared size.');
    }
    @chmod($destination, 0644);

    $handle = fopen($destination, 'rb');
    $header = is_resource($handle) ? (string) fread($handle, 32) : '';
    if (is_resource($handle)) fclose($handle);
    if (!portableImportMediaSignatureMatches($entry['extension'], $header)) {
        portableImportError('Media contents do not match the filename: ' . $entry['filename']);
    }
}

function portableImportRemoveTree(string $root): void
{
    if (!is_dir($root)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isDir() && !$item->isLink()) @rmdir($item->getPathname());
        else @unlink($item->getPathname());
    }
    @rmdir($root);
}

function importPortableProjectZip(string $zipPath, string $originalFilename, string $userProjectsDir): array
{
    if (!class_exists('ZipArchive')) {
        portableImportError('ZIP import is unavailable on this server.');
    }
    $archiveSize = @filesize($zipPath);
    if (!is_int($archiveSize) || $archiveSize <= 0 || $archiveSize > PORTABLE_IMPORT_MAX_ARCHIVE_BYTES) {
        portableImportError('Choose a non-empty ZIP file no larger than 40 MB.');
    }
    $signature = @file_get_contents($zipPath, false, null, 0, 4);
    if (!is_string($signature) || !str_starts_with($signature, 'PK')) {
        portableImportError('The selected file is not a ZIP archive.');
    }
    if (!is_dir($userProjectsDir) && !@mkdir($userProjectsDir, 0755, true) && !is_dir($userProjectsDir)) {
        portableImportError('Could not prepare your online project library.');
    }

    $zip = new ZipArchive();
    $openResult = $zip->open($zipPath, ZipArchive::RDONLY);
    if ($openResult !== true) {
        portableImportError('The ZIP archive is invalid or unreadable.');
    }

    $stagingRoot = '';
    $lockHandle = null;
    try {
        $inspection = portableImportInspectArchive($zip);
        $rawFlow = $zip->getFromIndex($inspection['flowEntry']['index']);
        if (!is_string($rawFlow)) {
            portableImportError('flow.json could not be read.');
        }
        $imageNames = [];
        foreach ($inspection['entries'] as $entry) {
            if ($entry['type'] === 'img') {
                $imageNames[strtolower($entry['filename'])] = $entry['filename'];
            }
        }
        $archiveLabel = $inspection['rootName'] !== ''
            ? $inspection['rootName']
            : pathinfo($originalFilename, PATHINFO_FILENAME);
        $fallbackTitle = trim(str_replace(['-', '_'], ' ', $archiveLabel));
        if ($fallbackTitle === '') $fallbackTitle = 'Imported slideshow';
        $flow = portableImportNormalizeFlow($rawFlow, $fallbackTitle, $imageNames);
        $baseSlug = portableImportSlug($inspection['rootName'] !== '' ? $inspection['rootName'] : $flow['title']);

        $lockHandle = @fopen($userProjectsDir . DIRECTORY_SEPARATOR . '.portable-import.lock', 'c');
        if (!is_resource($lockHandle) || !flock($lockHandle, LOCK_EX)) {
            portableImportError('Could not lock your project library for import.');
        }
        $projectSlug = portableImportNextSlug($userProjectsDir, $baseSlug);
        $stagingRoot = $userProjectsDir . DIRECTORY_SEPARATOR . '.import-' . bin2hex(random_bytes(12));
        if (!@mkdir($stagingRoot, 0700)) {
            portableImportError('Could not prepare the imported slideshow.');
        }
        foreach (['img', 'speech', 'audio', 'backups'] as $folder) {
            if (!@mkdir($stagingRoot . DIRECTORY_SEPARATOR . $folder, 0755)) {
                portableImportError('Could not prepare the imported media folders.');
            }
        }

        foreach ($inspection['entries'] as $entry) {
            if (!in_array($entry['type'], ['img', 'speech', 'audio'], true)) continue;
            portableImportCopyEntry(
                $zip,
                $entry,
                $stagingRoot . DIRECTORY_SEPARATOR . $entry['type'] . DIRECTORY_SEPARATOR . $entry['filename']
            );
        }

        $serializedFlow = json_encode(
            $flow,
            JSON_PRETTY_PRINT
                | JSON_UNESCAPED_SLASHES
                | JSON_UNESCAPED_UNICODE
                | JSON_HEX_TAG
                | JSON_HEX_AMP
                | JSON_HEX_APOS
                | JSON_HEX_QUOT
                | JSON_THROW_ON_ERROR
        );
        if (@file_put_contents($stagingRoot . DIRECTORY_SEPARATOR . 'flow.json', $serializedFlow, LOCK_EX) === false) {
            portableImportError('Could not save the imported slideshow data.');
        }
        @chmod($stagingRoot . DIRECTORY_SEPARATOR . 'flow.json', 0644);
        $htaccess = <<<'HTACCESS'
# Prevent execution of server-side scripts inside project storage.
<FilesMatch "\.ph(p[0-9]?|tml)$">
    Require all denied
</FilesMatch>
HTACCESS;
        if (@file_put_contents($stagingRoot . DIRECTORY_SEPARATOR . '.htaccess', $htaccess, LOCK_EX) === false) {
            portableImportError('Could not secure the imported slideshow folder.');
        }
        @chmod($stagingRoot . DIRECTORY_SEPARATOR . '.htaccess', 0644);
        @chmod($stagingRoot, 0755);

        $destination = $userProjectsDir . DIRECTORY_SEPARATOR . $projectSlug;
        if (file_exists($destination) || !@rename($stagingRoot, $destination)) {
            portableImportError('Could not finish importing the slideshow.');
        }
        $stagingRoot = '';
        return [
            'project' => $projectSlug,
            'title' => $flow['title'],
            'mediaCount' => count(array_filter(
                $inspection['entries'],
                static fn(array $entry): bool => in_array($entry['type'], ['img', 'speech', 'audio'], true)
            )),
        ];
    } catch (JsonException) {
        portableImportError('Could not normalize flow.json.');
    } finally {
        $zip->close();
        if ($stagingRoot !== '') portableImportRemoveTree($stagingRoot);
        if (is_resource($lockHandle)) {
            @flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
        }
    }
}
