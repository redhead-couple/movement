import { createEffectImage } from './effect-media.js';

export const MAX_TOTAL_SURFACE_PIXELS = 2073600;
export const CURSOR_CELL_SIZE = 160;
export const CURSOR_VARIANT_COUNT = 2;
export const CURSOR_ATLAS_PIXELS = CURSOR_CELL_SIZE * CURSOR_CELL_SIZE * CURSOR_VARIANT_COUNT;
export const MAX_ANIMATED_PIXELS = Math.floor((MAX_TOTAL_SURFACE_PIXELS - CURSOR_ATLAS_PIXELS) / 2);
export const MAX_ANIMATED_DIMENSION = 4096;
export const TARGET_FPS = 30;
export const MAX_REPEATED_OBJECTS = 1;

export const HAND_LEAD_SECONDS = 0.15;
export const CLICK_PRESS_SECONDS = 0.15;
export const HIGHLIGHT_SECONDS = 0.7;
export const POST_CLICK_HOLD_SECONDS = 0.4;
export const FADE_OUT_SECONDS = 0.3;

export const DEFAULTS = Object.freeze({
    startDelay: 0.4,
    movementDuration: 1.2,
    highlightColor: '#38bdf8',
    highlightSize: 96,
    highlightDuration: HIGHLIGHT_SECONDS,
    disappearAfterClick: true,
    startPosition: Object.freeze({ x: 0.14, y: 0.82 }),
    clickPosition: Object.freeze({ x: 0.68, y: 0.48 }),
    imgSrc: ''
});

export const schema = {
    startDelay: { type: 'number', min: 0, max: 5, step: 0.1, default: DEFAULTS.startDelay, label: 'Delay before movement (s)' },
    movementDuration: { type: 'number', min: 0.4, max: 4, step: 0.1, default: DEFAULTS.movementDuration, label: 'Movement duration (s)' },
    highlightColor: { type: 'color', default: DEFAULTS.highlightColor, label: 'Highlight color' },
    highlightSize: { type: 'number', min: 40, max: 240, step: 4, default: DEFAULTS.highlightSize, label: 'Highlight size (px)' },
    highlightDuration: { type: 'number', min: 0.2, max: 3, step: 0.1, default: DEFAULTS.highlightDuration, label: 'Highlight duration (s)' },
    disappearAfterClick: { type: 'boolean', default: DEFAULTS.disappearAfterClick, label: 'Disappear after click' },
    startPosition: { type: 'point', default: DEFAULTS.startPosition, label: 'Cursor starting position' },
    clickPosition: { type: 'point', default: DEFAULTS.clickPosition, label: 'Click position' },
    imgSrc: { type: 'string', hidden: true, default: DEFAULTS.imgSrc },
    layerPlacement: { type: 'string', hidden: true, default: 'background' }
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback) {
    if (value === null || value === '' || typeof value === 'boolean') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizePoint(value, fallback) {
    const point = value && typeof value === 'object' ? value : {};
    return {
        x: clamp(safeNumber(point.x, fallback.x), 0.01, 0.99),
        y: clamp(safeNumber(point.y, fallback.y), 0.01, 0.99)
    };
}

function normalizeColor(value) {
    const color = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULTS.highlightColor;
}

export function normalizeConfig(config) {
    const input = config && typeof config === 'object' ? config : {};
    return {
        startDelay: clamp(safeNumber(input.startDelay, DEFAULTS.startDelay), 0, 5),
        movementDuration: clamp(safeNumber(input.movementDuration, DEFAULTS.movementDuration), 0.4, 4),
        highlightColor: normalizeColor(input.highlightColor),
        highlightSize: Math.round(clamp(safeNumber(input.highlightSize, DEFAULTS.highlightSize), 40, 240)),
        highlightDuration: clamp(safeNumber(input.highlightDuration, DEFAULTS.highlightDuration), 0.2, 3),
        disappearAfterClick: typeof input.disappearAfterClick === 'boolean'
            ? input.disappearAfterClick
            : DEFAULTS.disappearAfterClick,
        startPosition: normalizePoint(input.startPosition, DEFAULTS.startPosition),
        clickPosition: normalizePoint(input.clickPosition, DEFAULTS.clickPosition),
        imgSrc: typeof input.imgSrc === 'string' ? input.imgSrc.trim() : DEFAULTS.imgSrc,
        layerPlacement: input.layerPlacement === 'foreground' ? 'foreground' : 'background',
        preloadedImages: input.preloadedImages && typeof input.preloadedImages.get === 'function' ? input.preloadedImages : new Map(),
        onResize: typeof input.onResize === 'function' ? input.onResize : null
    };
}

export function calculateCappedSize(sourceWidth, sourceHeight) {
    const width = Math.max(1, Math.floor(safeNumber(sourceWidth, 1920)));
    const height = Math.max(1, Math.floor(safeNumber(sourceHeight, 1080)));
    const pixelScale = Math.sqrt(MAX_ANIMATED_PIXELS / (width * height));
    const scale = Math.min(
        1,
        pixelScale,
        MAX_ANIMATED_DIMENSION / width,
        MAX_ANIMATED_DIMENSION / height
    );
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale))
    };
}

function easeInOutCubic(value) {
    return value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutCubic(value) {
    const inverse = 1 - value;
    return 1 - inverse * inverse * inverse;
}

function createCursorAtlas() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const atlas = document.createElement('canvas');
    atlas.width = CURSOR_CELL_SIZE * CURSOR_VARIANT_COUNT;
    atlas.height = CURSOR_CELL_SIZE;
    const atlasContext = atlas.getContext('2d', { alpha: true });
    if (!atlasContext) return null;

    atlasContext.lineJoin = 'round';
    atlasContext.lineCap = 'round';
    atlasContext.fillStyle = '#ffffff';
    atlasContext.strokeStyle = '#111827';
    atlasContext.lineWidth = 8;

    atlasContext.beginPath();
    atlasContext.moveTo(24, 16);
    atlasContext.lineTo(24, 119);
    atlasContext.lineTo(50, 94);
    atlasContext.lineTo(68, 137);
    atlasContext.lineTo(91, 127);
    atlasContext.lineTo(72, 86);
    atlasContext.lineTo(111, 85);
    atlasContext.closePath();
    atlasContext.fill();
    atlasContext.stroke();

    atlasContext.save();
    atlasContext.translate(CURSOR_CELL_SIZE, 0);
    atlasContext.beginPath();
    atlasContext.moveTo(52, 72);
    atlasContext.lineTo(52, 24);
    atlasContext.bezierCurveTo(52, 15, 65, 15, 65, 24);
    atlasContext.lineTo(65, 61);
    atlasContext.lineTo(65, 48);
    atlasContext.bezierCurveTo(65, 39, 78, 39, 78, 48);
    atlasContext.lineTo(78, 61);
    atlasContext.lineTo(78, 52);
    atlasContext.bezierCurveTo(78, 43, 91, 43, 91, 52);
    atlasContext.lineTo(91, 65);
    atlasContext.lineTo(91, 58);
    atlasContext.bezierCurveTo(91, 49, 104, 49, 104, 58);
    atlasContext.lineTo(104, 89);
    atlasContext.bezierCurveTo(104, 119, 88, 140, 61, 140);
    atlasContext.bezierCurveTo(43, 140, 32, 130, 24, 116);
    atlasContext.lineTo(11, 92);
    atlasContext.bezierCurveTo(7, 84, 10, 75, 18, 72);
    atlasContext.bezierCurveTo(24, 69, 30, 72, 35, 78);
    atlasContext.lineTo(45, 91);
    atlasContext.lineTo(45, 72);
    atlasContext.closePath();
    atlasContext.fill();
    atlasContext.stroke();
    atlasContext.restore();
    return atlas;
}

export function mount(canvas, ctx, config) {
    let active = true;
    let cleaned = false;
    let cfg = normalizeConfig(config);
    let cursorAtlas = null;
    let cachedSurface = null;
    let image = null;
    let imageToken = 0;
    let loadedSource = '';
    let pendingSource = '';
    let frameId = null;
    let timerId = null;
    let delayStartedAt = 0;
    let remainingDelay = 0;
    let animationStarted = false;
    let animationCompleted = false;
    let startTimestamp = 0;
    let lastPaintTimestamp = 0;
    let pausedAt = 0;
    const frameInterval = 1000 / TARGET_FPS;
    const visibilityDocument = typeof document !== 'undefined' ? document : null;
    const reducedMotion = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function isHidden() {
        return !!(visibilityDocument && visibilityDocument.hidden);
    }

    function cancelScheduledWork() {
        if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
        }
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    function releasePendingImage() {
        imageToken += 1;
        if (image) {
            image.onload = null;
            image.onerror = null;
            image = null;
        }
        pendingSource = '';
    }

    function clearCanvas() {
        ctx.save();
        if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    function notifyResize() {
        if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
    }

    function prepareSurface(width, height) {
        const size = calculateCappedSize(width, height);
        canvas.width = size.width;
        canvas.height = size.height;
        cursorAtlas = createCursorAtlas();
        clearCanvas();
        notifyResize();
    }

    function drawCursor(variantIndex, x, y, size, alpha) {
        if (!cursorAtlas || alpha <= 0) return;
        const scale = size / CURSOR_CELL_SIZE;
        const hotspotX = variantIndex === 0 ? 24 : 52;
        const hotspotY = variantIndex === 0 ? 16 : 18;
        ctx.globalAlpha = alpha;
        ctx.drawImage(
            cursorAtlas,
            variantIndex * CURSOR_CELL_SIZE,
            0,
            CURSOR_CELL_SIZE,
            CURSOR_CELL_SIZE,
            x - hotspotX * scale,
            y - hotspotY * scale,
            size,
            size
        );
    }

    function renderFrame(elapsedSeconds, reducedStatic = false) {
        clearCanvas();
        if (cachedSurface && cfg.layerPlacement !== 'foreground') {
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(cachedSurface, 0, 0);
            ctx.restore();
        }

        const startX = cfg.startPosition.x * canvas.width;
        const startY = cfg.startPosition.y * canvas.height;
        const clickX = cfg.clickPosition.x * canvas.width;
        const clickY = cfg.clickPosition.y * canvas.height;
        const moveProgress = clamp(elapsedSeconds / cfg.movementDuration, 0, 1);
        const easedMove = easeInOutCubic(moveProgress);
        const cursorX = startX + (clickX - startX) * easedMove;
        const cursorY = startY + (clickY - startY) * easedMove;
        const handStart = Math.max(0, cfg.movementDuration - HAND_LEAD_SECONDS);
        const handBlend = clamp((elapsedSeconds - handStart) / Math.min(0.08, HAND_LEAD_SECONDS), 0, 1);
        const pressProgress = clamp((elapsedSeconds - cfg.movementDuration) / CLICK_PRESS_SECONDS, 0, 1);
        const isPressing = elapsedSeconds >= cfg.movementDuration
            && elapsedSeconds <= cfg.movementDuration + CLICK_PRESS_SECONDS;
        const pressScale = isPressing ? 1 - Math.sin(pressProgress * Math.PI) * 0.14 : 1;
        const fadeStart = cfg.movementDuration + CLICK_PRESS_SECONDS + POST_CLICK_HOLD_SECONDS;
        const cursorAlpha = cfg.disappearAfterClick
            ? 1 - clamp((elapsedSeconds - fadeStart) / FADE_OUT_SECONDS, 0, 1)
            : 1;
        const cursorSize = clamp(Math.min(canvas.width, canvas.height) * 0.092, 54, 94) * pressScale;
        const ringProgress = reducedStatic
            ? 0.58
            : clamp((elapsedSeconds - cfg.movementDuration) / cfg.highlightDuration, 0, 1);

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        if ((elapsedSeconds >= cfg.movementDuration && ringProgress < 1) || reducedStatic) {
            const designScale = Math.min(canvas.width / 1920, canvas.height / 1080);
            const finalRadius = cfg.highlightSize * Math.max(0.45, designScale) * 0.5;
            ctx.globalAlpha = reducedStatic ? 0.7 : 1 - ringProgress;
            ctx.strokeStyle = cfg.highlightColor;
            ctx.lineWidth = Math.max(3, 6 * Math.max(0.45, designScale));
            ctx.beginPath();
            ctx.arc(clickX, clickY, finalRadius * (0.24 + easeOutCubic(ringProgress) * 0.76), 0, Math.PI * 2);
            ctx.stroke();
        }

        if (cursorAlpha > 0) {
            drawCursor(0, cursorX, cursorY, cursorSize, cursorAlpha * (1 - handBlend));
            drawCursor(1, cursorX, cursorY, cursorSize, cursorAlpha * handBlend);
        }
        ctx.restore();
    }

    function cycleDuration() {
        const ringEnd = cfg.movementDuration + cfg.highlightDuration;
        const holdEnd = cfg.movementDuration + CLICK_PRESS_SECONDS + POST_CLICK_HOLD_SECONDS;
        return Math.max(ringEnd, holdEnd + (cfg.disappearAfterClick ? FADE_OUT_SECONDS : 0));
    }

    function scheduleFrame() {
        if (!active || frameId !== null || isHidden()) return;
        frameId = requestAnimationFrame(tick);
    }

    function tick(timestamp) {
        frameId = null;
        if (!active || isHidden()) return;
        if (!startTimestamp) startTimestamp = timestamp;
        const elapsedMs = Math.max(0, timestamp - startTimestamp);
        const elapsedSeconds = elapsedMs / 1000;
        const completed = elapsedSeconds >= cycleDuration();
        if (!lastPaintTimestamp || timestamp - lastPaintTimestamp >= frameInterval || completed) {
            renderFrame(completed ? cycleDuration() : elapsedSeconds);
            lastPaintTimestamp = timestamp;
        }
        if (!completed) scheduleFrame();
        else animationCompleted = true;
    }

    function startAnimation() {
        timerId = null;
        delayStartedAt = 0;
        remainingDelay = 0;
        if (!active || reducedMotion || isHidden()) return;
        animationStarted = true;
        animationCompleted = false;
        startTimestamp = 0;
        lastPaintTimestamp = 0;
        scheduleFrame();
    }

    function armDelay(delayMs) {
        remainingDelay = Math.max(0, delayMs);
        if (!active || reducedMotion || isHidden()) return;
        if (remainingDelay === 0) {
            startAnimation();
            return;
        }
        delayStartedAt = performance.now();
        timerId = setTimeout(startAnimation, remainingDelay);
    }

    function startCycle() {
        cancelScheduledWork();
        animationStarted = false;
        animationCompleted = false;
        startTimestamp = 0;
        lastPaintTimestamp = 0;
        pausedAt = 0;
        if (reducedMotion) {
            renderFrame(cfg.movementDuration + cfg.highlightDuration * 0.58, true);
            animationCompleted = true;
            return;
        }
        renderFrame(0);
        armDelay(cfg.startDelay * 1000);
    }

    function rasterizeLoadedImage(loadedImage, token) {
        if (!active || token !== imageToken) return;
        const sourceWidth = loadedImage.naturalWidth || loadedImage.width;
        const sourceHeight = loadedImage.naturalHeight || loadedImage.height;
        if (!sourceWidth || !sourceHeight) {
            cachedSurface = null;
            prepareSurface(1920, 1080);
            startCycle();
            return;
        }
        const size = calculateCappedSize(sourceWidth, sourceHeight);
        const surface = document.createElement('canvas');
        surface.width = size.width;
        surface.height = size.height;
        const surfaceContext = surface.getContext('2d', { alpha: true });
        if (!surfaceContext) {
            cachedSurface = null;
            prepareSurface(sourceWidth, sourceHeight);
            startCycle();
            return;
        }
        surfaceContext.drawImage(loadedImage, 0, 0, size.width, size.height);
        cachedSurface = surface;
        canvas.width = size.width;
        canvas.height = size.height;
        loadedSource = cfg.imgSrc;
        pendingSource = '';
        loadedImage.onload = null;
        loadedImage.onerror = null;
        image = null;
        clearCanvas();
        notifyResize();
        startCycle();
    }

    function loadConfiguredImage() {
        cancelScheduledWork();
        releasePendingImage();
        cachedSurface = null;
        loadedSource = '';
        const currentWidth = Math.max(0, Number(canvas.width) || 0);
        const currentHeight = Math.max(0, Number(canvas.height) || 0);
        const intentionalSize = currentWidth > 320 && currentHeight > 180;
        prepareSurface(intentionalSize ? currentWidth : 1920, intentionalSize ? currentHeight : 1080);
        if (cfg.layerPlacement === 'foreground' || !cfg.imgSrc || typeof Image !== 'function') {
            startCycle();
            return;
        }
        const token = imageToken;
        const imageResource = createEffectImage(cfg, cfg.imgSrc);
        if (imageResource.isPreloaded) {
            image = imageResource.image;
            pendingSource = cfg.imgSrc;
            rasterizeLoadedImage(imageResource.image, token);
            return;
        }
        image = imageResource.image;
        pendingSource = cfg.imgSrc;
        image.decoding = 'async';
        image.crossOrigin = 'Anonymous';
        image.onload = function onImageLoad() {
            rasterizeLoadedImage(this, token);
        };
        image.onerror = function onImageError() {
            if (!active || token !== imageToken) return;
            this.onload = null;
            this.onerror = null;
            image = null;
            pendingSource = '';
            cachedSurface = null;
            startCycle();
        };
        image.src = cfg.imgSrc;
    }

    function restart(nextConfig) {
        if (!active) return;
        const previousSource = cfg.imgSrc;
        const previousPlacement = cfg.layerPlacement;
        cfg = normalizeConfig({ ...cfg, ...(nextConfig || {}) });
        if (cfg.layerPlacement === 'foreground') {
            if (previousPlacement !== 'foreground' || image || cachedSurface) loadConfiguredImage();
            else startCycle();
            return;
        }
        if (image && cfg.imgSrc === pendingSource) return;
        if (previousPlacement !== cfg.layerPlacement || cfg.imgSrc !== previousSource || cfg.imgSrc !== loadedSource) {
            loadConfiguredImage();
            return;
        }
        startCycle();
    }

    function handleVisibilityChange() {
        if (!active || reducedMotion || animationCompleted) return;
        const now = performance.now();
        if (isHidden()) {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
                remainingDelay = Math.max(0, remainingDelay - (now - delayStartedAt));
                delayStartedAt = 0;
            }
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            pausedAt = now;
            return;
        }
        if (!animationStarted) {
            armDelay(remainingDelay);
            return;
        }
        if (pausedAt && startTimestamp) startTimestamp += now - pausedAt;
        pausedAt = 0;
        scheduleFrame();
    }

    if (visibilityDocument && typeof visibilityDocument.addEventListener === 'function') {
        visibilityDocument.addEventListener('visibilitychange', handleVisibilityChange);
    }
    loadConfiguredImage();

    function cleanup() {
        if (cleaned) return;
        cleaned = true;
        active = false;
        cancelScheduledWork();
        releasePendingImage();
        if (visibilityDocument && typeof visibilityDocument.removeEventListener === 'function') {
            visibilityDocument.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        cursorAtlas = null;
        cachedSurface = null;
        clearCanvas();
    }

    cleanup.restart = restart;
    return cleanup;
}
