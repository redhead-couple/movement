const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const applicationRoot = path.resolve(__dirname, '..');

test('shared maker scroll guard installs once and marks known and inferred control panels', () => {
  const source = fs.readFileSync(path.join(applicationRoot, 'studio', 'maker', 'maker-scroll-guard.js'), 'utf8');
  const window = {};
  vm.runInNewContext(source, { window, URL });

  const marked = new Set();
  const body = {};
  const knownPanel = {
    classList: { add: name => marked.add(`known:${name}`) }
  };
  const inferredPanel = {
    parentElement: body,
    classList: { add: name => marked.add(`inferred:${name}`) }
  };
  const inferredWrapper = { parentElement: inferredPanel };
  const knownControl = { closest: () => knownPanel };
  const inferredControl = {
    closest: () => null,
    parentElement: inferredWrapper
  };

  let stylesheet = null;
  let appendedStylesheets = 0;
  const doc = {
    body,
    head: {
      appendChild(link) {
        stylesheet = link;
        appendedStylesheets += 1;
      }
    },
    querySelector: () => stylesheet,
    createElement: () => ({ dataset: {} }),
    querySelectorAll(selector) {
      return selector === 'input, select, textarea, button'
        ? [knownControl, inferredControl]
        : [knownPanel];
    }
  };
  const frame = {
    contentDocument: doc,
    ownerDocument: { baseURI: 'movement-app://local/studio/hubs/effects-hub.html' }
  };

  assert.equal(window.MovementMakerScrollGuard.install(frame), true);
  assert.equal(window.MovementMakerScrollGuard.install(frame), true);
  assert.equal(appendedStylesheets, 1);
  assert.equal(stylesheet.rel, 'stylesheet');
  assert.equal(stylesheet.href, 'movement-app://local/studio/maker/maker-scroll-guard.css');
  assert.equal(stylesheet.dataset.movementMakerScrollGuard, 'true');
  assert.equal(marked.has('known:movement-maker-scroll-panel'), true);
  assert.equal(marked.has('inferred:movement-maker-scroll-panel'), true);
});

test('shared maker scroll styles constrain panels and enable vertical overflow', () => {
  const styles = fs.readFileSync(path.join(applicationRoot, 'studio', 'maker', 'maker-scroll-guard.css'), 'utf8');
  assert.match(styles, /min-height:\s*0 !important/);
  assert.match(styles, /max-height:\s*100vh !important/);
  assert.match(styles, /overflow-y:\s*auto !important/);
  assert.match(styles, /scrollbar-gutter:\s*stable/);
});
