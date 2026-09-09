const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const enginePath = path.join(applicationRoot, 'transitions', 'alternating-panels-engine.js');
const makerPath = path.join(applicationRoot, 'transitions', 'alternating-panels-maker.html');

function createDrawingContext() {
  return {
    drawCount: 0,
    save() {},
    restore() {},
    drawImage() { this.drawCount += 1; }
  };
}

function createHarness({ reducedMotion = false, width = 3840, height = 2160 } = {}) {
  const animationFrames = new Map();
  const timers = new Map();
  const createdCanvases = [];
  let nextFrameId = 1;
  let nextTimerId = 1;

  class FakeElement {
    constructor(tagName, rect = { left: 0, top: 0, width, height }) {
      this.tagName = String(tagName).toUpperCase();
      this.rect = rect;
      this.style = {};
      this.children = [];
      this.parentNode = null;
      this.parentElement = null;
      this.className = '';
      this.attributes = new Map();
      this.listeners = new Map();
      this.media = [];
      this.computedStyle = {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        objectFit: 'contain'
      };
    }

    appendChild(child) {
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      child.parentElement = null;
      return child;
    }

    querySelectorAll(selector) {
      return selector === 'img, canvas' ? this.media : [];
    }

    getBoundingClientRect() { return this.rect; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    dispatchTransition(propertyName) {
      const listener = this.listeners.get('transitionend');
      if (listener) listener({ target: this, propertyName });
    }
  }

  class FakeCanvas extends FakeElement {
    constructor(rect) {
      super('canvas', rect);
      this.width = 300;
      this.height = 150;
      this.context = createDrawingContext();
      createdCanvases.push(this);
    }

    getContext() { return this.context; }
  }

  const document = {
    createElement(tagName) {
      return String(tagName).toLowerCase() === 'canvas'
        ? new FakeCanvas()
        : new FakeElement(tagName);
    }
  };
  const sourceCanvas = new FakeCanvas({ left: 0, top: 0, width, height });
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  createdCanvases.length = 0;

  const root = new FakeElement('div');
  const outgoing = new FakeElement('div');
  const incoming = new FakeElement('div');
  outgoing.parentElement = root;
  incoming.parentElement = root;
  outgoing.media = [sourceCanvas];
  Object.assign(outgoing.style, {
    zIndex: '7',
    opacity: '0.82',
    transition: 'opacity 9s linear',
    transform: 'scale(0.9)',
    visibility: 'visible'
  });
  Object.assign(incoming.style, {
    zIndex: '4',
    opacity: '0.91',
    transition: 'transform 8s linear',
    transform: 'translateX(2px)',
    visibility: 'visible'
  });

  const source = fs.readFileSync(enginePath, 'utf8')
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, '')
    + '\n;globalThis.__alternatingPanels = {'
    + 'MAX_ANIMATED_PIXELS, MAX_ANIMATED_DIMENSION, MAX_PANEL_COUNT, DEFAULTS, EASING_MAP,'
    + 'normalizeConfig, calculateCappedSize, runTransition};';
  const window = {
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
  const sandbox = {
    document,
    window,
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: element => element.computedStyle,
    Math,
    Number,
    Object
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: enginePath });

  return {
    api: sandbox.__alternatingPanels,
    root,
    outgoing,
    incoming,
    animationFrames,
    timers,
    createdCanvases,
    fireFrame(timestamp = 16) {
      const entry = animationFrames.entries().next().value;
      assert.ok(entry, 'expected a pending frame');
      animationFrames.delete(entry[0]);
      entry[1](timestamp);
    },
    fireTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected a pending failsafe');
      timers.delete(entry[0]);
      entry[1].callback();
    }
  };
}

test('Alternating Panels is registered exactly once under Experimental', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'transitions', 'registry.json'), 'utf8'));
  const registrations = registry.flatMap(group => String(group.engines || '').split(',')
    .map(engine => ({ category: group.Category, engine: engine.trim() })))
    .filter(entry => entry.engine === 'alternating-panels');
  assert.deepEqual(registrations, [{ category: 'Experimental', engine: 'alternating-panels' }]);
});

test('normalization and aggregate panel surfaces remain inside deterministic limits', () => {
  const { api } = createHarness();
  const normalized = api.normalizeConfig({
    segments: 999,
    stagger: -1,
    duration: Infinity,
    easing: 'unsupported',
    shadow: 999
  }, 1.7);
  assert.equal(api.MAX_ANIMATED_PIXELS, 2073600);
  assert.equal(api.MAX_PANEL_COUNT, 12);
  assert.equal(normalized.segments, 12);
  assert.equal(normalized.stagger, 0);
  assert.equal(normalized.duration, 1.7);
  assert.equal(normalized.easing, api.DEFAULTS.easing);
  assert.equal(normalized.shadow, 100);

  const size = api.calculateCappedSize(8000, 6000);
  assert.ok(size.width * size.height <= api.MAX_ANIMATED_PIXELS);
  assert.ok(Math.abs((size.width / size.height) - (4 / 3)) < 0.002);
});

test('panel choreography schedules once, completes exactly once, and restores every layer style', () => {
  const harness = createHarness();
  const originalOutgoing = { ...harness.outgoing.style };
  const originalIncoming = { ...harness.incoming.style };
  let completions = 0;
  const finish = harness.api.runTransition({
    root: harness.root,
    outgoing: harness.outgoing,
    incoming: harness.incoming,
    config: { segments: 99, stagger: 0.12, duration: 1.2, easing: 'natural', shadow: 100 },
    onComplete: () => { completions += 1; }
  });

  assert.equal(harness.root.children.length, 1);
  const host = harness.root.children[0];
  assert.equal(host.children.length, 12);
  assert.equal(harness.animationFrames.size, 1);
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.outgoing.style.visibility, 'hidden');
  const panelPixels = host.children.reduce((total, panel) => {
    const canvas = panel.children[0];
    return total + canvas.width * canvas.height;
  }, 0);
  assert.ok(panelPixels <= harness.api.MAX_ANIMATED_PIXELS);
  assert.ok(host.children.every(panel => panel.style.filter === undefined));

  harness.fireFrame();
  assert.equal(harness.animationFrames.size, 0);
  assert.match(host.children[0].style.transform, /-112%/);
  assert.match(host.children[1].style.transform, /112%/);
  host.children[host.children.length - 1].dispatchTransition('opacity');
  assert.equal(completions, 0, 'irrelevant transition properties must be ignored');
  host.children[host.children.length - 1].dispatchTransition('transform');
  assert.equal(completions, 1);
  assert.equal(harness.root.children.length, 0);
  assert.equal(harness.timers.size, 0);
  assert.deepEqual(harness.outgoing.style, originalOutgoing);
  assert.deepEqual(harness.incoming.style, originalIncoming);
  finish();
  assert.equal(completions, 1, 'finish must be idempotent');
  assert.ok(harness.createdCanvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('failsafe and early interruption each use the same exact-once cleanup path', () => {
  const failsafeHarness = createHarness();
  let failsafeCompletions = 0;
  const failsafeFinish = failsafeHarness.api.runTransition({
    root: failsafeHarness.root,
    outgoing: failsafeHarness.outgoing,
    incoming: failsafeHarness.incoming,
    config: { duration: 0.8 },
    onComplete: () => { failsafeCompletions += 1; }
  });
  failsafeHarness.fireFrame();
  failsafeHarness.fireTimer();
  assert.equal(failsafeCompletions, 1);
  assert.equal(failsafeHarness.root.children.length, 0);
  failsafeFinish();
  assert.equal(failsafeCompletions, 1);

  const interruptedHarness = createHarness();
  let interruptedCompletions = 0;
  const interrupt = interruptedHarness.api.runTransition({
    root: interruptedHarness.root,
    outgoing: interruptedHarness.outgoing,
    incoming: interruptedHarness.incoming,
    config: { segments: 12 },
    onComplete: () => { interruptedCompletions += 1; }
  });
  interrupt();
  interrupt();
  assert.equal(interruptedCompletions, 1);
  assert.equal(interruptedHarness.animationFrames.size, 0);
  assert.equal(interruptedHarness.timers.size, 0);
  assert.equal(interruptedHarness.root.children.length, 0);
});

test('reduced motion uses a bounded whole-layer fade and still completes cleanly', () => {
  const harness = createHarness({ reducedMotion: true });
  const originalOutgoing = { ...harness.outgoing.style };
  let completions = 0;
  const finish = harness.api.runTransition({
    root: harness.root,
    outgoing: harness.outgoing,
    incoming: harness.incoming,
    config: { segments: 12, duration: 4 },
    onComplete: () => { completions += 1; }
  });
  assert.equal(harness.root.children.length, 0);
  assert.equal(harness.animationFrames.size, 1);
  assert.equal(harness.timers.size, 1);
  assert.ok([...harness.timers.values()][0].delay <= 340);
  harness.fireFrame();
  harness.outgoing.dispatchTransition('opacity');
  assert.equal(completions, 1);
  assert.deepEqual(harness.outgoing.style, originalOutgoing);
  finish();
  assert.equal(completions, 1);
});

test('maker exposes safe controls, debounced replay, exact edit restoration, and valid export paths', () => {
  const maker = fs.readFileSync(makerPath, 'utf8');
  const { api } = createHarness();
  const controls = {
    segments: ['4', '12', '1', String(api.DEFAULTS.segments)],
    stagger: ['0', '0.12', '0.01', String(api.DEFAULTS.stagger)],
    duration: ['0.6', '4', '0.1', String(api.DEFAULTS.duration)],
    shadow: ['0', '100', '5', String(api.DEFAULTS.shadow)]
  };

  for (const [key, [min, max, step, value]] of Object.entries(controls)) {
    const input = maker.match(new RegExp(`<input[^>]+id=["']${key}["'][^>]*>`));
    assert.ok(input, `missing maker control: ${key}`);
    assert.match(input[0], new RegExp(`min=["']${min.replace('.', '\\.')}["']`));
    assert.match(input[0], new RegExp(`max=["']${max.replace('.', '\\.')}["']`));
    assert.match(input[0], new RegExp(`step=["']${step.replace('.', '\\.')}["']`));
    assert.match(input[0], new RegExp(`value=["']${value.replace('.', '\\.')}["']`));
  }
  for (const easing of ['smooth', 'sharp', 'elastic', 'natural']) {
    assert.match(maker, new RegExp(`<option value=["']${easing}["']`));
  }
  assert.ok(maker.includes('document.getElementById(key).value = String(cfg[key]);'));
  assert.match(maker, /const REPLAY_DEBOUNCE_MS = 160/);
  assert.match(maker, /if \(activeFinish\) activeFinish\(\)/);
  assert.match(maker, /if \(request !== replayRequest\) return/);
  assert.match(maker, /sessionStorage\.getItem\('transitionEditData'\)/);
  assert.match(maker, /transitionData\.name/);
  assert.match(maker, /engine: ENGINE/);
  assert.match(maker, /maker: MAKER/);
  assert.match(maker, /window\.MakerAPI = \{ run: playPreview, getExportJSON, loadEditConfig \}/);
});

test('portable player strips exports and inlines Alternating Panels once', () => {
  const transition = {
    version: 1,
    enabled: true,
    name: 'Alternating Panels',
    engine: 'alternating-panels',
    maker: 'transitions/alternating-panels-maker.html',
    config: { segments: 8, stagger: 0.06, duration: 1.4, easing: 'natural', shadow: 35 }
  };
  const html = buildPortablePlayerHtml(applicationRoot, {
    schemaVersion: 2,
    title: 'Alternating Panels portable test',
    slides: [
      { background: {}, foregroundLayers: [], audioLayers: [] },
      { transitionDraft: transition, background: {}, foregroundLayers: [], audioLayers: [] }
    ]
  });
  assert.equal((html.match(/inlineTransitions\["alternating-panels"\]/g) || []).length, 1);
  assert.match(html, /function runTransition\(\{ root, outgoing, incoming/);
  assert.doesNotMatch(html, /export function runTransition/);
  const engine = fs.readFileSync(enginePath, 'utf8');
  assert.doesNotMatch(engine, /https?:\/\/|\bfetch\(|\beval\(/);
});
