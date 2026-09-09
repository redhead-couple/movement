<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/templates/player/offline-player-template.php';

function focusFormationAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$applicationRoot = dirname(__DIR__, 2);
$engineSource = file_get_contents($applicationRoot . '/effects/focus-formation-engine.js');
focusFormationAssert(is_string($engineSource), 'Could not read the Focus Formation engine.');

$definition = [
    'enabled' => true,
    'name' => 'Focus Formation',
    'engine' => 'focus-formation',
    'config' => ['count' => 48, 'destination' => ['x' => 0.5, 'y' => 0.5]],
];
$flowJson = json_encode([
    'schemaVersion' => 2,
    'title' => 'Focus Formation PHP portable test',
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
    ['focus-formation' => $engineSource]
);

focusFormationAssert(
    substr_count($html, 'inlineEngines["focus-formation"]') === 1,
    'The PHP portable player did not inline Focus Formation exactly once.'
);
focusFormationAssert(!str_contains($html, 'export function mount'), 'Module exports remained in the portable engine.');
focusFormationAssert(str_contains($html, 'function mount(canvas, ctx, config)'), 'The portable mount function is missing.');
focusFormationAssert(str_contains($html, 'foregroundLayers'), 'The portable foreground placement is missing.');

echo "FOCUS_FORMATION_PHP_PORTABLE_OK\n";
