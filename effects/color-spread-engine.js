import { createEffectImage } from './effect-media.js';

export const MAX_TOTAL_SURFACE_PIXELS = 2073600;
export const MASK_SURFACE_PIXELS = 32768;
export const FULL_SURFACE_COUNT = 4;
export const MAX_ANIMATED_PIXELS = Math.floor(
    (MAX_TOTAL_SURFACE_PIXELS - MASK_SURFACE_PIXELS) / FULL_SURFACE_COUNT
);
export const MAX_ANIMATED_DIMENSION = 4096;
export const TARGET_FPS = 30;
export const MAX_REPEATED_OBJECTS = 0;

export const DEFAULTS = Object.freeze({
    imgSrc: '',
    startDelay: 0.5,
    duration: 5,
    spreadSpeed: 1,
    softness: 26,
    targetColor: '#f97316',
    intensity: 68,
    saturationIncrease: 38,
    brightnessShift: 6,
    origin: Object.freeze({ mode: 'center', x: 0.5, y: 0.5 })
});

export const schema = {
    startDelay: { type: 'number', min: 0, max: 8, step: 0.1, default: DEFAULTS.startDelay, label: 'Start time (s)' },
    duration: { type: 'number', min: 1, max: 15, step: 0.1, default: DEFAULTS.duration, label: 'Duration (s)' },
    spreadSpeed: { type: 'number', min: 0.5, max: 2.5, step: 0.1, default: DEFAULTS.spreadSpeed, label: 'Spread speed' },
    softness: { type: 'number', min: 5, max: 60, step: 1, default: DEFAULTS.softness, label: 'Edge softness (%)' },
    targetColor: { type: 'color', default: DEFAULTS.targetColor, label: 'Target color' },
    intensity: { type: 'number', min: 0, max: 100, step: 1, default: DEFAULTS.intensity, label: 'Color intensity (%)' },
    saturationIncrease: { type: 'number', min: 0, max: 100, step: 1, default: DEFAULTS.saturationIncrease, label: 'Saturation increase (%)' },
    brightnessShift: { type: 'number', min: -30, max: 30, step: 1, default: DEFAULTS.brightnessShift, label: 'Brightness shift (%)' },
    origin: { type: 'origin', default: DEFAULTS.origin, label: 'Spread from' },
    imgSrc: { type: 'string', hidden: true, default: DEFAULTS.imgSrc }
};

const ORIGIN_MODES = Object.freeze(['center', 'custom', 'left', 'right', 'top', 'bottom']);
const NEUTRAL_FILTER = 'grayscale(82%) saturate(42%) brightness(96%)';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback) {
    if (value === null || value === '' || typeof value === 'boolean') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeColor(value) {
    const color = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULTS.targetColor;
}

export function normalizeConfig(config) {
    const input = config && typeof config === 'object' ? config : {};
    const inputOrigin = input.origin && typeof input.origin === 'object' ? input.origin : {};
    const requestedMode = String(inputOrigin.mode || input.originMode || DEFAULTS.origin.mode).toLowerCase();
    const mode = ORIGIN_MODES.includes(requestedMode) ? requestedMode : DEFAULTS.origin.mode;

    return {
        imgSrc: typeof input.imgSrc === 'string' ? input.imgSrc.trim() : DEFAULTS.imgSrc,
        startDelay: clamp(safeNumber(input.startDelay, DEFAULTS.startDelay), 0, 8),
        duration: clamp(safeNumber(input.duration, DEFAULTS.duration), 1, 15),
        spreadSpeed: clamp(safeNumber(input.spreadSpeed, DEFAULTS.spreadSpeed), 0.5, 2.5),
        softness: clamp(safeNumber(input.softness, DEFAULTS.softness), 5, 60),
        targetColor: normalizeColor(input.targetColor),
        intensity: clamp(safeNumber(input.intensity, DEFAULTS.intensity), 0, 100),
        saturationIncrease: clamp(safeNumber(input.saturationIncrease, DEFAULTS.saturationIncrease), 0, 100),
        brightnessShift: clamp(safeNumber(input.brightnessShift, DEFAULTS.brightnessShift), -30, 30),
        origin: {
            mode,
            x: clamp(safeNumber(inputOrigin.x ?? input.originX, DEFAULTS.origin.x), 0, 1),
            y: clamp(safeNumber(inputOrigin.y ?? input.originY, DEFAULTS.origin.y), 0, 1)
        },
        preloadedImages: input.preloadedImages && typeof input.preloadedImages.get === 'function' ? input.preloadedImages : new Map(),
        onResize: typeof input.onResize === 'function' ? input.onResize : null
    };
}

function calculateSizeWithin(width, height, maxPixels) {
    const safeWidth = Math.max(1, Math.floor(safeNumber(width, 1920)));
    const safeHeight = Math.max(1, Math.floor(safeNumber(height, 1080)));
    const scale = Math.min(
        1,
        Math.sqrt(maxPixels / (safeWidth * safeHeight)),
        MAX_ANIMATED_DIMENSION / safeWidth,
        MAX_ANIMATED_DIMENSION / safeHeight
    );
    return {
        width: Math.max(1, Math.floor(safeWidth * scale)),
        height: Math.max(1, Math.floor(safeHeight * scale))
    };
}

export function calculateCappedSize(sourceWidth, sourceHeight) {
    return calculateSizeWithin(sourceWidth, sourceHeight, MAX_ANIMATED_PIXELS);
}

export function calculateMaskSize(width, height) {
    return calculateSizeWithin(width, height, MASK_SURFACE_PIXELS);
}

export function buildSpreadField(width, height, config) {
    const cfg = normalizeConfig(config);
    const safeWidth = Math.max(1, Math.floor(safeNumber(width, 1)));
    const safeHeight = Math.max(1, Math.floor(safeNumber(height, 1)));
    const field = new Float32Array(safeWidth * safeHeight);
    const originX = cfg.origin.mode === 'center' ? 0.5 : cfg.origin.x;
    const originY = cfg.origin.mode === 'center' ? 0.5 : cfg.origin.y;
    const maxRadialDistance = Math.max(
        Math.hypot(originX, originY),
        Math.hypot(1 - originX, originY),
        Math.hypot(originX, 1 - originY),
        Math.hypot(1 - originX, 1 - originY),
        0.0001
    );
    const widthScale = Math.max(1, safeWidth - 1);
    const heightScale = Math.max(1, safeHeight - 1);
    let offset = 0;

    for (let y = 0; y < safeHeight; y += 1) {
        const ny = y / heightScale;
        for (let x = 0; x < safeWidth; x += 1) {
            const nx = x / widthScale;
            let distance;
            if (cfg.origin.mode === 'left') distance = nx;
            else if (cfg.origin.mode === 'right') distance = 1 - nx;
            else if (cfg.origin.mode === 'top') distance = ny;
            else if (cfg.origin.mode === 'bottom') distance = 1 - ny;
            else distance = Math.hypot(nx - originX, ny - originY) / maxRadialDistance;

            const wave = (
                Math.sin(nx * 17.3 + ny * 8.1) * 0.5
                + Math.sin(nx * 6.2 - ny * 14.7 + 1.7) * 0.3
                + Math.sin((nx + ny) * 31.1 + 0.6) * 0.2
            );
            const edgeWeight = distance < 0.035 ? distance / 0.035 : 1;
            field[offset] = clamp(
                distance + wave * 0.045 * (0.35 + distance * 0.65) * edgeWeight,
                0,
                1
            );
            offset += 1;
        }
    }
    return field;
}

function resetContext(context) {
    if (typeof context.setTransform === 'function') context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
}

function clearContext(context, width, height) {
    context.save();
    resetContext(context);
    context.clearRect(0, 0, width, height);
    context.restore();
}

function fillFallbackScene(context, width, height, colored, cfg) {
    context.save();
    resetContext(context);
    const gradient = typeof context.createLinearGradient === 'function'
        ? context.createLinearGradient(0, 0, width, height)
        : null;
    if (gradient) {
        gradient.addColorStop(0, colored ? '#173150' : '#343a42');
        gradient.addColorStop(0.52, colored ? '#6b3b48' : '#5a5558');
        gradient.addColorStop(1, colored ? '#d18b56' : '#8a8177');
        context.fillStyle = gradient;
    } else {
        context.fillStyle = colored ? '#6b3b48' : '#55585d';
    }
    context.fillRect(0, 0, width, height);

    context.globalAlpha = colored ? 0.7 : 0.28;
    context.fillStyle = colored ? '#ffe3b3' : '#d7d2ca';
    if (typeof context.beginPath === 'function' && typeof context.arc === 'function') {
        context.beginPath();
        context.arc(width * 0.72, height * 0.28, Math.min(width, height) * 0.16, 0, Math.PI * 2);
        context.fill();
    }

    context.globalAlpha = 0.72;
    context.fillStyle = colored ? '#102f38' : '#30363a';
    context.fillRect(0, height * 0.7, width, height * 0.3);
    context.globalAlpha = 1;

    if (colored) {
        context.globalCompositeOperation = 'color';
        context.globalAlpha = cfg.intensity / 100;
        context.fillStyle = cfg.targetColor;
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
        if (cfg.brightnessShift !== 0) {
            context.globalAlpha = Math.abs(cfg.brightnessShift) / 100;
            context.fillStyle = cfg.brightnessShift > 0 ? '#ffffff' : '#000000';
            context.fillRect(0, 0, width, height);
        }
    }
    context.restore();
}

export function mount(canvas, ctx, config) {
    let active = true;
    let cleaned = false;
    let cfg = normalizeConfig(config);
    let pendingImage = null;
    let imageToken = 0;
    let loadedSource = '';
    let pendingSource = '';
    let baseSurface = null;
    let targetSurface = null;
    let revealSurface = null;
    let maskSurface = null;
    let baseContext = null;
    let targetContext = null;
    let revealContext = null;
    let maskContext = null;
    let maskImageData = null;
    let previousMaskAlpha = null;
    let spreadField = null;
    let frameId = null;
    let timerId = null;
    let remainingDelay = 0;
    let delayStartedAt = 0;
    let animationStarted = false;
    let animationCompleted = false;
    let startTimestamp = 0;
    let lastPaintTimestamp = 0;
    let pausedAt = 0;
    let visualSignature = '';
    let fieldSignature = '';
    const frameInterval = 1000 / TARGET_FPS;
    const visibilityDocument = typeof document !== 'undefined' ? document : null;
    const reducedMotion = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function isHidden() {
        return !!(visibilityDocument && visibilityDocument.hidden);
    }

    function now() {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
    }

    function cancelScheduledWork() {
        if (frameId !== null) cancelAnimationFrame(frameId);
        if (timerId !== null) clearTimeout(timerId);
        frameId = null;
        timerId = null;
    }

    function releasePendingImage() {
        imageToken += 1;
        if (pendingImage) {
            pendingImage.onload = null;
            pendingImage.onerror = null;
        }
        pendingImage = null;
        pendingSource = '';
    }

    function createCanvasSurface(width, height) {
        const surface = document.createElement('canvas');
        surface.width = width;
        surface.height = height;
        return surface;
    }

    function makeImageData(context, width, height) {
        if (typeof context.createImageData === 'function') return context.createImageData(width, height);
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    }

    function allocateSurfaces(width, height) {
        const size = calculateCappedSize(width, height);
        const maskSize = calculateMaskSize(size.width, size.height);
        canvas.width = size.width;
        canvas.height = size.height;

        baseSurface = createCanvasSurface(size.width, size.height);
        targetSurface = createCanvasSurface(size.width, size.height);
        revealSurface = createCanvasSurface(size.width, size.height);
        maskSurface = createCanvasSurface(maskSize.width, maskSize.height);
        baseContext = baseSurface.getContext('2d', { alpha: true });
        targetContext = targetSurface.getContext('2d', { alpha: true });
        revealContext = revealSurface.getContext('2d', { alpha: true });
        maskContext = maskSurface.getContext('2d', { alpha: true });
        if (!baseContext || !targetContext || !revealContext || !maskContext) return false;

        maskImageData = makeImageData(maskContext, maskSize.width, maskSize.height);
        previousMaskAlpha = new Uint8Array(maskSize.width * maskSize.height);
        for (let index = 0; index < maskImageData.data.length; index += 4) {
            maskImageData.data[index] = 255;
            maskImageData.data[index + 1] = 255;
            maskImageData.data[index + 2] = 255;
            maskImageData.data[index + 3] = 0;
        }
        spreadField = buildSpreadField(maskSize.width, maskSize.height, cfg);
        fieldSignature = `${cfg.origin.mode}:${cfg.origin.x}:${cfg.origin.y}`;
        if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
        return true;
    }

    function rebuildTargetCache() {
        if (!baseContext || !targetContext) return;
        const width = canvas.width;
        const height = canvas.height;
        clearContext(targetContext, width, height);
        targetContext.save();
        resetContext(targetContext);
        targetContext.filter = `saturate(${100 + cfg.saturationIncrease}%) brightness(${100 + cfg.brightnessShift}%)`;
        targetContext.drawImage(baseSurface, 0, 0, width, height);
        targetContext.filter = 'none';
        targetContext.globalCompositeOperation = 'color';
        targetContext.globalAlpha = cfg.intensity / 100;
        targetContext.fillStyle = cfg.targetColor;
        targetContext.fillRect(0, 0, width, height);
        targetContext.globalCompositeOperation = 'destination-in';
        targetContext.globalAlpha = 1;
        targetContext.drawImage(baseSurface, 0, 0, width, height);
        targetContext.restore();
        visualSignature = `${cfg.targetColor}:${cfg.intensity}:${cfg.saturationIncrease}:${cfg.brightnessShift}`;
    }

    function drawImageCaches(source) {
        if (!baseContext || !targetContext) return;
        clearContext(baseContext, canvas.width, canvas.height);
        if (source) {
            baseContext.save();
            resetContext(baseContext);
            baseContext.drawImage(source, 0, 0, canvas.width, canvas.height);
            baseContext.restore();
        } else {
            fillFallbackScene(baseContext, canvas.width, canvas.height, false, cfg);
        }
        rebuildTargetCache();
    }

    function drawNeutralFrame() {
        if (!baseSurface) return;
        ctx.save();
        resetContext(ctx);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.filter = NEUTRAL_FILTER;
        ctx.drawImage(baseSurface, 0, 0);
        ctx.restore();
    }

    function rebuildFieldIfNeeded() {
        if (!maskSurface) return;
        const signature = `${cfg.origin.mode}:${cfg.origin.x}:${cfg.origin.y}`;
        if (spreadField && signature === fieldSignature) return;
        spreadField = buildSpreadField(maskSurface.width, maskSurface.height, cfg);
        fieldSignature = signature;
    }

    function renderMask(progress) {
        if (!maskContext || !maskImageData || !spreadField) return;
        const feather = 0.015 + (cfg.softness / 100) * 0.24;
        const front = progress * (1 + feather * 2) - feather;
        const range = feather * 2;
        const pixels = maskImageData.data;
        for (let index = 0, pixel = 3; index < spreadField.length; index += 1, pixel += 4) {
            const raw = clamp((front - spreadField[index] + feather) / range, 0, 1);
            const smooth = raw * raw * (3 - 2 * raw);
            const desiredAlpha = Math.round(smooth * 255);
            const previousAlpha = previousMaskAlpha[index];
            pixels[pixel] = desiredAlpha <= previousAlpha
                ? 0
                : Math.round(((desiredAlpha - previousAlpha) * 255) / (255 - previousAlpha));
            previousMaskAlpha[index] = desiredAlpha;
        }
        maskContext.putImageData(maskImageData, 0, 0);
    }

    function renderFrame(progress) {
        if (!active || !baseSurface || !targetSurface || !revealSurface || !maskSurface) return;
        renderMask(progress);
        clearContext(revealContext, revealSurface.width, revealSurface.height);
        revealContext.save();
        resetContext(revealContext);
        revealContext.drawImage(targetSurface, 0, 0);
        revealContext.globalCompositeOperation = 'destination-in';
        revealContext.imageSmoothingEnabled = true;
        revealContext.drawImage(maskSurface, 0, 0, revealSurface.width, revealSurface.height);
        revealContext.restore();

        ctx.save();
        resetContext(ctx);
        ctx.drawImage(revealSurface, 0, 0);
        ctx.restore();
    }

    function scheduleFrame() {
        if (!active || frameId !== null || isHidden()) return;
        frameId = requestAnimationFrame(tick);
    }

    function tick(timestamp) {
        frameId = null;
        if (!active || isHidden() || animationCompleted) return;
        if (!startTimestamp) startTimestamp = timestamp;
        const elapsed = Math.max(0, timestamp - startTimestamp);
        const timelineProgress = clamp(elapsed / (cfg.duration * 1000), 0, 1);
        const easedTimeline = timelineProgress * timelineProgress * (3 - 2 * timelineProgress);
        const spreadProgress = 1 - Math.pow(1 - easedTimeline, cfg.spreadSpeed);

        if (!lastPaintTimestamp || timestamp - lastPaintTimestamp >= frameInterval || timelineProgress >= 1) {
            renderFrame(timelineProgress >= 1 ? 1 : spreadProgress);
            lastPaintTimestamp = timestamp;
        }
        if (timelineProgress >= 1) animationCompleted = true;
        else scheduleFrame();
    }

    function beginAnimation() {
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
            beginAnimation();
            return;
        }
        delayStartedAt = now();
        timerId = setTimeout(beginAnimation, remainingDelay);
    }

    function startCycle() {
        cancelScheduledWork();
        animationStarted = false;
        animationCompleted = false;
        startTimestamp = 0;
        lastPaintTimestamp = 0;
        pausedAt = 0;
        rebuildFieldIfNeeded();
        previousMaskAlpha.fill(0);
        drawNeutralFrame();
        renderFrame(reducedMotion ? 1 : 0);
        if (reducedMotion) {
            animationCompleted = true;
            return;
        }
        armDelay(cfg.startDelay * 1000);
    }

    function prepareVisual(sourceWidth, sourceHeight, source) {
        if (!active) return;
        if (!allocateSurfaces(sourceWidth, sourceHeight)) {
            clearContext(ctx, canvas.width, canvas.height);
            return;
        }
        drawImageCaches(source);
        startCycle();
    }

    function useFallback(sourceKey) {
        loadedSource = sourceKey;
        const hasIntentionalSize = Number(canvas.width) > 320 && Number(canvas.height) > 180;
        prepareVisual(
            hasIntentionalSize ? canvas.width : 1280,
            hasIntentionalSize ? canvas.height : 720,
            null
        );
    }

    function loadConfiguredImage() {
        cancelScheduledWork();
        releasePendingImage();
        loadedSource = '';

        if (!cfg.imgSrc || typeof Image !== 'function') {
            useFallback(cfg.imgSrc);
            return;
        }

        const token = imageToken;
        const imageResource = createEffectImage(cfg, cfg.imgSrc);
        const image = imageResource.image;
        // The player already decoded this image. Changing crossOrigin would
        // restart its request and can clear its dimensions before we draw it.
        if (imageResource.isPreloaded) {
            loadedSource = cfg.imgSrc;
            prepareVisual(image.naturalWidth || image.width, image.naturalHeight || image.height, image);
            return;
        }
        pendingImage = image;
        pendingSource = cfg.imgSrc;
        image.decoding = 'async';
        image.crossOrigin = 'Anonymous';
        image.onload = function onImageLoad() {
            if (!active || token !== imageToken || this !== pendingImage) return;
            const width = this.naturalWidth || this.width;
            const height = this.naturalHeight || this.height;
            this.onload = null;
            this.onerror = null;
            pendingImage = null;
            pendingSource = '';
            if (!width || !height) {
                useFallback(cfg.imgSrc);
                return;
            }
            loadedSource = cfg.imgSrc;
            prepareVisual(width, height, this);
        };
        image.onerror = function onImageError() {
            if (!active || token !== imageToken || this !== pendingImage) return;
            this.onload = null;
            this.onerror = null;
            pendingImage = null;
            pendingSource = '';
            useFallback(cfg.imgSrc);
        };
        image.src = cfg.imgSrc;
    }

    function restart(nextConfig) {
        if (!active) return;
        const next = nextConfig && typeof nextConfig === 'object' ? nextConfig : {};
        const previousSource = cfg.imgSrc;
        const mergedOrigin = next.origin && typeof next.origin === 'object'
            ? { ...cfg.origin, ...next.origin }
            : cfg.origin;
        cfg = normalizeConfig({ ...cfg, ...next, origin: mergedOrigin });

        if (pendingImage && cfg.imgSrc === pendingSource) return;
        if (cfg.imgSrc !== previousSource || cfg.imgSrc !== loadedSource) {
            loadConfiguredImage();
            return;
        }

        const nextVisualSignature = `${cfg.targetColor}:${cfg.intensity}:${cfg.saturationIncrease}:${cfg.brightnessShift}`;
        if (nextVisualSignature !== visualSignature) rebuildTargetCache();
        startCycle();
    }

    function handleVisibilityChange() {
        if (!active || reducedMotion || animationCompleted) return;
        const timestamp = now();
        if (isHidden()) {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
                remainingDelay = Math.max(0, remainingDelay - (timestamp - delayStartedAt));
                delayStartedAt = 0;
            }
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            pausedAt = timestamp;
            return;
        }
        if (!animationStarted) {
            armDelay(remainingDelay);
            return;
        }
        if (pausedAt && startTimestamp) startTimestamp += timestamp - pausedAt;
        pausedAt = 0;
        scheduleFrame();
    }

    if (visibilityDocument && typeof visibilityDocument.addEventListener === 'function') {
        visibilityDocument.addEventListener('visibilitychange', handleVisibilityChange);
    }
    loadConfiguredImage();

    function diagnostics() {
        const framePixels = Math.max(0, Number(canvas.width) || 0) * Math.max(0, Number(canvas.height) || 0);
        const maskPixels = maskSurface ? maskSurface.width * maskSurface.height : 0;
        return {
            framePixels,
            maskPixels,
            fullSurfaceCount: FULL_SURFACE_COUNT,
            totalSurfacePixels: framePixels * FULL_SURFACE_COUNT + maskPixels,
            frameScheduled: frameId !== null,
            timerScheduled: timerId !== null,
            completed: animationCompleted
        };
    }

    function cleanup() {
        if (cleaned) return;
        cleaned = true;
        active = false;
        cancelScheduledWork();
        releasePendingImage();
        if (visibilityDocument && typeof visibilityDocument.removeEventListener === 'function') {
            visibilityDocument.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        spreadField = null;
        maskImageData = null;
        previousMaskAlpha = null;
        baseSurface = null;
        targetSurface = null;
        revealSurface = null;
        maskSurface = null;
        baseContext = null;
        targetContext = null;
        revealContext = null;
        maskContext = null;
        clearContext(ctx, canvas.width, canvas.height);
    }

    cleanup.restart = restart;
    cleanup.getDiagnostics = diagnostics;
    return cleanup;
}
