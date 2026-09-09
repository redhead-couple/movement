import { createEffectImage } from './effect-media.js';

export const MAX_TOTAL_SURFACE_PIXELS = 2073600;
export const SPRITE_CELL_SIZE = 128;
export const SPRITE_VARIANT_COUNT = 6;
export const SPRITE_ATLAS_PIXELS = SPRITE_CELL_SIZE * SPRITE_CELL_SIZE * SPRITE_VARIANT_COUNT;
export const MAX_ANIMATED_PIXELS = MAX_TOTAL_SURFACE_PIXELS - SPRITE_ATLAS_PIXELS;
export const MAX_ANIMATED_DIMENSION = 4096;
export const TARGET_FPS = 30;
export const MAX_ORB_COUNT = 96;

export const DEFAULTS = Object.freeze({
    startDelay: 0.5,
    duration: 3.6,
    randomness: 65,
    size: 32,
    count: 48,
    destination: Object.freeze({ x: 0.5, y: 0.5 }),
    imgSrc: ''
});

export const schema = {
    startDelay: { type: 'number', min: 0, max: 5, step: 0.1, default: DEFAULTS.startDelay, label: 'Start time (s)' },
    duration: { type: 'number', min: 1, max: 8, step: 0.1, default: DEFAULTS.duration, label: 'Duration (s)' },
    randomness: { type: 'number', min: 0, max: 100, step: 5, default: DEFAULTS.randomness, label: 'Randomness (%)' },
    size: { type: 'number', min: 12, max: 72, step: 1, default: DEFAULTS.size, label: 'Size (px)' },
    count: { type: 'number', min: 8, max: MAX_ORB_COUNT, step: 1, default: DEFAULTS.count, label: 'Amount' },
    destination: { type: 'point', default: DEFAULTS.destination, label: 'Point of destination' },
    imgSrc: { type: 'string', hidden: true, default: DEFAULTS.imgSrc }
};

const ORB_COLORS = Object.freeze([
    Object.freeze(['#fff0e8', '#ff6b4a', '#58141e']),
    Object.freeze(['#fff5b8', '#e5a823', '#5c310c']),
    Object.freeze(['#d8faff', '#38bdf8', '#0c3a58']),
    Object.freeze(['#f3d8ff', '#a855f7', '#381258']),
    Object.freeze(['#ffd8ea', '#ec4899', '#581236']),
    Object.freeze(['#d8ffd8', '#22c55e', '#0e4220'])
]);

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
    const inputDest = input.destination && typeof input.destination === 'object' ? input.destination : {};
    return {
        startDelay: clamp(safeNumber(input.startDelay, DEFAULTS.startDelay), 0, 5),
        duration: clamp(safeNumber(input.duration, DEFAULTS.duration), 1, 8),
        randomness: clamp(safeNumber(input.randomness, DEFAULTS.randomness), 0, 100),
        size: clamp(safeNumber(input.size, DEFAULTS.size), 12, 72),
        count: Math.round(clamp(safeNumber(input.count, DEFAULTS.count), 8, MAX_ORB_COUNT)),
        destination: {
            x: clamp(safeNumber(inputDest.x ?? input.destinationX, DEFAULTS.destination.x), 0.02, 0.98),
            y: clamp(safeNumber(inputDest.y ?? input.destinationY, DEFAULTS.destination.y), 0.02, 0.98)
        },
        imgSrc: typeof input.imgSrc === 'string' ? input.imgSrc.trim() : DEFAULTS.imgSrc,
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

export function buildOrbPlan(width, height, config, seed) {
    const cfg = normalizeConfig(config);
    const random = createRandom(seed);
    const randomness = cfg.randomness / 100;
    const destX = cfg.destination.x * width;
    const destY = cfg.destination.y * height;
    const diagonal = Math.sqrt(width * width + height * height);
    const orbs = new Array(cfg.count);

    for (let index = 0; index < cfg.count; index += 1) {
        const evenAngle = (index / cfg.count) * Math.PI * 2;
        const angle = evenAngle + (random() - 0.5) * Math.PI * 1.2 * randomness;
        const startDistance = diagonal * (0.32 + (index % 5) * 0.035 + random() * 0.28 * randomness);
        const tangent = (random() - 0.5) * diagonal * 0.15 * randomness;
        const radiusVariation = 1 + (random() - 0.5) * 0.6 * randomness;
        const speedVariation = 1 + (random() - 0.5) * 0.3 * randomness;

        orbs[index] = {
            startX: destX + Math.cos(angle) * startDistance,
            startY: destY + Math.sin(angle) * startDistance,
            curveX: -Math.sin(angle) * tangent,
            curveY: Math.cos(angle) * tangent,
            radiusScale: radiusVariation,
            speed: speedVariation,
            stagger: random() * 0.15 * randomness,
            spriteIndex: index % SPRITE_VARIANT_COUNT
        };
    }
    return orbs;
}

function createSpriteAtlas() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const atlas = document.createElement('canvas');
    atlas.width = SPRITE_CELL_SIZE * SPRITE_VARIANT_COUNT;
    atlas.height = SPRITE_CELL_SIZE;
    const atlasContext = atlas.getContext('2d', { alpha: true });
    if (!atlasContext) return null;

    const radius = SPRITE_CELL_SIZE * 0.36;
    for (let index = 0; index < SPRITE_VARIANT_COUNT; index += 1) {
        const centerX = index * SPRITE_CELL_SIZE + SPRITE_CELL_SIZE * 0.5;
        const centerY = SPRITE_CELL_SIZE * 0.5;
        const colors = ORB_COLORS[index];

        const sphere = atlasContext.createRadialGradient(
            centerX - radius * 0.34,
            centerY - radius * 0.38,
            radius * 0.08,
            centerX,
            centerY,
            radius
        );
        sphere.addColorStop(0, '#ffffff');
        sphere.addColorStop(0.18, colors[0]);
        sphere.addColorStop(0.52, colors[1]);
        sphere.addColorStop(0.86, colors[2]);
        sphere.addColorStop(1, 'rgba(5, 7, 12, 0)');

        atlasContext.fillStyle = sphere;
        atlasContext.beginPath();
        atlasContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
        atlasContext.fill();

        atlasContext.fillStyle = 'rgba(255, 255, 255, 0.72)';
        atlasContext.beginPath();
        atlasContext.arc(
            centerX - radius * 0.34,
            centerY - radius * 0.38,
            radius * 0.12,
            0,
            Math.PI * 2
        );
        atlasContext.fill();
    }
    return atlas;
}

function easeOutCubic(value) {
    const inverse = 1 - value;
    return 1 - inverse * inverse * inverse;
}

function smoothstep(value) {
    return value * value * (3 - 2 * value);
}

export function mount(canvas, ctx, config) {
    let active = true;
    let cleaned = false;
    let cfg = normalizeConfig(config);
    let atlas = null;
    let image = null;
    let imageToken = 0;
    let cachedSurface = null;
    let loadedSource = '';
    let pendingSource = '';
    let orbs = [];
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

    function prepareSurface() {
        const currentWidth = Math.max(0, Number(canvas.width) || 0);
        const currentHeight = Math.max(0, Number(canvas.height) || 0);
        const hasIntentionalSize = currentWidth > 320 && currentHeight > 180;
        const size = calculateCappedSize(
            hasIntentionalSize ? currentWidth : 1920,
            hasIntentionalSize ? currentHeight : 1080
        );
        canvas.width = size.width;
        canvas.height = size.height;
        atlas = createSpriteAtlas();
        clearCanvas();
        notifyResize();
    }

    function renderFrame(progress) {
        clearCanvas();

        if (cachedSurface) {
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(cachedSurface, 0, 0);
            ctx.restore();
        }

        if (!atlas || orbs.length === 0) return;

        const destX = cfg.destination.x * canvas.width;
        const destY = cfg.destination.y * canvas.height;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        for (let index = 0; index < orbs.length; index += 1) {
            const orb = orbs[index];
            const available = 1 - orb.stagger;
            const localProgress = clamp(((progress - orb.stagger) / available) * orb.speed, 0, 1);
            const motion = easeOutCubic(localProgress);
            const curve = Math.sin(localProgress * Math.PI);

            // Opacity increases gradually from 0% at origin to 100% when gathering at destination
            const alpha = smoothstep(localProgress);
            if (alpha <= 0) continue;

            const scalePulse = 0.65 + Math.sin(Math.min(1, localProgress) * Math.PI) * 0.45;
            const drawSize = cfg.size * orb.radiusScale * scalePulse;
            const x = orb.startX + (destX - orb.startX) * motion + orb.curveX * curve;
            const y = orb.startY + (destY - orb.startY) * motion + orb.curveY * curve;

            ctx.globalAlpha = alpha;
            ctx.drawImage(
                atlas,
                orb.spriteIndex * SPRITE_CELL_SIZE,
                0,
                SPRITE_CELL_SIZE,
                SPRITE_CELL_SIZE,
                x - drawSize * 0.5,
                y - drawSize * 0.5,
                drawSize,
                drawSize
            );
        }

        ctx.restore();
    }

    function scheduleFrame() {
        if (!active || frameId !== null || isHidden()) return;
        frameId = requestAnimationFrame(tick);
    }

    function tick(timestamp) {
        frameId = null;
        if (!active || isHidden()) return;
        if (!startTimestamp) startTimestamp = timestamp;

        const elapsed = Math.max(0, timestamp - startTimestamp);
        const progress = clamp(elapsed / (cfg.duration * 1000), 0, 1);
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
        const seed = Math.floor(Math.random() * 4294967295) || 1;
        orbs = buildOrbPlan(canvas.width, canvas.height, cfg, seed);
        renderFrame(reducedMotion ? 1.0 : 0.0);
        if (!atlas) {
            animationCompleted = true;
            return;
        }
        if (!reducedMotion) armDelay(cfg.startDelay * 1000);
    }

    function rasterizeLoadedImage(loadedImage, token) {
        if (!active || token !== imageToken) return;
        const sourceWidth = loadedImage.naturalWidth || loadedImage.width;
        const sourceHeight = loadedImage.naturalHeight || loadedImage.height;
        if (!sourceWidth || !sourceHeight) {
            cachedSurface = null;
            prepareSurface();
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
            prepareSurface();
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
        atlas = createSpriteAtlas();
        clearCanvas();
        notifyResize();
        startCycle();
    }

    function loadConfiguredImage() {
        cancelScheduledWork();
        releasePendingImage();
        cachedSurface = null;
        loadedSource = '';
        pendingSource = '';
        prepareSurface();

        if (!cfg.imgSrc || typeof Image !== 'function') {
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
            prepareSurface();
            startCycle();
        };
        image.src = cfg.imgSrc;
    }

    function restart(nextConfig) {
        if (!active) return;
        const previousSource = cfg.imgSrc;
        cfg = normalizeConfig({ ...cfg, ...(nextConfig || {}) });
        if (image && cfg.imgSrc === pendingSource) return;
        if (cfg.imgSrc !== previousSource || cfg.imgSrc !== loadedSource) {
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
        orbs = [];
        atlas = null;
        cachedSurface = null;
        clearCanvas();
    }

    cleanup.restart = restart;
    return cleanup;
}
