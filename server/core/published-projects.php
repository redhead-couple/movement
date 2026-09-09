<?php

function getProjectFeedMeta(string $username, string $project): ?array
{
    $rootDir = $_SERVER['DOCUMENT_ROOT'];
    $projectDir = dirname(__DIR__, 2) . '/private-data/slidedeck/' . $username . '/' . $project;
    $flowPath = $projectDir . '/flow.json';

    if (!is_dir($projectDir) || !is_file($flowPath)) {
        return null;
    }

    $json = @file_get_contents($flowPath);
    $data = is_string($json) ? json_decode($json, true) : null;

    if (!is_array($data)) {
        return null;
    }

    $title = trim((string)($data['title'] ?? $project));
    $description = trim((string)($data['description'] ?? ''));
    $openingImage = trim((string)($data['openingImage'] ?? ''));
    $isPublished = !empty($data['isPublished']);
    $publishedAt = (int)($data['publishedAt'] ?? 0);

    return [
        'username' => $username,
        'project' => $project,
        'title' => $title !== '' ? $title : $project,
        'description' => $description,
        'openingImage' => $openingImage,
        'isPublished' => $isPublished,
        'publishedAt' => $publishedAt,
        'projectUrl' => '/player.php?username=' . rawurlencode($username) . '&project=' . rawurlencode($project),
        'imageUrl' => $openingImage !== ''
            ? '/media.php?p=' . rawurlencode($username) . '/' . rawurlencode($project) . '/img/' . rawurlencode($openingImage)
            : '',
    ];
}
function getPublishedProjectsByUser(string $username): array
{
    $rootDir = $_SERVER['DOCUMENT_ROOT'];
    $userDir = dirname(__DIR__, 2) . '/private-data/slidedeck/' . $username;

    if (!is_dir($userDir)) {
        return [];
    }

    $results = [];
    $projectItems = scandir($userDir);

    if (!is_array($projectItems)) {
        return [];
    }

    foreach ($projectItems as $project) {
        if ($project === '.' || $project === '..') {
            continue;
        }

        $meta = getProjectFeedMeta($username, $project);

        if (!$meta || empty($meta['isPublished'])) {
            continue;
        }

        $results[] = $meta;
    }

    usort($results, function ($a, $b) {
        return ($b['publishedAt'] ?? 0) <=> ($a['publishedAt'] ?? 0);
    });

    return $results;
}
function getPublishedProjects(): array
{
    $rootDir = $_SERVER['DOCUMENT_ROOT'];
    $slidedeckDir = dirname(__DIR__, 2) . '/private-data/slidedeck';

    if (!is_dir($slidedeckDir)) {
        return [];
    }

    $results = [];
    $userItems = scandir($slidedeckDir);

    if (!is_array($userItems)) {
        return [];
    }

    foreach ($userItems as $username) {
        if ($username === '.' || $username === '..') {
            continue;
        }

        $userDir = $slidedeckDir . '/' . $username;

        if (!is_dir($userDir)) {
            continue;
        }

        $projectItems = scandir($userDir);

        if (!is_array($projectItems)) {
            continue;
        }

        foreach ($projectItems as $project) {
            if ($project === '.' || $project === '..') {
                continue;
            }

            $meta = getProjectFeedMeta($username, $project);

            if (!$meta || empty($meta['isPublished'])) {
                continue;
            }

            $results[] = $meta;
        }
        usort($results, function ($a, $b) {
            return ($b['publishedAt'] ?? 0) <=> ($a['publishedAt'] ?? 0);
        });
    }

    return $results;
}
