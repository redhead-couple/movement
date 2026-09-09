import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;
    let lastTime = performance.now();
    const mountTime = performance.now();

    let bgImage = null;
    let bgReady = false;

    const cfg = {
        imgSrc: '',
        symbol: '!',
        color: '#ffffff',
        opacity: 0.85,
        count: 90,
        speed: 1.2,
        size: 64,
        spread: 1.0,
        shape: 'tunnel',
        startDelay: 0,
        duration: 4,
        ...config
    };

    const particles = [];

    if (cfg.imgSrc) {
        const imageResource = createEffectImage(cfg, cfg.imgSrc);
        bgImage = imageResource.image;
        const backgroundReady = () => {
            if (!active) return;
            canvas.width = bgImage.width || 1920;
            canvas.height = bgImage.height || 1080;
            bgReady = true;
            if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
        };
        if (imageResource.isPreloaded) {
            backgroundReady();
        } else {
            bgImage.crossOrigin = 'Anonymous';
            bgImage.onload = backgroundReady;
            bgImage.src = cfg.imgSrc;
        }
    } else {
        canvas.width = 1920;
        canvas.height = 1080;
        bgReady = true;
        if (typeof cfg.onResize === 'function') cfg.onResize(canvas);
    }

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pickShapeSeed(shape) {
        const side = Math.random() < 0.5 ? -1 : 1;
        if (shape === 'ring') {
            return {
                angle: rand(0, Math.PI * 2),
                radius: rand(0.75, 1.15),
                spin: rand(-0.3, 0.3)
            };
        }

        if (shape === 'spiral') {
            return {
                angle: rand(0, Math.PI * 2),
                radius: rand(0.45, 1.15),
                spin: rand(1.8, 3.8) * (Math.random() < 0.5 ? -1 : 1)
            };
        }

        if (shape === 'stream') {
            return {
                side,
                yBias: rand(-0.8, 0.8),
                bend: rand(0.15, 0.5)
            };
        }

        if (shape === 'cloud') {
            return {
                x: rand(-1, 1),
                y: rand(-1, 1)
            };
        }

        return {
            lane: rand(-1, 1),
            yBias: rand(-0.2, 1.0),
            curve: rand(0.15, 0.65) * (Math.random() < 0.5 ? -1 : 1)
        };
    }

    function spawnParticle(initialProgress = Math.random()) {
        return {
            progress: initialProgress,
            speedFactor: rand(0.75, 1.35),
            phase: rand(0, Math.PI * 2),
            seed: pickShapeSeed(cfg.shape)
        };
    }

    function syncParticleCount() {
        const target = Math.max(1, Math.floor(cfg.count));
        while (particles.length < target) particles.push(spawnParticle());
        while (particles.length > target) particles.pop();
    }

    function getParticlePosition(p, w, h) {
        const centerX = w * 0.5;
        const centerY = h * 0.5;
        const factor = Math.pow(1 - p.progress, 1.8);
        const spreadX = w * 0.48 * cfg.spread;
        const spreadY = h * 0.38 * cfg.spread;

        let x = centerX;
        let y = centerY;

        if (cfg.shape === 'cloud') {
            x += p.seed.x * spreadX * factor;
            y += p.seed.y * spreadY * factor;
        } else if (cfg.shape === 'tunnel') {
            const lane = p.seed.lane * spreadX;
            const roadCurve = p.seed.curve * spreadX * factor * 0.3;
            x += lane * factor + roadCurve;
            y += (0.15 + p.seed.yBias) * spreadY * factor;
        } else if (cfg.shape === 'spiral') {
            const angle = p.seed.angle + (1 - factor) * p.seed.spin * Math.PI * 2;
            const radiusX = spreadX * p.seed.radius * factor;
            const radiusY = spreadY * p.seed.radius * factor;
            x += Math.cos(angle) * radiusX;
            y += Math.sin(angle) * radiusY;
        } else if (cfg.shape === 'ring') {
            const angle = p.seed.angle + p.seed.spin * Math.PI * 2 * (1 - factor);
            const radiusX = spreadX * p.seed.radius * factor;
            const radiusY = spreadY * p.seed.radius * factor;
            x += Math.cos(angle) * radiusX;
            y += Math.sin(angle) * radiusY;
        } else if (cfg.shape === 'stream') {
            const sideX = p.seed.side * spreadX * (0.9 + 0.1 * factor);
            const bend = p.seed.side * p.seed.bend * spreadX * factor * 0.25;
            x += sideX * factor + bend;
            y += p.seed.yBias * spreadY * factor;
        }

        return { x, y, factor };
    }

    function drawBackground(w, h) {
        ctx.clearRect(0, 0, w, h);
        if (bgReady && bgImage.src) {
            ctx.drawImage(bgImage, 0, 0, w, h);
        } else {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
        }
    }

    function loop(now) {
        if (!active) return;

        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        syncParticleCount();

        const w = canvas.width || 1920;
        const h = canvas.height || 1080;
        const symbolText = String(cfg.symbol || '!').slice(0, 1);
        const elapsed = (now - mountTime) / 1000;
        const delay = Math.max(0, cfg.startDelay);
        const duration = Math.max(0.1, cfg.duration);

        drawBackground(w, h);

        if (elapsed < delay) {
            animationId = requestAnimationFrame(loop);
            return;
        }

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.progress += delta * (cfg.speed / duration) * 1.2 * p.speedFactor;

            if (p.progress >= 1) {
                particles[i] = spawnParticle(0);
                continue;
            }

            const { x, y, factor } = getParticlePosition(p, w, h);
            const depthBoost = Math.pow(factor, 1.4);
            const drawSize = Math.max(4, cfg.size * (0.08 + depthBoost * 2.6));
            const alpha = Math.max(0, Math.min(1, cfg.opacity * (0.08 + depthBoost * 1.1)));

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = cfg.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `700 ${drawSize}px Arial, sans-serif`;
            ctx.fillText(symbolText, x, y);
            ctx.restore();
        }

        animationId = requestAnimationFrame(loop);
    }

    syncParticleCount();
    animationId = requestAnimationFrame(loop);

    return () => {
        active = false;
        if (animationId) cancelAnimationFrame(animationId);
    };
}
