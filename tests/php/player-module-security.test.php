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

assertPlayerPolicy(count($effects) === 25, 'Expected exactly 25 approved effects.');
assertPlayerPolicy(count($transitions) === 6, 'Expected exactly 6 approved transitions.');
assertPlayerPolicy(isset($effects['zoom']), 'Registered effect zoom was rejected.');
assertPlayerPolicy(isset($transitions['soft-wipe']), 'Registered transition soft-wipe was rejected.');
assertPlayerPolicy(!isset($effects['unregistered-effect']), 'Unregistered effect was approved.');
assertPlayerPolicy(!isset($transitions['unregistered-transition']), 'Unregistered transition was approved.');

echo "PLAYER_MODULE_POLICY_PHP_OK\n";
