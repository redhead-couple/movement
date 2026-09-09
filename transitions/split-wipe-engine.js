export function runTransition({ outgoing, incoming, config = {}, duration = 1, onComplete }) {
    const cfg = {
        axis: 'vertical',
        mode: 'open',
        gapBlur: 8,
        easing: 'ease-in-out',
        ...config
    };
    const seconds = Math.max(0.05, Number(cfg.duration ?? duration) || 1);
    const easing = String(cfg.easing || 'ease-in-out');
    const gapBlur = Math.max(0, Number(cfg.gapBlur) || 0);
    const axis = cfg.axis === 'horizontal' ? 'horizontal' : 'vertical';
    const mode = cfg.mode === 'close' ? 'close' : 'open';
    let done = false;
    let timer = null;

    incoming.style.zIndex = '2';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '1';
    outgoing.style.opacity = '1';
    incoming.style.clipPath = splitPath(axis, mode, 0);
    incoming.style.webkitClipPath = splitPath(axis, mode, 0);
    incoming.style.filter = gapBlur ? `blur(${gapBlur}px)` : 'none';
    incoming.style.transition = 'none';
    outgoing.style.transition = `opacity ${seconds}s ${easing}`;

    const finish = () => {
        if (done) return;
        done = true;
        if (timer) window.clearTimeout(timer);
        incoming.removeEventListener('transitionend', onTransitionEnd);
        cleanup(incoming);
        cleanup(outgoing);
        if (typeof onComplete === 'function') onComplete();
    };

    const onTransitionEnd = (event) => {
        if (event.target !== incoming || event.propertyName !== 'clip-path') return;
        finish();
    };

    incoming.addEventListener('transitionend', onTransitionEnd);
    timer = window.setTimeout(finish, (seconds * 1000) + 120);

    void incoming.offsetWidth;
    window.requestAnimationFrame(() => {
        incoming.style.transition = [
            `clip-path ${seconds}s ${easing}`,
            `filter ${seconds}s ${easing}`,
            `opacity ${seconds}s ${easing}`
        ].join(', ');
        incoming.style.clipPath = splitPath(axis, mode, 1);
        incoming.style.webkitClipPath = splitPath(axis, mode, 1);
        incoming.style.filter = 'none';
        outgoing.style.opacity = '0.97';
    });

    return finish;
}

function splitPath(axis, mode, progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (axis === 'horizontal') {
        if (mode === 'close') {
            const edge = (1 - p) * 50;
            return `polygon(0 0, 100% 0, 100% ${edge}%, 0 ${edge}%, 0 ${100 - edge}%, 100% ${100 - edge}%, 100% 100%, 0 100%)`;
        }
        const middle = p * 50;
        return `polygon(0 ${50 - middle}%, 100% ${50 - middle}%, 100% ${50 + middle}%, 0 ${50 + middle}%)`;
    }

    if (mode === 'close') {
        const edge = (1 - p) * 50;
        return `polygon(0 0, ${edge}% 0, ${edge}% 100%, ${100 - edge}% 100%, ${100 - edge}% 0, 100% 0, 100% 100%, 0 100%)`;
    }
    const middle = p * 50;
    return `polygon(${50 - middle}% 0, ${50 + middle}% 0, ${50 + middle}% 100%, ${50 - middle}% 100%)`;
}

function cleanup(layer) {
    layer.style.transition = '';
    layer.style.clipPath = '';
    layer.style.webkitClipPath = '';
    layer.style.filter = '';
    layer.style.opacity = '';
    layer.style.zIndex = '';
}
