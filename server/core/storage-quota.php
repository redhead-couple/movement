<?php
declare(strict_types=1);

final class StorageQuotaException extends RuntimeException {}

final class UserStorageLock
{
    private $handle;
    public function __construct($handle) { $this->handle = $handle; }
    public function __destruct()
    {
        if (is_resource($this->handle)) {
            @flock($this->handle, LOCK_UN);
            fclose($this->handle);
        }
    }
}

// Acquire BEFORE any project lock. Hold until all writes/cleanup finish.
// Nonblocking: parallel requests retry instead of checking stale usage.
function acquireUserStorageLock(string $userDirectory): UserStorageLock|false
{
    $handle = @fopen($userDirectory . '/.storage.lock', 'c');
    if ($handle === false) return false;
    if (!flock($handle, LOCK_EX | LOCK_NB)) {
        fclose($handle);
        return false;
    }
    return new UserStorageLock($handle);
}

function userStorageQuotaBytes(): int
{
    // Config is loaded by the web bootstrap. Standalone imports use the same
    // safe default. Never accept a quota from the request or project JSON.
    $limit = $GLOBALS['USER_STORAGE_QUOTA_BYTES'] ?? 1024 * 1024 * 1024;
    if (!is_int($limit) || $limit <= 0) {
        throw new StorageQuotaException('Storage quota configuration is unavailable.', 503);
    }
    return $limit;
}

function storageFileBytes(string $path): int
{
    clearstatcache(true, $path);
    $size = @filesize($path);
    if ($size === false || $size < 0 || is_link($path)) {
        throw new StorageQuotaException('Could not verify storage usage. Please try again.', 503);
    }
    return $size;
}

// Count actual file bytes, including backups, abandoned imports and temporary
// recovery files. Do not follow links or treat an unreadable tree as empty.
function storageTreeBytes(string $directory): int
{
    try {
        if (is_link($directory) || !is_dir($directory)) throw new RuntimeException();
        $bytes = 0;
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if ($file->isLink() || !$file->isFile()) throw new RuntimeException();
            $size = storageFileBytes($file->getPathname());
            if ($bytes > PHP_INT_MAX - $size) throw new RuntimeException();
            $bytes += $size;
        }
        return $bytes;
    } catch (Throwable $error) {
        throw new StorageQuotaException('Could not verify storage usage. Please try again.', 503);
    }
}

// Caller holds the user's lock. Additional bytes are a conservative upper
// bound for PEAK usage, not just the final size after replacing old files.
function assertUserStorageCapacity(string $userDirectory, int $additionalBytes): void
{
    $limit = userStorageQuotaBytes();
    $used = storageTreeBytes($userDirectory);
    if ($additionalBytes < 0 || $used > $limit || $additionalBytes > $limit - $used) {
        throw new StorageQuotaException('Your storage limit has been reached. Delete unused media or projects and try again. Space is also needed for safety backups and temporary files.', 507);
    }
}

function uploadStoragePeakBytes(array $uploads): int
{
    $bytes = 0;
    foreach ($uploads as $upload) {
        $bytes += storageFileBytes($upload['tmpName']);
        if (is_file($upload['destination'])) $bytes += storageFileBytes($upload['destination']);
    }
    return $bytes;
}
