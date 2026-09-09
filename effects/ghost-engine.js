// effects/ghost-engine.js

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
        opacity: 0.5,       // How visible is the ghost?
        blendMode: 'screen',// 'screen', 'overlay', 'source-over', 'lighter'

        driftX: 20,         // Max horizontal drift (pixels)
        driftY: 0,          // Max vertical drift (pixels)

        scalePulse: 0.05,   // How much it zooms in/out (0.05 = 5%)
        speed: 2,           // Speed of the movement

        mirror: false,      // If true, flips the ghost (Reflection style)

        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    baseImage = imageResource.image;

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

        // Update Time
        time += 0.01 * cfg.speed;

        const w = canvas.width;
        const h = canvas.height;

        // 1. Clear & Draw Main Image (The "Real" World)
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
        ctx.clearRect(0, 0, w, h);

        if (imageReady) {
            ctx.drawImage(baseImage, 0, 0, w, h);

            // 2. Calculate Ghost Position
            // We use Sine waves to make it "float"
            const offsetX = Math.sin(time) * cfg.driftX;
            const offsetY = Math.cos(time * 0.7) * cfg.driftY; // 0.7 makes it out of sync with X
            const scale = 1 + (Math.sin(time * 1.5) * cfg.scalePulse);

            // 3. Draw The Ghost (The "Memory")
            ctx.save(); // Save current state

            // Set Blend Mode
            ctx.globalCompositeOperation = cfg.blendMode;
            ctx.globalAlpha = cfg.opacity;

            // Move to center to handle scaling correctly
            ctx.translate(w / 2, h / 2);

            // Apply Transformations
            ctx.translate(offsetX, offsetY);
            ctx.scale(scale, scale);

            if (cfg.mirror) {
                ctx.scale(-1, 1); // Flip horizontally
            }

            // Draw image centered at (0,0)
            ctx.drawImage(baseImage, -w / 2, -h / 2, w, h);

            ctx.restore(); // Restore state
        }

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
