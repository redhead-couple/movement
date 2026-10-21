<?php
declare(strict_types=1);

function mediaTrashPlainPath(string $root, string ...$parts): string
{
    $path = $root;
    foreach (array_merge([''], $parts) as $part) {
        if ($part !== '') $path .= '/' . $part;
        if (is_link($path)) throw new RuntimeException('Linked media folders are not supported.');
    }
    return $path;
}

function mediaTrashSafeName(string $value): bool
{
    return $value !== '' && $value[0] !== '.' && !preg_match('/[\\\\\/\x00-\x1f\x7f:]/', $value);
}

function mediaTrashType(string $type): string
{
    if (!in_array($type, ['img', 'audio', 'speech'], true)) throw new RuntimeException('Invalid media type.');
    return $type;
}

/** Keep any filename mentioned anywhere in saved data, including custom effects and audio layers. */
function unusedMediaSnapshot(string $projectDir, string $flowPath, string $type): array
{
    mediaTrashType($type);
    $json = @file_get_contents($flowPath);
    $flow = is_string($json) ? json_decode($json, true) : null;
    if (!is_array($flow) || !isset($flow['slides']) || !is_array($flow['slides'])) {
        throw new RuntimeException('The saved slideshow cannot be read. No media can be removed.');
    }
    $references = [];
    array_walk_recursive($flow, function ($value) use (&$references): void {
        if (is_string($value)) {
            $references[] = strtolower($value);
            $references[] = strtolower(rawurldecode($value));
        }
    });
    $text = implode("\n", $references);
    $mediaDir = mediaTrashPlainPath($projectDir, $type);
    $extensions = $type === 'img' ? ['jpg', 'jpeg', 'png', 'webp', 'gif'] : ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
    $files = [];
    $state = [];
    foreach (is_dir($mediaDir) ? scandir($mediaDir) : [] as $name) {
        if (!mediaTrashSafeName($name)) continue;
        $file = $mediaDir . '/' . $name;
        if (is_link($file) || !is_file($file)) continue;
        if (!in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), $extensions, true)) continue;
        $state[] = [$name, filesize($file), filemtime($file)];
        if (strpos($text, strtolower($name)) === false) $files[] = $name;
    }
    return ['files' => $files, 'token' => hash('sha256', $type . $json . json_encode($state))];
}

/** Caller holds the same project lock as save/upload. Each move is atomic and recoverable. */
function trashUnusedMedia(string $projectDir, string $flowPath, string $type, string $token): array
{
    $snapshot = unusedMediaSnapshot($projectDir, $flowPath, $type);
    if ($token === '' || !hash_equals($snapshot['token'], $token)) {
        throw new RuntimeException('The project or media list changed. Refresh and review the list again.');
    }
    $moved = 0;
    if ($snapshot['files'] === []) return ['moved' => 0];
    $trashId = gmdate('Y-m-d\TH-i-s') . '--' . bin2hex(random_bytes(8));
    $destination = mediaTrashPlainPath($projectDir, '.movement-media-trash', $trashId, $type);
    if (!@mkdir($destination, 0755, true)) throw new RuntimeException('Could not prepare Media Trash. Nothing was removed.');
    foreach ($snapshot['files'] as $filename) {
        $source = mediaTrashPlainPath($projectDir, $type, $filename);
        if (!@rename($source, $destination . '/' . $filename)) {
            return ['moved' => $moved, 'error' => 'Stopped before ' . $filename . '. Remaining files were kept.'];
        }
        $moved++;
    }
    return ['moved' => $moved];
}

function listMediaTrash(string $projectDir, string $type): array
{
    mediaTrashType($type);
    $root = mediaTrashPlainPath($projectDir, '.movement-media-trash');
    $result = [];
    foreach (is_dir($root) ? scandir($root, SCANDIR_SORT_DESCENDING) : [] as $id) {
        if (!mediaTrashSafeName($id) || is_link($root . '/' . $id)) continue;
        $directory = mediaTrashPlainPath($projectDir, '.movement-media-trash', $id, $type);
        foreach (is_dir($directory) ? scandir($directory) : [] as $filename) {
            if (!mediaTrashSafeName($filename) || is_link($directory . '/' . $filename) || !is_file($directory . '/' . $filename)) continue;
            $result[] = ['trashId' => $id, 'filename' => $filename];
        }
    }
    return $result;
}

function mediaTrashSnapshot(string $projectDir): array
{
    clearstatcache();
    $files = [];
    $state = [];
    foreach (['img', 'audio', 'speech'] as $type) {
        foreach (listMediaTrash($projectDir, $type) as $item) {
            $item['type'] = $type;
            $file = mediaTrashPlainPath($projectDir, '.movement-media-trash', $item['trashId'], $type, $item['filename']);
            $files[] = $item;
            $state[] = [$item, filesize($file), filemtime($file), fileinode($file)];
        }
    }
    return ['files' => $files, 'token' => hash('sha256', json_encode($state, JSON_THROW_ON_ERROR))];
}

/** Caller holds the project lock; delete only the reviewed trash files, never live media. */
function emptyMediaTrash(string $projectDir, string $expectedToken): array
{
    $snapshot = mediaTrashSnapshot($projectDir);
    if ($expectedToken === '' || !hash_equals($snapshot['token'], $expectedToken)) {
        throw new RuntimeException('Media Trash changed. Refresh and review it again.');
    }
    $deleted = 0;
    foreach ($snapshot['files'] as $item) {
        $file = mediaTrashPlainPath($projectDir, '.movement-media-trash', $item['trashId'], $item['type'], $item['filename']);
        if (!@unlink($file)) return ['deleted' => $deleted, 'error' => 'Some files could not be deleted. The remaining files are still in Media Trash.'];
        $deleted++;
    }
    return ['deleted' => $deleted];
}

function restoreTrashedMedia(string $projectDir, string $type, string $trashId, string $filename): void
{
    mediaTrashType($type);
    if (!mediaTrashSafeName($trashId) || !mediaTrashSafeName($filename)) throw new RuntimeException('Invalid trash entry.');
    $source = mediaTrashPlainPath($projectDir, '.movement-media-trash', $trashId, $type, $filename);
    $target = mediaTrashPlainPath($projectDir, $type, $filename);
    if (!is_file($source)) throw new RuntimeException('Trash file not found.');
    if (file_exists($target)) throw new RuntimeException('A file with this name already exists. Nothing was overwritten; the old file remains in Trash.');
    // Atomic no-overwrite restore. A crash before unlink leaves both complete copies.
    if (!@link($source, $target)) {
        // Some filesystems do not support hard links. Exclusive creation still
        // refuses collisions; the trash source survives until copying completes.
        $input = @fopen($source, 'rb');
        $output = $input === false ? false : @fopen($target, 'xb');
        if ($output === false) {
            if (is_resource($input)) fclose($input);
            throw new RuntimeException('Could not restore the file. It remains in Trash.');
        }
        $size = fstat($input)['size'];
        $copied = stream_copy_to_stream($input, $output);
        $complete = $copied === $size && fflush($output);
        fclose($input);
        $complete = fclose($output) && $complete;
        if (!$complete) {
            @unlink($target);
            throw new RuntimeException('Could not finish restoring the file. It remains in Trash.');
        }
    }
    if (!@unlink($source)) throw new RuntimeException('File restored, but its trash entry could not be removed.');
}

// Keep existing image-only callers compatible with the generalized operations.
function unusedImageSnapshot(string $projectDir, string $flowPath): array { return unusedMediaSnapshot($projectDir, $flowPath, 'img'); }
function trashUnusedImages(string $projectDir, string $flowPath, string $token): array { return trashUnusedMedia($projectDir, $flowPath, 'img', $token); }
function listImageTrash(string $projectDir): array { return listMediaTrash($projectDir, 'img'); }
function restoreTrashedImage(string $projectDir, string $trashId, string $filename): void { restoreTrashedMedia($projectDir, 'img', $trashId, $filename); }
