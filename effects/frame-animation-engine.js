import { createEffectImage } from './effect-media.js';

export function runFrameanim(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let startedAt = null;
    let loopStarted = false;
    let bgLoaded = false;
    let framesLoaded = false;

    const cfg = {
        imgSrc: '',
        frames: [],
        startDelay: 0,
        travelDuration: 4,
        sequenceDuration: 1,
        loops: 1,
        startX: 0.5,
        startY: 0.5,
        endX: 0.5,
        endY: 0.5,
        startSize: 0.25,
        endSize: 0.25,
        startOpacity: 1,
        endOpacity: 1,
        ...config
    };

    const backgroundResource = createEffectImage(cfg, cfg.imgSrc);
    let bgImage = backgroundResource.image;
    const frameImages = [];

    function safeNum(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function fitCanvasToBackground() {
        if (!bgLoaded || !bgImage.width || !bgImage.height) return;
        canvas.width = bgImage.width;
        canvas.height = bgImage.height;
        if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
    }

    function drawBackground() {
        if (!bgLoaded) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    }

    function maybeStart() {
        if (!active || !bgLoaded || !framesLoaded || loopStarted) return;
        loopStarted = true;
        fitCanvasToBackground();
        animationId = requestAnimationFrame(loop);
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startedAt) startedAt = timestamp;

        drawBackground();

        const elapsedMs = timestamp - startedAt;
        const delayMs = Math.max(0, safeNum(cfg.startDelay, 0) * 1000);
        const travelDurationMs = Math.max(1, safeNum(cfg.travelDuration ?? cfg.duration, 4) * 1000);
        const fallbackSequenceDuration = frameImages.length > 0
            ? Math.max(0.1, frameImages.length / Math.max(1, safeNum(cfg.frameRate, 12)))
            : 1;
        const sequenceDurationMs = Math.max(1, safeNum(cfg.sequenceDuration, fallbackSequenceDuration) * 1000);
        const loops = Math.max(0, Math.floor(safeNum(cfg.loops, 0)));

        if (elapsedMs >= delayMs && frameImages.length) {
            const animMs = elapsedMs - delayMs;
            const totalAnimMs = loops === 0 ? Infinity : travelDurationMs * loops;
            if (animMs <= totalAnimMs) {
                const travelMs = loops > 0 ? Math.min(animMs, totalAnimMs - 1) % travelDurationMs : (animMs % travelDurationMs);
                const sequenceMs = animMs % sequenceDurationMs;
                const progress = clamp(travelMs / travelDurationMs, 0, 1);
                const frameIndex = Math.floor((sequenceMs / sequenceDurationMs) * frameImages.length) % frameImages.length;
                const frame = frameImages[frameIndex];
                if (frame && frame.complete && frame.naturalWidth && frame.naturalHeight) {
                    const x = canvas.width * (cfg.startX + ((cfg.endX - cfg.startX) * progress));
                    const y = canvas.height * (cfg.startY + ((cfg.endY - cfg.startY) * progress));
                    const widthRatio = cfg.startSize + ((cfg.endSize - cfg.startSize) * progress);
                    const drawWidth = Math.max(1, canvas.width * widthRatio);
                    const drawHeight = drawWidth * (frame.naturalHeight / frame.naturalWidth);
                    const opacity = clamp(cfg.startOpacity + ((cfg.endOpacity - cfg.startOpacity) * progress), 0, 1);

                    ctx.save();
                    ctx.globalAlpha = opacity;
                    ctx.drawImage(frame, x - (drawWidth / 2), y - (drawHeight / 2), drawWidth, drawHeight);
                    ctx.restore();
                }
            }
        }

        animationId = requestAnimationFrame(loop);
    }

    if (cfg.imgSrc) {
        const backgroundReady = () => {
            bgLoaded = true;
            fitCanvasToBackground();
            maybeStart();
        };
        const backgroundError = () => {
            bgLoaded = true;
            maybeStart();
        };
        if (backgroundResource.isPreloaded) {
            backgroundReady();
        } else {
            bgImage.onload = backgroundReady;
            bgImage.onerror = backgroundError;
            bgImage.src = cfg.imgSrc;
        }
    } else {
        bgLoaded = true;
    }

    const frameSources = Array.isArray(cfg.frames) ? cfg.frames.filter(Boolean) : [];
    if (!frameSources.length) {
        framesLoaded = true;
        maybeStart();
    } else {
        let remaining = frameSources.length;
        frameSources.forEach((src, index) => {
            const frameResource = createEffectImage(cfg, src);
            const img = frameResource.image;
            const frameReady = () => {
                remaining -= 1;
                if (remaining <= 0) {
                    framesLoaded = true;
                    maybeStart();
                }
            };
            if (frameResource.isPreloaded) {
                frameReady();
            } else {
                img.crossOrigin = 'Anonymous';
                img.onload = img.onerror = frameReady;
                img.src = src;
            }
            frameImages[index] = img;
        });
    }

    return () => {
        active = false;
        if (animationId) cancelAnimationFrame(animationId);
    };
}

export function mount(canvas, ctx, config) {
    return runFrameanim(canvas, ctx, config);
}
