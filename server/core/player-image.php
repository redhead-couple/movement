<?php

// Disposable presentation copies, never project media. Call only AFTER access
// to the original has been authorized. Editing, downloads and exports use originals.
function playerImageCopy(string $source, string $cacheDir): ?string
{
    if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) return null;
    $size = @filesize($source);
    $info = @getimagesize($source);
    if (!$size || $size < 65536 || $size > 16 * 1024 * 1024 || !$info
        || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) return null;
    $pixels = $info[0] * $info[1];
    if ($pixels > 12000000) return null;
    $limit = trim(ini_get('memory_limit'));
    $unit = strtolower(substr($limit, -1));
    $limitBytes = (int) $limit * (['g' => 1073741824, 'm' => 1048576, 'k' => 1024][$unit] ?? 1);
    if ($limitBytes > 0 && memory_get_usage(true) + $pixels * 10 + $size * 3 + 16777216 > $limitBytes) return null;
    $bytes = @file_get_contents($source);
    if ($bytes === false) return null;
    if ($info[2] === IMAGETYPE_WEBP) {
        $chunks = [];
        for ($offset = 12; $offset + 8 <= strlen($bytes);) {
            $chunks[] = substr($bytes, $offset, 4);
            $length = unpack('V', substr($bytes, $offset + 4, 4))[1];
            $offset += 8 + $length + ($length % 2);
        }
        // Already-lossy WebP is a delivery format. Do not spend CPU or incur
        // another lossy generation; the large lossless sources are the target.
        if (!in_array('VP8L', $chunks, true) || in_array('ANIM', $chunks, true) || in_array('ICCP', $chunks, true)) return null;
    }
    // GD does not preserve animation, embedded color profiles or EXIF rotation.
    // Keep such originals rather than changing their appearance.
    if (($info[2] === IMAGETYPE_PNG && preg_match('/acTL|iCCP|gAMA|cICP/', $bytes))
        || ($info[2] === IMAGETYPE_JPEG && (str_contains($bytes, 'ICC_PROFILE') || str_contains($bytes, "Exif\0\0")))) return null;
    if (is_link($cacheDir)) return null;
    if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0700, true) && !is_dir($cacheDir)) return null;
    $key = hash('sha256', "webp-q90-same-size-v1\0" . $bytes);
    $copy = $cacheDir . '/' . $key . '.webp';
    $skip = $cacheDir . '/' . $key . '.skip';
    if (is_file($copy) && !is_link($copy)) { @touch($copy); return $copy; }
    if (is_file($skip)) return null;
    // Serialize cold conversions to bound server memory/CPU. Reads of existing
    // copies do not wait. A complete temporary file is renamed atomically.
    $lock = @fopen($cacheDir . '/generation.lock', 'c');
    if (!$lock) return null;
    $image = null; $temp = null;
    try {
        if (!flock($lock, LOCK_EX)) return null;
        if (is_file($copy) && !is_link($copy)) return $copy;
        if (is_file($skip)) return null;
        $image = @imagecreatefromstring($bytes);
        if (!$image) return null;
        if (!imageistruecolor($image)) imagepalettetotruecolor($image);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        $temp = @tempnam($cacheDir, 'encode-');
        if ($temp === false || !@imagewebp($image, $temp, 90)) return null;
        clearstatcache(true, $temp);
        $encodedSize = @filesize($temp);
        $encodedInfo = @getimagesize($temp);
        // Avoid a second lossy generation unless it delivers a meaningful saving.
        if (!$encodedSize || !$encodedInfo || $encodedInfo[0] !== $info[0] || $encodedInfo[1] !== $info[1]
            || $encodedSize > $size * 0.85) {
            @file_put_contents($skip, '');
            prunePlayerImageCopies($cacheDir);
            return null;
        }
        prunePlayerImageCopies($cacheDir, $encodedSize);
        if (!@rename($temp, $copy)) return null;
        $temp = null;
        @chmod($copy, 0600);
        return $copy;
    } catch (Throwable $error) {
        return null;
    } finally {
        if ($image) imagedestroy($image);
        if ($temp && is_file($temp)) @unlink($temp);
        flock($lock, LOCK_UN); fclose($lock);
    }
}

function prunePlayerImageCopies(string $cacheDir, int $incomingBytes = 0): void
{
    $entries = []; $total = $incomingBytes;
    foreach (glob($cacheDir . '/*') ?: [] as $file) {
        // Clean up abandoned encoder output after a killed PHP process.
        if (str_starts_with(basename($file), 'encode-') && !is_link($file)
            && @filemtime($file) < time() - 86400) { @unlink($file); continue; }
        if (!preg_match('/^[a-f0-9]{64}\.(webp|skip)$/D', basename($file)) || is_link($file)) continue;
        $mtime = @filemtime($file); $size = @filesize($file);
        if ($mtime < time() - 7 * 86400 && @unlink($file)) continue;
        $entries[] = ['file' => $file, 'time' => $mtime, 'size' => $size];
        $total += $size;
    }
    usort($entries, fn($a, $b) => $a['time'] <=> $b['time']);
    $count = count($entries);
    foreach ($entries as $entry) {
        if ($total <= 128 * 1024 * 1024 && $count < 2000) break;
        if (@unlink($entry['file'])) { $total -= $entry['size']; $count--; }
    }
}
