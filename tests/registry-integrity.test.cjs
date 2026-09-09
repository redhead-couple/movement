const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

function registryEngines(filename) {
  const registry = JSON.parse(fs.readFileSync(path.join(applicationRoot, filename), 'utf8'));
  return registry.flatMap(group => String(group.engines || '')
    .split(',')
    .map(engine => engine.trim())
    .filter(Boolean));
}

test('every registered effect has a maker and runtime engine', () => {
  const engines = registryEngines(path.join('effects', 'registry.json'));
  assert.equal(new Set(engines).size, engines.length, 'effect registry contains duplicate engines');

  for (const engine of engines) {
    const makerPath = path.join(applicationRoot, 'effects', `${engine}-maker.html`);
    assert.ok(
      fs.existsSync(makerPath),
      `missing effect maker: effects/${engine}-maker.html`
    );
    assert.match(
      fs.readFileSync(makerPath, 'utf8'),
      /<base href=["']\.\.\/["']>/,
      `effect maker must preserve root-relative resources: effects/${engine}-maker.html`
    );
    assert.ok(
      fs.existsSync(path.join(applicationRoot, 'effects', `${engine}-engine.js`)),
      `missing effect engine: effects/${engine}-engine.js`
    );
  }
});

test('every registered transition has a maker and runtime engine', () => {
  const engines = registryEngines(path.join('transitions', 'registry.json'));
  assert.equal(new Set(engines).size, engines.length, 'transition registry contains duplicate engines');

  for (const engine of engines) {
    assert.ok(
      fs.existsSync(path.join(applicationRoot, 'transitions', `${engine}-maker.html`)),
      `missing transition maker: transitions/${engine}-maker.html`
    );
    assert.ok(
      fs.existsSync(path.join(applicationRoot, 'transitions', `${engine}-engine.js`)),
      `missing transition engine: transitions/${engine}-engine.js`
    );
  }
});

test('Diverge maker wires its play control and editable configuration', () => {
  const maker = fs.readFileSync(path.join(applicationRoot, 'effects', 'diverge-maker.html'), 'utf8');
  assert.match(
    maker,
    /getElementById\(['"]runBtn['"]\)\.addEventListener\(['"]click['"],\s*run\)/,
    'Diverge Play Effect button is not connected to the runtime'
  );
  assert.match(
    maker,
    /loadEditConfig[,:]/,
    'Diverge maker cannot reload a saved effect configuration'
  );
  for (const control of ['axis', 'color1', 'color2', 'thickness', 'intensity', 'duration', 'startDelay']) {
    assert.match(maker, new RegExp(`['"]${control}['"]`), `Diverge control is not wired: ${control}`);
  }
});
