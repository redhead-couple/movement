const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { createComponentExportService } = require('../desktop/services/component-export-service.cjs');
const root = path.resolve(__dirname, '..');

function context() {
  return { draws: [], clearCount: 0, globalAlpha: 1, shadowBlur: 0,
    save() {}, restore() {}, setTransform() {},
    clearRect() { this.clearCount++; },
    drawImage(...args) { this.draws.push({ args, alpha: this.globalAlpha, shadow: this.shadowBlur }); } };
}
function harness({ reduced = false, hidden = false } = {}) {
  const frames = new Map(), timers = new Map(), listeners = new Map(), observers = [], images = [], surfaces = [];
  let id = 0, now = 0;
  class FakeImage { constructor() { this.naturalWidth = 0; this.naturalHeight = 0; images.push(this); } }
  const doc = { hidden, addEventListener(k, fn) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); },
    removeEventListener(k, fn) { listeners.get(k)?.delete(fn); },
    createElement(tag) { assert.equal(tag, 'canvas'); const ctx = context(); const surface = { width: 0, height: 0, getContext: () => ctx, ctx }; surfaces.push(surface); return surface; } };
  const motionListeners = new Set();
  const motion = { matches: reduced, addEventListener(_k, fn) { motionListeners.add(fn); }, removeEventListener(_k, fn) { motionListeners.delete(fn); } };
  const box = { document: doc, Image: FakeImage, performance: { now: () => now }, matchMedia: () => motion,
    ResizeObserver: class { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    requestAnimationFrame(fn) { const key = ++id; frames.set(key, fn); return key; }, cancelAnimationFrame(key) { frames.delete(key); },
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, delay }); return key; }, clearTimeout(key) { timers.delete(key); } };
  vm.runInNewContext(loadEffectEngineSource(path.join(root, 'effects/soft-glow-engine.js')) + '\nglobalThis.api={mount,normalizeConfig,calculateCanvasSize,MAX_ANIMATED_PIXELS};', box);
  function mount(config = {}) { const canvas = { width: 300, height: 150, ownerDocument: doc }; const ctx = context(); const stop = box.api.mount(canvas, ctx, config); return { canvas, ctx, stop }; }
  function step(time) { now = time; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(time)); }
  function load(index = 0, width = 7680, height = 4320) { const img = images[index]; img.naturalWidth = width; img.naturalHeight = height; img.onload(); return img; }
  return { ...box.api, mountInstance: mount, frames, timers, listeners, observers, images, surfaces, doc, motion, motionListeners, step, load };
}

test('Soft Glow caps all surfaces, caches expensive work and throttles paints', () => {
  const h = harness(); const instance = h.mountInstance({ imgSrc: 'img/example.webp', strength: 100, pulseSpeed: 24 });
  assert.equal(h.frames.size, 0); h.load();
  assert.equal(h.surfaces.length, 2);
  for (const c of [instance.canvas, ...h.surfaces]) {
    assert.ok(c.width * c.height <= 2073600); assert.ok(c.width <= 2048 && c.height <= 2048);
    assert.ok(Math.abs(c.width / c.height - 16 / 9) < 0.01);
  }
  for (let ms = 5; ms <= 1000; ms += 5) { h.step(ms); assert.equal(h.frames.size, 1); }
  assert.ok(instance.ctx.clearCount <= 31);
  assert.ok(instance.ctx.draws.some(draw => draw.alpha !== 1));
  assert.equal(h.surfaces[0].ctx.draws.length, 1, 'scale source only once');
  assert.equal(h.surfaces[1].ctx.draws.length, 1, 'cache the halo only once');
  assert.ok(instance.ctx.draws.every(draw => draw.shadow === 0), 'no per-frame shadow rasterization');
  instance.stop(); instance.stop(); assert.equal(h.frames.size, 0);
  assert.ok(h.surfaces.every(c => c.width === 1 && c.height === 1));
  assert.ok([...h.listeners.values()].every(set => !set.size)); assert.equal(h.motionListeners.size, 0);
  assert.ok(h.observers.every(o => o.disconnected));
  h.observers[0].callback(); assert.equal(h.frames.size, 0, 'late resize callbacks are harmless');
});

test('control changes reuse image/cache and keep one loop; zero speed/strength become idle', () => {
  const h = harness(); const i = h.mountInstance({ imgSrc: 'img/a.webp' }); h.load();
  for (let k = 0; k < 100; k++) i.stop.update({ strength: k, pulseSpeed: 24 });
  assert.equal(h.images.length, 1); assert.equal(h.surfaces.length, 2); assert.equal(h.frames.size, 1);
  i.stop.update({ strength: 80, pulseSpeed: 0 }); h.step(40); assert.equal(h.frames.size, 0);
  i.stop.update({ strength: 0, pulseSpeed: 24 }); h.step(80); assert.equal(h.frames.size, 0);
  assert.equal(i.ctx.draws.at(-1).alpha, 1, 'the image remains visible without glow'); i.stop();
});

test('reduced motion, visibility and incoming-transition delay do not repaint idle states', () => {
  const h = harness({ reduced: true }); const i = h.mountInstance({ imgSrc: 'img/a.webp' }); h.load();
  assert.equal(h.frames.size, 0); assert.equal(i.ctx.clearCount, 1);
  h.motion.matches = false; h.motionListeners.forEach(fn => fn()); assert.equal(h.frames.size, 1);
  h.doc.hidden = true; h.listeners.get('visibilitychange').forEach(fn => fn()); assert.equal(h.frames.size, 0);
  h.doc.hidden = false; h.listeners.get('visibilitychange').forEach(fn => fn()); assert.equal(h.frames.size, 1); i.stop();
  const delayed = h.mountInstance({ imgSrc: 'img/b.webp', playbackStartDelayMs: 700 }); h.load(1);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 700);
  const late = [...h.timers.values()][0].fn; delayed.stop(); late(); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});

test('preloaded images avoid decoding; instances and late load callbacks stay isolated', () => {
  const h = harness(); const supplied = { naturalWidth: 4096, naturalHeight: 2048 };
  const first = h.mountInstance({ imgSrc: 'img/preloaded.webp', preloadedImages: new Map([['img/preloaded.webp', supplied]]) });
  assert.equal(h.images.length, 0); assert.equal(h.frames.size, 1);
  const second = h.mountInstance({ imgSrc: 'img/pending.webp' }); const late = h.images[0].onload;
  second.stop(); h.images[0].naturalWidth = 100; h.images[0].naturalHeight = 100; late();
  assert.equal(h.frames.size, 1); assert.equal(h.surfaces.length, 2);
  first.canvas.width = 8000; first.canvas.height = 8000; h.step(40);
  assert.ok(first.canvas.width * first.canvas.height <= 2073600); assert.equal(h.surfaces.length, 2);
  first.stop(); assert.equal(h.frames.size, 0);
});

test('a hidden player layer pauses animation and resumes without remounting or decoding', () => {
  const h = harness(); const i = h.mountInstance({ imgSrc: 'img/a.webp' }); h.load();
  const notify = (width, height) => h.observers[0].callback([{ target: i.canvas, contentRect: { width, height } }]);
  notify(0, 0); assert.equal(h.frames.size, 0);
  const paints = i.ctx.clearCount; i.stop.update({ strength: 90, pulseSpeed: 10 }); h.step(1000);
  assert.equal(i.ctx.clearCount, paints);
  notify(300, 200); assert.equal(h.frames.size, 1); h.step(1040);
  assert.equal(h.images.length, 1); assert.equal(h.surfaces.length, 2); assert.ok(i.ctx.clearCount > paints);
  i.stop(); notify(300,200); assert.equal(h.frames.size,0);
});

test('malformed controls, extreme aspect ratios and missing images stay bounded', () => {
  const h = harness();
  for (const dimensions of [[1, 100000], [100000, 1], [NaN, Infinity], [1e20, 1e20]]) {
    const size = h.calculateCanvasSize(...dimensions); assert.ok(size.width * size.height <= 2073600); assert.ok(size.width <= 2048 && size.height <= 2048);
  }
  const normalized = h.normalizeConfig({ strength: 900, pulseSpeed: -8, playbackStartDelayMs: Infinity });
  assert.equal(normalized.strength, 100); assert.equal(normalized.pulseSpeed, 0); assert.equal(normalized.playbackStartDelayMs, 0);
  assert.equal(h.normalizeConfig(null).strength, 45);
  const empty = h.mountInstance(); assert.equal(h.frames.size, 0); empty.stop();
  const broken = h.mountInstance({ imgSrc: 'missing.webp' }); const error = h.images.at(-1).onerror; error();
  assert.equal(h.frames.size, 0); broken.stop(); error(); assert.equal(h.frames.size, 0);
});

test('maker exports portable references, restores controls and does not remount during input bursts', () => {
  const html = fs.readFileSync(path.join(root, 'effects/soft-glow-maker.html'), 'utf8');
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;\s*$/m, '');
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } }); return elements.get(id); };
  element('cvs').getContext = () => ({});
  let mounts = 0, updates = 0, stopped = 0;
  const events = {};
  const h = harness();
  const win = { img1Data: 'data:image/png;base64,example', imgName: 'chosen.webp', addEventListener(name, fn) { events[name] = fn; } };
  vm.runInNewContext(source, { window: win, document: { getElementById: element }, DEFAULTS: { strength: 45, pulseSpeed: 12 }, normalizeConfig: h.normalizeConfig,
    mount() { mounts++; const stop = () => { stopped++; }; stop.update = () => { updates++; }; return stop; } });
  win.MakerAPI.run();
  for (let k = 0; k < 80; k++) element('strength').handlers.input({ target: { value: String(k) } });
  assert.equal(mounts, 1); assert.equal(updates, 80);
  win.MakerAPI.loadEditConfig({ imgSrc: 'img/saved.webp', strength: 67, pulseSpeed: 9 });
  assert.equal(element('strength').value, 67); assert.equal(element('pulseSpeed').value, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(win.MakerAPI.getExportJSON().config)), { imgSrc: 'img/chosen.webp', strength: 67, pulseSpeed: 9 });
  win.imgName = ''; assert.equal(win.MakerAPI.getExportJSON().config.imgSrc, 'img/saved.webp');
  win.img1Data = 'data:image/png;base64,next'; win.MakerAPI.run(); assert.equal(mounts, 2); assert.equal(stopped, 1);
  events.pagehide(); win.MakerAPI.run(); assert.equal(mounts, 2); assert.equal(stopped, 2);
});

test('portable player and component exporter include Soft Glow with the explicit repository license', () => {
  const html = buildPortablePlayerHtml(root, { schemaVersion: 2, title: 'Soft Glow test', slides: [
    { background: { src: 'test.webp', effect: { engine: 'soft-glow', config: { imgSrc: 'img/test.webp', strength: 45, pulseSpeed: 12 } } }, foregroundLayers: [] }
  ] });
  assert.match(html, /inlineEngines\["soft-glow"\]/);
  assert.doesNotMatch(html, /^\s*(?:export|import)\s/m);
  const exported = createComponentExportService({ applicationRoot: root }).prepare('effects', 'soft-glow');
  assert.deepEqual(exported.entries.map(e => e.name), ['component.json', 'LICENSE', 'effects/soft-glow-maker.html', 'effects/soft-glow-engine.js']);
  assert.deepEqual(exported.entries[1].buffer, fs.readFileSync(path.join(root, 'LICENSE')));
  assert.deepEqual(exported.manifest.requires, { hostContract: 'movement-effect-host-1', sharedFiles: ['effects/effect-media.js', 'studio/maker/maker-engine.js', 'studio/maker/maker-theme.css'] });
});
