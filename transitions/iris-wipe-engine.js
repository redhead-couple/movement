export function runTransition({ outgoing, incoming, config = {}, duration = 1, onComplete }) {
    const cfg = {
        origin: 'center',
        softness: 18,
        easing: 'ease-in-out',
        ...config
    };
    const seconds = Math.max(0.05, Number(cfg.duration ?? duration) || 1);
    const softness = Math.max(0, Number(cfg.softness) || 0);
    const origin = originPoint(cfg.origin);
    const easing = String(cfg.easing || 'ease-in-out');
    let done = false;
    let timer = null;

    incoming.style.zIndex = '2';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '1';
    outgoing.style.opacity = '1';
    incoming.style.clipPath = `circle(0% at ${origin})`;
    incoming.style.webkitClipPath = `circle(0% at ${origin})`;
    incoming.style.filter = softness ? `blur(${softness}px)` : 'none';
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
        incoming.style.clipPath = `circle(145% at ${origin})`;
        incoming.style.webkitClipPath = `circle(145% at ${origin})`;
        incoming.style.filter = 'none';
        outgoing.style.opacity = '0.96';
    });

    return finish;
}

function originPoint(origin) {
    if (origin === 'top-left') return '0% 0%';
    if (origin === 'top-right') return '100% 0%';
    if (origin === 'bottom-left') return '0% 100%';
    if (origin === 'bottom-right') return '100% 100%';
    return '50% 50%';
}

function cleanup(layer) {
    layer.style.transition = '';
    layer.style.clipPath = '';
    layer.style.webkitClipPath = '';
    layer.style.filter = '';
    layer.style.opacity = '';
    layer.style.zIndex = '';
}
