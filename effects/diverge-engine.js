// effects/diverge-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let img = null;
    let imgReady = false;
    let startTime = null;

    const cfg = {
        imgSrc: '',

        // Colors for the two beams
        color1: '#3b82f6', // Left or Top Beam (Blue default)
        color2: '#ef4444', // Right or Bottom Beam (Red default)

        axis: 'horizontal', // 'horizontal' or 'vertical'

        thickness: 200,    // How thick the beam is in pixels
        intensity: 0.8,    // Opacity/Brightness (0.0 - 1.0)

        duration: 3.0,     // Total time
        startDelay: 0.0,   // Wait time

        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    img = imageResource.image;

    // Load Background
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

    // Smooth easing for the expansion
    function easeOutCubic(x) {
        return 1 - Math.pow(1 - x, 3);
    }

    function drawBeam(x, y, w, h, color, direction, progress, globalAlpha) {
        ctx.save();

        // Use 'lighter' for a glowing light effect
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = globalAlpha * cfg.intensity;

        // Create Gradient based on direction
        // The gradient goes from OPAQUE (Center) to TRANSPARENT (Edge)
        let grad;

        if (direction === 'left') {
            // Gradient starts at Center (x) and goes Left (x - len)
            const len = (w / 2) * progress; // Length grows with progress
            grad = ctx.createLinearGradient(x, y, x - len, y);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            // Draw rect: from end-point to center
            ctx.fillRect(x - len, y - cfg.thickness / 2, len, cfg.thickness);

        } else if (direction === 'right') {
            const len = (w / 2) * progress;
            grad = ctx.createLinearGradient(x, y, x + len, y);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y - cfg.thickness / 2, len, cfg.thickness);

        } else if (direction === 'up') {
            const len = (h / 2) * progress;
            grad = ctx.createLinearGradient(x, y, x, y - len);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(x - cfg.thickness / 2, y - len, cfg.thickness, len);

        } else if (direction === 'down') {
            const len = (h / 2) * progress;
            grad = ctx.createLinearGradient(x, y, x, y + len);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(x - cfg.thickness / 2, y, cfg.thickness, len);
        }

        // Add a secondary "blur" pass to make edges soft
        // (Simulated by drawing a wider, fainter rect behind or using shadow)
        // For performance, the linear gradient transparency handles most of the "blend"

        ctx.restore();
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startTime) startTime = timestamp;

        const timeElapsed = (timestamp - startTime) / 1000;
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // 1. Draw Background
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
        if (imgReady) ctx.drawImage(img, 0, 0, w, h);

        // 2. Calculate Progress
        if (timeElapsed > cfg.startDelay) {
            let p = (timeElapsed - cfg.startDelay) / cfg.duration;
            if (p > 1) p = 1;

            // A. Expansion Phase (0% -> 100% reach)
            // It reaches full length quickly, then stays
            let expand = easeOutCubic(p);

            // B. Fade Out Phase (Last 20%)
            let alpha = 1.0;
            if (p > 0.8) {
                alpha = 1.0 - ((p - 0.8) / 0.2);
                if (alpha < 0) alpha = 0;
            }

            if (alpha > 0) {
                if (cfg.axis === 'horizontal') {
                    // Left Beam
                    drawBeam(cx, cy, w, h, cfg.color1, 'left', expand, alpha);
                    // Right Beam
                    drawBeam(cx, cy, w, h, cfg.color2, 'right', expand, alpha);
                } else {
                    // Top Beam
                    drawBeam(cx, cy, w, h, cfg.color1, 'up', expand, alpha);
                    // Bottom Beam
                    drawBeam(cx, cy, w, h, cfg.color2, 'down', expand, alpha);
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
