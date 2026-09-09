// effects/slideshow-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let startTime = null;

    // Configuration
    const cfg = {
        images: [],       // Array of image paths/URLs
        interval: 3.0,    // Time to hold each image
        transDuration: 1.0, // Time to animate between images
        transition: 'fade', // 'push-left', 'wipe-down', 'zoom', etc.
        fit: 'cover',     // 'cover' or 'contain'
        ...config
    };

    // State
    const imageObjects = [];
    let loadedCount = 0;
    let allLoaded = false;
    let canvasResized = false; // New Flag

    // 1. PRELOADER LOGIC
    if (cfg.images && cfg.images.length > 0) {
        cfg.images.forEach((src, index) => {
            const imageResource = createEffectImage(cfg, src);
            const img = imageResource.image;
            const imageReady = () => {
                loadedCount++;

                // FIX: Resize canvas based on the FIRST image loaded
                // (We try to stick to the first image in the list if possible)
                if (!canvasResized && index === 0) {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    canvasResized = true;
                    if (cfg.onResize) cfg.onResize(canvas);
                }

                if (loadedCount === cfg.images.length) {
                    allLoaded = true;
                }
            };
            const imageError = () => {
                loadedCount++;
                if (loadedCount === cfg.images.length) allLoaded = true;
            };
            if (imageResource.isPreloaded) {
                imageReady();
            } else {
                img.crossOrigin = "Anonymous";
                img.onload = imageReady;
                img.onerror = imageError;
                img.src = src;
            }
            imageObjects.push(img);
        });
    }

    function drawImageProp(img, x, y, w, h, offsetX, offsetY) {
        if (!img.width) return;

        // Default to "Cover" fit
        let iw = img.width, ih = img.height;
        let r = Math.min(w / iw, h / ih);
        let nw = iw * r, nh = ih * r;
        let ar = 1;

        if (cfg.fit === 'cover') {
            const scale = Math.max(w / iw, h / ih);
            const sw = w / scale;
            const sh = h / scale;
            const sx = (iw - sw) / 2;
            const sy = (ih - sh) / 2;
            ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        } else {
            ctx.drawImage(img, x, y, w, h);
        }
    }

    // --- TRANSITION DRAWING FUNCTIONS ---
    function drawTransition(img1, img2, p, w, h, type) {
        if (type === 'fade' || type === 'dissolve') {
            drawImageProp(img1, 0, 0, w, h);
            ctx.globalAlpha = p;
            drawImageProp(img2, 0, 0, w, h);
            ctx.globalAlpha = 1.0;
        }
        else if (type.startsWith('push')) {
            let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
            const ease = p;

            if (type === 'push-left') {
                x1 = -w * ease; x2 = w * (1 - ease);
            } else if (type === 'push-right') {
                x1 = w * ease; x2 = -w * (1 - ease);
            } else if (type === 'push-up') {
                y1 = -h * ease; y2 = h * (1 - ease);
            } else if (type === 'push-down') {
                y1 = h * ease; y2 = -h * (1 - ease);
            }

            drawImageProp(img1, x1, y1, w, h);
            drawImageProp(img2, x2, y2, w, h);
        }
        else if (type.startsWith('wipe')) {
            drawImageProp(img1, 0, 0, w, h);

            if (type === 'wipe-left') {
                ctx.save();
                ctx.beginPath();
                ctx.rect(w * (1 - p), 0, w * p, h);
                ctx.clip();
                drawImageProp(img2, 0, 0, w, h);
                ctx.restore();
            }
            else if (type === 'wipe-right') {
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, w * p, h);
                ctx.clip();
                drawImageProp(img2, 0, 0, w, h);
                ctx.restore();
            }
            else if (type === 'wipe-up') {
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, h * (1 - p), w, h * p);
                ctx.clip();
                drawImageProp(img2, 0, 0, w, h);
                ctx.restore();
            }
            else if (type === 'wipe-down') {
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, w, h * p);
                ctx.clip();
                drawImageProp(img2, 0, 0, w, h);
                ctx.restore();
            }
        }
        else if (type === 'zoom') {
            ctx.save();
            ctx.globalAlpha = 1.0;
            const s1 = 1.0 + (0.5 * p);
            ctx.translate(w / 2, h / 2);
            ctx.scale(s1, s1);
            ctx.translate(-w / 2, -h / 2);
            drawImageProp(img1, 0, 0, w, h);
            ctx.restore();

            ctx.save();
            ctx.globalAlpha = p;
            const s2 = 1.5 - (0.5 * p);
            ctx.translate(w / 2, h / 2);
            ctx.scale(s2, s2);
            ctx.translate(-w / 2, -h / 2);
            drawImageProp(img2, 0, 0, w, h);
            ctx.restore();
        }
        else {
            drawImageProp(img2, 0, 0, w, h);
        }
    }


    function loop(timestamp) {
        if (!active) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // 1. Loading Screen
        if (!allLoaded) {
            // Do not reveal incremental loading progress inside a visual effect.
            // The slideshow begins only when its complete image set is ready.
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
            animationId = requestAnimationFrame(loop);
            return;
        }

        // FIX: Fallback resize if preloader missed it (e.g. cached images)
        if (!canvasResized && imageObjects[0] && imageObjects[0].width) {
            canvas.width = imageObjects[0].width;
            canvas.height = imageObjects[0].height;
            canvasResized = true;
            if (cfg.onResize) cfg.onResize(canvas);
        }

        // 2. Logic
        if (!startTime) startTime = timestamp;
        const totalTime = (timestamp - startTime) / 1000;
        const cycleDuration = cfg.interval + cfg.transDuration;
        const totalCycleIndex = Math.floor(totalTime / cycleDuration);

        const count = imageObjects.length;
        const currentIndex = totalCycleIndex % count;
        const nextIndex = (currentIndex + 1) % count;

        const timeInCycle = totalTime % cycleDuration;
        const img1 = imageObjects[currentIndex];
        const img2 = imageObjects[nextIndex];

        // 3. Draw
        if (timeInCycle < cfg.interval) {
            drawImageProp(img1, 0, 0, w, h);
        } else {
            const transTime = timeInCycle - cfg.interval;
            let progress = transTime / cfg.transDuration;
            if (progress > 1) progress = 1;
            drawTransition(img1, img2, progress, w, h, cfg.transition);
        }

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
