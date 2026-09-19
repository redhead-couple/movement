import { createEffectImage } from './effect-media.js';

export const MAX_ANIMATED_PIXELS = 2073600;
export const MAX_DIMENSION = 2048;
export const TARGET_FRAME_MS = 1000 / 30;
export const DEFAULTS = Object.freeze({ strength: 45, pulseSpeed: 12 });

function bounded(value, fallback, min, max) {
    const number = value === null || value === '' || typeof value === 'boolean' ? NaN : Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeConfig(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        ...source,
        imgSrc: typeof source.imgSrc === 'string' ? source.imgSrc : '',
        strength: bounded(source.strength, DEFAULTS.strength, 0, 100),
        pulseSpeed: bounded(source.pulseSpeed, DEFAULTS.pulseSpeed, 0, 24),
        playbackStartDelayMs: bounded(source.playbackStartDelayMs, 0, 0, 60000)
    };
}

export function calculateCanvasSize(width, height) {
    const w = bounded(width, 1, 1, Number.MAX_SAFE_INTEGER);
    const h = bounded(height, 1, 1, Number.MAX_SAFE_INTEGER);
    const scale = Math.min(1, Math.sqrt(MAX_ANIMATED_PIXELS / w / h), MAX_DIMENSION / w, MAX_DIMENSION / h);
    return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}

export function mount(canvas, ctx, config = {}) {
    let cfg = normalizeConfig(config);
    let active = true, ready = false, dirty = false, delayed = false, canvasVisible = true;
    let frame = null, delayTimer = null, lastPaint = -Infinity, lastTick = null, phase = 0;
    let base = null, glow = null, image = null;
    const owner = canvas.ownerDocument || document;
    const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

    function animated() { return cfg.strength > 0 && cfg.pulseSpeed > 0 && !motion?.matches; }
    function cancelFrame() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        lastTick = null;
    }
    function schedule() {
        if (active && ready && !delayed && !owner.hidden && canvasVisible && frame === null) frame = requestAnimationFrame(tick);
    }

    // Two bounded static caches, plus one animated output canvas. The source
    // image is scaled once; the soft shadow is also rasterized only on rebuild.
    function rebuild() {
        const size = calculateCanvasSize(canvas.width, canvas.height);
        canvas.width = size.width;
        canvas.height = size.height;
        if (!base) { base = owner.createElement('canvas'); glow = owner.createElement('canvas'); }
        base.width = glow.width = size.width;
        base.height = glow.height = size.height;
        const inset = Math.min(size.width, size.height) * 0.10;
        const iw = image.naturalWidth || image.width;
        const ih = image.naturalHeight || image.height;
        const scale = Math.min((size.width - inset * 2) / iw, (size.height - inset * 2) / ih);
        const w = iw * scale, h = ih * scale;
        base.getContext('2d').drawImage(image, (size.width - w) / 2, (size.height - h) / 2, w, h);
        const glowContext = glow.getContext('2d');
        glowContext.shadowColor = 'rgba(255, 239, 207, 0.95)';
        glowContext.shadowBlur = inset * 0.65;
        glowContext.drawImage(base, 0, 0);
        if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
    }

    function paint() {
        if (!active || !ready || owner.hidden) return;
        if (canvas.width !== base.width || canvas.height !== base.height) rebuild();
        const opacity = cfg.strength / 100 * (animated() ? 0.55 + 0.45 * (1 - Math.cos(phase)) / 2 : 0.75);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
        ctx.shadowBlur = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (opacity > 0) { ctx.globalAlpha = opacity; ctx.drawImage(glow, 0, 0); }
        ctx.globalAlpha = 1;
        ctx.drawImage(base, 0, 0);
        ctx.restore();
        dirty = false;
    }

    function tick(timestamp) {
        frame = null;
        if (!active || !ready || owner.hidden || !canvasVisible || delayed) return;
        if (lastTick !== null && animated()) phase = (phase + Math.min(100, Math.max(0, timestamp - lastTick)) * cfg.pulseSpeed * Math.PI * 2 / 60000) % (Math.PI * 2);
        lastTick = timestamp;
        if (timestamp - lastPaint >= TARGET_FRAME_MS) { paint(); lastPaint = timestamp; }
        if (animated() || dirty) schedule();
    }

    function refresh() {
        if (!active) return;
        dirty = true;
        if (owner.hidden || !canvasVisible) cancelFrame();
        else schedule();
    }

    function loaded() {
        if (!active || ready || !(image.naturalWidth || image.width) || !(image.naturalHeight || image.height)) return;
        const size = calculateCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
        canvas.width = size.width; canvas.height = size.height;
        rebuild();
        ready = true;
        dirty = true;
        paint();
        lastPaint = performance.now();
        if (cfg.playbackStartDelayMs > 0 && animated()) {
            delayed = true;
            delayTimer = setTimeout(() => {
                delayTimer = null; delayed = false;
                if (active && (animated() || dirty)) schedule();
            }, cfg.playbackStartDelayMs);
        } else if (animated() || dirty) schedule();
    }

    owner.addEventListener('visibilitychange', refresh);
    motion?.addEventListener('change', refresh);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries = []) => {
        if (!active) return;
        const entry = entries.find(item => item.target === canvas);
        if (entry) {
            const visible = entry.contentRect.width > 0 && entry.contentRect.height > 0;
            if (visible !== canvasVisible) { canvasVisible = visible; refresh(); }
        }
        if (ready && (canvas.width !== base.width || canvas.height !== base.height)) refresh();
    }) : null;
    observer?.observe(canvas);
    const resource = createEffectImage(cfg, cfg.imgSrc);
    image = resource.image;
    if (resource.isPreloaded) loaded();
    else if (image && cfg.imgSrc) {
        image.onload = loaded;
        image.onerror = () => { if (active) { ctx.clearRect(0, 0, canvas.width, canvas.height); cancelFrame(); } };
        image.src = cfg.imgSrc;
    }

    function cleanup() {
        if (!active) return;
        active = false;
        cancelFrame();
        if (delayTimer !== null) clearTimeout(delayTimer);
        delayTimer = null;
        owner.removeEventListener('visibilitychange', refresh);
        motion?.removeEventListener('change', refresh);
        observer?.disconnect();
        if (image && !resource.isPreloaded) image.onload = image.onerror = null;
        if (base) { base.width = base.height = glow.width = glow.height = 1; }
        base = glow = image = null;
    }
    // Maker control changes reuse the decoded image and both caches.
    cleanup.update = controls => {
        if (!active) return;
        const next = normalizeConfig({ ...cfg, strength: controls.strength, pulseSpeed: controls.pulseSpeed });
        cfg.strength = next.strength; cfg.pulseSpeed = next.pulseSpeed;
        refresh();
    };
    return cleanup;
}
