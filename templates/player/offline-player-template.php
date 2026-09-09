<?php
declare(strict_types=1);
// Shared player behavior lives in studio/player/player-runtime.js and this template directory.
// Keep this file focused on the offline export bootstrap only.

require_once __DIR__ . '/player-page-template.php';

function buildOfflinePlayerHtml(string $flowJson, string $appCss, array $engineSources, array $transitionSources = []): string
{
    $bootstrapScript = buildOfflineBootstrapScript($flowJson, $engineSources, $transitionSources);

    return renderPlayerPage([
        'title' => 'Timeline Player v2',
        'headAssetsHtml' => "<style>\n{$appCss}\n</style>",
        'bootstrapScript' => $bootstrapScript,
    ]);
}

function buildOfflineBootstrapScript(string $flowJson, array $engineSources, array $transitionSources = []): string
{
    $safeFlowJson = str_replace('</', '<\/', $flowJson);
    $config = [
        'flowData' => json_decode($flowJson, true),
        'imgBase' => 'img/',
        'speechBase' => 'speech/',
        'audioBase' => 'audio/',
        'engineBase' => '',
        'transitionEngineBase' => 'transitions/',
        'cacheBustSpeech' => false,
        // Keep this in sync with player.php when changing the preload window.
        'preloadAheadSlides' => 6,
    ];

    $script = 'window.PLAYER_BOOTSTRAP = ' . json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ";\n";
    $script .= "window.PLAYER_BOOTSTRAP.flowData = {$safeFlowJson};\n";
    $script .= "window.PLAYER_BOOTSTRAP.inlineEngines = {};\n";
    $script .= buildOfflineEngineBootstrap($engineSources, 'window.PLAYER_BOOTSTRAP.inlineEngines');
    $script .= "\nwindow.PLAYER_BOOTSTRAP.inlineTransitions = {};\n";
    $script .= buildOfflineEngineBootstrap($transitionSources, 'window.PLAYER_BOOTSTRAP.inlineTransitions');

    return $script;
}

function buildOfflineEngineBootstrap(array $engineSources, string $registryVar): string
{
    $chunks = [];
    $isEffectRegistry = str_ends_with($registryVar, '.inlineEngines');
    $effectMediaSource = '';
    if ($isEffectRegistry) {
        $effectMediaPath = dirname(__DIR__, 2) . '/effects/effect-media.js';
        $loadedEffectMediaSource = @file_get_contents($effectMediaPath);
        if (!is_string($loadedEffectMediaSource)) {
            throw new RuntimeException('Could not read effects/effect-media.js');
        }
        $effectMediaSource = transformEngineModuleToInlineScript($loadedEffectMediaSource);
    }
    foreach ($engineSources as $engineName => $source) {
        $usesEffectMedia = $effectMediaSource !== '' && str_contains($source, './effect-media.js');
        $inlineSource = $usesEffectMedia ? $effectMediaSource . "\n\n" . $source : $source;
        $chunks[] = $registryVar . '[' . json_encode($engineName, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "] = (function () {\n"
            . transformEngineModuleToInlineScript($inlineSource) . "\n"
            . "    return {\n"
            . "        mount: (typeof mount === 'function' ? mount : null),\n"
            . "        runTransition: (typeof runTransition === 'function' ? runTransition : null)\n"
            . "    };\n"
            . "})();";
    }
    return implode("\n\n", $chunks);
}

function transformEngineModuleToInlineScript(string $source): string
{
    $source = preg_replace('/^\xEF\xBB\xBF/', '', $source) ?? $source;
    $source = preg_replace('/^\s*import\s+\{[^}]+\}\s+from\s+["\']\.\/effect-media\.js["\'];?\s*$/m', '', $source) ?? $source;
    $source = preg_replace('/^\s*export\s+function\s+/m', 'function ', $source) ?? $source;
    $source = preg_replace('/^\s*export\s+const\s+/m', 'const ', $source) ?? $source;
    $source = preg_replace('/^\s*export\s+\{[^}]+\};?\s*$/m', '', $source) ?? $source;
    $source = preg_replace('/([A-Za-z_$][A-Za-z0-9_$]*)\.crossOrigin\s*=\s*["\']Anonymous["\'];?/', 'if (location.protocol !== "file:") { $1.crossOrigin = "Anonymous"; }', $source) ?? $source;
    return rtrim($source);
}
