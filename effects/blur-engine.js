// effects/blur-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let img1 = null;
    let imgReady = false;
    let startTime = null;

    const cfg = {
        imgSrc: '',          // Target Image
        duration: 3.0,       // How long the animation takes
        startDelay: 0.0,     // Wait before starting
        blurIntensity: 20,   // Max blur in px (e.g. 20)
        mode: 'in',          // 'in': starts blurry -> sharp. 'out': starts sharp -> blurry.
        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    img1 = imageResource.image;

    // Load Image
    if (cfg.imgSrc) {
        if (imageResource.isPreloaded) {
            imgReady = true;
            checkStart();
        } else {
            if (!cfg.imgSrc.startsWith('data:')) img1.crossOrigin = "Anonymous";
            img1.onload = () => { imgReady = true; checkStart(); };
            img1.src = cfg.imgSrc;
        }
    }

    function checkStart() {
        if (!active) return;
        // Resize canvas to match image
        if (imgReady && img1.width) {
            canvas.width = img1.width;
            canvas.height = img1.height;
        }
        if (cfg.onResize) cfg.onResize(canvas);
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startTime) startTime = timestamp;

        const timeElapsed = (timestamp - startTime) / 1000;
        const w = canvas.width;
        const h = canvas.height;

        // Clear canvas but keep it transparent or black depending on the environment
        ctx.clearRect(0, 0, w, h);

        if (imgReady) {
            // 1. Calculate Progress (0.0 to 1.0)
            let p = 0;
            if (timeElapsed > cfg.startDelay) {
                p = (timeElapsed - cfg.startDelay) / cfg.duration;
                if (p > 1) p = 1;
            }

            // 2. Calculate current blur amount
            let currentBlur = 0;
            if (cfg.mode === 'in') {
                // Starts at max blur, goes down to 0
                currentBlur = cfg.blurIntensity * (1.0 - p);
            } else {
                // Starts at 0, goes up to max blur
                currentBlur = cfg.blurIntensity * p;
            }

            // 3. Draw Image with the calculated filter
            ctx.save();
            ctx.filter = `blur(${currentBlur}px)`;

            // Draw image to fill bounds optimally or just centered depending on ratio
            ctx.drawImage(img1, 0, 0, w, h);

            ctx.restore();
        }

        // Loop while active
        if (active) {
            animationId = requestAnimationFrame(loop);
        }
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        if (animationId) cancelAnimationFrame(animationId);
    };
}
