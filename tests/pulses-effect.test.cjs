const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'pulses-engine.js');
const makerPath = path.join(applicationRoot, 'effects', 'pulses-maker.html');

function createContextRecorder() {
  return {
    drawCalls: [],
    clearCount: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    save() {},
    restore() {},
    setTransform() {},
    clearRect() { this.clearCount += 1; },
    drawImage(...args) {
      this.drawCalls.push({
        args,
        filter: this.filter,
        alpha: this.globalAlpha,
        composite: this.globalCompositeOperation
      });
    }
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
      const context = createContextRecorder();
      const surface = {
        width: 0,
        height: 0,
        context,
        getContext() { return context; }
      };
      cachedSurfaces.push(surface);
      return surface;
    }
  };

  const source = loadEffectEngineSource(enginePath)
    + '\n;globalThis.__pulses = {'
    + 'MAX_ANIMATED_PIXELS, MAX_ANIMATED_DIMENSION, TARGET_FPS, MAX_REPEATED_OBJECTS, '
    + 'DEFAULTS, schema, normalizeConfig, calculateCappedSize, calculatePulseEnvelope, mount};';
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
    api: sandbox.__pulses,
    images,
    animationFrames,
    timers,
    listeners,
    cachedSurfaces,
    document,
    setNow(value) { now = value; },
    loadImage(index, width, height) {
      const image = images[index];
      image.naturalWidth = width;
      image.naturalHeight = height;
      image.width = width;
      image.height = height;
      assert.equal(typeof image.onload, 'function');
      image.onload.call(image);
    },
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

test('Pulses is registered exactly once under Focus & Emphasis', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'pulses');
  assert.deepEqual(registrations, [{ category: 'Focus & Emphasis', engine: 'pulses' }]);
});

test('normalization, pulse shape, and raster dimensions stay inside deterministic limits', () => {
  const { api } = loadEngineHarness();
  const normalized = api.normalizeConfig({
    startDelay: -5,
    duration: Infinity,
    pulseCount: 99,
    pulseSpeed: 900,
    spacing: -10,
    intensity: 500,
    brightnessBoost: 500,
    opacityBoost: 500
  });

  assert.equal(api.MAX_ANIMATED_PIXELS, 2073600);
  assert.equal(api.MAX_ANIMATED_DIMENSION, 4096);
  assert.equal(api.TARGET_FPS, 30);
  assert.equal(api.MAX_REPEATED_OBJECTS, 0);
  assert.equal(normalized.startDelay, 0);
  assert.equal(normalized.duration, api.DEFAULTS.duration);
  assert.equal(normalized.pulseCount, 12);
  assert.equal(normalized.pulseSpeed, 100);
  assert.equal(normalized.spacing, 0);
  assert.equal(normalized.intensity, 25);
  assert.equal(normalized.brightnessBoost, 40);
  assert.equal(normalized.opacityBoost, 30);

  const size = api.calculateCappedSize(8000, 6000);
  assert.ok(size.width * size.height <= api.MAX_ANIMATED_PIXELS);
  assert.ok(size.width <= api.MAX_ANIMATED_DIMENSION);
  assert.ok(size.height <= api.MAX_ANIMATED_DIMENSION);
  assert.ok(Math.abs((size.width / size.height) - (4 / 3)) < 0.002);

  assert.equal(api.calculatePulseEnvelope(0, api.DEFAULTS), 0);
  assert.equal(api.calculatePulseEnvelope(1, api.DEFAULTS), 0);
  assert.ok(api.calculatePulseEnvelope(0.03, api.DEFAULTS) > 0);
  assert.equal(api.calculatePulseEnvelope(0.24, { ...api.DEFAULTS, spacing: 70 }), 0);
});

test('the engine idles during delay and rests, owns one frame, and returns exactly to base state', () => {
  const harness = loadEngineHarness();
  const canvas = { width: 320, height: 180 };
  const context = createContextRecorder();
  const cleanup = harness.api.mount(canvas, context, {
    imgSrc: 'img/large.jpg',
    startDelay: 1,
    duration: 1,
    pulseCount: 2,
    intensity: 25,
    brightnessBoost: 40,
    opacityBoost: 30
  });

  assert.equal(harness.animationFrames.size, 0, 'image loading must remain idle');
  assert.equal(harness.timers.size, 0);
  harness.loadImage(0, 8000, 6000);
  assert.equal(harness.cachedSurfaces.length, 1, 'the source should be rasterized once');
  assert.ok(canvas.width * canvas.height <= harness.api.MAX_ANIMATED_PIXELS);
  assert.equal(harness.animationFrames.size, 0, 'start delay must not repaint');
  assert.equal(harness.timers.size, 1);

  harness.fireTimer();
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1000);
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1010);
  assert.equal(harness.animationFrames.size, 1, 'throttling must retain exactly one scheduled frame');
  harness.fireFrame(1100);
  const energeticDraw = context.drawCalls.at(-1);
  assert.ok(energeticDraw.args[3] > canvas.width, 'pulse must expand around the image center');
  assert.equal(energeticDraw.composite, 'screen');
  assert.ok(energeticDraw.alpha > 0);

  harness.fireFrame(1400);
  assert.equal(harness.animationFrames.size, 0, 'the quiet interval between pulses must not repaint');
  assert.equal(harness.timers.size, 1, 'the next pulse should be armed by one idle timer');
  harness.fireTimer();
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(2000);
  assert.equal(harness.animationFrames.size, 0, 'completed effects must become idle');
  const finalDraw = context.drawCalls.at(-1);
  assert.equal(finalDraw.args[1], 0);
  assert.equal(finalDraw.args[2], 0);
  assert.equal(finalDraw.args[3], canvas.width);
  assert.equal(finalDraw.args[4], canvas.height);
  assert.equal(finalDraw.filter, 'none');
  assert.equal(finalDraw.alpha, 1);
  assert.equal(finalDraw.composite, 'source-over');

  cleanup();
  cleanup();
  assert.equal(harness.listeners.size, 0);
});

test('replay reuses media while simultaneous instances, stale loads, missing media, and reduced motion stay safe', () => {
  const harness = loadEngineHarness();
  const first = harness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: 'img/one.jpg', startDelay: 0 }
  );
  const staleImage = harness.images[0];
  const staleOnload = staleImage.onload;
  const second = harness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: 'img/two.jpg', startDelay: 0 }
  );
  harness.loadImage(0, 1920, 1080);
  harness.loadImage(1, 1920, 1080);
  assert.equal(harness.animationFrames.size, 2, 'two instances must schedule one frame each');

  first.restart({ intensity: 20, pulseCount: 12 });
  assert.equal(harness.images.length, 2, 'same-source replay must reuse decoded media');
  assert.equal(harness.animationFrames.size, 2, 'restart must replace rather than overlap its loop');
  first();
  first();
  assert.equal(harness.animationFrames.size, 1);
  staleOnload.call(staleImage);
  assert.equal(harness.animationFrames.size, 1, 'late image work must not reactivate disposed instances');
  second();
  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.listeners.size, 0);

  const missingHarness = loadEngineHarness();
  const missing = missingHarness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: '' }
  );
  assert.equal(missingHarness.animationFrames.size, 0);
  assert.equal(missingHarness.timers.size, 0);
  missing();

  const reducedHarness = loadEngineHarness({ reducedMotion: true });
  const reducedContext = createContextRecorder();
  const reduced = reducedHarness.api.mount(
    { width: 320, height: 180 },
    reducedContext,
    { imgSrc: 'img/reduced.jpg', intensity: 25 }
  );
  reducedHarness.loadImage(0, 1920, 1080);
  assert.equal(reducedHarness.animationFrames.size, 0);
  assert.equal(reducedHarness.timers.size, 0);
  const staticDraw = reducedContext.drawCalls.at(-1);
  assert.equal(staticDraw.args[3], 1920);
  assert.equal(staticDraw.args[4], 1080);
  reduced();
});

test('maker exposes every requested control, restores all values, and reuses one debounced preview', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = loadEngineHarness();
  const expectedControls = {
    startDelay: { min: '0', max: '5', step: '0.1', value: api.DEFAULTS.startDelay },
    duration: { min: '1', max: '20', step: '0.1', value: api.DEFAULTS.duration },
    pulseCount: { min: '1', max: '12', step: '1', value: api.DEFAULTS.pulseCount },
    pulseSpeed: { min: '20', max: '100', step: '1', value: api.DEFAULTS.pulseSpeed },
    spacing: { min: '0', max: '70', step: '1', value: api.DEFAULTS.spacing },
    intensity: { min: '0', max: '25', step: '1', value: api.DEFAULTS.intensity },
    brightnessBoost: { min: '0', max: '40', step: '1', value: api.DEFAULTS.brightnessBoost },
    opacityBoost: { min: '0', max: '30', step: '1', value: api.DEFAULTS.opacityBoost }
  };

  for (const [key, attributes] of Object.entries(expectedControls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing maker control: ${key}`);
    for (const attribute of ['min', 'max', 'step']) {
      assert.match(input[0], new RegExp(`${attribute}=["']${attributes[attribute].replace('.', '\\.')}["']`));
    }
    const value = input[0].match(/value=["']([^"']+)["']/);
    assert.ok(value);
    assert.equal(Number(value[1]), Number(attributes.value));
  }
  assert.match(maker, /<base href="\.\.\/">/);
  assert.match(maker, /id="advancedControls"/);
  assert.match(maker, /const PREVIEW_DEBOUNCE_MS = 140/);
  assert.match(maker, /if \(!controller\) controller = mount/);
  assert.match(maker, /controller\.restart\(previewConfig\(\)\)/);
  assert.match(maker, /if \(request !== previewRequest\) return/);
  assert.match(maker, /const canvases = \[document\.createElement\('canvas'\), document\.createElement\('canvas'\)\]/);
  assert.match(maker, /for \(let index = 0; index < 30; index \+= 1\)/);
  assert.doesNotMatch(maker, /new Function|eval\s*\(/);

  const elements = new Map();
  function element(id) {
    const target = {
      id,
      value: '',
      textContent: '',
      listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); }
    };
    elements.set(id, target);
    return target;
  }
  for (const key of Object.keys(expectedControls)) {
    element(key);
    element(`val-${key}`);
  }
  element('runBtn');
  const canvas = element('cvs');
  canvas.getContext = () => createContextRecorder();
  const previewCalls = [];
  function mountStub(_canvas, _ctx, config) {
    const controller = () => {};
    controller.restart = next => previewCalls.push(next);
    previewCalls.push(config);
    return controller;
  }
  const makerWindow = {
    img1Data: '',
    imgData: '',
    imgName: '',
    addEventListener() {}
  };
  const moduleSource = maker.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*/, '');
  const makerSandbox = {
    DEFAULTS: api.DEFAULTS,
    MAX_ANIMATED_PIXELS: api.MAX_ANIMATED_PIXELS,
    mount: mountStub,
    normalizeConfig: api.normalizeConfig,
    encodeURIComponent,
    document: { getElementById: id => elements.get(id) || null },
    window: makerWindow,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame() {}
  };
  vm.runInNewContext(moduleSource, makerSandbox, { filename: makerPath });

  const saved = {
    imgSrc: 'img/saved.jpg',
    startDelay: 1.2,
    duration: 12.5,
    pulseCount: 9,
    pulseSpeed: 88,
    spacing: 54,
    intensity: 19,
    brightnessBoost: 31,
    opacityBoost: 21
  };
  makerWindow.MakerAPI.loadEditConfig(saved);
  const exported = makerWindow.MakerAPI.getExportJSON();
  assert.equal(exported.engine, 'pulses');
  assert.equal(exported.maker, 'effects/pulses-maker.html');
  assert.deepEqual(JSON.parse(JSON.stringify(exported.config)), saved);
  assert.ok(previewCalls.length >= 2);
});

test('the hot loop uses cached media and portable output includes both layer placements once', () => {
  const engine = fs.readFileSync(enginePath, 'utf8');
  const renderFrame = engine.match(/function renderFrame\(progress\) \{([\s\S]*?)\n    \}\n\n    function scheduleFrame/);
  assert.ok(renderFrame, 'could not inspect renderFrame');
  assert.match(renderFrame[1], /ctx\.drawImage\(cachedSurface/);
  assert.doesNotMatch(renderFrame[1], /new Image|document\.createElement|createRadialGradient|shadowBlur|getImageData/);

  const definition = {
    enabled: true,
    name: 'Pulses',
    engine: 'pulses',
    config: { imgSrc: 'img/example.jpg', pulseCount: 4, intensity: 8 }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Pulses placement test',
    slides: [{
      background: { src: '', effect: definition },
      foregroundLayers: [{ name: 'Foreground', src: 'img/example.jpg', effect: definition }],
      audioLayers: []
    }]
  });

  assert.equal((html.match(/inlineEngines\["pulses"\]/g) || []).length, 1);
  assert.match(html, /function mount\(canvas, ctx, config\)/);
  assert.match(html, /background[^]*"pulses"/);
  assert.match(html, /foregroundLayers[^]*"pulses"/);
  assert.doesNotMatch(html, /import\(['"]effects\/pulses-engine\.js/);
});

test('the PHP portable exporter inlines Pulses without module syntax', () => {
  const result = spawnSync(
    'php',
    [path.join('tests', 'php', 'pulses-offline-player.test.php')],
    { cwd: applicationRoot, encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(
    result.status,
    0,
    `PHP portable-player test failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /PULSES_PHP_PORTABLE_OK/);
});
