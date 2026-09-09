// effects/ripple-engine.js

import { createEffectImage } from './effect-media.js';

const MAX_ANIMATED_PIXELS = 2073600;
const TARGET_FRAME_MS = 1000 / 30;
const RIPPLE_BAND_WIDTH = 80;
const RIPPLE_RING_COUNT = 12;

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function calculateCanvasSize(width, height) {
    const safeWidth = Math.max(1, finiteNumber(width, 1));
    const safeHeight = Math.max(1, finiteNumber(height, 1));
    const scale = Math.min(1, Math.sqrt(MAX_ANIMATED_PIXELS / (safeWidth * safeHeight)));
    return {
        width: Math.max(1, Math.round(safeWidth * scale)),
        height: Math.max(1, Math.round(safeHeight * scale))
    };
}

export function runRipple(canvas, ctx, config) {
    let active = true;
    let ripples = [];
    let baseImage = null;
    let loaded = false;
    let animationId = null;
    let startTimeout = null;
    let spawnInterval = null;
    let lastPaintTime = 0;

    const cfg = {
        imgSrc: '',
        x: 0.5,
        y: 0.5,
        startTime: 0,
        count: 1,
        interval: 800,
        freq: 0.02,
        speed: 15,
        amp: 20,
        decay: 0.03,
        playbackStartDelayMs: 0,
        ...config
    };

    cfg.x = Math.max(0, Math.min(1, finiteNumber(cfg.x, 0.5)));
    cfg.y = Math.max(0, Math.min(1, finiteNumber(cfg.y, 0.5)));
    cfg.startTime = Math.max(0, finiteNumber(cfg.startTime, 0));
    cfg.count = Math.max(-1, Math.floor(finiteNumber(cfg.count, 1)));
    cfg.interval = Math.max(16, finiteNumber(cfg.interval, 800));
    cfg.freq = Math.max(0, finiteNumber(cfg.freq, 0.02));
    cfg.speed = Math.max(0, finiteNumber(cfg.speed, 15));
    cfg.amp = finiteNumber(cfg.amp, 20);
    cfg.decay = Math.max(0.0001, finiteNumber(cfg.decay, 0.03));
    cfg.playbackStartDelayMs = Math.max(0, finiteNumber(cfg.playbackStartDelayMs, 0));
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    baseImage = imageResource.image;

    function drawBaseImage() {
        if (!loaded || !canvas.width || !canvas.height) return;
        const canvasRatio = canvas.width / canvas.height;
        const imageRatio = baseImage.naturalWidth / baseImage.naturalHeight;
        let sx = 0;
        let sy = 0;
        let sw = baseImage.naturalWidth;
        let sh = baseImage.naturalHeight;

        if (canvasRatio > imageRatio) {
            sh = baseImage.naturalWidth / canvasRatio;
            sy = (baseImage.naturalHeight - sh) / 2;
        } else {
            sw = baseImage.naturalHeight * canvasRatio;
            sx = (baseImage.naturalWidth - sw) / 2;
        }
        ctx.drawImage(baseImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }

    function drawRipple(ripple) {
        const centerX = cfg.x * canvas.width;
        const centerY = cfg.y * canvas.height;
        const radius = ripple.ageFrames * cfg.speed;
        const bandStart = Math.max(0, radius - RIPPLE_BAND_WIDTH);
        const bandEnd = radius + RIPPLE_BAND_WIDTH;
        const ringWidth = (bandEnd - bandStart) / RIPPLE_RING_COUNT;

        for (let index = 0; index < RIPPLE_RING_COUNT; index++) {
            const innerRadius = bandStart + (index * ringWidth);
            const outerRadius = Math.max(innerRadius + 0.5, innerRadius + ringWidth + 0.75);
            if (innerRadius > Math.hypot(canvas.width, canvas.height)) break;

            const sampleRadius = (innerRadius + outerRadius) / 2;
            const distanceFromFront = sampleRadius - radius;
            const damping = (100 / (sampleRadius + 50)) * ripple.energy;
            const offset = Math.sin(distanceFromFront * cfg.freq) * cfg.amp * damping;
            const scale = Math.max(0.85, Math.min(1.15, 1 + (offset / Math.max(32, sampleRadius))));

            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
            if (innerRadius > 0) {
                ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
            }
            ctx.clip('evenodd');
            ctx.translate(centerX, centerY);
            ctx.scale(scale, scale);
            ctx.translate(-centerX, -centerY);
            drawBaseImage();
            ctx.restore();
        }
    }

    function scheduleFrame() {
        if (!active || animationId !== null) return;
        animationId = requestAnimationFrame(loop);
    }

    function spawn() {
        if (!active) return;
        ripples.push({ ageFrames: 0, energy: 1 });
        scheduleFrame();
    }

    function beginSpawning() {
        if (!active || cfg.count === 0) return;
        spawn();
        let spawnedSoFar = 1;
        if (cfg.count === -1 || cfg.count > 1) {
            spawnInterval = setInterval(() => {
                if (!active) return;
                if (cfg.count !== -1 && spawnedSoFar >= cfg.count) {
                    clearInterval(spawnInterval);
                    spawnInterval = null;
                    return;
                }
                spawn();
                spawnedSoFar += 1;
            }, cfg.interval);
        }
    }

    function loop(timestamp) {
        animationId = null;
        if (!active || !loaded) return;
        if (lastPaintTime && timestamp - lastPaintTime < TARGET_FRAME_MS) {
            scheduleFrame();
            return;
        }

        const elapsedFrames = lastPaintTime
            ? Math.min(4, (timestamp - lastPaintTime) / (1000 / 60))
            : 1;
        lastPaintTime = timestamp;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBaseImage();
        ripples.forEach(drawRipple);

        ripples.forEach(ripple => {
            ripple.ageFrames += elapsedFrames;
            ripple.energy -= cfg.decay * elapsedFrames;
        });
        ripples = ripples.filter(ripple => ripple.energy > 0);
        if (ripples.length > 0) scheduleFrame();
    }

    baseImage.onload = () => {
        if (!active) return;
        loaded = true;
        const size = calculateCanvasSize(
            baseImage.naturalWidth || baseImage.width,
            baseImage.naturalHeight || baseImage.height
        );
        canvas.width = size.width;
        canvas.height = size.height;
        drawBaseImage();
        if (cfg.onResize) cfg.onResize(canvas);
        startTimeout = setTimeout(beginSpawning, cfg.startTime + cfg.playbackStartDelayMs);
    };
    baseImage.onerror = () => {
        loaded = false;
    };
    if (cfg.imgSrc) {
        if (imageResource.isPreloaded) {
            baseImage.onload();
        } else {
            if (!String(cfg.imgSrc).startsWith('data:') && (typeof location === 'undefined' || location.protocol !== 'file:')) {
                baseImage.crossOrigin = 'Anonymous';
            }
            baseImage.src = cfg.imgSrc;
        }
    }

    return () => {
        if (!active) return;
        active = false;
        clearTimeout(startTimeout);
        clearInterval(spawnInterval);
        if (animationId !== null) cancelAnimationFrame(animationId);
        animationId = null;
        baseImage.onload = null;
        baseImage.onerror = null;
        ripples = [];
    };
}

export function mount(canvas, ctx, config) {
    return runRipple(canvas, ctx, config);
}
