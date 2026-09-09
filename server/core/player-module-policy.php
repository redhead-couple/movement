<?php
declare(strict_types=1);

function safePlayerModuleSlug($value): ?string
{
    if (!is_string($value)) {
        return null;
    }

    $slug = trim($value);
    return preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $slug) === 1 ? $slug : null;
}

/**
 * @return array<string, true>
 */
function loadApprovedPlayerModuleSlugs(string $applicationRoot, string $folder): array
{
    if ($folder !== 'effects' && $folder !== 'transitions') {
        throw new InvalidArgumentException('Unknown player module registry.');
    }

    $registryPath = rtrim($applicationRoot, '/\\') . '/' . $folder . '/registry.json';
    $registryJson = @file_get_contents($registryPath);
    $registry = is_string($registryJson) ? json_decode($registryJson, true) : null;
    if (!is_array($registry)) {
        throw new RuntimeException('Could not read the approved ' . $folder . ' registry.');
    }

    $approved = [];
    foreach ($registry as $group) {
        if (!is_array($group)) {
            continue;
        }
        foreach (explode(',', (string) ($group['engines'] ?? '')) as $rawSlug) {
            $slug = safePlayerModuleSlug($rawSlug);
            if ($slug !== null) {
                $approved[$slug] = true;
            }
        }
    }
    return $approved;
}
