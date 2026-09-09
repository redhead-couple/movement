// effects/slide-engine.js

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
        imgSrc: '',       // Leaving Image
        imgSrc2: '',      // Entering Image

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

        // 1. Calculate Progress
        let progress = 0;
        if (timeElapsed > cfg.startDelay) {
            progress = (timeElapsed - cfg.startDelay) / cfg.duration;
            if (progress > 1) progress = 1;
        }

        // 2. Calculate Coordinates
        const offX = w * progress;
        const offY = h * progress;

        let x1 = 0, y1 = 0; // Old Image Position
        let x2 = 0, y2 = 0; // New Image Position
        let seamX = 0, seamY = 0, isVertical = false;

        if (cfg.direction === 'left') {
            // Push Left: Old moves Left, New enters from Right
            x1 = -offX;
            x2 = w - offX;
            seamX = x2;
        } else if (cfg.direction === 'right') {
            // Push Right: Old moves Right, New enters from Left
            x1 = offX;
            x2 = offX - w;
            seamX = x1;
        } else if (cfg.direction === 'up') {
            // Push Up: Old moves Up, New enters from Bottom
            y1 = -offY;
            y2 = h - offY;
            seamY = y2;
            isVertical = true;
        } else if (cfg.direction === 'down') {
            // Push Down: Old moves Down, New enters from Top
            y1 = offY;
            y2 = offY - h;
            seamY = y1;
            isVertical = true;
        }

        // 3. Draw
        ctx.clearRect(0, 0, w, h);

        if (img1Ready) ctx.drawImage(img1, x1, y1, w, h);
        if (img2Ready) ctx.drawImage(img2, x2, y2, w, h);

        // 4. Draw Seam (Shadow Line)
        if (progress > 0 && progress < 1) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 2;

            if (isVertical) {
                // Horizontal line moving up/down
                ctx.moveTo(0, seamY);
                ctx.lineTo(w, seamY);
            } else {
                // Vertical line moving left/right
                ctx.moveTo(seamX, 0);
                ctx.lineTo(seamX, h);
            }
            ctx.stroke();
        }

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
