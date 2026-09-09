// effects/zoom-engine.js

import { createEffectImage } from './effect-media.js';

export const MAX_ANIMATED_PIXELS = 2073600;
export const TARGET_FPS = 30;

export const DEFAULTS = Object.freeze({
    imgSrc: '',
    zoomStart: 1.0,
    xStart: 0.5,
    yStart: 0.5,
    brightStart: 1.0,
    startOpacity: 1.0,
    zoomEnd: 1.2,
    xEnd: 0.5,
    yEnd: 0.5,
    brightEnd: 1.0,
    endOpacity: 1.0,
    duration: 5.0,
    startDelay: 0.0,
    easing: 'smooth'
});

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function normalizeConfig(config = {}) {
    const input = config && typeof config === 'object' ? config : {};
    return {
        imgSrc: typeof input.imgSrc === 'string' ? input.imgSrc : DEFAULTS.imgSrc,
        zoomStart: clamp(finiteNumber(input.zoomStart, DEFAULTS.zoomStart), 0.1, 5),
        xStart: clamp(finiteNumber(input.xStart, DEFAULTS.xStart), 0, 1),
        yStart: clamp(finiteNumber(input.yStart, DEFAULTS.yStart), 0, 1),
        brightStart: clamp(finiteNumber(input.brightStart, DEFAULTS.brightStart), 0, 2),
        startOpacity: clamp(finiteNumber(input.startOpacity, DEFAULTS.startOpacity), 0, 1),
        zoomEnd: clamp(finiteNumber(input.zoomEnd, DEFAULTS.zoomEnd), 0.1, 5),
        xEnd: clamp(finiteNumber(input.xEnd, DEFAULTS.xEnd), 0, 1),
        yEnd: clamp(finiteNumber(input.yEnd, DEFAULTS.yEnd), 0, 1),
        brightEnd: clamp(finiteNumber(input.brightEnd, DEFAULTS.brightEnd), 0, 2),
        endOpacity: clamp(finiteNumber(input.endOpacity, DEFAULTS.endOpacity), 0, 1),
        duration: clamp(finiteNumber(input.duration, DEFAULTS.duration), 0.1, 20),
        startDelay: clamp(finiteNumber(input.startDelay, DEFAULTS.startDelay), 0, 5),
        easing: input.easing === 'linear' ? 'linear' : DEFAULTS.easing,
        preloadedImages: input.preloadedImages && typeof input.preloadedImages.get === 'function' ? input.preloadedImages : new Map(),
        onResize: typeof input.onResize === 'function' ? input.onResize : null
    };
}

export function calculateCappedSize(width, height) {
    const safeWidth = Math.max(1, Math.floor(finiteNumber(width, 1)));
    const safeHeight = Math.max(1, Math.floor(finiteNumber(height, 1)));
    const scale = Math.min(1, Math.sqrt(MAX_ANIMATED_PIXELS / (safeWidth * safeHeight)));
    return {
        width: Math.max(1, Math.floor(safeWidth * scale)),
        height: Math.max(1, Math.floor(safeHeight * scale))
    };
}

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let delayTimer = null;
    let img = null;
    let imageToken = 0;
    let loadedImageSource = '';
    let cachedSurface = null;
    let cfg = normalizeConfig(config);
    let animationStart = null;
    let lastDrawTime = -Infinity;
    let completed = false;

    const frameInterval = 1000 / TARGET_FPS;
    const reducedMotion = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function cancelScheduledWork() {
        if (animationId !== null) cancelAnimationFrame(animationId);
        if (delayTimer !== null) clearTimeout(delayTimer);
        animationId = null;
        delayTimer = null;
    }

    function lerp(start, end, amount) {
        return start + ((end - start) * amount);
    }

    function easeInOutSine(value) {
        return -(Math.cos(Math.PI * value) - 1) / 2;
    }

    function drawFrame(progress) {
        if (!active || !cachedSurface) return;
        const eased = cfg.easing === 'smooth' ? easeInOutSine(progress) : progress;
        const currentZoom = lerp(cfg.zoomStart, cfg.zoomEnd, eased);
        const currentX = lerp(cfg.xStart, cfg.xEnd, eased);
        const currentY = lerp(cfg.yStart, cfg.yEnd, eased);
        const currentBright = lerp(cfg.brightStart, cfg.brightEnd, eased);
        const currentOpacity = lerp(cfg.startOpacity, cfg.endOpacity, eased);
        const width = canvas.width;
        const height = canvas.height;
        const sourceWidth = cachedSurface.width;
        const sourceHeight = cachedSurface.height;
        const viewWidth = sourceWidth / currentZoom;
        const viewHeight = sourceHeight / currentZoom;
        const sourceX = (sourceWidth * currentX) - (viewWidth / 2);
        const sourceY = (sourceHeight * currentY) - (viewHeight / 2);

        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.filter = currentBright === 1 ? 'none' : `brightness(${currentBright * 100}%)`;
        ctx.globalAlpha = currentOpacity;
        ctx.drawImage(
            cachedSurface,
            sourceX,
            sourceY,
            viewWidth,
            viewHeight,
            0,
            0,
            width,
            height
        );
        // Keep opacity and filters scoped to the zoomed image.
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
        ctx.restore();
    }

    function scheduleFrame() {
        if (!active || animationId !== null || document.hidden) return;
        animationId = requestAnimationFrame(loop);
    }

    function loop(timestamp) {
        animationId = null;
        if (!active || document.hidden || !cachedSurface) return;
        if (animationStart === null) animationStart = timestamp;
        const progress = clamp((timestamp - animationStart) / (cfg.duration * 1000), 0, 1);

        if (progress >= 1 || timestamp - lastDrawTime >= frameInterval) {
            drawFrame(progress);
            lastDrawTime = timestamp;
        }
        if (progress >= 1) completed = true;
        if (progress < 1) scheduleFrame();
    }

    function startAnimation() {
        cancelScheduledWork();
        if (!active || !cachedSurface) return;
        animationStart = null;
        lastDrawTime = -Infinity;
        completed = false;
        drawFrame(reducedMotion ? 1 : 0);
        if (reducedMotion) {
            completed = true;
            return;
        }
        if (document.hidden) return;

        if (cfg.startDelay > 0) {
            delayTimer = setTimeout(() => {
                delayTimer = null;
                scheduleFrame();
            }, cfg.startDelay * 1000);
        } else {
            scheduleFrame();
        }
    }

    function prepareLoadedImage(nextImage, token) {
        if (!active || token !== imageToken) return;
        const naturalWidth = nextImage.naturalWidth || nextImage.width;
        const naturalHeight = nextImage.naturalHeight || nextImage.height;
        if (!naturalWidth || !naturalHeight) return;

        const size = calculateCappedSize(naturalWidth, naturalHeight);
        const nextSurface = document.createElement('canvas');
        nextSurface.width = size.width;
        nextSurface.height = size.height;
        const cacheContext = nextSurface.getContext('2d');
        if (!cacheContext) return;
        cacheContext.drawImage(nextImage, 0, 0, size.width, size.height);
        cachedSurface = nextSurface;
        loadedImageSource = cfg.imgSrc;
        canvas.width = size.width;
        canvas.height = size.height;
        if (cfg.onResize) cfg.onResize(canvas);
        startAnimation();
    }

    function loadImage(source) {
        cancelScheduledWork();
        cachedSurface = null;
        loadedImageSource = '';
        const token = ++imageToken;
        if (img) {
            img.onload = null;
            img.onerror = null;
        }
        img = null;

        if (!source) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (cfg.onResize) cfg.onResize(canvas);
            return;
        }

        const imageResource = createEffectImage(cfg, source);
        if (imageResource.isPreloaded) {
            img = imageResource.image;
            prepareLoadedImage(imageResource.image, token);
            return;
        }

        const nextImage = imageResource.image;
        img = nextImage;
        nextImage.onload = () => prepareLoadedImage(nextImage, token);
        nextImage.onerror = () => {
            if (!active || token !== imageToken) return;
            cachedSurface = null;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
        nextImage.crossOrigin = "Anonymous";
        nextImage.src = source;
    }

    function restart(nextConfig = {}) {
        if (!active) return;
        const previousSource = cfg.imgSrc;
        cfg = normalizeConfig({ ...cfg, ...nextConfig });
        if (cfg.imgSrc !== previousSource || (!img && !cachedSurface)) {
            loadImage(cfg.imgSrc);
            return;
        }
        if (cachedSurface && loadedImageSource === cfg.imgSrc) startAnimation();
    }

    function handleVisibilityChange() {
        if (!active) return;
        if (document.hidden) {
            cancelScheduledWork();
            return;
        }
        if (cachedSurface && !completed) startAnimation();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    loadImage(cfg.imgSrc);

    const cleanup = () => {
        if (!active) return;
        active = false;
        imageToken += 1;
        cancelScheduledWork();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (img) {
            img.onload = null;
            img.onerror = null;
        }
        img = null;
        cachedSurface = null;
    };
    cleanup.restart = restart;
    return cleanup;
}
