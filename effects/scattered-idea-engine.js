import { createEffectImage } from './effect-media.js';

export const MAX_ANIMATED_PIXELS = 2073600;
export const MAX_ANIMATED_DIMENSION = 4096;
export const TARGET_FPS = 30;
export const MAX_FRAGMENT_COUNT = 120;

export const DEFAULTS = Object.freeze({
    imgSrc: '',
    count: 63,
    spread: 100,
    duration: 3.2,
    randomness: 60,
    startDelay: 0.8
});

export const schema = {
    imgSrc: { type: 'string', hidden: true, default: DEFAULTS.imgSrc },
    count: { type: 'number', min: 12, max: MAX_FRAGMENT_COUNT, step: 1, default: DEFAULTS.count, label: 'Amount' },
    spread: { type: 'number', min: 40, max: 180, step: 5, default: DEFAULTS.spread, label: 'Spread (%)' },
    duration: { type: 'number', min: 1, max: 8, step: 0.1, default: DEFAULTS.duration, label: 'Duration (s)' },
    randomness: { type: 'number', min: 0, max: 100, step: 5, default: DEFAULTS.randomness, label: 'Randomness (%)' },
    startDelay: { type: 'number', min: 0, max: 5, step: 0.1, default: DEFAULTS.startDelay, label: 'Start time (s)' }
};

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
        count: Math.round(clamp(safeNumber(input.count, DEFAULTS.count), 12, MAX_FRAGMENT_COUNT)),
        spread: clamp(safeNumber(input.spread, DEFAULTS.spread), 40, 180),
        duration: clamp(safeNumber(input.duration, DEFAULTS.duration), 1, 8),
        randomness: clamp(safeNumber(input.randomness, DEFAULTS.randomness), 0, 100),
        startDelay: clamp(safeNumber(input.startDelay, DEFAULTS.startDelay), 0, 5),
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

function createRandom(seed) {
    let state = (Math.floor(safeNumber(seed, 1)) >>> 0) || 1;
    return function random() {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function buildFragmentPlan(width, height, config, seed) {
    const cfg = normalizeConfig(config);
    const fragments = new Array(cfg.count);
    const random = createRandom(seed);
    const aspect = width / Math.max(1, height);
    const rows = clamp(Math.round(Math.sqrt(cfg.count / Math.max(0.25, aspect))), 1, cfg.count);
    const basePerRow = Math.floor(cfg.count / rows);
    const extraRows = cfg.count % rows;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const diagonal = Math.sqrt(width * width + height * height);
    const randomness = cfg.randomness / 100;
    const travelDistance = diagonal * (0.45 + (cfg.spread / 100) * 0.75);
    let index = 0;

    for (let row = 0; row < rows; row += 1) {
        const segments = basePerRow + (row < extraRows ? 1 : 0);
        const sy = Math.floor((row * height) / rows);
        const bottom = Math.floor(((row + 1) * height) / rows);
        const fragmentHeight = Math.max(1, bottom - sy);

        for (let column = 0; column < segments; column += 1) {
            const sx = Math.floor((column * width) / segments);
            const right = Math.floor(((column + 1) * width) / segments);
            const fragmentWidth = Math.max(1, right - sx);
            const originX = sx + fragmentWidth * 0.5;
            const originY = sy + fragmentHeight * 0.5;
            const fromCenterX = originX - centerX;
            const fromCenterY = originY - centerY;
            const fallbackAngle = random() * Math.PI * 2;
            const radialAngle = (fromCenterX === 0 && fromCenterY === 0)
                ? fallbackAngle
                : Math.atan2(fromCenterY, fromCenterX);
            const angle = radialAngle + (random() - 0.5) * 0.8 * randomness;
            const speed = 1 + (random() - 0.5) * 0.42 * randomness;
            const distance = travelDistance * (0.88 + random() * 0.24 * randomness);

            fragments[index] = {
                sx,
                sy,
                width: fragmentWidth,
                height: fragmentHeight,
                originX,
                originY,
                travelX: Math.cos(angle) * distance,
                travelY: Math.sin(angle) * distance,
                rotation: (random() - 0.5) * 0.46 * randomness,
                speed,
                stagger: random() * 0.12 * randomness
            };
            index += 1;
        }
    }

    return fragments;
}

function smoothstep(value) {
    return value * value * (3 - 2 * value);
}

export function mount(canvas, ctx, config) {
    let active = true;
    let cleaned = false;
    let cfg = normalizeConfig(config);
    let image = null;
    let imageToken = 0;
    let cachedSurface = null;
    let fragments = [];
    let frameId = null;
    let timerId = null;
    let delayStartedAt = 0;
    let remainingDelay = 0;
    let animationStarted = false;
    let animationCompleted = false;
    let startTimestamp = 0;
    let lastPaintTimestamp = 0;
    let pausedAt = 0;
    let loadedSource = '';
    let pendingSource = '';
    let cycleSeed = 1;
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

    function setEmptySurface() {
        const size = calculateCappedSize(1920, 1080);
        canvas.width = size.width;
        canvas.height = size.height;
        clearCanvas();
        notifyResize();
    }

    function drawIntact() {
        clearCanvas();
        if (!cachedSurface) return;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(cachedSurface, 0, 0);
        ctx.restore();
    }

    function renderFragments(progress) {
        clearCanvas();
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        for (let index = 0; index < fragments.length; index += 1) {
            const fragment = fragments[index];
            const available = 1 - fragment.stagger;
            const rawProgress = ((progress - fragment.stagger) / available) * fragment.speed;
            const localProgress = clamp(rawProgress, 0, 1);
            const motion = localProgress * localProgress;
            const fadeProgress = clamp((localProgress - 0.32) / 0.68, 0, 1);
            const alpha = 1 - smoothstep(fadeProgress);
            if (alpha <= 0) continue;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(
                fragment.originX + fragment.travelX * motion,
                fragment.originY + fragment.travelY * motion
            );
            ctx.rotate(fragment.rotation * motion);
            ctx.drawImage(
                cachedSurface,
                fragment.sx,
                fragment.sy,
                fragment.width,
                fragment.height,
                -fragment.width * 0.5,
                -fragment.height * 0.5,
                fragment.width,
                fragment.height
            );
            ctx.restore();
        }

        ctx.restore();
    }

    function scheduleFrame() {
        if (!active || frameId !== null || isHidden()) return;
        frameId = requestAnimationFrame(tick);
    }

    function tick(timestamp) {
        frameId = null;
        if (!active || !cachedSurface || isHidden()) return;
        if (!startTimestamp) startTimestamp = timestamp;

        const elapsed = Math.max(0, timestamp - startTimestamp);
        const progress = clamp(elapsed / (cfg.duration * 1000), 0, 1);
        if (!lastPaintTimestamp || timestamp - lastPaintTimestamp >= frameInterval || progress >= 1) {
            renderFragments(progress);
            lastPaintTimestamp = timestamp;
        }

        if (progress < 1) scheduleFrame();
        else animationCompleted = true;
    }

    function startAnimation() {
        timerId = null;
        delayStartedAt = 0;
        remainingDelay = 0;
        if (!active || !cachedSurface || reducedMotion) return;
        animationStarted = true;
        animationCompleted = false;
        startTimestamp = 0;
        lastPaintTimestamp = 0;
        scheduleFrame();
    }

    function armDelay(delayMs) {
        remainingDelay = Math.max(0, delayMs);
        if (!active || !cachedSurface || reducedMotion || isHidden()) return;
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
        cycleSeed = Math.floor(Math.random() * 4294967295) || 1;
        fragments = buildFragmentPlan(canvas.width, canvas.height, cfg, cycleSeed);
        drawIntact();
        if (!reducedMotion) armDelay(cfg.startDelay * 1000);
    }

    function rasterizeLoadedImage(loadedImage, token) {
        if (!active || token !== imageToken) return;
        const sourceWidth = loadedImage.naturalWidth || loadedImage.width;
        const sourceHeight = loadedImage.naturalHeight || loadedImage.height;
        if (!sourceWidth || !sourceHeight) {
            setEmptySurface();
            return;
        }

        const size = calculateCappedSize(sourceWidth, sourceHeight);
        const surface = document.createElement('canvas');
        surface.width = size.width;
        surface.height = size.height;
        const surfaceContext = surface.getContext('2d', { alpha: true });
        if (!surfaceContext) {
            setEmptySurface();
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
        notifyResize();
        startCycle();
    }

    function loadConfiguredImage() {
        cancelScheduledWork();
        releasePendingImage();
        cachedSurface = null;
        fragments = [];
        loadedSource = '';
        pendingSource = '';
        clearCanvas();

        if (!cfg.imgSrc || typeof Image !== 'function') {
            setEmptySurface();
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
            setEmptySurface();
        };
        image.src = cfg.imgSrc;
    }

    function restart(nextConfig) {
        if (!active) return;
        const previousSource = cfg.imgSrc;
        cfg = normalizeConfig({ ...cfg, ...(nextConfig || {}) });
        if (image && cfg.imgSrc === pendingSource) return;
        if (!cachedSurface || cfg.imgSrc !== previousSource || cfg.imgSrc !== loadedSource) {
            loadConfiguredImage();
            return;
        }
        startCycle();
    }

    function handleVisibilityChange() {
        if (!active || !cachedSurface || reducedMotion || animationCompleted) return;
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
        fragments = [];
        cachedSurface = null;
        clearCanvas();
    }

    cleanup.restart = restart;
    return cleanup;
}
