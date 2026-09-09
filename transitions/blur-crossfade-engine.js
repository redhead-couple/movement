export function runTransition({ outgoing, incoming, config = {}, duration = 1, onComplete }) {
    const cfg = {
        blur: 18,
        scale: 1.04,
        easing: 'ease-in-out',
        ...config
    };
    const seconds = Math.max(0.05, Number(cfg.duration ?? duration) || 1);
    const blur = Math.max(0, Number(cfg.blur) || 0);
    const scale = Math.max(1, Number(cfg.scale) || 1.04);
    const easing = String(cfg.easing || 'ease-in-out');
    let done = false;
    let timer = null;

    incoming.style.zIndex = '2';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '0';
    incoming.style.transform = `scale(${scale})`;
    incoming.style.filter = blur ? `blur(${blur}px)` : 'none';
    outgoing.style.opacity = '1';
    outgoing.style.transform = 'scale(1)';
    outgoing.style.filter = 'none';
    incoming.style.transition = 'none';
    outgoing.style.transition = 'none';

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
        if (event.target !== incoming || event.propertyName !== 'opacity') return;
        finish();
    };

    incoming.addEventListener('transitionend', onTransitionEnd);
    timer = window.setTimeout(finish, (seconds * 1000) + 120);

    void incoming.offsetWidth;
    window.requestAnimationFrame(() => {
        const transition = [
            `opacity ${seconds}s ${easing}`,
            `transform ${seconds}s ${easing}`,
            `filter ${seconds}s ${easing}`
        ].join(', ');
        incoming.style.transition = transition;
        outgoing.style.transition = transition;
        incoming.style.opacity = '1';
        incoming.style.transform = 'scale(1)';
        incoming.style.filter = 'none';
        outgoing.style.opacity = '0';
        outgoing.style.transform = `scale(${scale})`;
        outgoing.style.filter = blur ? `blur(${Math.round(blur * 0.65)}px)` : 'none';
    });

    return finish;
}

function cleanup(layer) {
    layer.style.transition = '';
    layer.style.transform = '';
    layer.style.filter = '';
    layer.style.opacity = '';
    layer.style.zIndex = '';
}
