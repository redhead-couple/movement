const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
// Captured from the pre-fix exporters with ordinary inputs. No legacy evaluator
// is kept in the test or application; these pin keys, types and rounding.
const fixtures = require('./fixtures/effect-maker-exports.json');
const root = path.resolve(__dirname, '..');

function exportEffect(engine, parameters, names = ['one.webp', 'two.webp']) {
  const source = fs.readFileSync(path.join(root, 'effects', engine + '-maker.html'), 'utf8');
  const signature = 'getExportJSON: () => {';
  const start = source.lastIndexOf(signature);
  assert.ok(start >= 0);
  const end = source.indexOf('\n            }', start);
  assert.ok(end > start);
  const sandbox = {
    ENGINE: engine, config: { ...parameters }, cfg: { ...parameters },
    window: { imgName: names[0], name1: names[0], name2: names[1],
      fileNames: [...names], localImages: ['data:image/png;base64,AA', 'data:image/png;base64,BB'] },
    points: [{ x: 0.12, y: 0.8 }]
  };
  const result = vm.runInNewContext('(() => {' + source.slice(start + signature.length, end) + '})()', sandbox,
    { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  assert.equal(sandbox.injected, undefined);
  return JSON.parse(JSON.stringify(result));
}

for (const { engine, parameters, expected } of fixtures) {
  test(`${engine}: export retains pre-fix values, types, media and rounding without code generation`, () => {
    assert.deepEqual(exportEffect(engine, parameters), expected);
  });
  test(`${engine}: filenames remain data, including quotes, HTML and code-like text`, () => {
    for (const name of ["O'Brien.webp", 'צילום "one" & two.webp',
      "' + (globalThis.injected = true) + '", '<img src=x onerror="globalThis.injected=true">']) {
      const result = exportEffect(engine, parameters, [name, name]);
      if (result.config.images) assert.deepEqual(result.config.images, ['img/' + name, 'img/' + name]);
      else assert.equal(result.config.imgSrc, 'img/' + name);
      if ('imgSrc2' in result.config) assert.equal(result.config.imgSrc2, 'img/' + name);
    }
  });
  test(`${engine}: saved string settings remain literal values`, () => {
    const input = { ...parameters };
    for (const key of Object.keys(input)) {
      if (typeof input[key] === 'string') input[key] = "' + (globalThis.injected = true) + '\n\\";
    }
    const result = exportEffect(engine, input);
    for (const key of Object.keys(input)) {
      if (typeof input[key] === 'string') assert.equal(result.config[key], input[key]);
    }
  });
}

test('effect makers contain no dynamic code evaluators', () => {
  for (const filename of fs.readdirSync(path.join(root, 'effects')).filter(name => name.endsWith('-maker.html'))) {
    const source = fs.readFileSync(path.join(root, 'effects', filename), 'utf8');
    assert.doesNotMatch(source, /\b(?:new\s+Function|eval)\s*\(/, filename);
  }
});

test('frame names render as text and the remove control still removes the selected frame', () => {
  const source = fs.readFileSync(path.join(root, 'effects/frame-animation-maker.html'), 'utf8');
  const start = source.indexOf('        function renderFramesList() {');
  const end = source.indexOf('\n        async function uploadSingleFile', start);
  function element() {
    return { children: [], dataset: {},
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.append(child); },
      addEventListener(_name, callback) { this.click = callback; },
      set innerHTML(value) { this.children = []; assert.ok(!value.includes('onerror')); },
      querySelectorAll() { return this.children.flatMap(row => row.children.filter(child => child.className === 'rm-btn')); }
    };
  }
  const list = element();
  const name = '<img src=x onerror="globalThis.injected=true">';
  let previews = 0;
  const context = { window: { frameFileNames: [name, 'second.webp'], frameDataUrls: ['one', 'two'] },
    document: { getElementById: () => list, createElement: element }, run() { previews++; } };
  vm.runInNewContext(source.slice(start, end), context);
  context.renderFramesList();
  assert.equal(list.children[0].children[0].textContent, '1. ' + name);
  const remove = list.children[0].children[1];
  remove.click({ target: remove });
  assert.deepEqual(context.window.frameFileNames, ['second.webp']);
  assert.deepEqual(context.window.frameDataUrls, ['two']);
  assert.equal(list.children[0].children[0].textContent, '1. second.webp');
  assert.equal(previews, 1);
});
