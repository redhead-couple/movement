<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/templates/player/offline-player-template.php';

function cursorMoveAndClickAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$applicationRoot = dirname(__DIR__, 2);
$engineSource = file_get_contents($applicationRoot . '/effects/cursor-move-and-click-engine.js');
cursorMoveAndClickAssert(is_string($engineSource), 'Could not read the Cursor Move and Click engine.');

$definition = [
    'enabled' => true,
    'name' => 'Cursor Move and Click',
    'engine' => 'cursor-move-and-click',
    'config' => ['clickPosition' => ['x' => 0.7, 'y' => 0.4]],
];
$flowJson = json_encode([
    'schemaVersion' => 2,
    'title' => 'Cursor Move and Click PHP portable test',
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

$html = buildOfflinePlayerHtml($flowJson, '', ['cursor-move-and-click' => $engineSource]);
cursorMoveAndClickAssert(
    substr_count($html, 'inlineEngines["cursor-move-and-click"]') === 1,
    'The PHP portable player did not inline Cursor Move and Click exactly once.'
);
cursorMoveAndClickAssert(!str_contains($html, 'export function mount'), 'Module exports remained in the portable engine.');
cursorMoveAndClickAssert(str_contains($html, 'function mount(canvas, ctx, config)'), 'The portable mount function is missing.');
cursorMoveAndClickAssert(str_contains($html, 'foregroundLayers'), 'The portable foreground placement is missing.');
cursorMoveAndClickAssert(str_contains($html, "layerPlacement: 'background'"), 'Background placement metadata is missing.');
cursorMoveAndClickAssert(str_contains($html, "layerPlacement: 'foreground'"), 'Foreground placement metadata is missing.');

echo "CURSOR_MOVE_AND_CLICK_PHP_PORTABLE_OK\n";
