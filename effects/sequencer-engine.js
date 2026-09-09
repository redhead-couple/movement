// effects/sequencer-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let img = null;
    let imgReady = false;
    let startTime = null;

    const cfg = {
        imgSrc: '',
        points: [],

        interval: 0.5,
        startDelay: 0.0,

        color: '#ffffff',
        size: 30,

        // --- NEW FEATURES ---
        intensity: 1.0,    // Transparency (0.0 - 1.0)
        darken: 0.5,       // Background Darkening (0.0 - 1.0)
        dispersion: 0.8,   // 0.0 = Hard Edge, 1.0 = Very Soft Glow

        fadeSpeed: 0.5,
        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    img = imageResource.image;

    if (cfg.imgSrc) {
        if (imageResource.isPreloaded) {
            imgReady = true;
            checkStart();
        } else {
            img.crossOrigin = "Anonymous";
            img.onload = () => { imgReady = true; checkStart(); };
            img.src = cfg.imgSrc;
        }
    }

    function checkStart() {
        if (!active) return;
        if (imgReady && img.width) {
            canvas.width = img.width;
            canvas.height = img.height;
        }
        if (cfg.onResize) cfg.onResize(canvas);
    }

    function drawLight(x, y, alpha) {
        if (alpha <= 0) return;

        ctx.save();

        // 1. Set Blend Mode
        // 'screen' or 'lighter' blends nicely with the background
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha * cfg.intensity;

        // 2. Calculate Dispersion (Softness)
        // Hard center depends on dispersion.
        // High dispersion (1.0) = Tiny center (0.05), mostly glow.
        // Low dispersion (0.0) = Large center (0.8), hard edge.
        const centerSize = 1.0 - (cfg.dispersion * 0.95);

        const grad = ctx.createRadialGradient(x, y, cfg.size * centerSize, x, y, cfg.size);
        grad.addColorStop(0, cfg.color); // Hot center
        grad.addColorStop(1, 'rgba(0,0,0,0)'); // Fade out

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, cfg.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startTime) startTime = timestamp;

        const timeElapsed = (timestamp - startTime) / 1000;
        const w = canvas.width;
        const h = canvas.height;

        // 1. Draw Background
        ctx.clearRect(0, 0, w, h);
        if (imgReady) {
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, 0, 0, w, h);
        }

        // --- NEW: Apply Global Darken ---
        if (cfg.darken > 0) {
            ctx.fillStyle = 'black';
            ctx.globalAlpha = cfg.darken; // e.g. 0.5 = 50% dark
            ctx.fillRect(0, 0, w, h);
        }

        // 2. Draw Lights
        if (cfg.points && cfg.points.length > 0) {
            const sequenceTime = timeElapsed - cfg.startDelay;

            if (sequenceTime > 0) {
                cfg.points.forEach((pt, index) => {
                    const myStartTime = index * cfg.interval;
                    const myLife = sequenceTime - myStartTime;

                    if (myLife > 0) {
                        let fade = myLife / cfg.fadeSpeed;
                        if (fade > 1) fade = 1;

                        const px = pt.x * w;
                        const py = pt.y * h;

                        drawLight(px, py, fade);
                    }
                });
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
