// effects/wave-engine.js

import { createEffectImage } from './effect-media.js';

export function runWave(canvas, ctx, config) {
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

        count: 5,
        color: '#ffffff',
        thickness: 2,

        // New / Exposed Params
        originX: 0.5,       // 0 = Left Edge, 1 = Right Edge
        opacity: 1.0,       // 0 = Transparent, 1 = Opaque

        freq: 0.02,
        speed: 10,
        amp: 20,
        spacing: 40,

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
        const timePassed = timestamp - startTimeStamp;

        // 1. Clear & Draw BG (Full Opacity)
        ctx.globalAlpha = 1.0;
        ctx.clearRect(0, 0, w, h);
        if (loaded) ctx.drawImage(baseImage, 0, 0, w, h);

        // 2. Check Timing
        if (timePassed < cfg.startTime) {
            animationId = requestAnimationFrame(loop);
            return;
        }

        if (cfg.duration > 0 && timePassed > (cfg.startTime + cfg.duration)) {
            animationId = requestAnimationFrame(loop);
            return;
        }

        // 3. Draw Waves
        ctx.save(); // Save context to restore opacity later
        ctx.globalAlpha = cfg.opacity; // Apply Wave Opacity
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = cfg.thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Calculate Center Line based on originX
        const cx = w * cfg.originX;

        const phase = (timePassed / 1000) * cfg.speed;

        for (let i = -cfg.count; i <= cfg.count; i++) {
            ctx.beginPath();

            // X position for this vertical line
            const baseX = cx + (i * cfg.spacing);

            const step = 10;
            for (let y = 0; y <= h; y += step) {
                // We add 'i' to phase so lines ripple differently
                const waveOffset = Math.sin(y * cfg.freq + phase + (i * 0.5)) * cfg.amp;
                const x = baseX + waveOffset;

                if (y === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        ctx.restore(); // Reset opacity
        animationId = requestAnimationFrame(loop);
    }

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}

export function mount(canvas, ctx, config) {
    return runWave(canvas, ctx, config);
}
