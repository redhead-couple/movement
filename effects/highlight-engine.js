// effects/highlight-engine.js

import { createEffectImage } from './effect-media.js';

export const schema = {
    imgSrc: { type: 'string', hidden: true, default: '' },
    x: { type: 'number', hidden: true, default: 0.5 },
    y: { type: 'number', hidden: true, default: 0.5 },
    shape: { type: 'enum', options: ['star', 'sphere'], default: 'star', label: 'Marker Shape' },
    zoom: { type: 'number', min: 1, max: 3, step: 0.1, default: 1.5, label: 'Zoom Level' },
    duration: { type: 'number', min: 0.1, max: 10, step: 0.1, default: 1.5, label: 'Pop Duration (s)' },
    startDelay: { type: 'number', min: 0, max: 10, step: 0.1, default: 0.0, label: 'Start Delay (s)' },
    color: { type: 'color', default: '#fbbf24', label: 'Marker Color' },
    size: { type: 'number', min: 10, max: 200, step: 1, default: 50, label: 'Marker Size' }
};

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let img = null;
    let imgReady = false;
    let startTime = null;

    const cfg = {
        imgSrc: '',
        x: 0.5, y: 0.5,
        shape: 'star',
        zoom: 1.5,
        duration: 1.5,
        startDelay: 0.0,
        color: '#fbbf24',
        size: 50,
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

    function easeOutExpo(x) {
        return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
    }

    function drawStar(cx, cy, spikes, outerRadius, innerRadius) {
        let rot = Math.PI / 2 * 3;
        let x = cx;
        let y = cy;
        let step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
            x = cx + Math.cos(rot) * outerRadius;
            y = cy + Math.sin(rot) * outerRadius;
            ctx.lineTo(x, y);
            rot += step;

            x = cx + Math.cos(rot) * innerRadius;
            y = cy + Math.sin(rot) * innerRadius;
            ctx.lineTo(x, y);
            rot += step;
        }
        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
        ctx.fillStyle = cfg.color;
        ctx.fill();

        ctx.shadowColor = cfg.color;
        ctx.shadowBlur = 20;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    function drawSphere(cx, cy, radius) {
        const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.4, cfg.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    function loop(timestamp) {
        if (!active) return;
        if (!startTime) startTime = timestamp;

        const timeElapsed = (timestamp - startTime) / 1000;
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        if (imgReady) {
            let progress = 0;
            if (timeElapsed > cfg.startDelay) {
                progress = (timeElapsed - cfg.startDelay) / cfg.duration;
                if (progress > 1) progress = 1;
            }

            const ease = easeOutExpo(progress);

            // --- 1. HANDLE ZOOM (This stays held) ---
            ctx.save();
            const tx = w * cfg.x;
            const ty = h * cfg.y;
            const currentScale = 1 + ((cfg.zoom - 1) * ease);

            ctx.translate(tx, ty);
            ctx.scale(currentScale, currentScale);
            ctx.translate(-tx, -ty);
            ctx.drawImage(img, 0, 0, w, h);

            // --- 2. DRAW MARKER (With Fade Out) ---
            if (progress > 0) {
                // A. Entrance Animation (Pop)
                let pop = Math.sin(progress * Math.PI * 1.5);
                if (progress >= 0.5) pop = 1.0;
                if (progress < 0) pop = 0;

                // B. Exit Animation (Fade Out) - NEW LOGIC
                // Starts fading at 80% completion, gone by 100%
                let alpha = 1.0;
                if (progress > 0.8) {
                    // Map 0.8->1.0 range to 1.0->0.0 opacity
                    alpha = 1.0 - ((progress - 0.8) / 0.2);
                    if (alpha < 0) alpha = 0;
                }

                // Only draw if visible
                if (alpha > 0) {
                    ctx.save(); // Save context again for the marker settings
                    ctx.globalAlpha = alpha; // Apply the fade

                    if (cfg.shape === 'star') {
                        ctx.translate(tx, ty);
                        ctx.rotate(progress * Math.PI * 2);
                        ctx.translate(-tx, -ty);
                        const size = cfg.size * pop;
                        drawStar(tx, ty, 5, size, size / 2);
                    } else {
                        const size = cfg.size * 1.5 * pop;
                        drawSphere(tx, ty, size);
                    }
                    ctx.restore();
                }
            }

            ctx.restore(); // Restore zoom context
        }

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
