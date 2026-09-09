const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'scattered-idea-engine.js');
const makerPath = path.join(applicationRoot, 'effects', 'scattered-idea-maker.html');

function createContextRecorder() {
  return {
    clearCount: 0,
    drawCount: 0,
    save() {},
    restore() {},
    setTransform() {},
    clearRect() { this.clearCount += 1; },
    drawImage() { this.drawCount += 1; },
    translate() {},
    rotate() {}
  };
}

function loadEngineHarness({ hidden = false, reducedMotion = false } = {}) {
  const images = [];
  const animationFrames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const cachedSurfaces = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let now = 0;

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.width = 0;
      this.height = 0;
      images.push(this);
    }

    set src(value) { this._src = value; }
    get src() { return this._src; }
  }

  const document = {
    hidden,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const surfaceContext = createContextRecorder();
      const surface = {
        width: 0,
        height: 0,
        getContext() { return surfaceContext; },
        context: surfaceContext
      };
      cachedSurfaces.push(surface);
      return surface;
    }
  };

  const source = loadEffectEngineSource(enginePath)
    + '\n;globalThis.__scatteredIdea = {'
    + 'MAX_ANIMATED_PIXELS, TARGET_FPS, MAX_FRAGMENT_COUNT, DEFAULTS, schema,'
    + 'normalizeConfig, calculateCappedSize, buildFragmentPlan, mount};';

  const sandbox = {
    Image: FakeImage,
    Math,
    Number,
    Object,
    document,
    matchMedia: () => ({ matches: reducedMotion }),
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: enginePath });

  return {
    api: sandbox.__scatteredIdea,
    images,
    animationFrames,
    timers,
    listeners,
    cachedSurfaces,
    document,
    setNow(value) { now = value; },
    fireTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected one pending timer');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    fireFrame(timestamp) {
      const entry = animationFrames.entries().next().value;
      assert.ok(entry, 'expected one pending animation frame');
      animationFrames.delete(entry[0]);
      entry[1](timestamp);
    }
  };
}

function loadImage(image, width, height) {
  image.naturalWidth = width;
  image.naturalHeight = height;
  image.width = width;
  image.height = height;
  assert.equal(typeof image.onload, 'function');
  image.onload();
}

test('Scattered Idea is registered exactly once under Particles & Dispersion', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'scattered-idea');

  assert.deepEqual(registrations, [{ category: 'Particles & Dispersion', engine: 'scattered-idea' }]);
});

test('engine normalization, fragment count, and capped aspect-ratio surface stay within limits', () => {
  const { api } = loadEngineHarness();
  const normalized = api.normalizeConfig({
    count: 999,
    spread: -2,
    duration: Infinity,
    randomness: null,
    startDelay: 'bad'
  });

  assert.equal(api.MAX_ANIMATED_PIXELS, 2073600);
  assert.equal(api.TARGET_FPS, 30);
  assert.equal(api.MAX_FRAGMENT_COUNT, 120);
  assert.equal(normalized.count, 120);
  assert.equal(normalized.spread, 40);
  assert.equal(normalized.duration, api.DEFAULTS.duration);
  assert.equal(normalized.randomness, api.DEFAULTS.randomness);
  assert.equal(normalized.startDelay, api.DEFAULTS.startDelay);

  const size = api.calculateCappedSize(8000, 6000);
  assert.ok(size.width * size.height <= api.MAX_ANIMATED_PIXELS);
  assert.ok(Math.abs((size.width / size.height) - (4 / 3)) < 0.002);

  const fragments = api.buildFragmentPlan(size.width, size.height, { count: 120, randomness: 0 }, 7);
  assert.equal(fragments.length, 120);
  assert.equal(
    fragments.reduce((area, fragment) => area + fragment.width * fragment.height, 0),
    size.width * size.height,
    'rectangles must cover the cached image without missing cells'
  );
  assert.ok(fragments.every(fragment => fragment.rotation === 0 && fragment.stagger === 0));
});

test('engine stays idle while loading and holding, keeps one frame scheduled, then stops', () => {
  const harness = loadEngineHarness();
  const canvas = { width: 300, height: 150 };
  const ctx = createContextRecorder();
  const cleanup = harness.api.mount(canvas, ctx, {
    imgSrc: 'img/large-source.jpg',
    count: 120,
    startDelay: 1,
    duration: 1
  });

  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.timers.size, 0);
  loadImage(harness.images[0], 8000, 6000);
  assert.ok(canvas.width * canvas.height <= harness.api.MAX_ANIMATED_PIXELS);
  assert.equal(harness.cachedSurfaces.length, 1);
  assert.equal(harness.cachedSurfaces[0].width, canvas.width);
  assert.equal(harness.cachedSurfaces[0].height, canvas.height);
  assert.equal(harness.animationFrames.size, 0, 'the intact hold must not repaint');
  assert.equal(harness.timers.size, 1);

  harness.fireTimer();
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1000);
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1010);
  assert.equal(harness.animationFrames.size, 1, 'throttled frames must not create a second loop');
  harness.fireFrame(2040);
  assert.equal(harness.animationFrames.size, 0, 'completed effects must remain idle');
  harness.document.hidden = true;
  harness.listeners.get('visibilitychange')();
  harness.document.hidden = false;
  harness.listeners.get('visibilitychange')();
  assert.equal(harness.animationFrames.size, 0, 'visibility changes must not restart a completed effect');

  cleanup();
  cleanup();
  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.has('visibilitychange'), false);
});

test('cleanup invalidates stale media callbacks and instances do not share frame state', () => {
  const staleHarness = loadEngineHarness();
  const staleCleanup = staleHarness.api.mount(
    { width: 300, height: 150 },
    createContextRecorder(),
    { imgSrc: 'img/stale.jpg', startDelay: 0 }
  );
  const staleCallback = staleHarness.images[0].onload;
  staleHarness.images[0].naturalWidth = 4000;
  staleHarness.images[0].naturalHeight = 3000;
  staleCleanup();
  staleCallback();
  assert.equal(staleHarness.cachedSurfaces.length, 0);
  assert.equal(staleHarness.animationFrames.size, 0);
  assert.equal(staleHarness.timers.size, 0);

  const pendingHarness = loadEngineHarness();
  const pendingCanvas = { width: 300, height: 150 };
  const pendingCleanup = pendingHarness.api.mount(
    pendingCanvas,
    createContextRecorder(),
    { imgSrc: 'img/pending.jpg', count: 20 }
  );
  pendingCleanup.restart({ imgSrc: 'img/pending.jpg', count: 90 });
  pendingCleanup.restart({ imgSrc: 'img/pending.jpg', count: 120 });
  assert.equal(pendingHarness.images.length, 1, 'rapid updates must reuse an in-flight image load');
  loadImage(pendingHarness.images[0], 1920, 1080);
  pendingCleanup();

  const harness = loadEngineHarness();
  const firstCleanup = harness.api.mount(
    { width: 300, height: 150 },
    createContextRecorder(),
    { imgSrc: 'img/one.jpg', startDelay: 0 }
  );
  const secondCleanup = harness.api.mount(
    { width: 300, height: 150 },
    createContextRecorder(),
    { imgSrc: 'img/two.jpg', startDelay: 0 }
  );
  loadImage(harness.images[0], 1920, 1080);
  loadImage(harness.images[1], 1920, 1080);
  assert.equal(harness.animationFrames.size, 2);
  firstCleanup();
  assert.equal(harness.animationFrames.size, 1);
  secondCleanup();
  assert.equal(harness.animationFrames.size, 0);
});

test('reduced-motion and hidden states draw once without running an idle loop', () => {
  const reducedHarness = loadEngineHarness({ reducedMotion: true });
  const reducedContext = createContextRecorder();
  const reducedCleanup = reducedHarness.api.mount(
    { width: 300, height: 150 },
    reducedContext,
    { imgSrc: 'img/reduced.jpg', startDelay: 1 }
  );
  loadImage(reducedHarness.images[0], 1920, 1080);
  assert.ok(reducedContext.drawCount >= 1, 'reduced motion should retain the intact image');
  assert.equal(reducedHarness.timers.size, 0);
  assert.equal(reducedHarness.animationFrames.size, 0);
  reducedCleanup();

  const hiddenHarness = loadEngineHarness({ hidden: true });
  const hiddenCleanup = hiddenHarness.api.mount(
    { width: 300, height: 150 },
    createContextRecorder(),
    { imgSrc: 'img/hidden.jpg', startDelay: 1 }
  );
  loadImage(hiddenHarness.images[0], 1920, 1080);
  assert.equal(hiddenHarness.timers.size, 0);
  assert.equal(hiddenHarness.animationFrames.size, 0);
  hiddenHarness.document.hidden = false;
  hiddenHarness.listeners.get('visibilitychange')();
  assert.equal(hiddenHarness.timers.size, 1, 'the preserved hold should resume when visible');
  hiddenCleanup();
});

test('maker defaults, safe ranges, edit restoration, and debounced single-instance preview match the engine', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = loadEngineHarness();
  const expectedControls = {
    count: { min: '12', max: '120', step: '1', value: String(api.DEFAULTS.count) },
    spread: { min: '40', max: '180', step: '5', value: String(api.DEFAULTS.spread) },
    duration: { min: '1', max: '8', step: '0.1', value: String(api.DEFAULTS.duration) },
    randomness: { min: '0', max: '100', step: '5', value: String(api.DEFAULTS.randomness) },
    startDelay: { min: '0', max: '5', step: '0.1', value: String(api.DEFAULTS.startDelay) }
  };

  for (const [key, attributes] of Object.entries(expectedControls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing maker control: ${key}`);
    for (const [attribute, value] of Object.entries(attributes)) {
      assert.match(input[0], new RegExp(`${attribute}=["']${value.replace('.', '\\.')}["']`));
    }
    assert.match(maker, new RegExp(`setControlValue\\(key, normalized\\[key\\]\\)`));
  }

  assert.match(maker, /<details class="group" id="advancedControls">/);
  assert.match(maker, /const PREVIEW_DEBOUNCE_MS = 140/);
  assert.match(maker, /if \(!controller\)\s*\{\s*controller = mount/);
  assert.match(maker, /controller\.restart\(previewConfig\(\)\)/);
  assert.match(maker, /input', \(event\) => \{[\s\S]*?schedulePreview\(\)/);
  assert.match(maker, /loadEditConfig/);
  assert.match(maker, /imgSrc: imageNameRef \|\| savedImageRef/);
  assert.match(maker, /engine: ENGINE/);
});

test('portable player inlines Scattered Idea once for background and foreground placements', () => {
  const definition = {
    enabled: true,
    name: 'Scattered Idea',
    engine: 'scattered-idea',
    config: { imgSrc: 'img/example.jpg', count: 63 }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Scattered Idea placement test',
    slides: [{
      background: { src: '', effect: definition },
      foregroundLayers: [{ name: 'Foreground', src: 'img/example.jpg', effect: definition }],
      audioLayers: []
    }]
  });

  assert.equal((html.match(/inlineEngines\["scattered-idea"\]/g) || []).length, 1);
  assert.match(html, /function mount\(canvas, ctx, config\)/);
  assert.match(html, /background[^]*scattered-idea/);
  assert.match(html, /foregroundLayers[^]*scattered-idea/);
  assert.doesNotMatch(html, /import\(['"]effects\/scattered-idea-engine\.js/);
});
