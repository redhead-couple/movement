// effects/rain-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let particles = [];
    let animationId = null;
    let baseImage = null;
    let imageReady = false;
    let luminanceMap = null;

    // Default Configuration
    const cfg = {
        imgSrc: '',
        count: 100,
        speed: 15,
        wind: 0,
        length: 20,
        color: '#a3c1e0',
        opacity: 0.6,
        splashBounce: 0.3,
        darknessReact: 0.0,
        blendMode: 'source-over', // NEW: 'source-over' (Normal), 'screen' (Brightness), 'overlay'
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
            if (cfg.darknessReact > 0) generateLuminanceMap(canvas, ctx, baseImage);
            if (cfg.onResize) cfg.onResize(canvas);
        };
        if (imageResource.isPreloaded) {
            markImageReady();
        } else {
            baseImage.crossOrigin = "Anonymous";
            baseImage.onload = markImageReady;
            baseImage.src = cfg.imgSrc;
        }
    } else {
        canvas.width = 800;
        canvas.height = 600;
    }

    function generateLuminanceMap(cvs, cx, img) {
        try {
            cx.drawImage(img, 0, 0, cvs.width, cvs.height);
            const imgData = cx.getImageData(0, 0, cvs.width, cvs.height);
            const data = imgData.data;
            luminanceMap = new Uint8Array(cvs.width * cvs.height);
            for (let i = 0; i < data.length; i += 4) {
                luminanceMap[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            }
        } catch (error) {
            // Some browsers protect pixel reads from file:// images. The rain
            // remains playable; only the optional darkness response is skipped.
            luminanceMap = null;
        }
    }

    // 2. Initialize Particles
    for (let i = 0; i < cfg.count; i++) {
        particles.push(createDrop(canvas.width, canvas.height));
    }

    function createDrop(w, h) {
        return {
            x: Math.random() * w,
            y: Math.random() * -h,
            l: Math.random() * cfg.length + cfg.length / 2,
            vy: Math.random() * 5 + cfg.speed,
            state: 'falling',
            life: 1
        };
    }

    function loop() {
        if (!active) return;
        const w = canvas.width;
        const h = canvas.height;

        // A. Clear & Draw BG (Always Normal Mode for BG)
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, w, h);
        if (imageReady) {
            ctx.drawImage(baseImage, 0, 0, w, h);
        }

        // B. Set Blend Mode for Rain
        // 'screen' makes it look like light (Brightness)
        // 'source-over' is standard paint (Opacity)
        ctx.globalCompositeOperation = cfg.blendMode;

        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';

        for (let i = 0; i < particles.length; i++) {
            let p = particles[i];

            if (p.state === 'falling') {
                p.y += p.vy;
                p.x += cfg.wind;

                // Smart Opacity Logic
                let alpha = cfg.opacity;
                if (luminanceMap && p.y >= 0 && p.y < h && p.x >= 0 && p.x < w) {
                    const idx = Math.floor(p.y) * w + Math.floor(p.x);
                    const lum = luminanceMap[idx];
                    const fade = (lum / 255) * cfg.darknessReact;
                    alpha = Math.max(0, cfg.opacity - fade);
                }

                if (alpha > 0.01) {
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - cfg.wind, p.y - p.l);
                    ctx.stroke();
                }

                if (p.y > h) {
                    if (Math.random() > 0.5) {
                        p.state = 'splashing';
                        p.y = h;
                        p.life = 1.0;
                        p.vy = - (Math.random() * cfg.splashBounce * 10);
                        p.vx = (Math.random() - 0.5) * 4;
                    } else {
                        Object.assign(p, createDrop(w, h));
                    }
                }
                if (p.x > w) p.x = 0;
                if (p.x < 0) p.x = w;

            } else if (p.state === 'splashing') {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.5;
                p.life -= 0.05;

                if (p.life <= 0) {
                    Object.assign(p, createDrop(w, h));
                } else {
                    ctx.globalAlpha = cfg.opacity * p.life;
                    ctx.fillStyle = cfg.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Reset for next frame safety
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;

        animationId = requestAnimationFrame(loop);
    }

    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
