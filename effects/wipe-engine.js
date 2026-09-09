// effects/wipe-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let img1 = null;
    let img2 = null;
    let img1Ready = false;
    let img2Ready = false;
    let startTime = null;

    // Default Configuration
    const cfg = {
        imgSrc: '',       // Base Image
        imgSrc2: '',      // Wipe Image (The one appearing)

        startDelay: 0.0,
        duration: 2.0,

        direction: 'left', // 'left', 'right', 'up', 'down'
        ...config
    };
    const imageResource1 = createEffectImage(cfg, cfg.imgSrc);
    const imageResource2 = createEffectImage(cfg, cfg.imgSrc2);
    img1 = imageResource1.image;
    img2 = imageResource2.image;

    // 1. Load Images
    if (cfg.imgSrc) {
        if (imageResource1.isPreloaded) {
            img1Ready = true;
            checkStart();
        } else {
            img1.crossOrigin = "Anonymous";
            img1.onload = () => { img1Ready = true; checkStart(); };
            img1.src = cfg.imgSrc;
        }
    }

    if (cfg.imgSrc2) {
        if (imageResource2.isPreloaded) {
            img2Ready = true;
            checkStart();
        } else {
            img2.crossOrigin = "Anonymous";
            img2.onload = () => { img2Ready = true; checkStart(); };
            img2.src = cfg.imgSrc2;
        }
    }

    function checkStart() {
        if (!active) return;
        if (img1Ready && img1.width) {
            canvas.width = img1.width;
            canvas.height = img1.height;
        } else if (img2Ready && img2.width) {
            canvas.width = img2.width;
            canvas.height = img2.height;
        }
        if (cfg.onResize) cfg.onResize(canvas);
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startTime) startTime = timestamp;

        const timeElapsed = (timestamp - startTime) / 1000;
        const w = canvas.width;
        const h = canvas.height;

        // 1. Clear & Draw Base
        ctx.clearRect(0, 0, w, h);
        if (img1Ready) ctx.drawImage(img1, 0, 0, w, h);

        // 2. Draw Wipe (Clipped)
        if (img2Ready) {
            let progress = 0;
            if (timeElapsed > cfg.startDelay) {
                progress = (timeElapsed - cfg.startDelay) / cfg.duration;
                if (progress > 1) progress = 1;
            }

            // If progress is 0, we don't draw img2 yet
            if (progress > 0) {
                let sx, sy, sw, sh, dx, dy, dw, dh;
                let seamX1, seamY1, seamX2, seamY2;

                // --- DIRECTION LOGIC ---
                if (cfg.direction === 'right') {
                    // Reveal from Right side moving Left
                    // We draw the RIGHT slice of the image
                    const sliceW = w * progress;

                    sx = w - sliceW; sy = 0; sw = sliceW; sh = h;
                    dx = w - sliceW; dy = 0; dw = sliceW; dh = h;

                    // Seam line
                    seamX1 = w - sliceW; seamY1 = 0;
                    seamX2 = w - sliceW; seamY2 = h;

                } else if (cfg.direction === 'up') {
                    // Reveal from Bottom moving Up
                    const sliceH = h * progress;

                    sx = 0; sy = h - sliceH; sw = w; sh = sliceH;
                    dx = 0; dy = h - sliceH; dw = w; dh = sliceH;

                    seamX1 = 0; seamY1 = h - sliceH;
                    seamX2 = w; seamY2 = h - sliceH;

                } else if (cfg.direction === 'down') {
                    // Reveal from Top moving Down
                    const sliceH = h * progress;

                    sx = 0; sy = 0; sw = w; sh = sliceH;
                    dx = 0; dy = 0; dw = w; dh = sliceH;

                    seamX1 = 0; seamY1 = sliceH;
                    seamX2 = w; seamY2 = sliceH;

                } else {
                    // Default: 'left' (Reveal from Left moving Right)
                    const sliceW = w * progress;

                    sx = 0; sy = 0; sw = sliceW; sh = h;
                    dx = 0; dy = 0; dw = sliceW; dh = h;

                    seamX1 = sliceW; seamY1 = 0;
                    seamX2 = sliceW; seamY2 = h;
                }

                // Draw Slice
                ctx.drawImage(img2, sx, sy, sw, sh, dx, dy, dw, dh);

                // Draw Seam Line (White/Frosty)
                if (progress < 1) {
                    ctx.beginPath();
                    ctx.moveTo(seamX1, seamY1);
                    ctx.lineTo(seamX2, seamY2);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
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
