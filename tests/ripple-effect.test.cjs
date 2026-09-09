const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');
const { loadEffectEngineSource } = require('./helpers/effect-engine-source.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'effects', 'ripple-engine.js');

function registeredEffects() {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'effects', 'registry.json'), 'utf8'));
  return registry.flatMap(group => String(group.engines || '').split(','))
    .map(engine => engine.trim())
    .filter(Boolean);
}

function loadRippleHarness() {
  const images = [];
  const frames = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  let nextId = 1;

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      images.push(this);
    }
    set src(value) {
      assert.equal(typeof this.onload, 'function', 'load handlers must be installed before the local image starts loading');
      this._src = value;
    }
    get src() { return this._src; }
  }

  const source = loadEffectEngineSource(enginePath)
    + '\n;globalThis.__ripple = { MAX_ANIMATED_PIXELS, TARGET_FRAME_MS, calculateCanvasSize, mount };';
  const sandbox = {
    Image: FakeImage,
    location: { protocol: 'file:' },
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) {
      const id = nextId++;
      timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) {
      const id = nextId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { intervals.delete(id); }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: enginePath });
  return { api: sandbox.__ripple, images, frames, timeouts, intervals };
}

function createContextRecorder() {
  return {
    drawCalls: 0,
    arcCalls: 0,
    clearRect() {},
    drawImage() { this.drawCalls += 1; },
    save() {},
    restore() {},
    beginPath() {},
    arc() { this.arcCalls += 1; },
    clip() {},
    translate() {},
    scale() {}
  };
}

test('Ripple is file-safe, capped, throttled, and becomes idle after a finite run', () => {
  const source = fs.readFileSync(enginePath, 'utf8');
  assert.doesNotMatch(source, /getImageData|createImageData|putImageData/);

  const harness = loadRippleHarness();
  const canvas = { width: 300, height: 150 };
  const context = createContextRecorder();
  const cleanup = harness.api.mount(canvas, context, {
    imgSrc: 'img/example.webp',
    count: 1,
    startTime: 0,
    playbackStartDelayMs: 600,
    speed: 15,
    decay: 0.5
  });
  assert.equal(harness.images[0].crossOrigin, undefined, 'file playback must not request CORS mode');
  assert.equal(harness.frames.size, 0, 'the effect must stay idle while media loads');

  harness.images[0].naturalWidth = 5000;
  harness.images[0].naturalHeight = 3000;
  harness.images[0].onload();
  assert.ok(canvas.width * canvas.height <= harness.api.MAX_ANIMATED_PIXELS);
  assert.equal(harness.timeouts.size, 1);
  const timeout = harness.timeouts.values().next().value;
  assert.equal(timeout.delay, 600, 'the ripple must begin after the incoming slide transition');
  harness.timeouts.clear();
  timeout.callback();
  assert.equal(harness.frames.size, 1);

  let timestamp = 40;
  for (let guard = 0; guard < 10 && harness.frames.size; guard += 1) {
    const [id, callback] = harness.frames.entries().next().value;
    harness.frames.delete(id);
    callback(timestamp);
    timestamp += 40;
  }
  assert.equal(harness.frames.size, 0, 'a completed finite ripple must stop scheduling frames');
  assert.ok(context.arcCalls > 0, 'the portable-safe annular distortion must render');
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.equal(harness.intervals.size, 0);
});

test('both portable exporters inline Ripple and every registered effect exactly once', () => {
  const engines = registeredEffects();
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Portable effects audit',
    slides: engines.map(engine => ({
      background: {
        src: 'example.webp',
        effect: { engine, config: { imgSrc: 'img/example.webp' } }
      },
      foregroundLayers: []
    }))
  });

  for (const engine of engines) {
    const marker = `inlineEngines[${JSON.stringify(engine)}]`;
    assert.equal(html.split(marker).length - 1, 1, `${engine} was not inlined exactly once`);
  }
  assert.doesNotMatch(html, /^\s*export\s+(?:const|function|\{)/m);

  const php = spawnSync('php', [path.join('tests', 'php', 'ripple-offline-player.test.php')], {
    cwd: applicationRoot,
    encoding: 'utf8'
  });
  assert.equal(php.status, 0, `PHP portable Ripple test failed.\nSTDOUT:\n${php.stdout}\nSTDERR:\n${php.stderr}`);
  assert.match(php.stdout, /RIPPLE_PHP_PORTABLE_OK/);
});

test('Rain gracefully skips its optional luminance read when file-origin policy blocks it', () => {
  const source = fs.readFileSync(path.join(applicationRoot, 'effects', 'rain-engine.js'), 'utf8');
  assert.match(source, /try\s*\{[\s\S]*getImageData[\s\S]*catch\s*\(error\)/);
  assert.match(source, /catch\s*\(error\)\s*\{[\s\S]*luminanceMap\s*=\s*null/);
});

test('the player passes the incoming transition duration to effect engines', () => {
  const runtime = fs.readFileSync(path.join(applicationRoot, 'studio', 'player', 'player-runtime.js'), 'utf8');
  assert.match(runtime, /function effectStartDelayMs\(advancedTransition, transitionName\)/);
  assert.match(runtime, /playbackStartDelayMs:\s*effectStartDelayMs\(advancedTransition, transitionName\)/);
  assert.match(runtime, /transitionName === 'dissolve' \? 1100 : 600/);
});
