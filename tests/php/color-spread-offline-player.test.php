<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/templates/player/offline-player-template.php';

function colorSpreadAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$applicationRoot = dirname(__DIR__, 2);
$engineSource = file_get_contents($applicationRoot . '/effects/color-spread-engine.js');
colorSpreadAssert(is_string($engineSource), 'Could not read the Color Spread engine.');

$definition = [
    'enabled' => true,
    'name' => 'Color Spread',
    'engine' => 'color-spread',
    'config' => [
        'targetColor' => '#f97316',
        'origin' => ['mode' => 'left', 'x' => 0, 'y' => 0.5],
    ],
];
$flowJson = json_encode([
    'schemaVersion' => 2,
    'title' => 'Color Spread PHP portable test',
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
    ['color-spread' => $engineSource]
);

colorSpreadAssert(
    substr_count($html, 'inlineEngines["color-spread"]') === 1,
    'The PHP portable player did not inline Color Spread exactly once.'
);
colorSpreadAssert(!str_contains($html, 'export function mount'), 'Module exports remained in the portable engine.');
colorSpreadAssert(str_contains($html, 'function mount(canvas, ctx, config)'), 'The portable mount function is missing.');
colorSpreadAssert(str_contains($html, 'foregroundLayers'), 'The portable foreground placement is missing.');

echo "COLOR_SPREAD_PHP_PORTABLE_OK\n";
