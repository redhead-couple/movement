<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/templates/player/offline-player-template.php';

function scatteredOrbsAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$applicationRoot = dirname(__DIR__, 2);
$engineSource = file_get_contents($applicationRoot . '/effects/scattered-orbs-engine.js');
scatteredOrbsAssert(is_string($engineSource), 'Could not read the Scattered Orbs engine.');

$definition = [
    'enabled' => true,
    'name' => 'Scattered Orbs',
    'engine' => 'scattered-orbs',
    'config' => ['count' => 48, 'origin' => ['x' => 0.5, 'y' => 0.52]],
];
$flowJson = json_encode([
    'schemaVersion' => 2,
    'title' => 'Scattered Orbs PHP portable test',
    'slides' => [[
        'background' => ['src' => '', 'effect' => $definition],
        'foregroundLayers' => [[
            'name' => 'Foreground',
            'src' => '',
            'effect' => $definition,
        ]],
        'audioLayers' => [],
    ]],
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

$html = buildOfflinePlayerHtml(
    $flowJson,
    '',
    ['scattered-orbs' => $engineSource]
);

scatteredOrbsAssert(
    substr_count($html, 'inlineEngines["scattered-orbs"]') === 1,
    'The PHP portable player did not inline Scattered Orbs exactly once.'
);
scatteredOrbsAssert(!str_contains($html, 'export function mount'), 'Module exports remained in the portable engine.');
scatteredOrbsAssert(str_contains($html, 'function mount(canvas, ctx, config)'), 'The portable mount function is missing.');
scatteredOrbsAssert(str_contains($html, 'foregroundLayers'), 'The portable foreground placement is missing.');

echo "SCATTERED_ORBS_PHP_PORTABLE_OK\n";
