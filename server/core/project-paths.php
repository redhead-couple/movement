<?php

function normalizeSlug(string $value): string
{
    return basename(trim($value));
}

function getProjectPaths(string $username, string $project): array
{
    $username = normalizeSlug($username);
    $project = normalizeSlug($project);

    $rootDir = $_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 2);

    $privateStorageRoot = dirname(__DIR__, 2) . '/private-data/slidedeck';
    $userFsDir = $privateStorageRoot . '/' . $username;
    $projectFsDir = $userFsDir . '/' . $project;

    $projectWebDir = '/slidedeck/' . rawurlencode($username) . '/' . rawurlencode($project) . '/';
    // Media is private storage, so use the controller URL directly. Unlike the
    // friendly /slidedeck/ route, this does not depend on Apache or the local
    // development router rewriting asset requests.
    $mediaWebDir = '/media.php?p=' . rawurlencode($username) . '/' . rawurlencode($project) . '/';

    return [
        'username'      => $username,
        'project'       => $project,
        'rootDir'       => $rootDir,
        'userFsDir'     => $userFsDir,
        'projectFsDir'  => $projectFsDir,
        'projectWebDir' => $projectWebDir,
        'mediaWebDir'   => $mediaWebDir,
        'flowPath'      => $projectFsDir . '/flow.json',
        'imgFsDir'      => $projectFsDir . '/img',
        'speechFsDir'   => $projectFsDir . '/speech',
        'audioFsDir'    => $projectFsDir . '/audio',
        'backupsFsDir'  => $projectFsDir . '/backups',
        'imgWebDir'     => $mediaWebDir . 'img/',
        'speechWebDir'  => $mediaWebDir . 'speech/',
        'audioWebDir'   => $mediaWebDir . 'audio/',
    ];
}

function getExampleProjectPaths(string $example): ?array
{
    $example = trim($example);
    if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/', $example)) {
        return null;
    }

    $examplesRoot = realpath(dirname(__DIR__, 2) . '/examples');
    if ($examplesRoot === false) {
        return null;
    }

    $projectFsDir = realpath($examplesRoot . DIRECTORY_SEPARATOR . $example);
    if (
        $projectFsDir === false
        || !is_dir($projectFsDir)
        || !str_starts_with($projectFsDir . DIRECTORY_SEPARATOR, $examplesRoot . DIRECTORY_SEPARATOR)
    ) {
        return null;
    }

    $flowPath = $projectFsDir . DIRECTORY_SEPARATOR . 'flow.json';
    if (!is_file($flowPath)) {
        return null;
    }

    $projectWebDir = '/examples/' . rawurlencode($example) . '/';

    return [
        'example' => $example,
        'projectFsDir' => $projectFsDir,
        'projectWebDir' => $projectWebDir,
        'flowPath' => $flowPath,
    ];
}
