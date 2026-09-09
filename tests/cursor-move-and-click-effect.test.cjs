const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'cursor-move-and-click-engine.js');
const makerPath = path.join(applicationRoot, 'effects', 'cursor-move-and-click-maker.html');

function createContextRecorder() {
  return {
    drawCalls: [],
    arcs: [],
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save() {}, restore() {}, setTransform() {}, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, fill() {}, stroke() {}, translate() {},
    arc(...args) { this.arcs.push(args); },
    drawImage(...args) { this.drawCalls.push(args); }
  };
}

function loadEngineHarness({ hidden = false, reducedMotion = false } = {}) {
  const images = [];
  const animationFrames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const surfaces = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let now = 0;

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
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
      const surface = { width: 0, height: 0, context, getContext() { return context; } };
      surfaces.push(surface);
      return surface;
    }
  };

  const source = loadEffectEngineSource(enginePath)
    + '\n;globalThis.__cursorEffect = {'
    + 'MAX_TOTAL_SURFACE_PIXELS, CURSOR_ATLAS_PIXELS, MAX_ANIMATED_PIXELS, TARGET_FPS, '
    + 'MAX_REPEATED_OBJECTS, DEFAULTS, normalizeConfig, calculateCappedSize, mount};';
  const sandbox = {
    Image: FakeImage,
    Math, Number, Object,
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
    api: sandbox.__cursorEffect,
    images, animationFrames, timers, listeners, surfaces,
    setNow(value) { now = value; },
    loadImage(index, width, height) {
      const image = images[index];
      image.naturalWidth = width;
      image.naturalHeight = height;
      assert.equal(typeof image.onload, 'function');
      image.onload.call(image);
    },
    failImage(index) {
      const image = images[index];
      assert.equal(typeof image.onerror, 'function');
      image.onerror.call(image);
    },
    fireTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected a timer');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    fireFrame(timestamp) {
      const entry = animationFrames.entries().next().value;
      assert.ok(entry, 'expected a frame');
      animationFrames.delete(entry[0]);
      entry[1](timestamp);
    }
  };
}

test('Cursor Move and Click is registered once under Paths & Guided Motion', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'cursor-move-and-click');
  assert.deepEqual(registrations, [{ category: 'Paths & Guided Motion', engine: 'cursor-move-and-click' }]);
});

test('configuration and all render surfaces remain inside deterministic limits', () => {
  const { api } = loadEngineHarness();
  const normalized = api.normalizeConfig({
    startDelay: -4,
    movementDuration: 99,
    highlightColor: 'url(bad)',
    highlightSize: 900,
    highlightDuration: 99,
    disappearAfterClick: 'false',
    startPosition: { x: -2, y: 8 },
    clickPosition: { x: Infinity, y: NaN }
  });
  assert.equal(api.MAX_TOTAL_SURFACE_PIXELS, 2073600);
  assert.equal(api.MAX_ANIMATED_PIXELS, 1011200);
  assert.equal(api.TARGET_FPS, 30);
  assert.equal(api.MAX_REPEATED_OBJECTS, 1);
  assert.equal(normalized.startDelay, 0);
  assert.equal(normalized.movementDuration, 4);
  assert.equal(normalized.highlightColor, api.DEFAULTS.highlightColor);
  assert.equal(normalized.highlightSize, 240);
  assert.equal(normalized.highlightDuration, 3);
  assert.equal(normalized.disappearAfterClick, true);
  assert.equal(normalized.startPosition.x, 0.01);
  assert.equal(normalized.startPosition.y, 0.99);
  assert.equal(normalized.clickPosition.x, api.DEFAULTS.clickPosition.x);

  const size = api.calculateCappedSize(8000, 6000);
  assert.ok(size.width * size.height <= api.MAX_ANIMATED_PIXELS);
  assert.ok(size.width * size.height * 2 + api.CURSOR_ATLAS_PIXELS <= api.MAX_TOTAL_SURFACE_PIXELS);
  assert.ok(Math.abs(size.width / size.height - 4 / 3) < 0.002);
});

test('highlight duration controls the ring lifetime while legacy configs retain the old timing', () => {
  const { api } = loadEngineHarness();
  assert.equal(api.DEFAULTS.highlightDuration, 0.7);
  assert.equal(api.normalizeConfig({}).highlightDuration, 0.7);
  assert.equal(api.normalizeConfig({ highlightDuration: -4 }).highlightDuration, 0.2);

  const harness = loadEngineHarness();
  const context = createContextRecorder();
  const cleanup = harness.api.mount({ width: 320, height: 180 }, context, {
    startDelay: 0,
    movementDuration: 0.4,
    highlightDuration: 3
  });
  harness.fireFrame(1000);
  harness.fireFrame(2500);
  assert.ok(context.arcs.length > 0, 'the target highlight should still be active at 1.5 seconds');
  assert.equal(harness.animationFrames.size, 1, 'the extended highlight keeps one frame scheduled');
  harness.fireFrame(4500);
  assert.equal(harness.animationFrames.size, 0, 'the effect idles after the configured highlight ends');
  cleanup();
});

test('foreground placement remains transparent while background placement retains its source image', () => {
  const foregroundHarness = loadEngineHarness();
  const foregroundContext = createContextRecorder();
  const foreground = foregroundHarness.api.mount(
    { width: 1920, height: 1080 },
    foregroundContext,
    { imgSrc: 'img/foreground.jpg', layerPlacement: 'foreground', startDelay: 0 }
  );
  assert.equal(foregroundHarness.images.length, 0, 'overlay-only foregrounds must not decode the layer image');
  assert.equal(foregroundHarness.surfaces.length, 1, 'foregrounds only allocate the cursor atlas');
  foregroundHarness.fireFrame(1000);
  assert.ok(foregroundContext.drawCalls.length > 0, 'the cursor still renders on the transparent overlay');
  foreground();

  const backgroundHarness = loadEngineHarness();
  const backgroundContext = createContextRecorder();
  const background = backgroundHarness.api.mount(
    { width: 1920, height: 1080 },
    backgroundContext,
    { imgSrc: 'img/background.jpg', layerPlacement: 'background', startDelay: 0 }
  );
  assert.equal(backgroundHarness.images.length, 1);
  backgroundHarness.loadImage(0, 1920, 1080);
  const cachedSurface = backgroundHarness.surfaces[1];
  assert.ok(
    backgroundContext.drawCalls.some(args => args[0] === cachedSurface),
    'background placement must retain the established source-image rendering'
  );
  background();
});

test('the engine idles during delay, owns one frame, renders the click ring, and cleans up twice safely', () => {
  const harness = loadEngineHarness();
  const context = createContextRecorder();
  const canvas = { width: 320, height: 180 };
  const cleanup = harness.api.mount(canvas, context, {
    startDelay: 0.4,
    movementDuration: 0.4,
    highlightSize: 240
  });

  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.timers.size, 1, 'the delay must be idle');
  harness.fireTimer();
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1000);
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1450);
  assert.ok(context.arcs.length > 0, 'arrival must draw the expanding highlight ring');
  assert.equal(harness.animationFrames.size, 1, 'only one follow-up frame is scheduled');
  harness.fireFrame(2400);
  assert.equal(harness.animationFrames.size, 0, 'completed choreography must become idle');

  cleanup();
  cleanup();
  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.size, 0);
});

test('large and missing media, stale loads, replay, reduced motion, and two instances remain safe', () => {
  const harness = loadEngineHarness();
  const firstCanvas = { width: 320, height: 180 };
  const first = harness.api.mount(firstCanvas, createContextRecorder(), { imgSrc: 'img/one.jpg', startDelay: 0 });
  const staleImage = harness.images[0];
  const staleOnload = staleImage.onload;
  const second = harness.api.mount({ width: 320, height: 180 }, createContextRecorder(), { imgSrc: 'img/two.jpg', startDelay: 0 });
  harness.loadImage(0, 8000, 6000);
  harness.loadImage(1, 7680, 4320);
  assert.ok(firstCanvas.width * firstCanvas.height <= harness.api.MAX_ANIMATED_PIXELS);
  assert.equal(harness.animationFrames.size, 2, 'each instance owns exactly one frame');
  first.restart({ highlightSize: 240 });
  assert.equal(harness.images.length, 2, 'same-source replay reuses the decoded image');
  assert.equal(harness.animationFrames.size, 2, 'replay replaces the first loop');
  first();
  staleOnload.call(staleImage);
  assert.equal(harness.animationFrames.size, 1, 'late media cannot reactivate cleanup');
  second();
  assert.equal(harness.animationFrames.size, 0);

  const missingHarness = loadEngineHarness();
  const missing = missingHarness.api.mount({ width: 320, height: 180 }, createContextRecorder(), { imgSrc: 'missing.jpg' });
  missingHarness.failImage(0);
  assert.equal(missingHarness.animationFrames.size, 0);
  assert.equal(missingHarness.timers.size, 1);
  missing();

  const reducedHarness = loadEngineHarness({ reducedMotion: true });
  const reducedContext = createContextRecorder();
  const reduced = reducedHarness.api.mount({ width: 320, height: 180 }, reducedContext, {});
  assert.equal(reducedHarness.animationFrames.size, 0);
  assert.equal(reducedHarness.timers.size, 0);
  assert.ok(reducedContext.arcs.length > 0, 'reduced motion preserves a static click cue');
  reduced();
});

test('maker controls, debounced preview, and behavioral edit restoration match engine defaults', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = loadEngineHarness();
  const controls = {
    startDelay: ['0', '5', '0.1', String(api.DEFAULTS.startDelay)],
    movementDuration: ['0.4', '4', '0.1', String(api.DEFAULTS.movementDuration)],
    highlightSize: ['40', '240', '4', String(api.DEFAULTS.highlightSize)],
    highlightDuration: ['0.2', '3', '0.1', String(api.DEFAULTS.highlightDuration)]
  };
  for (const [key, values] of Object.entries(controls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing control ${key}`);
    for (const [index, attribute] of ['min', 'max', 'step', 'value'].entries()) {
      assert.match(input[0], new RegExp(`${attribute}=["']${values[index].replace('.', '\\.')}["']`));
    }
  }
  for (const id of ['highlightColor', 'disappearAfterClick', 'startMarker', 'clickMarker', 'runBtn']) {
    assert.match(maker, new RegExp(`id=["']${id}["']`));
  }
  assert.match(maker, /Positions are saved as percentages/);
  assert.match(maker, /const PREVIEW_DEBOUNCE_MS = 140/);
  assert.match(maker, /if \(!controller\) controller = mount/);
  assert.match(maker, /controller\.restart\(previewConfig\(\)\)/);
  assert.match(maker, /if \(request !== previewRequest\) return/);

  const elements = new Map();
  function element(id) {
    const target = {
      id, value: '', checked: false, textContent: '', style: {},
      classList: { toggle() {} },
      addEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 450 }; }
    };
    elements.set(id, target);
    return target;
  }
  for (const id of [
    'cvs', 'stage', 'startMarker', 'clickMarker', 'val-clickPosition', 'val-startPosition',
    'selectClickBtn', 'selectStartBtn', 'startDelay', 'movementDuration', 'highlightSize', 'highlightDuration',
    'val-startDelay', 'val-movementDuration', 'val-highlightSize', 'val-highlightDuration', 'highlightColor',
    'disappearAfterClick', 'runBtn'
  ]) element(id);
  elements.get('cvs').getContext = () => createContextRecorder();
  const previewCalls = [];
  function mountStub(_canvas, _ctx, config) {
    const controller = () => {};
    controller.restart = next => previewCalls.push(next);
    previewCalls.push(config);
    return controller;
  }
  const makerWindow = { img1Data: '', imgData: '', name1: '', addEventListener() {}, removeEventListener() {} };
  const moduleSource = maker.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/\s*import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];\s*/, '');
  const makerSandbox = {
    CURSOR_ATLAS_PIXELS: api.CURSOR_ATLAS_PIXELS,
    DEFAULTS: api.DEFAULTS,
    MAX_ANIMATED_PIXELS: api.MAX_ANIMATED_PIXELS,
    MAX_TOTAL_SURFACE_PIXELS: api.MAX_TOTAL_SURFACE_PIXELS,
    mount: mountStub,
    normalizeConfig: api.normalizeConfig,
    document: { getElementById: id => elements.get(id) || null },
    window: makerWindow,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame() {}
  };
  vm.runInNewContext(moduleSource, makerSandbox, { filename: makerPath });
  const legacySaved = {
    startDelay: 0.8,
    movementDuration: 1.6,
    highlightColor: '#22c55e',
    highlightSize: 120,
    disappearAfterClick: true,
    startPosition: { x: 0.14, y: 0.82 },
    clickPosition: { x: 0.68, y: 0.48 },
    imgSrc: 'img/legacy.png'
  };
  makerWindow.MakerAPI.loadEditConfig(legacySaved);
  const legacyExport = makerWindow.MakerAPI.getExportJSON();
  assert.equal(legacyExport.config.highlightDuration, api.DEFAULTS.highlightDuration);
  for (const [key, value] of Object.entries(legacySaved)) {
    assert.deepEqual(JSON.parse(JSON.stringify(legacyExport.config[key])), value);
  }

  const saved = {
    startDelay: 1.1,
    movementDuration: 2.7,
    highlightColor: '#ef4444',
    highlightSize: 188,
    highlightDuration: 2.3,
    disappearAfterClick: false,
    startPosition: { x: 0.23, y: 0.77 },
    clickPosition: { x: 0.81, y: 0.31 },
    imgSrc: 'img/saved.png'
  };
  makerWindow.MakerAPI.loadEditConfig(saved);
  const exported = makerWindow.MakerAPI.getExportJSON();
  assert.equal(exported.engine, 'cursor-move-and-click');
  assert.equal(exported.maker, 'effects/cursor-move-and-click-maker.html');
  assert.deepEqual(JSON.parse(JSON.stringify(exported.config)), saved);
  assert.equal(Object.hasOwn(exported.config, 'layerPlacement'), false);
  assert.ok(previewCalls.length >= 2);
});

test('hot loop uses cached assets and portable output includes both placements offline', () => {
  const engine = fs.readFileSync(enginePath, 'utf8');
  const renderFrame = engine.match(/function renderFrame\(elapsedSeconds, reducedStatic = false\) \{([\s\S]*?)\n    \}\n\n    function cycleDuration/);
  assert.ok(renderFrame);
  assert.match(renderFrame[1], /ctx\.drawImage\(cachedSurface/);
  assert.match(renderFrame[1], /drawCursor\(0/);
  assert.doesNotMatch(renderFrame[1], /new Image|document\.createElement|createLinearGradient|createRadialGradient|shadowBlur|getImageData/);

  const definition = {
    enabled: true,
    name: 'Cursor Move and Click',
    engine: 'cursor-move-and-click',
    config: { clickPosition: { x: 0.7, y: 0.4 } }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Cursor placement test',
    slides: [{
      background: { src: '', effect: definition },
      foregroundLayers: [{ name: 'Foreground', src: '', effect: definition }],
      audioLayers: []
    }]
  });
  assert.equal((html.match(/inlineEngines\["cursor-move-and-click"\]/g) || []).length, 1);
  assert.match(html, /function mount\(canvas, ctx, config\)/);
  assert.match(html, /background[^]*cursor-move-and-click/);
  assert.match(html, /foregroundLayers[^]*cursor-move-and-click/);
  assert.match(html, /layerPlacement: 'background'/);
  assert.match(html, /layerPlacement: 'foreground'/);
  assert.doesNotMatch(html, /import\(['"]effects\/cursor-move-and-click-engine\.js/);
});

test('PHP portable exporter inlines Cursor Move and Click without module syntax', () => {
  const result = spawnSync('php', [path.join('tests', 'php', 'cursor-move-and-click-offline-player.test.php')], {
    cwd: applicationRoot,
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.status, 0, `PHP portable test failed.\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /CURSOR_MOVE_AND_CLICK_PHP_PORTABLE_OK/);
});
