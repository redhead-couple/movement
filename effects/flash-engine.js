// effects/flash-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let baseImage = null;
    let imageReady = false;
    let time = 0;

    // Default Config
    const cfg = {
        imgSrc: '',
        intensity: 2.0,     // Max brightness (1.0 = normal, 2.0+ = blinding)
        speed: 10,          // How fast the flash happens
        decay: 0.95,        // How fast it fades out (0-1)
        tint: '#ffffff',    // Flash color (White, Gold, Blue)
        bloom: 20,          // Blur amount for the glow
        triggerAtStart: true, // Flash immediately on load?
        hold: 0,            // How long to hold the whiteout before fading
        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    baseImage = imageResource.image;

    let currentExposure = cfg.triggerAtStart ? 0 : cfg.intensity;
    let state = 'attack'; // 'attack' (getting bright), 'hold', 'decay' (fading)
    let holdTimer = 0;

    // 1. Load Image
    if (cfg.imgSrc) {
        const markImageReady = () => {
            if (!active) return;
            imageReady = true;
            canvas.width = baseImage.width;
            canvas.height = baseImage.height;
            if (cfg.onResize) cfg.onResize(canvas);
        };
        if (imageResource.isPreloaded) {
            markImageReady();
        } else {
            baseImage.crossOrigin = "Anonymous";
            baseImage.onload = markImageReady;
            baseImage.src = cfg.imgSrc;
        }
    }

    function loop() {
        if (!active) return;
        const w = canvas.width;
        const h = canvas.height;

        // --- UPDATE PHYSICS ---
        // 1. Attack Phase (Explosion)
        if (state === 'attack') {
            currentExposure += (cfg.speed * 0.1);
            if (currentExposure >= cfg.intensity) {
                currentExposure = cfg.intensity;
                state = 'hold';
                holdTimer = cfg.hold;
            }
        }
        // 2. Hold Phase
        else if (state === 'hold') {
            if (holdTimer > 0) {
                holdTimer--;
            } else {
                state = 'decay';
            }
        }
        // 3. Decay Phase (Settling)
        else if (state === 'decay') {
            currentExposure = currentExposure * cfg.decay;
            // Stop computing if it's basically normal
            if (currentExposure < 0.01) currentExposure = 0;
        }

        // --- DRAW ---
        ctx.globalCompositeOperation = 'source-over';

        if (imageReady) {
            // Draw Base
            ctx.filter = 'none';
            ctx.globalAlpha = 1.0;
            ctx.drawImage(baseImage, 0, 0, w, h);

            // Draw "Bloom" Overlay
            if (currentExposure > 0.01) {
                ctx.save();

                // Use 'lighter' (Add) blend mode for exposure effect
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = Math.min(1, currentExposure);

                // Add the tint/glow
                ctx.filter = `blur(${cfg.bloom}px) brightness(${100 + (currentExposure * 50)}%)`;

                // We draw the image again on top to create the glow
                ctx.drawImage(baseImage, 0, 0, w, h);

                // Draw a solid color wash for extreme brightness
                ctx.globalCompositeOperation = 'screen';
                ctx.fillStyle = cfg.tint;
                ctx.globalAlpha = Math.min(1, currentExposure * 0.5); // Wash is subtler
                ctx.filter = 'none';
                ctx.fillRect(0, 0, w, h);

                ctx.restore();
            }
        } else {
            // Placeholder if no image
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
        }

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
