// effects/affection-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let particles = [];
    let animationId = null;
    let baseImage = null;
    let imageReady = false;

    // Default Configuration
    const cfg = {
        imgSrc: '',
        startX: 0.2, startY: 0.5, // Start Point (0-1)
        endX: 0.8, endY: 0.5,   // End Point (0-1)

        speed: 0.5,
        flowRate: 5,
        spread: 20,
        curveHeight: -100,

        shape: 'orb',
        color: '#ffb6c1',
        size: 15,

        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    baseImage = imageResource.image;

    console.log("Affection v2 Started:", cfg);

    // 1. Force a default size immediately so canvas is never 0x0
    if (canvas.width === 0) {
        canvas.width = 800;
        canvas.height = 600;
    }

    // 2. Load Image (Fire and Forget)
    if (cfg.imgSrc) {
        const markImageReady = () => {
            if (!active) return;
            imageReady = true;
            console.log("Image Loaded OK");
            // Resize canvas to match image exactly
            canvas.width = baseImage.width;
            canvas.height = baseImage.height;
            if (cfg.onResize) cfg.onResize(canvas);
        };
        if (imageResource.isPreloaded) {
            markImageReady();
        } else {
            baseImage.crossOrigin = "Anonymous";
            baseImage.onload = markImageReady;
            baseImage.onerror = () => {
                console.error("Image FAILED:", cfg.imgSrc);
            };
            baseImage.src = cfg.imgSrc;
            if (baseImage.complete && baseImage.naturalWidth > 0) markImageReady();
        }
    }

    // --- Drawing Helpers ---
    function drawHeart(ctx, x, y, size) {
        ctx.beginPath();
        const topCurveHeight = size * 0.3;
        ctx.moveTo(x, y + topCurveHeight);
        ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + topCurveHeight);
        ctx.bezierCurveTo(x - size / 2, y + (size + topCurveHeight) / 2, x, y + (size + topCurveHeight) / 2, x, y + size);
        ctx.bezierCurveTo(x, y + (size + topCurveHeight) / 2, x + size / 2, y + (size + topCurveHeight) / 2, x + size / 2, y + topCurveHeight);
        ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + topCurveHeight);
        ctx.fill();
    }

    // --- Main Loop ---
    function loop() {
        if (!active) return;

        const w = canvas.width;
        const h = canvas.height;

        // A. Background Layer
        ctx.clearRect(0, 0, w, h);

        if (imageReady) {
            ctx.drawImage(baseImage, 0, 0, w, h);
        } else {
            // DEBUG MODE: If image missing, show placeholder
            ctx.fillStyle = "#222";
            ctx.fillRect(0, 0, w, h);

            // Draw grid to prove it's alive
            ctx.strokeStyle = "#444";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(w, h);
            ctx.moveTo(w, 0); ctx.lineTo(0, h);
            ctx.stroke();

            ctx.fillStyle = "#fff";
            ctx.font = "20px monospace";
            ctx.fillText(cfg.imgSrc ? "LOADING..." : "NO IMAGE SET", 20, 30);
        }

        // B. Spawn Particles
        if (Math.random() * 10 < cfg.flowRate) {
            particles.push({
                t: 0,
                offX: (Math.random() - 0.5) * cfg.spread,
                offY: (Math.random() - 0.5) * cfg.spread,
                speedMod: 0.8 + Math.random() * 0.4,
                sizeMod: 0.5 + Math.random() * 0.5
            });
        }

        // C. Draw Particles
        ctx.fillStyle = cfg.color;

        // Calculate Bezier Points
        const sx = cfg.startX * w;
        const sy = cfg.startY * h;
        const ex = cfg.endX * w;
        const ey = cfg.endY * h;

        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;

        // Control Point (The peak of the curve)
        const cx = mx;
        const cy = my + cfg.curveHeight;

        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];

            // Move
            p.t += 0.005 * cfg.speed * p.speedMod;

            if (p.t >= 1) { particles.splice(i, 1); continue; }

            // Quadratic Bezier Formula
            const invT = 1 - p.t;
            const x = (invT * invT * sx) + (2 * invT * p.t * cx) + (p.t * p.t * ex);
            const y = (invT * invT * sy) + (2 * invT * p.t * cy) + (p.t * p.t * ey);

            const finalX = x + p.offX;
            const finalY = y + p.offY;

            // Fade in/out logic
            let alpha = 1;
            if (p.t < 0.2) alpha = p.t * 5;
            if (p.t > 0.8) alpha = (1 - p.t) * 5;

            ctx.globalAlpha = alpha;
            const size = cfg.size * p.sizeMod;

            if (cfg.shape === 'heart') {
                drawHeart(ctx, finalX, finalY, size);
            } else {
                ctx.beginPath();
                ctx.arc(finalX, finalY, size / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1.0;
        animationId = requestAnimationFrame(loop);
    }

    // Start immediately (Do not wait for load)
    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}

export const runAffection = mount;
