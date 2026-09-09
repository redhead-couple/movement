<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/templates/player/offline-player-template.php';

function pulsesAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$applicationRoot = dirname(__DIR__, 2);
$engineSource = file_get_contents($applicationRoot . '/effects/pulses-engine.js');
pulsesAssert(is_string($engineSource), 'Could not read the Pulses engine.');

$definition = [
    'enabled' => true,
    'name' => 'Pulses',
    'engine' => 'pulses',
    'config' => ['pulseCount' => 4, 'intensity' => 8],
];
$flowJson = json_encode([
    'schemaVersion' => 2,
    'title' => 'Pulses PHP portable test',
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

$html = buildOfflinePlayerHtml($flowJson, '', ['pulses' => $engineSource]);

pulsesAssert(
    substr_count($html, 'inlineEngines["pulses"]') === 1,
    'The PHP portable player did not inline Pulses exactly once.'
);
pulsesAssert(!str_contains($html, 'export function mount'), 'Module exports remained in the portable engine.');
pulsesAssert(str_contains($html, 'function mount(canvas, ctx, config)'), 'The portable mount function is missing.');
pulsesAssert(str_contains($html, 'foregroundLayers'), 'The portable foreground placement is missing.');

echo "PULSES_PHP_PORTABLE_OK\n";
