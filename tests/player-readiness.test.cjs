const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const applicationRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

function runtimeFunction(name) {
  const source = read('studio/player/player-runtime.js');
  const start = source.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n    }', start) + 6);
}

test('effect preload discovery includes hosted query-path images and audio', async () => {
  const sandbox = { URLSearchParams, IMG_ASSETS: '/media.php?p=user/project/img/',
    SPEECH_ASSETS: '/media.php?p=user/project/speech/', AUDIO_ASSETS: '/media.php?p=user/project/audio/',
    PROJECT_BASE: '/projects/user/project/', effectDefCache: new Map(), effectAssetCache: new Map() };
  vm.createContext(sandbox);
  for (const name of ['mediaAssetType', 'isAbsoluteAssetPath', 'resolveAssetPath',
    'normalizeEffectConfigAssets', 'resolveEffectSpec', 'effectSpecKey',
    'collectEffectAssetUrls', 'getEffectDefinition', 'getEffectAssets']) {
    vm.runInContext(runtimeFunction(name), sandbox);
  }
  const assets = await sandbox.getEffectAssets({ engine: 'slideshow', config: {
    images: ['img/photo.webp', 'https://example.test/media.php?p=user%2Fproject%2Fimg%2Fsecond.PNG&v=2#preview'],
    sound: 'audio/music.mp3', unrelated: '/other.php?p=photo.png'
  } });
  assert.deepEqual(Array.from(assets.images), ['/media.php?p=user/project/img/photo.webp',
    'https://example.test/media.php?p=user%2Fproject%2Fimg%2Fsecond.PNG&v=2#preview']);
  assert.deepEqual(Array.from(assets.audio), ['/media.php?p=user/project/audio/music.mp3']);
  assert.equal(sandbox.mediaAssetType('img/local.webp?v=1'), 'image');
  assert.equal(sandbox.mediaAssetType('data:image/png;base64,abc'), 'image');
});

test('foreground effects must each paint before the incoming slide is ready', async () => {
  const contexts = [];
  const sandbox = {
    document: { createElement: () => {
      const context = { drawImage() {} };
      contexts.push(context);
      return { getContext: () => context };
    } },
    preloadEffectAssets: async () => {}, prepareDecodedEffectImages: async () => new Map(),
    loadEffectModule: async () => ({ config: {}, module: { mount: () => () => {} } }),
    waitForVisualPaint: async () => {}, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  for (const name of ['observeCanvasFirstPaint', 'waitForEffectReady', 'setVisual']) {
    vm.runInContext(runtimeFunction(name), sandbox);
  }
  const layer = { appendChild() {} };
  let ready = false;
  const pending = sandbox.setVisual({ foregroundLayers: [{ effect: 'one' }, { effect: 'two' }] }, layer)
    .then(() => { ready = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contexts.length, 2);
  assert.equal(ready, false);
  contexts[0].drawImage();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false, 'one painted foreground must not release the entire slide');
  contexts[1].drawImage();
  await pending;
  assert.equal(ready, true);
  layer._cleanupEffects.forEach(cleanup => cleanup());
});

test('player decodes media and prepares an independent incoming visual before transition', () => {
  const runtime = read('studio/player/player-runtime.js');
  const transitionStart = runtime.indexOf('async function transitionTo(i)');
  const transitionEnd = runtime.indexOf('\n    function clearTimer()', transitionStart);
  const transition = runtime.slice(transitionStart, transitionEnd);

  assert.match(runtime, /async function waitForImageDecode\(img\)/);
  assert.match(runtime, /await img\.decode\(\)/);
  assert.match(runtime, /function waitForVisualPaint\(\)/);
  assert.match(runtime, /function waitForEffectReady\(readyPromise/);
  assert.match(runtime, /function observeCanvasFirstPaint\(ctx, onPaint\)/);
  assert.match(runtime, /async function prepareDecodedEffectImages\(spec\)/);
  assert.match(runtime, /preloadedImages: preparedBackgroundEffectImages/);
  assert.match(runtime, /await waitForEffectReady\(backgroundEffectReady\)/);
  assert.doesNotMatch(runtime, /preparedBackgroundFallback/);
  assert.match(runtime, /const image = cached\.cloneNode\(false\)/);
  assert.match(runtime, /Never append that shared node directly/);
  assert.ok(
    transition.indexOf('await visualReady') < transition.indexOf('runSimpleTransition(outgoing, incoming'),
    'the incoming visual must be ready before a simple transition starts'
  );
  assert.match(runtime, /const stopPaintObserver = observeCanvasFirstPaint\(context, signalFirstPaint\)/);
  assert.match(runtime, /await renderSlideInstant\(state\.i\)/);
});

test('media streaming releases the PHP session lock before reading files', () => {
  const media = read('media.php');
  const closeAt = media.indexOf('session_write_close();');
  const streamAt = media.indexOf('readfile($fileFsPath);');

  assert.ok(closeAt >= 0, 'media.php must release the session lock');
  assert.ok(streamAt > closeAt, 'the session lock must be released before streaming');
});

test('Slideshow effect stays black and silent about progress until all images load', () => {
  const engine = read('effects/slideshow-engine.js');
  const loadingStart = engine.indexOf('if (!allLoaded)');
  const loadingEnd = engine.indexOf('// FIX: Fallback resize', loadingStart);
  const loadingBranch = engine.slice(loadingStart, loadingEnd);

  assert.match(loadingBranch, /ctx\.fillStyle = '#000'/);
  assert.doesNotMatch(loadingBranch, /fillText|Loading Slides/);
  assert.match(engine, /createEffectImage\(cfg, src\)/);
});

test('every image-based effect uses the shared decoded-media helper', () => {
  const effectsDirectory = path.join(applicationRoot, 'effects');
  const engines = fs.readdirSync(effectsDirectory)
    .filter(file => file.endsWith('-engine.js'))
    .map(file => ({ file, source: read(path.join('effects', file)) }));
  const imageEngines = engines.filter(engine => /\.\/effect-media\.js/.test(engine.source));
  const helper = read(path.join('effects', 'effect-media.js'));

  assert.ok(imageEngines.length > 0);
  assert.match(helper, /preloadedImages/);
  assert.match(helper, /new Image\(\)/);
  for (const engine of engines) {
    assert.doesNotMatch(engine.source, /new Image\(/, `${engine.file} must not bypass effect-media.js`);
  }
  for (const engine of imageEngines) {
    assert.match(engine.source, /createEffectImage\(/, `${engine.file} must acquire media through the helper`);
  }
});
