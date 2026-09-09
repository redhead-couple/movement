export function runTransition({ outgoing, incoming, config = {}, duration = 1, onComplete }) {
    const cfg = {
        direction: 'left',
        blur: 10,
        easing: 'ease',
        ...config
    };
    const seconds = Math.max(0.05, Number(cfg.duration ?? duration) || 1);
    const blur = Math.max(0, Number(cfg.blur) || 0);
    const easing = String(cfg.easing || 'ease');
    const direction = String(cfg.direction || 'left');
    let done = false;
    let timer = null;

    const startClip = getClipPath(direction, 0);
    const endClip = getClipPath(direction, 1);
    const transition = [
        `clip-path ${seconds}s ${easing}`,
        `filter ${seconds}s ${easing}`,
        `opacity ${seconds}s ${easing}`
    ].join(', ');

    incoming.style.zIndex = '2';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '1';
    outgoing.style.opacity = '1';
    incoming.style.clipPath = startClip;
    incoming.style.webkitClipPath = startClip;
    incoming.style.filter = blur ? `blur(${blur}px)` : 'none';
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
        incoming.style.transition = transition;
        incoming.style.clipPath = endClip;
        incoming.style.webkitClipPath = endClip;
        incoming.style.filter = 'none';
        outgoing.style.opacity = '0.98';
    });

    return finish;
}

function getClipPath(direction, progress) {
    const hidden = `${Math.max(0, Math.min(1, 1 - progress)) * 100}%`;
    if (direction === 'right') return `inset(0 0 0 ${hidden})`;
    if (direction === 'up') return `inset(${hidden} 0 0 0)`;
    if (direction === 'down') return `inset(0 0 ${hidden} 0)`;
    return `inset(0 ${hidden} 0 0)`;
}

function cleanup(layer) {
    layer.style.transition = '';
    layer.style.clipPath = '';
    layer.style.webkitClipPath = '';
    layer.style.filter = '';
    layer.style.opacity = '';
    layer.style.zIndex = '';
}
