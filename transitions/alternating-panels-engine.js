export const MAX_ANIMATED_PIXELS = 2073600;
export const MAX_ANIMATED_DIMENSION = 4096;
export const MAX_PANEL_COUNT = 12;

export const DEFAULTS = Object.freeze({
    segments: 8,
    stagger: 0.06,
    duration: 1.4,
    easing: 'natural',
    shadow: 35
});

export const EASING_MAP = Object.freeze({
    smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
    sharp: 'cubic-bezier(0.4, 0, 1, 1)',
    elastic: 'cubic-bezier(0.34, 1.32, 0.64, 1)',
    natural: 'cubic-bezier(0.22, 1, 0.36, 1)'
});

const LAYER_STYLE_KEYS = [
    'zIndex',
    'opacity',
    'transition',
    'transform',
    'visibility'
];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function safeNumber(value, fallback) {
    if (value === null || value === '' || typeof value === 'boolean') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function normalizeConfig(config, duration) {
    const input = config && typeof config === 'object' ? config : {};
    const fallbackDuration = clamp(safeNumber(duration, DEFAULTS.duration), 0.6, 4);
    const easing = Object.prototype.hasOwnProperty.call(EASING_MAP, input.easing)
        ? input.easing
        : DEFAULTS.easing;
    return {
        segments: Math.round(clamp(safeNumber(input.segments, DEFAULTS.segments), 4, MAX_PANEL_COUNT)),
        stagger: clamp(safeNumber(input.stagger, DEFAULTS.stagger), 0, 0.12),
        duration: clamp(safeNumber(input.duration, fallbackDuration), 0.6, 4),
        easing,
        shadow: clamp(safeNumber(input.shadow, DEFAULTS.shadow), 0, 100)
    };
}

export function calculateCappedSize(width, height) {
    const safeWidth = Math.max(1, Math.floor(safeNumber(width, 1920)));
    const safeHeight = Math.max(1, Math.floor(safeNumber(height, 1080)));
    const scale = Math.min(
        1,
        Math.sqrt(MAX_ANIMATED_PIXELS / (safeWidth * safeHeight)),
        MAX_ANIMATED_DIMENSION / safeWidth,
        MAX_ANIMATED_DIMENSION / safeHeight
    );
    return {
        width: Math.max(1, Math.floor(safeWidth * scale)),
        height: Math.max(1, Math.floor(safeHeight * scale))
    };
}

function captureStyles(element) {
    const values = {};
    for (let index = 0; index < LAYER_STYLE_KEYS.length; index += 1) {
        const key = LAYER_STYLE_KEYS[index];
        values[key] = element.style[key];
    }
    return values;
}

function restoreStyles(element, values) {
    for (let index = 0; index < LAYER_STYLE_KEYS.length; index += 1) {
        const key = LAYER_STYLE_KEYS[index];
        element.style[key] = values[key];
    }
}

function getStyle(element) {
    if (typeof getComputedStyle === 'function') return getComputedStyle(element);
    return element.style || {};
}

function drawContained(context, source, sourceWidth, sourceHeight, x, y, width, height, objectFit) {
    if (!sourceWidth || !sourceHeight || width <= 0 || height <= 0) return false;
    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = width / height;

    if (objectFit === 'cover') {
        let sx = 0;
        let sy = 0;
        let sw = sourceWidth;
        let sh = sourceHeight;
        if (sourceAspect > targetAspect) {
            sw = sourceHeight * targetAspect;
            sx = (sourceWidth - sw) * 0.5;
        } else {
            sh = sourceWidth / targetAspect;
            sy = (sourceHeight - sh) * 0.5;
        }
        context.drawImage(source, sx, sy, sw, sh, x, y, width, height);
        return true;
    }

    if (objectFit === 'fill') {
        context.drawImage(source, 0, 0, sourceWidth, sourceHeight, x, y, width, height);
        return true;
    }

    let drawWidth = width;
    let drawHeight = height;
    if (sourceAspect > targetAspect) drawHeight = width / sourceAspect;
    else drawWidth = height * sourceAspect;
    context.drawImage(
        source,
        0,
        0,
        sourceWidth,
        sourceHeight,
        x + (width - drawWidth) * 0.5,
        y + (height - drawHeight) * 0.5,
        drawWidth,
        drawHeight
    );
    return true;
}

function snapshotOutgoing(outgoing, rect, size) {
    const snapshot = document.createElement('canvas');
    snapshot.width = size.width;
    snapshot.height = size.height;
    const context = snapshot.getContext('2d', { alpha: true });
    if (!context) return null;

    const scaleX = size.width / Math.max(1, rect.width);
    const scaleY = size.height / Math.max(1, rect.height);
    const media = outgoing.querySelectorAll('img, canvas');
    let drawn = false;

    for (let index = 0; index < media.length; index += 1) {
        const element = media[index];
        const tagName = String(element.tagName || '').toUpperCase();
        const sourceWidth = tagName === 'IMG'
            ? (element.naturalWidth || element.width)
            : element.width;
        const sourceHeight = tagName === 'IMG'
            ? (element.naturalHeight || element.height)
            : element.height;
        if (!sourceWidth || !sourceHeight) continue;

        const elementRect = element.getBoundingClientRect();
        const style = getStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const opacity = clamp(safeNumber(style.opacity, 1), 0, 1);
        if (opacity === 0) continue;

        const x = (elementRect.left - rect.left) * scaleX;
        const y = (elementRect.top - rect.top) * scaleY;
        const width = elementRect.width * scaleX;
        const height = elementRect.height * scaleY;

        context.save();
        context.globalAlpha = opacity;
        try {
            drawn = drawContained(
                context,
                element,
                sourceWidth,
                sourceHeight,
                x,
                y,
                width,
                height,
                style.objectFit || 'contain'
            ) || drawn;
        } catch (error) {
            // A failed optional media layer should not block navigation.
        }
        context.restore();
    }

    if (!drawn) {
        snapshot.width = 1;
        snapshot.height = 1;
        return null;
    }
    return snapshot;
}

function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
}

export function runTransition({ root, outgoing, incoming, config = {}, duration = 1, onComplete }) {
    let done = false;
    let frameId = null;
    let failsafeTimer = null;
    let completionTarget = null;
    let completionListener = null;
    let panelHost = null;
    let snapshot = null;
    const panelCanvases = [];
    const cfg = normalizeConfig(config, duration);
    const host = root || (incoming && incoming.parentElement) || null;
    const outgoingStyles = outgoing && outgoing.style ? captureStyles(outgoing) : null;
    const incomingStyles = incoming && incoming.style ? captureStyles(incoming) : null;
    const reducedMotion = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function removeCompletionListener() {
        if (completionTarget && completionListener) {
            completionTarget.removeEventListener('transitionend', completionListener);
        }
        completionTarget = null;
        completionListener = null;
    }

    function finish() {
        if (done) return;
        done = true;
        if (frameId !== null) {
            window.cancelAnimationFrame(frameId);
            frameId = null;
        }
        if (failsafeTimer !== null) {
            window.clearTimeout(failsafeTimer);
            failsafeTimer = null;
        }
        removeCompletionListener();
        if (panelHost && panelHost.parentNode) panelHost.parentNode.removeChild(panelHost);
        panelHost = null;
        releaseCanvas(snapshot);
        snapshot = null;
        for (let index = 0; index < panelCanvases.length; index += 1) {
            releaseCanvas(panelCanvases[index]);
        }
        panelCanvases.length = 0;
        if (incomingStyles) restoreStyles(incoming, incomingStyles);
        if (outgoingStyles) restoreStyles(outgoing, outgoingStyles);
        if (typeof onComplete === 'function') onComplete();
    }

    if (!host || !outgoing || !incoming || !outgoing.style || !incoming.style) {
        finish();
        return finish;
    }

    const easing = EASING_MAP[cfg.easing];

    function startWholeLayerFallback(isReduced) {
        const seconds = isReduced ? Math.min(0.16, cfg.duration) : cfg.duration;
        incoming.style.zIndex = '1';
        incoming.style.opacity = '1';
        outgoing.style.zIndex = '2';
        outgoing.style.opacity = '1';
        outgoing.style.transform = 'translate3d(0, 0, 0) scale(1)';
        outgoing.style.transition = 'none';

        completionTarget = outgoing;
        completionListener = function onFallbackEnd(event) {
            if (event.target !== outgoing || event.propertyName !== 'opacity') return;
            finish();
        };
        outgoing.addEventListener('transitionend', completionListener);
        failsafeTimer = window.setTimeout(finish, (seconds * 1000) + 180);
        frameId = window.requestAnimationFrame(() => {
            frameId = null;
            if (done) return;
            outgoing.style.transition = [
                `transform ${seconds}s ${easing}`,
                `opacity ${seconds}s ${easing}`
            ].join(', ');
            outgoing.style.transform = isReduced
                ? 'translate3d(0, -2%, 0) scale(0.995)'
                : 'translate3d(0, -104%, 0) scale(0.97)';
            outgoing.style.opacity = '0';
        });
    }

    if (reducedMotion) {
        startWholeLayerFallback(true);
        return finish;
    }

    const rect = outgoing.getBoundingClientRect();
    const size = calculateCappedSize(rect.width, rect.height);
    snapshot = snapshotOutgoing(outgoing, rect, size);
    if (!snapshot) {
        startWholeLayerFallback(false);
        return finish;
    }

    panelHost = document.createElement('div');
    panelHost.className = 'alternating-panels-transition-layer';
    panelHost.setAttribute('aria-hidden', 'true');
    panelHost.style.position = 'absolute';
    panelHost.style.inset = '0';
    panelHost.style.zIndex = '3';
    panelHost.style.overflow = 'hidden';
    panelHost.style.pointerEvents = 'none';
    panelHost.style.contain = 'layout paint style';

    const panels = new Array(cfg.segments);
    const shadowAlpha = (cfg.shadow / 100 * 0.28).toFixed(3);
    const effectiveStagger = cfg.segments > 1
        ? Math.min(cfg.stagger, (cfg.duration * 0.42) / (cfg.segments - 1))
        : 0;
    const motionSeconds = Math.max(0.18, cfg.duration - effectiveStagger * (cfg.segments - 1));

    for (let index = 0; index < cfg.segments; index += 1) {
        const sx = Math.floor((index * size.width) / cfg.segments);
        const right = Math.floor(((index + 1) * size.width) / cfg.segments);
        const panelWidth = Math.max(1, right - sx);
        const panel = document.createElement('div');
        const panelCanvas = document.createElement('canvas');
        panelCanvas.width = panelWidth;
        panelCanvas.height = size.height;
        const panelContext = panelCanvas.getContext('2d', { alpha: true });
        if (panelContext) {
            panelContext.drawImage(
                snapshot,
                sx,
                0,
                panelWidth,
                size.height,
                0,
                0,
                panelWidth,
                size.height
            );
        }
        panelCanvases.push(panelCanvas);

        panel.style.position = 'absolute';
        panel.style.top = '0';
        panel.style.bottom = '0';
        panel.style.left = `${(sx / size.width) * 100}%`;
        panel.style.width = `${(panelWidth / size.width) * 100}%`;
        panel.style.overflow = 'visible';
        panel.style.opacity = '1';
        panel.style.transform = 'translate3d(0, 0, 0) scale(1)';
        panel.style.transformOrigin = '50% 50%';
        panel.style.transition = 'none';
        panel.style.willChange = 'transform, opacity';
        panel.style.boxShadow = cfg.shadow > 0
            ? `0 12px 18px rgba(0, 0, 0, ${shadowAlpha})`
            : 'none';

        panelCanvas.style.display = 'block';
        panelCanvas.style.width = '100%';
        panelCanvas.style.height = '100%';
        panel.appendChild(panelCanvas);
        panelHost.appendChild(panel);
        panels[index] = panel;
    }

    releaseCanvas(snapshot);
    snapshot = null;
    incoming.style.zIndex = '1';
    incoming.style.opacity = '1';
    outgoing.style.zIndex = '2';
    outgoing.style.visibility = 'hidden';
    host.appendChild(panelHost);

    completionTarget = panels[panels.length - 1];
    completionListener = function onPanelEnd(event) {
        if (event.target !== completionTarget || event.propertyName !== 'transform') return;
        finish();
    };
    completionTarget.addEventListener('transitionend', completionListener);
    failsafeTimer = window.setTimeout(finish, (cfg.duration * 1000) + 220);

    // Commit the bounded panel set once so the next compositor write transitions
    // from the intact mosaic instead of coalescing both states into one frame.
    void panelHost.offsetWidth;
    frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (done) return;
        for (let index = 0; index < panels.length; index += 1) {
            const panel = panels[index];
            const delay = effectiveStagger * index;
            panel.style.transition = [
                `transform ${motionSeconds}s ${easing} ${delay}s`,
                `opacity ${motionSeconds}s ${easing} ${delay}s`
            ].join(', ');
            panel.style.transform = index % 2 === 0
                ? 'translate3d(0, -112%, 0) scale(0.94, 0.97)'
                : 'translate3d(0, 112%, 0) scale(0.94, 0.97)';
            panel.style.opacity = '0.08';
        }
    });

    return finish;
}
