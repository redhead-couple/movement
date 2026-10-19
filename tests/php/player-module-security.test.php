<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/server/core/player-module-policy.php';

function assertPlayerPolicy(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . "\n");
        exit(1);
    }
}

$invalidSlugs = [
    'https://example.test/evil.js',
    'http://example.test/evil.js',
    'file:///tmp/evil.js',
    'javascript:alert(1)',
    '../evil',
    '%2e%2e%2fevil',
    '/absolute/evil',
    'C:\\absolute\\evil',
    'Zoom',
    'soft_wipe',
    'soft--wipe',
    'soft-wipe.js',
];

foreach ($invalidSlugs as $slug) {
    assertPlayerPolicy(safePlayerModuleSlug($slug) === null, 'Unsafe module slug accepted: ' . $slug);
}

$applicationRoot = dirname(__DIR__, 2);
$effects = loadApprovedPlayerModuleSlugs($applicationRoot, 'effects');
$transitions = loadApprovedPlayerModuleSlugs($applicationRoot, 'transitions');

// Read expected membership independently of the policy loader. Registry growth
// must not require editing tests, and equal counts must not hide wrong members.
foreach (['effects' => $effects, 'transitions' => $transitions] as $folder => $approved) {
    $registry = json_decode(file_get_contents($applicationRoot . '/' . $folder . '/registry.json'), true, 512, JSON_THROW_ON_ERROR);
    $expected = [];
    foreach ($registry as $group) {
        foreach (explode(',', $group['engines']) as $name) {
            $slug = trim($name);
            if ($slug !== '') $expected[$slug] = true;
        }
    }
    ksort($expected);
    ksort($approved);
    assertPlayerPolicy($approved === $expected, 'Approved modules differ from the current ' . $folder . ' registry.');
}
assertPlayerPolicy(!isset($effects['unregistered-effect']), 'Unregistered effect was approved.');
assertPlayerPolicy(!isset($transitions['unregistered-transition']), 'Unregistered transition was approved.');

echo "PLAYER_MODULE_POLICY_PHP_OK\n";
