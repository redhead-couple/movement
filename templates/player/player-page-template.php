<?php

declare(strict_types=1);

function playerSharedShellCss(): string
{
    return <<<'CSS'
:root {
    --app-bg: #0f0d0c;
    --app-bg-deep: #050505;
    --app-surface: rgba(20, 17, 16, .92);
    --app-surface-strong: rgba(10, 9, 8, .96);
    --app-surface-soft: rgba(42, 34, 30, .62);
    --app-text: #f3eee8;
    --app-text-muted: rgba(215, 205, 194, .72);
    --app-line: rgba(243, 238, 232, .12);
    --app-line-strong: rgba(243, 238, 232, .22);
    --app-accent: #b9634f;
    --app-accent-strong: #d18a70;
    --bg: #0f0d0c;
    --ink: #f3eee8;
    --muted: rgba(215, 205, 194, .72);
    --frame: rgba(242, 237, 233, .12);
    --accent: var(--app-accent);
    --accent2: var(--app-accent-strong);
    --card: rgba(23, 18, 16, .82);
    --shadow: rgba(0, 0, 0, .28);
}

html,
body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--app-font-body);
}

.wrap {
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0 10% 3% 10%;
    box-sizing: border-box;
}

.title {
    display: none;
    font-weight: 800;
    letter-spacing: .2px;
    margin: 6px 0 12px;
    font-size: clamp(18px, 2.2vw, 28px);
}

.player {
    display: flex;
    justify-content: center;
    width: 100%;
}

.visualColumn {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: transparent;
    border: none;
    border-radius: 0;
    margin-bottom: 5%;
    box-shadow: none;
    padding: 0;
    position: relative;
    width: 100%;
}

.portraitNotice {
    display: none;
    text-align: center;
    padding: 10px 16px 2px;
    color: var(--muted);
    font-weight: 700;
    font-size: 14px;
    line-height: 1.35;
}

.visualPane {
    position: relative;
    min-height: 80vh;
    max-height: 100vh;
    background: var(--app-bg-deep);
    border-radius: var(--app-radius-lg);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}

.visualInner {
    position: relative;
    width: 100%;
    height: 100%;
    padding-bottom: 0;
}

.intro-screen {
    position: absolute;
    inset: 0;
    z-index: 20;
    transition: opacity 0.8s ease, visibility 0.8s;
    opacity: 1;
    visibility: visible;
    background: var(--app-bg-deep);
}

.intro-screen.vanish {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
}

.layer-opener {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.startOverlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(20, 15, 13, 0.4);
    z-index: 2;
}

.bigBtn {
    appearance: none;
    border: none;
    background: var(--accent);
    color: #180f0c;
    font-weight: 800;
    padding: 14px 18px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 10px 24px rgba(0, 0, 0, .28);
    font-size: clamp(16px, 1.8vw, 22px);
    transition: transform 0.1s;
}

.bigBtn:active {
    transform: scale(0.95);
}

.slideLayer {
    position: absolute;
    inset: 0;
    display: block;
    transform: none;
    opacity: 1;
    will-change: transform, opacity;
}

.t-push-up-enter-active,
.t-push-up-exit-active,
.t-push-left-enter-active,
.t-push-left-exit-active,
.t-push-right-enter-active,
.t-push-right-exit-active,
.t-fade-enter-active,
.t-fade-exit-active,
.t-zoom-enter-active,
.t-zoom-exit-active {
    transition: transform 0.6s ease, opacity 0.6s ease;
}

.t-dissolve-enter-active,
.t-dissolve-exit-active {
    transition: opacity 1.1s ease-in-out;
}

.t-push-up-enter { transform: translateY(100%); z-index: 2; }
.t-push-up-enter-active { transform: translateY(0); }
.t-push-up-exit { transform: translateY(0); z-index: 1; }
.t-push-up-exit-active { transform: translateY(-100%); }
.t-push-left-enter { transform: translateX(100%); z-index: 2; }
.t-push-left-enter-active { transform: translateX(0); }
.t-push-left-exit { transform: translateX(0); z-index: 1; }
.t-push-left-exit-active { transform: translateX(-100%); }
.t-push-right-enter { transform: translateX(-100%); z-index: 2; }
.t-push-right-enter-active { transform: translateX(0); }
.t-push-right-exit { transform: translateX(0); z-index: 1; }
.t-push-right-exit-active { transform: translateX(100%); }
.t-zoom-enter { transform: scale(0.5); opacity: 0; z-index: 2; }
.t-zoom-enter-active { transform: scale(1); opacity: 1; }
.t-zoom-exit { transform: scale(1); opacity: 1; z-index: 1; }
.t-zoom-exit-active { transform: scale(1.5); opacity: 0; }
.t-fade-enter { opacity: 0; z-index: 2; }
.t-fade-enter-active { opacity: 1; }
.t-fade-exit { opacity: 1; z-index: 1; }
.t-fade-exit-active { opacity: 0; }
.t-dissolve-enter { opacity: 0; z-index: 2; }
.t-dissolve-enter-active { opacity: 1; }
.t-dissolve-exit { opacity: 1; z-index: 1; }
.t-dissolve-exit-active { opacity: 1; }

.slideLayer.anim {
    transition: transform 320ms ease-out;
}

.slideLayer img.layer-bg,
canvas.layer-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 1;
}

.slideLayer img.layer-fg,
canvas.layer-fg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 2;
    pointer-events: none;
}

.controlsBar {
    display: none;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 12px;
    background: transparent;
}

.btn {
    appearance: none;
    border: 1px solid var(--frame);
    background: rgba(255, 255, 255, .03);
    color: var(--ink);
    border-radius: var(--app-radius-sm);
    padding: 8px 12px;
    font-weight: 700;
    cursor: pointer;
}

.btn.primary {
    background: var(--accent);
    color: #180f0c;
    border-color: var(--accent2);
}

#backBtn {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 40;
    padding: 12px 18px;
    font-size: 1.05rem;
    border-radius: 999px;
}

#exitFullscreenBtn {
    position: fixed;
    top: 4px;
    right: 16px;
    z-index: 45;
    display: none;
    padding: 7px 18px;
    font-size: 1.05rem;
    border-radius: 999px;
}

body.is-fullscreen .wrap {
    padding: 0;
}

body.is-fullscreen .topBar {
    display: none;
}

body.is-fullscreen #backBtn {
    display: none;
}

body.is-fullscreen #exitFullscreenBtn {
    display: inline-flex;
}

body.is-fullscreen .visualPane {
    min-height: 100vh;
    max-height: 100vh;
    border-radius: 0;
}

body.is-fullscreen .controlsBar {
    padding: 12px 16px 16px;
}

@media (max-width: 768px) {
    .wrap {
        padding: 0 16px;
    }
}

@media (max-width: 768px) and (orientation: portrait) {
    .portraitNotice {
        display: block;
        margin-top: 30px;
    }
}

.rangeWrap {
    flex: 1 1 200px;
    display: flex;
    align-items: center;
    gap: 8px;
}

input[type="range"] {
    width: 100%;
    cursor: pointer;
}

.badge {
    font-size: .9rem;
    color: var(--muted);
}

.textPane {
    display: block;
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
}

#captionsOverlay {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 80%;
    text-align: center;
    pointer-events: none;
    z-index: 10;
    transition: opacity 0.3s ease;
}

#captionsOverlay span {
    background-color: rgba(0, 0, 0, 0.6);
    color: #fff;
    padding: 4px 12px;
    border-radius: 4px;
    font-family: sans-serif;
    font-size: 18px;
    line-height: 1.5;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
    display: inline-block;
}

.cc-hidden {
    opacity: 0;
}

.visually-hidden {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
}
CSS;
}

function renderPlayerPage(array $options): string
{
    $title = $options['title'] ?? 'Timeline Player v2';
    $headAssetsHtml = $options['headAssetsHtml'] ?? '';
    $bootstrapScript = $options['bootstrapScript'] ?? '';
    $runtimePath = dirname(__DIR__, 2) . '/studio/player/player-runtime.js';
    $runtimeSource = @file_get_contents($runtimePath);
    if (!is_string($runtimeSource)) {
        throw new RuntimeException('Could not read studio/player/player-runtime.js');
    }

    ob_start();
?>
    <!doctype html>
    <html lang="en">

    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></title>
        <meta name="robots" content="noindex, nofollow">
        <?= $headAssetsHtml ?>
        <style>
            <?= playerSharedShellCss() ?>
        </style>
    </head>

    <body class="page page-player">
        <div class="wrap">
            <div class="title" id="title">Loading...</div>
            <button class="btn" id="backBtn" type="button">Back</button>
            <button class="btn" id="exitFullscreenBtn" type="button">Exit Fullscreen</button>
            <div class="player" id="player">
                <div class="visualColumn">
                    <div class="portraitNotice" id="portraitNotice">
                        For the best experience, rotate your phone to landscape.
                    </div>
                    <div class="visualPane" id="visual">
                        <div class="visualInner">
                            <div id="introScreen" class="intro-screen" style="display:none;">
                                <img id="opener" class="layer-opener" />
                                <div class="startOverlay">
                                    <button class="bigBtn" id="startBtn">Start</button>
                                </div>
                            </div>
                            <div class="slideLayer" id="layerA" style="z-index:2;"></div>
                            <div class="slideLayer" id="layerB" style="z-index:1; transform: translateX(100%);"></div>
                        </div>
                        <div id="captionsOverlay" class="cc-hidden">
                            <span id="captionText"></span>
                        </div>
                    </div>
                    <div class="controlsBar" id="controlsBar">
                        <button class="btn" id="prevBtn" aria-label="Previous slide">Prev</button>
                        <button class="btn primary" id="playPauseBtn">Start</button>
                        <button class="btn" id="nextBtn" aria-label="Next slide">Next</button>
                        <button class="btn" id="ccBtn" title="Toggle Captions">CC</button>
                        <button class="btn" id="fullscreenBtn" type="button">Fullscreen</button>
                        <div class="rangeWrap">
                            <span class="badge" id="posLabel">1</span>
                            <input type="range" id="scrub" min="1" max="1" step="1" value="1" />
                            <span class="badge" id="maxLabel">1</span>
                        </div>
                        <span class="badge" id="status"></span>
                    </div>
                </div>
                <div class="textPane">
                    <div id="text"></div>
                </div>
            </div>
        </div>
        <audio id="speech" class="visually-hidden" preload="auto"></audio>
        <script>
            <?= $bootstrapScript ?>
        </script>
        <script>
            <?= $runtimeSource ?>
        </script>
    </body>

    </html>
<?php

    return (string) ob_get_clean();
}
