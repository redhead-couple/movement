const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'zoom-engine.js');
const makerPath = path.join(applicationRoot, 'effects', 'zoom-maker.html');

function createContextRecorder() {
  const opacityAssignments = [];
  let globalAlpha = 1;
  return {
    drawCalls: [],
    opacityAssignments,
    filter: 'none',
    get globalAlpha() { return globalAlpha; },
    set globalAlpha(value) {
      globalAlpha = value;
      opacityAssignments.push(value);
    },
    clearRect() {},
    save() {},
    restore() {},
    drawImage(...args) { this.drawCalls.push(args); }
  };
}

function loadEngineHarness({ reducedMotion = false, hidden = false } = {}) {
  const images = [];
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const cachedSurfaces = [];
  let nextFrameId = 1;
  let nextTimerId = 1;

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
    + '\n;globalThis.__zoom = {'
    + 'MAX_ANIMATED_PIXELS, TARGET_FPS, DEFAULTS, normalizeConfig, calculateCappedSize, mount};';
  const sandbox = {
    Image: FakeImage,
    document,
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
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
    api: sandbox.__zoom,
    images,
    frames,
    timers,
    listeners,
    cachedSurfaces,
    document,
    loadImage(index, width, height) {
      const image = images[index];
      image.naturalWidth = width;
      image.naturalHeight = height;
      image.width = width;
      image.height = height;
      assert.equal(typeof image.onload, 'function');
      image.onload();
    },
    fireFrame(timestamp) {
      const entry = frames.entries().next().value;
      assert.ok(entry, 'expected one pending animation frame');
      frames.delete(entry[0]);
      entry[1](timestamp);
    },
    fireTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected one pending timer');
      timers.delete(entry[0]);
      entry[1].callback();
    }
  };
}

function collectZoomDefinitions(flow) {
  const definitions = [];
  for (const slide of Array.isArray(flow.slides) ? flow.slides : []) {
    const specs = [slide?.background?.effect, slide?.bgEffect, slide?.fgEffect];
    for (const layer of Array.isArray(slide?.foregroundLayers) ? slide.foregroundLayers : []) {
      specs.push(layer?.effect);
    }
    for (const spec of specs) {
      const definition = spec?.json || spec;
      if (definition?.engine === 'zoom') definitions.push(definition);
    }
  }
  return definitions;
}

test('Zoom remains registered once under Camera & Image and the legacy example keeps its shape', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'zoom');
  assert.deepEqual(registrations, [{ category: 'Camera & Image', engine: 'zoom' }]);
  assert.equal(registry[0].engines, 'transform, zoom, blur');

  for (const fixture of ['examples/about/flow.json']) {
    const flow = JSON.parse(fs.readFileSync(path.join(applicationRoot, fixture), 'utf8'));
    const definitions = collectZoomDefinitions(flow);
    assert.ok(definitions.length > 0, `${fixture} should contain Zoom definitions`);
    for (const definition of definitions) {
      assert.equal(definition.engine, 'zoom');
      assert.equal(Object.hasOwn(definition.config, 'startOpacity'), false);
      assert.equal(Object.hasOwn(definition.config, 'endOpacity'), false);
    }
  }
});

test('normalization preserves legacy opacity and bounds malformed input and animated pixels', () => {
  const { api } = loadEngineHarness();
  const legacy = api.normalizeConfig({ zoomStart: 1.5, zoomEnd: 1, duration: 0.5 });
  assert.equal(legacy.startOpacity, 1);
  assert.equal(legacy.endOpacity, 1);
  assert.equal(legacy.duration, 0.5);

  const malformed = api.normalizeConfig({
    zoomStart: 0,
    zoomEnd: Infinity,
    xStart: -4,
    yEnd: 8,
    brightStart: -1,
    brightEnd: 20,
    startOpacity: -2,
    endOpacity: 4,
    duration: 'bad',
    startDelay: 99,
    easing: 'unknown'
  });
  assert.equal(malformed.zoomStart, 0.1);
  assert.equal(malformed.zoomEnd, api.DEFAULTS.zoomEnd);
  assert.equal(malformed.xStart, 0);
  assert.equal(malformed.yEnd, 1);
  assert.equal(malformed.brightStart, 0);
  assert.equal(malformed.brightEnd, 2);
  assert.equal(malformed.startOpacity, 0);
  assert.equal(malformed.endOpacity, 1);
  assert.equal(malformed.duration, api.DEFAULTS.duration);
  assert.equal(malformed.startDelay, 5);
  assert.equal(malformed.easing, 'smooth');
  assert.equal(api.MAX_ANIMATED_PIXELS, 2073600);
  assert.equal(api.TARGET_FPS, 30);

  const size = api.calculateCappedSize(8000, 6000);
  assert.ok(size.width * size.height <= api.MAX_ANIMATED_PIXELS);
  assert.ok(Math.abs((size.width / size.height) - (4 / 3)) < 0.002);
});

test('start and end opacity interpolate with easing only around the zoomed image draw', () => {
  const harness = loadEngineHarness();
  const canvas = { width: 320, height: 180 };
  const ctx = createContextRecorder();
  const cleanup = harness.api.mount(canvas, ctx, {
    imgSrc: 'img/example.jpg',
    startOpacity: 0.2,
    endOpacity: 0.8,
    duration: 1,
    easing: 'smooth'
  });
  assert.equal(harness.frames.size, 0, 'image loading should remain idle');
  harness.loadImage(0, 4000, 3000);
  assert.ok(canvas.width * canvas.height <= harness.api.MAX_ANIMATED_PIXELS);
  assert.deepEqual(ctx.opacityAssignments.slice(-2), [0.2, 1]);
  assert.equal(harness.frames.size, 1);

  harness.fireFrame(1000);
  harness.fireFrame(1250);
  const easedQuarter = -(Math.cos(Math.PI * 0.25) - 1) / 2;
  const expectedOpacity = 0.2 + ((0.8 - 0.2) * easedQuarter);
  assert.ok(Math.abs(ctx.opacityAssignments.at(-2) - expectedOpacity) < 1e-9);
  assert.equal(ctx.opacityAssignments.at(-1), 1, 'canvas alpha must reset after drawImage');

  harness.fireFrame(2000);
  assert.ok(Math.abs(ctx.opacityAssignments.at(-2) - 0.8) < 1e-9);
  assert.equal(ctx.opacityAssignments.at(-1), 1);
  assert.equal(harness.frames.size, 0, 'completed Zoom effects must stop scheduling frames');
  harness.document.hidden = true;
  harness.listeners.get('visibilitychange')();
  harness.document.hidden = false;
  harness.listeners.get('visibilitychange')();
  assert.equal(harness.frames.size, 0, 'visibility changes must not replay a completed effect');
  cleanup();
});

test('player-supplied decoded media renders without starting a second image request', () => {
  const harness = loadEngineHarness({ reducedMotion: true });
  const canvas = { width: 320, height: 180 };
  const ctx = createContextRecorder();
  const source = {
    naturalWidth: 1920,
    naturalHeight: 1080,
    width: 1920,
    height: 1080
  };
  const cleanup = harness.api.mount(canvas, ctx, {
    imgSrc: 'img/preloaded.jpg',
    preloadedImages: new Map([['img/preloaded.jpg', source]])
  });

  assert.equal(harness.images.length, 0);
  assert.ok(ctx.drawCalls.length > 0);
  cleanup();
});

test('replay reuses decoded media, instances stay local, missing media stays idle, and cleanup is idempotent', () => {
  const harness = loadEngineHarness();
  const first = harness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: 'img/one.jpg', startDelay: 1 }
  );
  const staleOnload = harness.images[0].onload;
  const second = harness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: 'img/two.jpg' }
  );
  harness.loadImage(0, 1920, 1080);
  harness.loadImage(1, 1920, 1080);
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.frames.size, 1);

  first.restart({ startOpacity: 0.4, endOpacity: 0.9 });
  assert.equal(harness.images.length, 2, 'replay with the same source must reuse decoded media');
  assert.equal(harness.timers.size, 1);
  first();
  first();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.frames.size, 1, 'cleaning one instance must not stop another');
  staleOnload();
  assert.equal(harness.timers.size, 0, 'late media callbacks must not restart disposed work');
  second();
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.listeners.size, 0);

  const missingHarness = loadEngineHarness();
  const missing = missingHarness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: '' }
  );
  assert.equal(missingHarness.frames.size, 0);
  assert.equal(missingHarness.timers.size, 0);
  missing();

  const reducedHarness = loadEngineHarness({ reducedMotion: true });
  const reduced = reducedHarness.api.mount(
    { width: 320, height: 180 },
    createContextRecorder(),
    { imgSrc: 'img/reduced.jpg', startOpacity: 0, endOpacity: 1 }
  );
  reducedHarness.loadImage(0, 1920, 1080);
  assert.equal(reducedHarness.frames.size, 0);
  assert.equal(reducedHarness.timers.size, 0);
  reduced();
});

test('maker exports and restores both opacity controls with matched defaults and a debounced reusable preview', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = loadEngineHarness();
  const expectedControls = {
    zoomStart: String(api.DEFAULTS.zoomStart),
    zoomEnd: String(api.DEFAULTS.zoomEnd),
    startOpacity: String(api.DEFAULTS.startOpacity),
    endOpacity: String(api.DEFAULTS.endOpacity)
  };

  for (const [key, value] of Object.entries(expectedControls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing maker control: ${key}`);
    const valueAttribute = input[0].match(/value=["']([^"']+)["']/);
    assert.ok(valueAttribute, `missing default value for maker control: ${key}`);
    assert.equal(Number(valueAttribute[1]), Number(value));
    assert.match(maker, new RegExp(`${key}: cfg\\.${key}`));
  }
  const startControls = maker.match(/<div class="group" id="startControls">([\s\S]*?)<\/div>\s*<div class="group" id="endControls">/);
  const endControls = maker.match(/<div class="group" id="endControls">([\s\S]*?)<\/div>\s*<div class="group">\s*<h4>4\. Timing/);
  assert.ok(startControls && /Start Opacity/.test(startControls[1]), 'Start Opacity must be visible in the START State group');
  assert.ok(endControls && /End Opacity/.test(endControls[1]), 'End Opacity must be visible in the END State group');
  assert.doesNotMatch(maker, /id="advancedControls"/);
  assert.match(maker, /const PREVIEW_DEBOUNCE_MS = 140/);
  assert.match(maker, /controller\.restart\(previewConfig\(\)\)/);
  assert.match(maker, /addEventListener\('input',[\s\S]*?schedulePreview\(\)/);
  assert.match(maker, /function loadEditConfig\(config\)/);
  assert.match(maker, /CONTROL_KEYS\.forEach\(key => setControlValue\(key, normalized\[key\]\)\)/);
  assert.match(maker, /imgSrc: imageNameRef \|\| savedImageRef/);
  assert.match(maker, /engine: ENGINE/);
  assert.doesNotMatch(maker, /new Function|eval\s*\(/);

  const elements = new Map();
  const controlKeys = [
    'zoomStart', 'xStart', 'yStart', 'brightStart',
    'zoomEnd', 'xEnd', 'yEnd', 'brightEnd',
    'duration', 'startDelay', 'startOpacity', 'endOpacity'
  ];
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
  for (const key of controlKeys) {
    element(key);
    element(`val-${key}`);
  }
  for (const id of ['easing', 'runBtn', 'copyStartToEnd']) element(id);
  const canvas = element('cvs');
  canvas.getContext = () => createContextRecorder();
  const mounts = [];
  function mountStub(_canvas, _ctx, config) {
    const controller = () => {};
    controller.restart = nextConfig => mounts.push(nextConfig);
    mounts.push(config);
    return controller;
  }
  const makerWindow = {
    imgData: '',
    imgName: '',
    addEventListener() {}
  };
  const moduleSource = maker.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/^\s*import[^\n]+\n/, '');
  const makerSandbox = {
    DEFAULTS: api.DEFAULTS,
    normalizeConfig: api.normalizeConfig,
    mount: mountStub,
    document: { getElementById: id => elements.get(id) || null },
    window: makerWindow,
    setTimeout: () => 1,
    clearTimeout() {}
  };
  vm.runInNewContext(moduleSource, makerSandbox, { filename: makerPath });

  const oldConfig = {
    imgSrc: 'img/legacy.jpg',
    zoomStart: 1.5,
    xStart: 0.25,
    yStart: 0.75,
    brightStart: 0.8,
    zoomEnd: 1,
    xEnd: 0.6,
    yEnd: 0.4,
    brightEnd: 0.6,
    duration: 0.5,
    startDelay: 0.2,
    easing: 'linear'
  };
  makerWindow.MakerAPI.loadEditConfig(oldConfig);
  const legacyExport = makerWindow.MakerAPI.getExportJSON();
  assert.equal(legacyExport.config.imgSrc, oldConfig.imgSrc);
  for (const [key, value] of Object.entries(oldConfig)) {
    if (key !== 'imgSrc') assert.equal(legacyExport.config[key], value, `legacy ${key} should survive edit mode`);
  }
  assert.equal(legacyExport.config.startOpacity, 1);
  assert.equal(legacyExport.config.endOpacity, 1);

  makerWindow.MakerAPI.loadEditConfig({ ...oldConfig, startOpacity: 0.15, endOpacity: 0.85 });
  const opacityExport = makerWindow.MakerAPI.getExportJSON();
  assert.equal(opacityExport.config.startOpacity, 0.15);
  assert.equal(opacityExport.config.endOpacity, 0.85);
  assert.equal(mounts.length >= 3, true);
});

test('portable player includes the same Zoom engine once for background and foreground placements', () => {
  const definition = {
    enabled: true,
    name: 'Zoom / Pan',
    engine: 'zoom',
    config: {
      imgSrc: 'img/example.jpg',
      startOpacity: 0.25,
      endOpacity: 0.75
    }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Zoom placement test',
    slides: [{
      background: { src: '', effect: definition },
      foregroundLayers: [{ name: 'Foreground', src: 'img/example.jpg', effect: definition }],
      audioLayers: []
    }]
  });

  assert.equal((html.match(/inlineEngines\["zoom"\]/g) || []).length, 1);
  assert.match(html, /startOpacity: 1\.0/);
  assert.match(html, /ctx\.globalAlpha = currentOpacity/);
  assert.match(html, /background[^]*"zoom"/);
  assert.match(html, /foregroundLayers[^]*"zoom"/);
  assert.doesNotMatch(html, /import\(['"]effects\/zoom-engine\.js/);
});
