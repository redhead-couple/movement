// effects/darken-engine.js

import { createEffectImage } from './effect-media.js';

export function runDarken(canvas, ctx, config) {
    let active = true;
    let baseImage = null;
    let loaded = false;
    let animationId = null;
    let startTimeStamp = null;

    // Default Config
    const cfg = {
        imgSrc: '',
        startTime: 0,
        duration: 5000,
        yoyo: false,        // Animate back?
        resetAtEnd: false,  // <-- NEW: Snap back?

        zoomStart: 1.0,
        zoomEnd: 1.2,

        driftX: 0,
        driftY: 0,

        darknessStart: 0.0,
        darknessEnd: 0.5,

        vignette: 0.5,

        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    baseImage = imageResource.image;

    // 1. Load Image
    if (cfg.imgSrc) {
        const markImageReady = () => {
            loaded = true;
            canvas.width = baseImage.width;
            canvas.height = baseImage.height;
            if (cfg.onResize) cfg.onResize(canvas);

            animationId = requestAnimationFrame(loop);
        };
        if (imageResource.isPreloaded) {
            markImageReady();
        } else {
            baseImage.crossOrigin = "Anonymous";
            baseImage.onload = markImageReady;
            baseImage.src = cfg.imgSrc;
        }
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startTimeStamp) startTimeStamp = timestamp;

        const w = canvas.width;
        const h = canvas.height;

        // 1. Calculate Progress
        let timePassed = timestamp - startTimeStamp;
        let progress = 0;

        if (timePassed > cfg.startTime) {
            let t = (timePassed - cfg.startTime) / cfg.duration;

            if (t >= 1) {
                // Time is up
                if (cfg.yoyo) {
                    progress = 0; // Yoyo finishes at 0
                } else if (cfg.resetAtEnd) {
                    progress = 0; // SNAP back to start
                } else {
                    progress = 1; // Stay at end state
                }
            } else {
                // Animation in progress
                if (cfg.yoyo) {
                    // Yoyo Logic (0 -> 1 -> 0)
                    if (t <= 0.5) {
                        progress = t * 2;
                    } else {
                        progress = 1 - ((t - 0.5) * 2);
                    }
                } else {
                    // Normal Logic (0 -> 1)
                    progress = t;
                }
            }
        }

        // 2. Clear
        ctx.clearRect(0, 0, w, h);

        if (loaded) {
            // 3. Zoom & Pan Math
            const scale = cfg.zoomStart + (cfg.zoomEnd - cfg.zoomStart) * progress;
            const dx = cfg.driftX * progress;
            const dy = cfg.driftY * progress;

            const sw = w / scale;
            const sh = h / scale;
            const sx = (w - sw) / 2 + dx;
            const sy = (h - sh) / 2 + dy;

            ctx.drawImage(baseImage, sx, sy, sw, sh, 0, 0, w, h);
        }

        // 4. Darkness Overlay
        const currentDarkness = cfg.darknessStart + (cfg.darknessEnd - cfg.darknessStart) * progress;

        if (currentDarkness > 0) {
            const safeAlpha = Math.max(0, Math.min(1, currentDarkness));
            ctx.fillStyle = `rgba(0, 0, 0, ${safeAlpha})`;
            ctx.fillRect(0, 0, w, h);
        }

        // 5. Vignette
        if (cfg.vignette > 0) {
            const radius = Math.sqrt(w * w + h * h) / 1.5;
            const grad = ctx.createRadialGradient(w / 2, h / 2, w / 4, w / 2, h / 2, radius);
            grad.addColorStop(0, "rgba(0,0,0,0)");
            grad.addColorStop(1, `rgba(0,0,0,${cfg.vignette})`);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        }

        animationId = requestAnimationFrame(loop);
    }

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}

export function mount(canvas, ctx, config) {
    return runDarken(canvas, ctx, config);
}
