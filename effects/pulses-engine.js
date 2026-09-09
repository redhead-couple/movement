import { createEffectImage } from './effect-media.js';

export const MAX_ANIMATED_PIXELS = 2073600;
export const MAX_ANIMATED_DIMENSION = 4096;
export const TARGET_FPS = 30;
export const MAX_REPEATED_OBJECTS = 0;

export const DEFAULTS = Object.freeze({
    imgSrc: '',
    startDelay: 0.4,
    duration: 6,
    pulseCount: 4,
    pulseSpeed: 70,
    spacing: 28,
    intensity: 8,
    brightnessBoost: 12,
    opacityBoost: 8
});

export const schema = Object.freeze({
    startDelay: Object.freeze({ min: 0, max: 5, step: 0.1, default: DEFAULTS.startDelay, label: 'Start time (s)' }),
    duration: Object.freeze({ min: 1, max: 20, step: 0.1, default: DEFAULTS.duration, label: 'Duration (s)' }),
    pulseCount: Object.freeze({ min: 1, max: 12, step: 1, default: DEFAULTS.pulseCount, label: 'Number of pulses' }),
    pulseSpeed: Object.freeze({ min: 20, max: 100, step: 1, default: DEFAULTS.pulseSpeed, label: 'Pulse speed (%)' }),
    spacing: Object.freeze({ min: 0, max: 70, step: 1, default: DEFAULTS.spacing, label: 'Spacing between pulses (%)' }),
    intensity: Object.freeze({ min: 0, max: 25, step: 1, default: DEFAULTS.intensity, label: 'Visual intensity (%)' }),
    brightnessBoost: Object.freeze({ min: 0, max: 40, step: 1, default: DEFAULTS.brightnessBoost, label: 'Brightness boost (%)' }),
    opacityBoost: Object.freeze({ min: 0, max: 30, step: 1, default: DEFAULTS.opacityBoost, label: 'Opacity boost (%)' })
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback) {
    if (value === null || value === '' || typeof value === 'boolean') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function normalizeConfig(config) {
    const input = config && typeof config === 'object' ? config : {};
    return {
        imgSrc: typeof input.imgSrc === 'string' ? input.imgSrc.trim() : DEFAULTS.imgSrc,
        startDelay: clamp(safeNumber(input.startDelay, DEFAULTS.startDelay), 0, 5),
        duration: clamp(safeNumber(input.duration, DEFAULTS.duration), 1, 20),
        pulseCount: Math.round(clamp(safeNumber(input.pulseCount, DEFAULTS.pulseCount), 1, 12)),
        pulseSpeed: clamp(safeNumber(input.pulseSpeed, DEFAULTS.pulseSpeed), 20, 100),
        spacing: clamp(safeNumber(input.spacing, DEFAULTS.spacing), 0, 70),
        intensity: clamp(safeNumber(input.intensity, DEFAULTS.intensity), 0, 25),
        brightnessBoost: clamp(safeNumber(input.brightnessBoost, DEFAULTS.brightnessBoost), 0, 40),
        opacityBoost: clamp(safeNumber(input.opacityBoost, DEFAULTS.opacityBoost), 0, 30),
        preloadedImages: input.preloadedImages && typeof input.preloadedImages.get === 'function' ? input.preloadedImages : new Map(),
        onResize: typeof input.onResize === 'function' ? input.onResize : null
    };
}

export function calculateCappedSize(sourceWidth, sourceHeight) {
    const width = Math.max(1, Math.floor(safeNumber(sourceWidth, 1920)));
    const height = Math.max(1, Math.floor(safeNumber(sourceHeight, 1080)));
    const scale = Math.min(
        1,
        Math.sqrt(MAX_ANIMATED_PIXELS / (width * height)),
        MAX_ANIMATED_DIMENSION / width,
        MAX_ANIMATED_DIMENSION / height
    );
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale))
    };
}

function smoothstep(value) {
    return value * value * (3 - 2 * value);
}

function pulseEnvelopeForConfig(progress, cfg) {
    if (progress <= 0 || progress >= 1) return 0;
    const pulsePosition = progress * cfg.pulseCount;
    const localProgress = pulsePosition - Math.floor(pulsePosition);
    const activePortion = 1 - (cfg.spacing / 100);
    if (localProgress >= activePortion) return 0;

    const beatProgress = localProgress / activePortion;
    const speedAmount = (cfg.pulseSpeed - 20) / 80;
    const peakAt = 0.44 - speedAmount * 0.26;
    if (beatProgress <= peakAt) {
        return smoothstep(beatProgress / peakAt);
    }
    return 1 - smoothstep((beatProgress - peakAt) / (1 - peakAt));
}

export function calculatePulseEnvelope(progress, config) {
    return pulseEnvelopeForConfig(clamp(safeNumber(progress, 0), 0, 1), normalizeConfig(config));
}

export function mount(canvas, ctx, config) {
    let active = true;
    let cleaned = false;
    let cfg = normalizeConfig(config);
    let image = null;
    let imageToken = 0;
    let pendingSource = '';
    let loadedSource = '';
    let cachedSurface = null;
    let frameId = null;
    let timerId = null;
    let remainingDelay = 0;
    let delayStartedAt = 0;
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
        if (!image) return;
        image.onload = null;
        image.onerror = null;
        image = null;
    }

    function clearCanvas() {
        ctx.save();
        if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    function notifyResize() {
        if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
    }

    function renderFrame(progress) {
        clearCanvas();
        if (!cachedSurface) return;

        const envelope = pulseEnvelopeForConfig(progress, cfg);
        const scale = 1 + (cfg.intensity / 100) * envelope;
        const drawWidth = canvas.width * scale;
        const drawHeight = canvas.height * scale;
        const drawX = (canvas.width - drawWidth) * 0.5;
        const drawY = (canvas.height - drawHeight) * 0.5;
        const brightness = 1 + (cfg.brightnessBoost / 100) * envelope;
        const opacityEcho = (cfg.opacityBoost / 100) * envelope;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = brightness === 1 ? 'none' : `brightness(${brightness})`;
        ctx.drawImage(cachedSurface, drawX, drawY, drawWidth, drawHeight);

        if (opacityEcho > 0) {
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = opacityEcho;
            ctx.drawImage(cachedSurface, drawX, drawY, drawWidth, drawHeight);
        }
        ctx.restore();
    }

    function scheduleFrame() {
        if (!active || frameId !== null || isHidden() || !cachedSurface) return;
        frameId = requestAnimationFrame(tick);
    }

    function scheduleRest(restMs) {
        if (!active || timerId !== null || isHidden() || !cachedSurface) return;
        timerId = setTimeout(() => {
            timerId = null;
            scheduleFrame();
        }, Math.max(0, restMs));
    }

    function tick(timestamp) {
        frameId = null;
        if (!active || isHidden() || !cachedSurface) return;
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = clamp((timestamp - startTimestamp) / (cfg.duration * 1000), 0, 1);

        if (progress < 1) {
            const pulsePosition = progress * cfg.pulseCount;
            const localProgress = pulsePosition - Math.floor(pulsePosition);
            const activePortion = 1 - (cfg.spacing / 100);
            if (localProgress >= activePortion) {
                renderFrame(progress);
                lastPaintTimestamp = timestamp;
                const intervalMs = (cfg.duration * 1000) / cfg.pulseCount;
                scheduleRest((1 - localProgress) * intervalMs);
                return;
            }
        }

        if (!lastPaintTimestamp || timestamp - lastPaintTimestamp >= frameInterval || progress >= 1) {
            renderFrame(progress);
            lastPaintTimestamp = timestamp;
        }

        if (progress < 1) scheduleFrame();
        else animationCompleted = true;
    }

    function startAnimation() {
        timerId = null;
        delayStartedAt = 0;
        remainingDelay = 0;
        if (!active || reducedMotion || isHidden() || !cachedSurface) return;
        animationStarted = true;
        animationCompleted = false;
        startTimestamp = 0;
        lastPaintTimestamp = 0;
        scheduleFrame();
    }

    function armDelay(delayMs) {
        remainingDelay = Math.max(0, delayMs);
        if (!active || reducedMotion || isHidden() || !cachedSurface) return;
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
        renderFrame(0);
        if (!cachedSurface || reducedMotion) {
            animationCompleted = true;
            return;
        }
        armDelay(cfg.startDelay * 1000);
    }

    function rasterizeLoadedImage(loadedImage, token) {
        if (!active || token !== imageToken) return;
        const sourceWidth = loadedImage.naturalWidth || loadedImage.width;
        const sourceHeight = loadedImage.naturalHeight || loadedImage.height;
        if (!sourceWidth || !sourceHeight) {
            cachedSurface = null;
            clearCanvas();
            return;
        }

        const size = calculateCappedSize(sourceWidth, sourceHeight);
        const surface = document.createElement('canvas');
        surface.width = size.width;
        surface.height = size.height;
        const surfaceContext = surface.getContext('2d', { alpha: true });
        if (!surfaceContext) {
            cachedSurface = null;
            clearCanvas();
            return;
        }
        surfaceContext.drawImage(loadedImage, 0, 0, size.width, size.height);

        cachedSurface = surface;
        loadedSource = cfg.imgSrc;
        pendingSource = '';
        loadedImage.onload = null;
        loadedImage.onerror = null;
        image = null;
        canvas.width = size.width;
        canvas.height = size.height;
        notifyResize();
        startCycle();
    }

    function loadConfiguredImage() {
        cancelScheduledWork();
        releasePendingImage();
        cachedSurface = null;
        pendingSource = '';
        loadedSource = '';
        clearCanvas();

        if (!cfg.imgSrc || typeof Image !== 'function') {
            notifyResize();
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
            clearCanvas();
        };
        image.src = cfg.imgSrc;
    }

    function restart(nextConfig) {
        if (!active) return;
        const previousSource = cfg.imgSrc;
        cfg = normalizeConfig({ ...cfg, ...(nextConfig || {}) });
        if (image && cfg.imgSrc === pendingSource) return;
        if (cfg.imgSrc !== previousSource || cfg.imgSrc !== loadedSource || !cachedSurface) {
            loadConfiguredImage();
            return;
        }
        startCycle();
    }

    function handleVisibilityChange() {
        if (!active || reducedMotion || animationCompleted || !cachedSurface) return;
        const now = performance.now();
        if (isHidden()) {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
                if (!animationStarted) {
                    remainingDelay = Math.max(0, remainingDelay - (now - delayStartedAt));
                    delayStartedAt = 0;
                }
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
        cachedSurface = null;
        clearCanvas();
    }

    cleanup.restart = restart;
    cleanup.inspect = function inspect() {
        return {
            active,
            frameScheduled: frameId !== null,
            timerScheduled: timerId !== null,
            surfacePixels: canvas.width * canvas.height,
            hasCachedSurface: !!cachedSurface
        };
    };
    return cleanup;
}
