<?php
declare(strict_types=1);
require_once __DIR__ . '/storage-quota.php';

// All existing-project content/publication writers must hold this same lock
// from before reading flow.json through backup creation and final replacement.
function acquireProjectLock(string $projectFsDir)
{
    $userLock = acquireUserStorageLock(dirname($projectFsDir));
    if ($userLock === false) return false;
    $handle = @fopen($projectFsDir . '/.save.lock', 'c');
    if ($handle === false) return false;
    if (!flock($handle, LOCK_EX | LOCK_NB)) {
        fclose($handle);
        return false;
    }
    $GLOBALS['movementProjectStorageLocks'][(int) $handle] = $userLock;
    return $handle;
}

function releaseProjectLock($handle): void
{
    if (is_resource($handle)) {
        $key = (int) $handle;
        flock($handle, LOCK_UN);
        fclose($handle);
        unset($GLOBALS['movementProjectStorageLocks'][$key]);
    }
}

function saveJsonAtomically(string $targetPath, string $json): bool
{
    // Validate without re-encoding: keep object/array distinctions and values.
    json_decode($json);
    if (json_last_error() !== JSON_ERROR_NONE || !is_dir(dirname($targetPath))) return false;

    $tmpPath = null;
    $handle = null;
    try {
        // Same directory/filesystem makes rename a single replacement. The
        // temporary name cannot be served as JSON by the media controller.
        $tmpPath = dirname($targetPath) . '/.flow-' . bin2hex(random_bytes(12)) . '.tmp';
        $handle = @fopen($tmpPath, 'xb');
        if ($handle === false) return false;
        $written = fwrite($handle, $json);
        if ($written !== strlen($json) || !fflush($handle)) return false;
        fclose($handle);
        $handle = null;

        $permissions = @fileperms($targetPath);
        if (!@chmod($tmpPath, $permissions === false ? 0644 : ($permissions & 0777))) return false;
        // Never unlink the old file to force replacement: on failure it must
        // remain available to readers and the caller must report failure.
        return @rename($tmpPath, $targetPath);
    } catch (Throwable $e) {
        return false;
    } finally {
        if (is_resource($handle)) fclose($handle);
        if ($tmpPath !== null && is_file($tmpPath)) @unlink($tmpPath);
    }
}

/**
 * Caller must hold the project lock. Prepare every upload before replacing any
 * live file, then save the flow only after all media replacements succeed.
 * Each rename is atomic; this is not a crash-atomic multi-file transaction.
 * On a reported failure, restore completed replacements from private copies.
 *
 * @param array<array{tmpName: string, destination: string}> $uploads
 */
function saveProjectUploadBatch(array $uploads, ?string $jsonPath = null, ?string $json = null): bool
{
    $prepared = [];
    $committed = [];
    $success = false;
    try {
        foreach ($uploads as $upload) {
            $destination = $upload['destination'];
            $directory = dirname($destination);
            if (!is_dir($directory) && !@mkdir($directory, 0755, true) && !is_dir($directory)) return false;
            // All temporary/recovery files have a non-media extension and stay
            // on the destination filesystem. The media controller cannot serve them.
            $id = bin2hex(random_bytes(12));
            $stage = $directory . '/.media-' . $id . '.tmp';
            $recovery = $directory . '/.media-old-' . $id . '.tmp';
            $prepared[] = ['destination' => $destination, 'stage' => $stage, 'recovery' => null];
            $index = count($prepared) - 1;
            $size = @filesize($upload['tmpName']);
            if ($size === false || $size === 0 || !@move_uploaded_file($upload['tmpName'], $stage)) return false;
            clearstatcache(true, $stage);
            if (@filesize($stage) !== $size || !@chmod($stage, 0644)) return false;

            if (file_exists($destination)) {
                if (!is_file($destination)) return false;
                $prepared[$index]['recovery'] = $recovery;
                if (!@copy($destination, $recovery)) return false;
                $permissions = @fileperms($destination);
                if (!@chmod($recovery, $permissions === false ? 0644 : ($permissions & 0777))) return false;
            }
        }

        foreach ($prepared as $index => $file) {
            // Never delete the destination first. Failed replacement leaves it intact.
            if (!@rename($file['stage'], $file['destination'])) return false;
            $committed[] = $index;
        }
        if ($jsonPath !== null && ($json === null || !saveJsonAtomically($jsonPath, $json))) return false;
        $success = true;
        return true;
    } catch (Throwable $e) {
        error_log('Project media save failed: ' . $e->getMessage());
        return false;
    } finally {
        if (!$success) {
            foreach (array_reverse($committed) as $index) {
                $file = $prepared[$index];
                try {
                    $restored = $file['recovery'] !== null
                        ? @rename($file['recovery'], $file['destination'])
                        : @unlink($file['destination']);
                } catch (Throwable $e) {
                    $restored = false;
                }
                if (!$restored) {
                    // A second filesystem failure must not delete the only old
                    // copy. Keep it for recovery and log its location for support.
                    error_log('Could not roll back project media: ' . $file['destination'] . '; recovery: ' . ($file['recovery'] ?? 'none'));
                    $prepared[$index]['recovery'] = null;
                }
            }
        }
        foreach ($prepared as $file) {
            if (is_file($file['stage'])) @unlink($file['stage']);
            if ($file['recovery'] !== null && is_file($file['recovery'])) @unlink($file['recovery']);
        }
    }
}
