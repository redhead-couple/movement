// effects/morph-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let img1 = null;
    let img2 = null;
    let img1Ready = false;
    let img2Ready = false;
    let startTime = null;

    const cfg = {
        imgSrc: '',       // Starting Image
        imgSrc2: '',      // Ending Image

        duration: 3.0,    // How long the morph takes
        startDelay: 0.0,  // Wait before starting

        zoomAmount: 0.1,  // How much movement? (0.1 = 10% zoom)

        ...config
    };
    const secondSource = cfg.imgSrc2 || cfg.imgSrc;
    const imageResource1 = createEffectImage(cfg, cfg.imgSrc);
    const imageResource2 = createEffectImage(cfg, secondSource);
    img1 = imageResource1.image;
    img2 = imageResource2.image;

    // Load Images
    if (cfg.imgSrc) {
        if (imageResource1.isPreloaded) {
            img1Ready = true;
            checkStart();
        } else {
            if (!cfg.imgSrc.startsWith('data:')) img1.crossOrigin = "Anonymous";
            img1.onload = () => { img1Ready = true; checkStart(); };
            img1.src = cfg.imgSrc;
        }
    }
    if (cfg.imgSrc2) {
        if (imageResource2.isPreloaded) {
            img2Ready = true;
            checkStart();
        } else {
            if (!cfg.imgSrc2.startsWith('data:')) img2.crossOrigin = "Anonymous";
            img2.onload = () => { img2Ready = true; checkStart(); };
            img2.src = cfg.imgSrc2;
        }
    } else if (cfg.imgSrc) {
        // Fallback: If no second image is provided, just morph the first image into itself (acts as a zoom effect)
        if (imageResource2.isPreloaded) {
            img2Ready = true;
            checkStart();
        } else {
            if (!cfg.imgSrc.startsWith('data:')) img2.crossOrigin = "Anonymous";
            img2.onload = () => { img2Ready = true; checkStart(); };
            img2.src = cfg.imgSrc;
        }
    }

    function checkStart() {
        if (!active) return;
        // Resize canvas to match first image
        if (img1Ready && img1.width) {
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

        ctx.clearRect(0, 0, w, h);

        // 1. Calculate Progress (0.0 to 1.0)
        let p = 0;
        if (timeElapsed > cfg.startDelay) {
            p = (timeElapsed - cfg.startDelay) / cfg.duration;
            if (p > 1) p = 1;
        }

        // 2. Draw Image 1 (The Leaver)
        // It starts at Scale 1.0 and grows to (1.0 + zoom)
        // It fades from Opacity 1.0 to 0.0
        if (img1Ready) {
            const scale1 = 1.0 + (cfg.zoomAmount * p);
            const alpha1 = 1.0 - p;

            if (alpha1 > 0) {
                ctx.save();
                ctx.globalAlpha = alpha1;

                // Draw centered zoom
                const dw = w * scale1;
                const dh = h * scale1;
                const dx = (w - dw) / 2;
                const dy = (h - dh) / 2;

                ctx.drawImage(img1, dx, dy, dw, dh);
                ctx.restore();
            }
        }

        // 3. Draw Image 2 (The Enterer)
        // It starts smaller at Scale (1.0 - zoom) and grows to 1.0
        // It fades from Opacity 0.0 to 1.0
        if (img2Ready) {
            const scale2 = (1.0 - cfg.zoomAmount) + (cfg.zoomAmount * p);
            const alpha2 = p;

            if (alpha2 > 0) {
                ctx.save();
                ctx.globalAlpha = alpha2;

                // Draw centered zoom
                const dw = w * scale2;
                const dh = h * scale2;
                const dx = (w - dw) / 2;
                const dy = (h - dh) / 2;

                ctx.drawImage(img2, dx, dy, dw, dh);
                ctx.restore();
            }
        }

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
