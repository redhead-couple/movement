<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/templates/player/offline-player-template.php';

function rippleAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$applicationRoot = dirname(__DIR__, 2);
$engineSource = file_get_contents($applicationRoot . '/effects/ripple-engine.js');
rippleAssert(is_string($engineSource), 'Could not read the Ripple engine.');

$definition = [
    'enabled' => true,
    'name' => 'Ripple',
    'engine' => 'ripple',
    'config' => ['imgSrc' => 'img/example.webp', 'count' => 1],
];
$flowJson = json_encode([
    'schemaVersion' => 2,
    'title' => 'Ripple PHP portable test',
    'slides' => [[
        'background' => ['src' => 'example.webp', 'effect' => $definition],
        'foregroundLayers' => [],
        'audioLayers' => [],
    ]],
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

$html = buildOfflinePlayerHtml($flowJson, '', ['ripple' => $engineSource]);
rippleAssert(
    substr_count($html, 'inlineEngines["ripple"]') === 1,
    'The PHP portable player did not inline Ripple exactly once.'
);
rippleAssert(!str_contains($html, 'export function'), 'Module exports remained in the portable Ripple engine.');
rippleAssert(str_contains($html, 'function mount(canvas, ctx, config)'), 'The portable Ripple mount function is missing.');
rippleAssert(!str_contains($html, 'getImageData'), 'The portable Ripple engine still requires protected pixel reads.');

echo "RIPPLE_PHP_PORTABLE_OK\n";
