const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const { buildPortablePlayerHtml } = require('../desktop/services/portable-project-service.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(
  path.join(applicationRoot, 'studio', 'player', 'player-runtime.js'),
  'utf8'
);

function registryEngines(folder) {
  const registry = JSON.parse(fs.readFileSync(
    path.join(applicationRoot, folder, 'registry.json'),
    'utf8'
  ));
  return registry.flatMap(group => String(group.engines || '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean));
}

function loadRuntimePolicy({ search = '', bootstrap = {}, fetchImpl } = {}) {
  const window = {
    PLAYER_BOOTSTRAP: {
      securityPolicyTestMode: true,
      ...bootstrap
    }
  };
  const sandbox = {
    URLSearchParams,
    console,
    fetch: fetchImpl || (async () => { throw new Error('Unexpected registry fetch'); }),
    location: { search },
    window
  };
  vm.runInNewContext(runtimeSource, sandbox, { filename: 'player-runtime.js' });
  return window.__PLAYER_SECURITY_POLICY__;
}

const maliciousModuleValues = [
  'https://example.test/evil.js',
  'http://example.test/evil.js',
  'file:///tmp/evil.js',
  'javascript:alert(1)',
  '../evil',
  '..\\evil',
  '%2e%2e%2fevil',
  '%252e%252e%252fevil',
  '/absolute/evil',
  'C:\\absolute\\evil',
  'Zoom',
  'soft_wipe',
  'soft--wipe',
  '-soft-wipe',
  'soft-wipe-',
  'soft-wipe.js',
  'transitions/soft-wipe-engine.js'
];

test('public flow URLs ignore every src query override', () => {
  for (const src of maliciousModuleValues) {
    const policy = loadRuntimePolicy({
      search: `?src=${encodeURIComponent(src)}`,
      bootstrap: { flowUrl: '/media.php?project=story&file=flow.json' }
    });
    assert.equal(policy.flowUrl, '/media.php?project=story&file=flow.json');
  }
  assert.doesNotMatch(runtimeSource, /qs\(['"]src['"]\)/);
});

test('effect and transition module identifiers are exact safe slugs', () => {
  const policy = loadRuntimePolicy();
  for (const value of maliciousModuleValues) {
    assert.equal(policy.safeModuleSlug(value), '', `unsafe module identifier accepted: ${value}`);
    assert.equal(policy.moduleEnginePath('/effects/', value), '', `unsafe module path built: ${value}`);
  }
  assert.equal(policy.safeModuleSlug('zoom'), 'zoom');
  assert.equal(policy.safeModuleSlug('blur-crossfade'), 'blur-crossfade');
  assert.equal(policy.moduleEnginePath('/effects/', 'zoom'), '/effects/zoom-engine.js');
  assert.equal(
    policy.moduleEnginePath('movement-app://ui/transitions/', 'soft-wipe'),
    'movement-app://ui/transitions/soft-wipe-engine.js'
  );
});

test('enginePath project fields never select effect modules', () => {
  const policy = loadRuntimePolicy();
  for (const enginePath of maliciousModuleValues) {
    assert.equal(policy.effectEngineSlug({ enginePath }), '');
    assert.equal(policy.effectEngineSlug({ engine: 'zoom', enginePath }), 'zoom');
  }
  assert.doesNotMatch(runtimeSource, /def(?:inition)?\??\.enginePath/);
  const desktopExporter = fs.readFileSync(
    path.join(applicationRoot, 'desktop', 'services', 'portable-project-service.cjs'),
    'utf8'
  );
  const phpExporter = fs.readFileSync(path.join(applicationRoot, 'export-project.php'), 'utf8');
  assert.doesNotMatch(desktopExporter, /spec\.enginePath/);
  assert.doesNotMatch(phpExporter, /\$spec\[['"]enginePath['"]\]/);
});

test('only registered local effects and transitions are approved', async () => {
  const fetched = [];
  const policy = loadRuntimePolicy({
    fetchImpl: async url => {
      fetched.push(url);
      const folder = url.includes('/transitions/') ? 'transitions' : 'effects';
      return {
        ok: true,
        json: async () => JSON.parse(fs.readFileSync(
          path.join(applicationRoot, folder, 'registry.json'),
          'utf8'
        ))
      };
    }
  });
  const effects = await policy.loadApprovedModuleSlugs('/effects/', {}, false, 'effect');
  const transitions = await policy.loadApprovedModuleSlugs('/transitions/', {}, false, 'transition');

  assert.equal(effects.size, 25);
  assert.equal(transitions.size, 6);
  assert.equal(effects.has('unregistered-effect'), false);
  assert.equal(transitions.has('unregistered-transition'), false);
  assert.deepEqual(fetched, ['/effects/registry.json', '/transitions/registry.json']);

  for (const slug of registryEngines('effects')) {
    assert.equal(effects.has(slug), true, `registered effect rejected: ${slug}`);
    assert.equal(policy.moduleEnginePath('/effects/', slug), `/effects/${slug}-engine.js`);
  }
  for (const slug of registryEngines('transitions')) {
    assert.equal(transitions.has(slug), true, `registered transition rejected: ${slug}`);
    assert.equal(
      policy.moduleEnginePath('/transitions/', slug),
      `/transitions/${slug}-engine.js`
    );
  }
});

test('trusted portable inline registries are allowlists and do not fetch', async () => {
  const policy = loadRuntimePolicy();
  const approved = await policy.loadApprovedModuleSlugs(
    '',
    {
      zoom: { mount() {} },
      '../evil': { mount() {} },
      'https://example.test/evil.js': { mount() {} }
    },
    true,
    'effect'
  );
  assert.deepEqual([...approved], ['zoom']);
});

test('Electron exposes only the fixed registry and shared effect dependency needed by the player', () => {
  const desktopMain = fs.readFileSync(path.join(applicationRoot, 'desktop', 'main.cjs'), 'utf8');
  assert.match(desktopMain, /'effects\/registry\.json'/);
  assert.match(desktopMain, /'transitions\/registry\.json'/);
  assert.match(desktopMain, /'effects\/effect-media\.js'/);
  assert.equal(
    desktopMain.includes('if (/^effects\\/[a-z0-9-]+-(?:engine\\.js|maker\\.html)$/i.test(normalized))'),
    true
  );
});

test('desktop portable export inlines registered slugs and rejects unregistered slugs', () => {
  const html = buildPortablePlayerHtml(applicationRoot, {
    title: 'Safe portable player',
    slides: [{
      background: {
        effect: {
          engine: 'zoom',
          enginePath: 'https://example.test/evil.js',
          config: {}
        }
      },
      transitionDraft: { enabled: true, engine: 'soft-wipe', config: {} }
    }]
  });
  assert.equal((html.match(/inlineEngines\["zoom"\]/g) || []).length, 1);
  assert.equal((html.match(/inlineTransitions\["soft-wipe"\]/g) || []).length, 1);

  assert.throws(
    () => buildPortablePlayerHtml(applicationRoot, {
      title: 'Bad effect',
      slides: [{ background: { effect: { engine: 'unregistered-effect' } } }]
    }),
    error => error && error.code === 'UNREGISTERED_ENGINE'
  );
  assert.throws(
    () => buildPortablePlayerHtml(applicationRoot, {
      title: 'Bad transition',
      slides: [{ transitionDraft: { enabled: true, engine: 'unregistered-transition' } }]
    }),
    error => error && error.code === 'UNREGISTERED_ENGINE'
  );
});

test('PHP offline-export policy rejects unsafe paths and sees the complete registries', () => {
  const result = spawnSync('php', [path.join('tests', 'php', 'player-module-security.test.php')], {
    cwd: applicationRoot,
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(
    result.status,
    0,
    `PHP module-policy tests failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /PLAYER_MODULE_POLICY_PHP_OK/);
});
