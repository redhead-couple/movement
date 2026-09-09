const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'focus-formation-engine.js');
const makerPath = path.join(applicationRoot, 'effects', 'focus-formation-maker.html');

function createContextRecorder() {
  return {
    clearCount: 0,
    drawCount: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    save() {},
    restore() {},
    setTransform() {},
    clearRect() { this.clearCount += 1; },
    drawImage() { this.drawCount += 1; },
    beginPath() {},
    arc() {},
    fill() {},
    createRadialGradient() {
      return { addColorStop() {} };
    }
  };
}

function loadEngineHarness({ hidden = false, reducedMotion = false } = {}) {
  const animationFrames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const cachedSurfaces = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let now = 0;

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
        getContext() { return context; },
        context
      };
      cachedSurfaces.push(surface);
      return surface;
    }
  };

  const source = loadEffectEngineSource(enginePath)
    + '\n;globalThis.__focusFormation = {'
    + 'MAX_TOTAL_SURFACE_PIXELS, SPRITE_CELL_SIZE, SPRITE_VARIANT_COUNT, '
    + 'SPRITE_ATLAS_PIXELS, MAX_ANIMATED_PIXELS, TARGET_FPS, MAX_ORB_COUNT, '
    + 'DEFAULTS, schema, normalizeConfig, calculateCappedSize, buildOrbPlan, mount};';

  const sandbox = {
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
    api: sandbox.__focusFormation,
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

test('Focus Formation is registered exactly once under Focus & Emphasis', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'focus-formation');

  assert.deepEqual(registrations, [{ category: 'Focus & Emphasis', engine: 'focus-formation' }]);
});

test('normalization, orb count, and all canvas surfaces remain inside deterministic limits', () => {
  const { api } = loadEngineHarness();
  const normalized = api.normalizeConfig({
    startDelay: -3,
    duration: Infinity,
    randomness: 900,
    size: 1000,
    count: 500,
    destination: { x: -1, y: 4 }
  });

  assert.equal(api.MAX_TOTAL_SURFACE_PIXELS, 2073600);
  assert.equal(api.TARGET_FPS, 30);
  assert.equal(api.MAX_ORB_COUNT, 96);
  assert.equal(normalized.startDelay, 0);
  assert.equal(normalized.duration, api.DEFAULTS.duration);
  assert.equal(normalized.randomness, 100);
  assert.equal(normalized.size, 72);
  assert.equal(normalized.count, 96);
  assert.equal(normalized.destination.x, 0.02);
  assert.equal(normalized.destination.y, 0.98);

  const size = api.calculateCappedSize(8000, 6000);
  assert.ok(size.width * size.height <= api.MAX_ANIMATED_PIXELS);
  assert.ok(size.width * size.height + api.SPRITE_ATLAS_PIXELS <= api.MAX_TOTAL_SURFACE_PIXELS);
  assert.ok(Math.abs((size.width / size.height) - (4 / 3)) < 0.002);

  const plan = api.buildOrbPlan(size.width, size.height, { count: 96, randomness: 0, destination: { x: 0.5, y: 0.5 } }, 7);
  assert.equal(plan.length, 96);
  assert.ok(plan.every(orb => orb.radiusScale === 1 && orb.speed === 1));
  assert.equal(
    Array.from(plan, orb => orb.spriteIndex).slice(0, 7).join(','),
    '0,1,2,3,4,5,0'
  );
});

test('the engine holds without repainting, schedules one frame, then becomes idle', () => {
  const harness = loadEngineHarness();
  const canvas = { width: 300, height: 150 };
  const context = createContextRecorder();
  const cleanup = harness.api.mount(canvas, context, {
    count: 96,
    startDelay: 1,
    duration: 1
  });

  assert.equal(harness.cachedSurfaces.length, 1);
  assert.equal(
    harness.cachedSurfaces[0].width * harness.cachedSurfaces[0].height,
    harness.api.SPRITE_ATLAS_PIXELS
  );
  assert.ok(canvas.width * canvas.height <= harness.api.MAX_ANIMATED_PIXELS);
  assert.equal(harness.animationFrames.size, 0, 'the start hold must remain idle');
  assert.equal(harness.timers.size, 1);

  harness.fireTimer();
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1000);
  assert.equal(harness.animationFrames.size, 1);
  harness.fireFrame(1010);
  assert.equal(harness.animationFrames.size, 1, 'throttling must keep exactly one frame scheduled');
  harness.fireFrame(2040);
  assert.equal(harness.animationFrames.size, 0, 'a completed burst must stay idle');

  cleanup();
  cleanup();
  assert.equal(harness.animationFrames.size, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.has('visibilitychange'), false);
});

test('reduced motion, hidden state, restart, and simultaneous instances stay bounded', () => {
  const reducedHarness = loadEngineHarness({ reducedMotion: true });
  const reducedContext = createContextRecorder();
  const reducedCleanup = reducedHarness.api.mount(
    { width: 1920, height: 1080 },
    reducedContext,
    { count: 96, startDelay: 1 }
  );
  assert.ok(reducedContext.drawCount > 0, 'reduced motion should draw one calm static arrangement');
  assert.equal(reducedHarness.timers.size, 0);
  assert.equal(reducedHarness.animationFrames.size, 0);
  reducedCleanup();

  const hiddenHarness = loadEngineHarness({ hidden: true });
  const hiddenCleanup = hiddenHarness.api.mount(
    { width: 1920, height: 1080 },
    createContextRecorder(),
    { startDelay: 1 }
  );
  assert.equal(hiddenHarness.timers.size, 0);
  assert.equal(hiddenHarness.animationFrames.size, 0);
  hiddenHarness.document.hidden = false;
  hiddenHarness.listeners.get('visibilitychange')();
  assert.equal(hiddenHarness.timers.size, 1, 'the preserved delay should resume when visible');
  hiddenCleanup();

  const harness = loadEngineHarness();
  const firstCleanup = harness.api.mount(
    { width: 1920, height: 1080 },
    createContextRecorder(),
    { startDelay: 0 }
  );
  const secondCleanup = harness.api.mount(
    { width: 1920, height: 1080 },
    createContextRecorder(),
    { startDelay: 0 }
  );
  assert.equal(harness.animationFrames.size, 2, 'two instances must own one frame each');
  firstCleanup.restart({ count: 96, destination: { x: 0.2, y: 0.8 } });
  assert.equal(harness.animationFrames.size, 2, 'restart must replace, not overlap, its frame');
  firstCleanup();
  assert.equal(harness.animationFrames.size, 1);
  secondCleanup();
  assert.equal(harness.animationFrames.size, 0);
});

test('maker exposes requested controls, restores nested destination, and debounces one preview instance', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = loadEngineHarness();
  const expectedControls = {
    startDelay: { min: '0', max: '5', step: '0.1', value: String(api.DEFAULTS.startDelay) },
    duration: { min: '1', max: '8', step: '0.1', value: String(api.DEFAULTS.duration) },
    randomness: { min: '0', max: '100', step: '5', value: String(api.DEFAULTS.randomness) },
    size: { min: '12', max: '72', step: '1', value: String(api.DEFAULTS.size) },
    count: { min: '8', max: '96', step: '1', value: String(api.DEFAULTS.count) }
  };

  for (const [key, attributes] of Object.entries(expectedControls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing maker control: ${key}`);
    for (const [attribute, value] of Object.entries(attributes)) {
      assert.match(input[0], new RegExp(`${attribute}=["']${value.replace('.', '\\.')}["']`));
    }
    assert.match(maker, new RegExp(`setControlValue\\(key, normalized\\[key\\]\\)`));
  }

  assert.match(maker, /id="destinationMarker"/);
  assert.match(maker, /Click the preview or drag the marker/);
  assert.match(maker, /destination: \{[\s\S]*?x: Number\(cfg\.destination\.x\.toFixed\(3\)\)/);
  assert.match(maker, /cfg\.destination = \{ \.\.\.normalized\.destination \}/);
  assert.match(maker, /const PREVIEW_DEBOUNCE_MS = 140/);
  assert.match(maker, /if \(!controller\) controller = mount/);
  assert.match(maker, /controller\.restart\(previewConfig\(\)\)/);
  assert.match(maker, /if \(request !== previewRequest\) return/);
  assert.match(maker, /async function runStressCheck\(\)/);
  assert.match(maker, /const canvases = \[document\.createElement\('canvas'\), document\.createElement\('canvas'\)\]/);
  assert.match(maker, /stressCanvas\.width = 3840/);
  assert.match(maker, /stressCanvas\.height = 2160/);
  assert.match(maker, /for \(let index = 0; index < 30; index \+= 1\)/);
  assert.match(maker, /pixels \+ SPRITE_ATLAS_PIXELS <= MAX_TOTAL_SURFACE_PIXELS/);
  assert.match(maker, /controllers\.forEach\(stop => stop\(\)\)/);
  assert.match(maker, /engine: ENGINE/);
});

test('the hot loop draws cached sprites and portable output includes both layer placements', () => {
  const engine = fs.readFileSync(enginePath, 'utf8');
  const renderFrame = engine.match(/function renderFrame\(progress\) \{([\s\S]*?)\n    \}\n\n    function scheduleFrame/);
  assert.ok(renderFrame, 'could not inspect renderFrame');
  assert.match(renderFrame[1], /ctx\.drawImage\(\s*atlas/);
  assert.doesNotMatch(renderFrame[1], /createRadialGradient|shadowBlur|new Array|\.map\(|\.filter\(/);

  const definition = {
    enabled: true,
    name: 'Focus Formation',
    engine: 'focus-formation',
    config: { count: 48, destination: { x: 0.5, y: 0.5 } }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Focus Formation placement test',
    slides: [{
      background: { src: '', effect: definition },
      foregroundLayers: [{ name: 'Foreground', src: '', effect: definition }],
      audioLayers: []
    }]
  });

  assert.equal((html.match(/inlineEngines\["focus-formation"\]/g) || []).length, 1);
  assert.match(html, /function mount\(canvas, ctx, config\)/);
  assert.match(html, /background[^]*focus-formation/);
  assert.match(html, /foregroundLayers[^]*focus-formation/);
  assert.doesNotMatch(html, /import\(["']effects\/focus-formation-engine\.js/);
});

test('the online PHP exporter inlines Focus Formation without module syntax', () => {
  const result = spawnSync(
    'php',
    [path.join('tests', 'php', 'focus-formation-offline-player.test.php')],
    { cwd: applicationRoot, encoding: 'utf8', timeout: 30000 }
  );

  assert.equal(
    result.status,
    0,
    `PHP portable-player test failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /FOCUS_FORMATION_PHP_PORTABLE_OK/);
});
