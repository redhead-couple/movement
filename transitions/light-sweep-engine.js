export function runTransition({ root, outgoing, incoming, config = {}, duration = 1, onComplete }) {
    const cfg = {
        direction: 'left',
        bandWidth: 22,
        intensity: 0.75,
        blur: 8,
        easing: 'ease-in-out',
        ...config
    };
    const seconds = Math.max(0.05, Number(cfg.duration ?? duration) || 1);
    const bandWidth = Math.max(4, Math.min(80, Number(cfg.bandWidth) || 22));
    const intensity = Math.max(0, Math.min(1, Number(cfg.intensity) || 0.75));
    const blur = Math.max(0, Number(cfg.blur) || 0);
    const easing = String(cfg.easing || 'ease-in-out');
    const direction = String(cfg.direction || 'left');
    const host = root || incoming.parentElement;
    let done = false;
    let timer = null;
    let band = null;

    incoming.style.zIndex = '2';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '1';
    outgoing.style.opacity = '1';
    incoming.style.clipPath = getClipPath(direction, 0);
    incoming.style.webkitClipPath = getClipPath(direction, 0);
    incoming.style.filter = blur ? `blur(${blur}px)` : 'none';
    incoming.style.transition = 'none';
    outgoing.style.transition = `opacity ${seconds}s ${easing}`;

    if (host) {
        band = document.createElement('div');
        band.setAttribute('aria-hidden', 'true');
        band.style.position = 'absolute';
        band.style.inset = '0';
        band.style.zIndex = '5';
        band.style.pointerEvents = 'none';
        band.style.mixBlendMode = 'screen';
        band.style.opacity = String(0.35 + intensity * 0.65);
        band.style.transform = getBandTransform(direction, bandWidth, 0);
        band.style.transition = 'none';
        band.style.background = getBandGradient(direction, bandWidth, intensity);
        band.style.filter = `blur(${Math.max(0, Math.round(blur * 0.55))}px)`;
        host.appendChild(band);
    }

    const finish = () => {
        if (done) return;
        done = true;
        if (timer) window.clearTimeout(timer);
        incoming.removeEventListener('transitionend', onTransitionEnd);
        if (band && band.parentNode) band.parentNode.removeChild(band);
        cleanup(incoming);
        cleanup(outgoing);
        if (typeof onComplete === 'function') onComplete();
    };

    const onTransitionEnd = (event) => {
        if (event.target !== incoming || event.propertyName !== 'clip-path') return;
        finish();
    };

    incoming.addEventListener('transitionend', onTransitionEnd);
    timer = window.setTimeout(finish, (seconds * 1000) + 140);

    void incoming.offsetWidth;
    window.requestAnimationFrame(() => {
        incoming.style.transition = [
            `clip-path ${seconds}s ${easing}`,
            `filter ${seconds}s ${easing}`,
            `opacity ${seconds}s ${easing}`
        ].join(', ');
        incoming.style.clipPath = getClipPath(direction, 1);
        incoming.style.webkitClipPath = getClipPath(direction, 1);
        incoming.style.filter = 'none';
        outgoing.style.opacity = '0.94';
        if (band) {
            band.style.transition = [
                `transform ${seconds}s ${easing}`,
                `opacity ${seconds}s ${easing}`
            ].join(', ');
            band.style.transform = getBandTransform(direction, bandWidth, 1);
            band.style.opacity = '0';
        }
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

function getBandGradient(direction, bandWidth, intensity) {
    const half = Math.max(2, Math.min(40, bandWidth / 2));
    const edgeA = Math.max(0, 50 - half);
    const glowA = Math.max(edgeA, 50 - (half * 0.35));
    const glowB = Math.min(100, 50 + (half * 0.35));
    const edgeB = Math.min(100, 50 + half);
    const warm = (0.34 + intensity * 0.38).toFixed(2);
    const core = (0.62 + intensity * 0.35).toFixed(2);
    const cool = (0.24 + intensity * 0.28).toFixed(2);
    const angle = (direction === 'up' || direction === 'down') ? '0deg' : '90deg';
    return `linear-gradient(${angle}, transparent 0%, rgba(255,255,255,0) ${edgeA}%, rgba(255,246,188,${warm}) ${glowA}%, rgba(255,255,255,${core}) 50%, rgba(150,220,255,${cool}) ${glowB}%, rgba(255,255,255,0) ${edgeB}%, transparent 100%)`;
}

function getBandTransform(direction, bandWidth, progress) {
    const start = -100 - bandWidth;
    const end = 100 + bandWidth;
    const value = start + ((end - start) * Math.max(0, Math.min(1, progress)));
    if (direction === 'right') return `translateX(${-value}%)`;
    if (direction === 'up') return `translateY(${-value}%)`;
    if (direction === 'down') return `translateY(${value}%)`;
    return `translateX(${value}%)`;
}

function cleanup(layer) {
    layer.style.transition = '';
    layer.style.clipPath = '';
    layer.style.webkitClipPath = '';
    layer.style.filter = '';
    layer.style.opacity = '';
    layer.style.zIndex = '';
}
