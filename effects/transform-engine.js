// effects/transform-engine.js

import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
    let active = true;
    let img = null;
    let imgReady = false;

    const cfg = {
        imgSrc: '',
        stageWidth: 1920,
        stageHeight: 1080,

        x: 50,
        y: 50,
        width: 100,
        height: 100,
        scale: 1,
        opacity: 1,
        rotation: 0,
        anchor: 'center',
        fit: 'contain',

        flipX: false,
        flipY: false,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        blur: 0,

        ...config
    };
    const imageResource = createEffectImage(cfg, cfg.imgSrc);
    img = imageResource.image;

    canvas.width = Math.max(1, Number(cfg.stageWidth) || 1920);
    canvas.height = Math.max(1, Number(cfg.stageHeight) || 1080);
    if (cfg.onResize) cfg.onResize(canvas);

    if (cfg.imgSrc) {
        const imageReady = () => {
            imgReady = true;
            draw();
        };
        if (imageResource.isPreloaded) {
            imageReady();
        } else {
            if (!String(cfg.imgSrc).startsWith('data:')) img.crossOrigin = 'Anonymous';
            img.onload = imageReady;
            img.src = cfg.imgSrc;
        }
    } else {
        draw();
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value) || 0));
    }

    function anchorPoint(anchor) {
        const points = {
            'top-left': [0, 0],
            'top': [0.5, 0],
            'top-right': [1, 0],
            'left': [0, 0.5],
            'center': [0.5, 0.5],
            'right': [1, 0.5],
            'bottom-left': [0, 1],
            'bottom': [0.5, 1],
            'bottom-right': [1, 1]
        };
        return points[anchor] || points.center;
    }

    function drawFittedImage(boxW, boxH) {
        if (!imgReady || !img.width || !img.height) return;

        if (cfg.fit === 'stretch') {
            ctx.drawImage(img, 0, 0, boxW, boxH);
            return;
        }

        const imageRatio = img.width / img.height;
        const boxRatio = boxW / boxH;
        const shouldCover = cfg.fit === 'cover';
        let drawW;
        let drawH;

        if ((shouldCover && imageRatio > boxRatio) || (!shouldCover && imageRatio < boxRatio)) {
            drawH = boxH;
            drawW = drawH * imageRatio;
        } else {
            drawW = boxW;
            drawH = drawW / imageRatio;
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, boxW, boxH);
        ctx.clip();
        ctx.drawImage(img, (boxW - drawW) / 2, (boxH - drawH) / 2, drawW, drawH);
        ctx.restore();
    }

    function draw() {
        if (!active) return;

        const stageW = canvas.width;
        const stageH = canvas.height;
        const boxW = Math.max(1, stageW * (clamp(cfg.width, 1, 300) / 100) * Math.max(0.01, Number(cfg.scale) || 1));
        const boxH = Math.max(1, stageH * (clamp(cfg.height, 1, 300) / 100) * Math.max(0.01, Number(cfg.scale) || 1));
        const [anchorX, anchorY] = anchorPoint(cfg.anchor);
        const posX = stageW * (Number(cfg.x) || 0) / 100;
        const posY = stageH * (Number(cfg.y) || 0) / 100;

        ctx.clearRect(0, 0, stageW, stageH);
        ctx.save();
        ctx.globalAlpha = clamp(cfg.opacity, 0, 1);
        ctx.filter = [
            `brightness(${Math.max(0, Number(cfg.brightness) || 0)})`,
            `contrast(${Math.max(0, Number(cfg.contrast) || 0)})`,
            `saturate(${Math.max(0, Number(cfg.saturation) || 0)})`,
            `blur(${Math.max(0, Number(cfg.blur) || 0)}px)`
        ].join(' ');

        ctx.translate(posX, posY);
        ctx.rotate((Number(cfg.rotation) || 0) * Math.PI / 180);
        ctx.scale(cfg.flipX ? -1 : 1, cfg.flipY ? -1 : 1);
        ctx.translate(-boxW * anchorX, -boxH * anchorY);
        drawFittedImage(boxW, boxH);
        ctx.restore();
    }

    return () => {
        active = false;
    };
}
