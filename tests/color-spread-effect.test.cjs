const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'color-spread-engine.js');
const makerPath = path.join(applicationRoot, 'effects', 'color-spread-maker.html');

function createContextRecorder() {
  return {
    clearCount: 0,
    drawCount: 0,
    fillCount: 0,
    maskWrites: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '',
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    setTransform() {},
    clearRect() { this.clearCount += 1; },
    drawImage() { this.drawCount += 1; },
    fillRect() { this.fillCount += 1; },
    beginPath() {},
    arc() {},
    fill() { this.fillCount += 1; },
    createLinearGradient() { return { addColorStop() {} }; },
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() { this.maskWrites += 1; }
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
  let currentTime = 0;

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
    + '\n;globalThis.__colorSpread = {'
    + 'MAX_TOTAL_SURFACE_PIXELS, MASK_SURFACE_PIXELS, FULL_SURFACE_COUNT, '
    + 'MAX_ANIMATED_PIXELS, MAX_ANIMATED_DIMENSION, TARGET_FPS, MAX_REPEATED_OBJECTS, '
    + 'DEFAULTS, schema, normalizeConfig, calculateCappedSize, calculateMaskSize, '
    + 'buildSpreadField, mount};';
  const sandbox = {
    Date,
    Float32Array,
    Image: FakeImage,
    Math,
    Number,
    Object,
    Uint8ClampedArray,
    document,
    matchMedia: () => ({ matches: reducedMotion }),
    performance: { now: () => currentTime },
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
    api: sandbox.__colorSpread,
    images,
    animationFrames,
    timers,
    listeners,
    cachedSurfaces,
    document,
    setNow(value) { currentTime = value; },
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

test('Color Spread is registered exactly once under Color & Light', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'color-spread');

  assert.deepEqual(registrations, [{ category: 'Color & Light', engine: 'color-spread' }]);
});

test('normalization and every internal surface remain inside deterministic limits', () => {
  const { api } = loadEngineHarness();
  const normalized = api.normalizeConfig({
    startDelay: -4,
    duration: Infinity,
    spreadSpeed: 99,
    softness: 400,
    targetColor: 'not-a-color',
    intensity: 900,
    saturationIncrease: -8,
    brightnessShift: 500,
    origin: { mode: 'unknown', x: -4, y: 7 }
  });

  assert.equal(api.MAX_TOTAL_SURFACE_PIXELS, 2073600);
  assert.equal(api.TARGET_FPS, 30);
  assert.equal(api.MAX_REPEATED_OBJECTS, 0);
  assert.equal(api.FULL_SURFACE_COUNT, 4);
  assert.equal(normalized.startDelay, 0);
  assert.equal(normalized.duration, api.DEFAULTS.duration);
  assert.equal(normalized.spreadSpeed, 2.5);
  assert.equal(normalized.softness, 60);
  assert.equal(normalized.targetColor, api.DEFAULTS.targetColor);
  assert.equal(normalized.intensity, 100);
  assert.equal(normalized.saturationIncrease, 0);
  assert.equal(normalized.brightnessShift, 30);
  assert.equal(normalized.origin.mode, 'center');
  assert.equal(normalized.origin.x, 0);
  assert.equal(normalized.origin.y, 1);

  const frameSize = api.calculateCappedSize(8000, 6000);
  const maskSize = api.calculateMaskSize(frameSize.width, frameSize.height);
  const framePixels = frameSize.width * frameSize.height;
  const maskPixels = maskSize.width * maskSize.height;
  assert.ok(framePixels <= api.MAX_ANIMATED_PIXELS);
  assert.ok(maskPixels <= api.MASK_SURFACE_PIXELS);
  assert.ok(framePixels * api.FULL_SURFACE_COUNT + maskPixels <= api.MAX_TOTAL_SURFACE_PIXELS);
  assert.ok(Math.abs((frameSize.width / frameSize.height) - (4 / 3)) < 0.003);
});

test('the organic spread field supports point and directional origins without repeated objects', () => {
  const { api } = loadEngineHarness();
  const point = api.buildSpreadField(32, 18, { origin: { mode: 'custom', x: 0.25, y: 0.5 } });
  const left = api.buildSpreadField(32, 18, { origin: { mode: 'left', x: 0.5, y: 0.5 } });

  assert.equal(point.length, 32 * 18);
  assert.equal(left.length, 32 * 18);
  assert.ok(Array.from(point).every(value => value >= 0 && value <= 1));
  assert.ok(left[0] < left[31], 'a left-edge field should progress across the image');
  assert.notDeepEqual(Array.from(point.slice(0, 40)), Array.from(left.slice(0, 40)));
});

test('the engine idles during delay, owns one frame, completes, and cleans up idempotently', () => {
  const harness = loadEngineHarness();
  const canvas = { width: 7680, height: 4320 };
  const context = createContextRecorder();
  const cleanup = harness.api.mount(canvas, context, { startDelay: 1, duration: 1 });
  const diagnostics = cleanup.getDiagnostics();

  assert.equal(harness.cachedSurfaces.length, 4);
  assert.ok(diagnostics.framePixels <= harness.api.MAX_ANIMATED_PIXELS);
  assert.ok(diagnostics.maskPixels <= harness.api.MASK_SURFACE_PIXELS);
  assert.ok(diagnostics.totalSurfacePixels <= harness.api.MAX_TOTAL_SURFACE_PIXELS);
  assert.equal(harness.animationFrames.size, 0, 'the start delay must remain idle');
  assert.equal(harness.timers.size, 1);

  harness.fireTimer();
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1000);
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1010);
  assert.equal(harness.animationFrames.size, 1, 'throttling must retain exactly one scheduled frame');
  harness.fireFrame(2010);
  assert.equal(harness.animationFrames.size, 0, 'the completed transformation must remain static');

  cleanup();
  cleanup();
  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.has('visibilitychange'), false);
});

test('image loads are cached once, stale callbacks are invalidated, and two instances stay independent', () => {
  const harness = loadEngineHarness();
  const firstContext = createContextRecorder();
  const first = harness.api.mount(
    { width: 1920, height: 1080 },
    firstContext,
    { imgSrc: 'img/first.jpg', startDelay: 0 }
  );
  const staleImage = harness.images[0];
  first.restart({ imgSrc: 'img/second.jpg' });
  assert.equal(staleImage.onload, null);
  assert.equal(staleImage.onerror, null);
  assert.equal(harness.images.length, 2);

  harness.loadImage(1, 8000, 6000);
  assert.equal(harness.animationFrames.size, 1);
  const sourceDrawsAfterLoad = harness.cachedSurfaces.reduce(
    (sum, surface) => sum + surface.context.drawCount,
    0
  );
  first.restart({ softness: 48, spreadSpeed: 2 });
  assert.equal(harness.animationFrames.size, 1, 'restart must replace rather than overlap its frame');
  const sourceDrawsAfterLightRestart = harness.cachedSurfaces.reduce(
    (sum, surface) => sum + surface.context.drawCount,
    0
  );
  assert.ok(sourceDrawsAfterLightRestart >= sourceDrawsAfterLoad);

  const second = harness.api.mount(
    { width: 1920, height: 1080 },
    createContextRecorder(),
    { startDelay: 0, origin: { mode: 'right' } }
  );
  assert.equal(harness.animationFrames.size, 2, 'two instances must own one frame each');
  first();
  assert.equal(harness.animationFrames.size, 1);
  second();
  assert.equal(harness.animationFrames.size, 0);

  const pendingHarness = loadEngineHarness();
  const pending = pendingHarness.api.mount(
    { width: 640, height: 360 },
    createContextRecorder(),
    { imgSrc: 'img/late.jpg' }
  );
  const lateImage = pendingHarness.images[0];
  pending();
  assert.equal(lateImage.onload, null);
  assert.equal(lateImage.onerror, null);
  assert.equal(pendingHarness.animationFrames.size, 0);
  assert.equal(pendingHarness.timers.size, 0);
});

test('reduced motion and hidden mounts draw once without an ambient loop', () => {
  const reducedHarness = loadEngineHarness({ reducedMotion: true });
  const reducedContext = createContextRecorder();
  const reducedCleanup = reducedHarness.api.mount(
    { width: 1920, height: 1080 },
    reducedContext,
    { startDelay: 2 }
  );
  assert.ok(reducedContext.drawCount > 0);
  assert.equal(reducedHarness.animationFrames.size, 0);
  assert.equal(reducedHarness.timers.size, 0);
  reducedCleanup();

  const hiddenHarness = loadEngineHarness({ hidden: true });
  const hiddenCleanup = hiddenHarness.api.mount(
    { width: 1920, height: 1080 },
    createContextRecorder(),
    { startDelay: 1 }
  );
  assert.equal(hiddenHarness.animationFrames.size, 0);
  assert.equal(hiddenHarness.timers.size, 0);
  hiddenHarness.document.hidden = false;
  hiddenHarness.listeners.get('visibilitychange')();
  assert.equal(hiddenHarness.timers.size, 1);
  hiddenCleanup();
});

test('maker exposes every requested control, debounces one preview, and restores edit configuration', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = loadEngineHarness();
  const expectedControls = {
    startDelay: ['0', '8', '0.1', api.DEFAULTS.startDelay],
    duration: ['1', '15', '0.1', api.DEFAULTS.duration],
    spreadSpeed: ['0.5', '2.5', '0.1', api.DEFAULTS.spreadSpeed],
    softness: ['5', '60', '1', api.DEFAULTS.softness],
    intensity: ['0', '100', '1', api.DEFAULTS.intensity],
    saturationIncrease: ['0', '100', '1', api.DEFAULTS.saturationIncrease],
    brightnessShift: ['-30', '30', '1', api.DEFAULTS.brightnessShift]
  };

  for (const [key, [min, max, step, defaultValue]] of Object.entries(expectedControls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing maker control: ${key}`);
    assert.match(input[0], new RegExp(`min=["']${min.replace('.', '\\.')}["']`));
    assert.match(input[0], new RegExp(`max=["']${max.replace('.', '\\.')}["']`));
    assert.match(input[0], new RegExp(`step=["']${step.replace('.', '\\.')}["']`));
    assert.equal(Number(input[0].match(/value=["']([^"']+)["']/)[1]), Number(defaultValue));
  }
  assert.match(maker, /id="targetColor" value="#f97316"/);
  assert.match(maker, /id="originMode"/);
  for (const mode of ['center', 'custom', 'left', 'right', 'top', 'bottom']) {
    assert.match(maker, new RegExp(`<option value=["']${mode}["']`));
  }
  assert.match(maker, /<base href="\.\.\/">/);
  assert.match(maker, /const PREVIEW_DEBOUNCE_MS = 140/);
  assert.match(maker, /if \(!controller\) controller = mount/);
  assert.match(maker, /controller\.restart\(previewConfig\(\)\)/);
  assert.match(maker, /if \(request !== previewRequest\) return/);
  assert.match(maker, /largeSource\.width = 4096/);
  assert.match(maker, /largeSource\.height = 3072/);
  assert.match(maker, /const canvases = \[document\.createElement\('canvas'\), document\.createElement\('canvas'\)\]/);
  assert.match(maker, /for \(let index = 0; index < 40; index \+= 1\)/);
  assert.match(maker, /controllers\.every\(control => control\.getDiagnostics\(\)\.maskPixels > 0\)/);
  assert.doesNotMatch(maker, /new Function|eval\s*\(/);

  const elements = new Map();
  function element(id) {
    const target = {
      id,
      value: '',
      textContent: '',
      hidden: false,
      style: {},
      listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 450 }; },
      setPointerCapture() {},
      releasePointerCapture() {}
    };
    elements.set(id, target);
    return target;
  }
  for (const key of Object.keys(expectedControls)) {
    element(key);
    element(`val-${key}`);
  }
  element('targetColor');
  element('originMode');
  element('runBtn');
  const stage = element('stage');
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450 });
  element('originMarker');
  const canvas = element('cvs');
  canvas.getContext = () => createContextRecorder();
  const previewCalls = [];
  function mountStub(_canvas, _ctx, previewConfig) {
    const controller = () => {};
    controller.restart = next => previewCalls.push(next);
    controller.getDiagnostics = () => ({
      framePixels: 1,
      maskPixels: 1,
      fullSurfaceCount: api.FULL_SURFACE_COUNT,
      totalSurfacePixels: api.FULL_SURFACE_COUNT + 1
    });
    previewCalls.push(previewConfig);
    return controller;
  }
  const makerWindow = {
    img1Data: '',
    imgData: '',
    name1: '',
    addEventListener() {},
    removeEventListener() {}
  };
  const moduleSource = maker.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*/, '');
  const makerSandbox = {
    DEFAULTS: api.DEFAULTS,
    FULL_SURFACE_COUNT: api.FULL_SURFACE_COUNT,
    MASK_SURFACE_PIXELS: api.MASK_SURFACE_PIXELS,
    MAX_ANIMATED_PIXELS: api.MAX_ANIMATED_PIXELS,
    MAX_TOTAL_SURFACE_PIXELS: api.MAX_TOTAL_SURFACE_PIXELS,
    mount: mountStub,
    normalizeConfig: api.normalizeConfig,
    document: {
      body: { appendChild() {} },
      createElement() { return element(`created-${elements.size}`); },
      getElementById: id => elements.get(id) || null
    },
    window: makerWindow,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame() {}
  };
  vm.runInNewContext(moduleSource, makerSandbox, { filename: makerPath });

  const saved = {
    imgSrc: 'img/saved.jpg',
    startDelay: 1.2,
    duration: 9.4,
    spreadSpeed: 2.1,
    softness: 44,
    targetColor: '#2563eb',
    intensity: 83,
    saturationIncrease: 72,
    brightnessShift: -12,
    origin: { mode: 'custom', x: 0.234, y: 0.678 }
  };
  makerWindow.MakerAPI.loadEditConfig(saved);
  const exported = makerWindow.MakerAPI.getExportJSON();
  assert.equal(exported.engine, 'color-spread');
  assert.equal(exported.maker, 'effects/color-spread-maker.html');
  assert.deepEqual(JSON.parse(JSON.stringify(exported.config)), saved);
  assert.ok(previewCalls.length >= 2);
});

test('the hot loop reuses caches and portable output includes both layer placements once', () => {
  const engine = fs.readFileSync(enginePath, 'utf8');
  const renderFrame = engine.match(/function renderFrame\(progress\) \{([\s\S]*?)\n    \}\n\n    function scheduleFrame/);
  assert.ok(renderFrame, 'could not inspect renderFrame');
  assert.match(renderFrame[1], /revealContext\.drawImage\(targetSurface/);
  assert.match(renderFrame[1], /ctx\.drawImage\(revealSurface/);
  assert.doesNotMatch(renderFrame[1], /new Image|document\.createElement|createLinearGradient|shadowBlur|getImageData/);
  assert.match(engine, /function drawNeutralFrame\(\)[^]*ctx\.drawImage\(baseSurface/);

  const definition = {
    enabled: true,
    name: 'Color Spread',
    engine: 'color-spread',
    config: { imgSrc: 'img/example.jpg', targetColor: '#f97316', origin: { mode: 'left', x: 0, y: 0.5 } }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Color Spread placement test',
    slides: [{
      background: { src: '', effect: definition },
      foregroundLayers: [{ name: 'Foreground', src: 'img/example.jpg', effect: definition }],
      audioLayers: []
    }]
  });

  assert.equal((html.match(/inlineEngines\["color-spread"\]/g) || []).length, 1);
  assert.match(html, /function mount\(canvas, ctx, config\)/);
  assert.match(html, /background[^]*"color-spread"/);
  assert.match(html, /foregroundLayers[^]*"color-spread"/);
  assert.doesNotMatch(html, /import\(['"]effects\/color-spread-engine\.js/);
});

test('the PHP portable exporter inlines Color Spread without module syntax', () => {
  const result = spawnSync(
    'php',
    [path.join('tests', 'php', 'color-spread-offline-player.test.php')],
    { cwd: applicationRoot, encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(
    result.status,
    0,
    `PHP portable-player test failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /COLOR_SPREAD_PHP_PORTABLE_OK/);
});
