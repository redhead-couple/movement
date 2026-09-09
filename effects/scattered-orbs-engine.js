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
    origin: Object.freeze({ x: 0.5, y: 0.52 })
});

export const schema = {
    startDelay: { type: 'number', min: 0, max: 5, step: 0.1, default: DEFAULTS.startDelay, label: 'Start time (s)' },
    duration: { type: 'number', min: 1, max: 8, step: 0.1, default: DEFAULTS.duration, label: 'Duration (s)' },
    randomness: { type: 'number', min: 0, max: 100, step: 5, default: DEFAULTS.randomness, label: 'Randomness (%)' },
    size: { type: 'number', min: 12, max: 72, step: 1, default: DEFAULTS.size, label: 'Size (px)' },
    count: { type: 'number', min: 8, max: MAX_ORB_COUNT, step: 1, default: DEFAULTS.count, label: 'Amount' },
    origin: { type: 'point', default: DEFAULTS.origin, label: 'Origin point' }
};

const ORB_COLORS = Object.freeze([
    Object.freeze(['#fff0e8', '#ff8b6c', '#6f2030']),
    Object.freeze(['#fff4bd', '#f1bf45', '#72421e']),
    Object.freeze(['#e1fbff', '#55c8df', '#174664']),
    Object.freeze(['#f5e8ff', '#ad7ae8', '#43245f']),
    Object.freeze(['#ffe5f0', '#ed74a6', '#6d2347']),
    Object.freeze(['#e8ffe8', '#76cf8d', '#24573b'])
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
    const inputOrigin = input.origin && typeof input.origin === 'object' ? input.origin : {};
    return {
        startDelay: clamp(safeNumber(input.startDelay, DEFAULTS.startDelay), 0, 5),
        duration: clamp(safeNumber(input.duration, DEFAULTS.duration), 1, 8),
        randomness: clamp(safeNumber(input.randomness, DEFAULTS.randomness), 0, 100),
        size: clamp(safeNumber(input.size, DEFAULTS.size), 12, 72),
        count: Math.round(clamp(safeNumber(input.count, DEFAULTS.count), 8, MAX_ORB_COUNT)),
        origin: {
            x: clamp(safeNumber(inputOrigin.x ?? input.originX, DEFAULTS.origin.x), 0.02, 0.98),
            y: clamp(safeNumber(inputOrigin.y ?? input.originY, DEFAULTS.origin.y), 0.02, 0.98)
        },
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
    const diagonal = Math.sqrt(width * width + height * height);
    const orbs = new Array(cfg.count);

    for (let index = 0; index < cfg.count; index += 1) {
        const evenAngle = (index / cfg.count) * Math.PI * 2;
        const angle = evenAngle + (random() - 0.5) * Math.PI * 1.35 * randomness;
        const distanceVariation = 0.82 + random() * 0.38 * randomness;
        const distance = diagonal * (0.27 + (index % 5) * 0.012) * distanceVariation;
        const tangent = (random() - 0.5) * diagonal * 0.16 * randomness;
        const radiusVariation = 1 + (random() - 0.5) * 0.8 * randomness;
        const speedVariation = 1 + (random() - 0.5) * 0.32 * randomness;

        orbs[index] = {
            travelX: Math.cos(angle) * distance,
            travelY: Math.sin(angle) * distance,
            curveX: -Math.sin(angle) * tangent,
            curveY: Math.cos(angle) * tangent,
            startX: (random() - 0.5) * cfg.size * 0.65 * randomness,
            startY: (random() - 0.5) * cfg.size * 0.65 * randomness,
            radiusScale: radiusVariation,
            speed: speedVariation,
            stagger: random() * 0.14 * randomness,
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

        atlasContext.fillStyle = 'rgba(255, 255, 255, 0.66)';
        atlasContext.beginPath();
        atlasContext.arc(
            centerX - radius * 0.34,
            centerY - radius * 0.38,
            radius * 0.11,
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
        if (!atlas || orbs.length === 0) return;

        const originX = cfg.origin.x * canvas.width;
        const originY = cfg.origin.y * canvas.height;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        for (let index = 0; index < orbs.length; index += 1) {
            const orb = orbs[index];
            const available = 1 - orb.stagger;
            const localProgress = clamp(((progress - orb.stagger) / available) * orb.speed, 0, 1);
            const motion = easeOutCubic(localProgress);
            const curve = Math.sin(localProgress * Math.PI);
            const fadeProgress = clamp((localProgress - 0.38) / 0.62, 0, 1);
            const alpha = 1 - smoothstep(fadeProgress);
            if (alpha <= 0) continue;

            const scalePulse = 0.58 + Math.sin(Math.min(1, localProgress) * Math.PI) * 0.58;
            const drawSize = cfg.size * orb.radiusScale * scalePulse;
            const x = originX + orb.startX + orb.travelX * motion + orb.curveX * curve;
            const y = originY + orb.startY + orb.travelY * motion + orb.curveY * curve;
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
        renderFrame(reducedMotion ? 0.22 : 0);
        if (!atlas) {
            animationCompleted = true;
            return;
        }
        if (!reducedMotion) armDelay(cfg.startDelay * 1000);
    }

    function restart(nextConfig) {
        if (!active) return;
        cfg = normalizeConfig({ ...cfg, ...(nextConfig || {}) });
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
    prepareSurface();
    startCycle();

    function cleanup() {
        if (cleaned) return;
        cleaned = true;
        active = false;
        cancelScheduledWork();
        if (visibilityDocument && typeof visibilityDocument.removeEventListener === 'function') {
            visibilityDocument.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        orbs = [];
        atlas = null;
        clearCanvas();
    }

    cleanup.restart = restart;
    return cleanup;
}
