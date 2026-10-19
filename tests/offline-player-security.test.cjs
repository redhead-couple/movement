const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { version, databaseSource } = require('./helpers/session-fixture.cjs');

const root = path.resolve(__dirname, '..');
const attacks = [
  '</script><script>globalThis.exportInjection = 731</script>',
  '</ScRiPt ><script>globalThis.exportInjection = 732</script>',
  '<!--<script>',
  '</script><img src=x onerror="globalThis.exportInjection=733">',
];

function php(code, args = [], input) {
  const result = spawnSync('php', ['-d', 'display_errors=stderr', '-r', code, ...args],
    { cwd: root, input, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(String(result.stderr), '');
  return result.stdout;
}

function readBootstrap(html, expected) {
  const scripts = [...html.matchAll(/<script>\s*([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(scripts.length, 2, 'project data must not create HTML script elements');
  assert.doesNotMatch(scripts[0][1], /</, 'project data must not change HTML script parsing state');
  const context = { window: {} };
  vm.runInNewContext(scripts[0][1], context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.PLAYER_BOOTSTRAP.flowData)), expected);
  assert.equal(context.exportInjection, undefined);
  return context.window.PLAYER_BOOTSTRAP;
}

test('PHP offline bootstrap preserves JSON values without allowing HTML script breakout', () => {
  for (const attack of attacks) {
    const flow = { schemaVersion: 2, title: attack, slides: [{ text: attack,
      background: { effect: { name: attack, config: { caption: attack } } } }],
    values: ['עברית 😀 <b>טקסט</b> & "quotes" \'apostrophe\' \\ / \u2028 \u2029',
      {}, [], { 0: 'zero', 1: 'one' }, null, false, 1.2345678901234567, 1e100] };
    const html = php("require 'templates/player/offline-player-template.php'; echo buildOfflinePlayerHtml(stream_get_contents(STDIN), '', []);",
      [], JSON.stringify(flow)).toString();
    const bootstrap = readBootstrap(html, flow);
    assert.equal(bootstrap.imgBase, 'img/');
    assert.equal(bootstrap.speechBase, 'speech/');
    assert.equal(bootstrap.audioBase, 'audio/');
    assert.equal(bootstrap.preloadAheadSlides, 6);
    assert.equal(bootstrap.cacheBustSpeech, false);
  }
});

test('website export produces a complete playable ZIP with safely embedded project data', async t => {
  // Exercise the real controller using a synthetic authenticated session and
  // isolated document root. Never read real project data or credentials.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-offline-security-'));
  t.after(() => {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('movement-offline-security-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const documentRoot = path.join(fixture, 'public');
  function write(relative, content) {
    const file = path.join(documentRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  for (const file of ['export-project.php', 'server/core/storage-quota.php', 'server/core/auth-check.php',
    'server/core/current-user.php', 'server/core/web-session.php',
    'server/core/config-loader.php', 'server/core/player-module-policy.php',
    'templates/player/offline-player-template.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'assets/app.css', 'effects/registry.json',
    'effects/effect-media.js', 'effects/ripple-engine.js',
    'transitions/registry.json', 'transitions/soft-wipe-engine.js']) {
    write(file, fs.readFileSync(path.join(root, file)));
  }
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('server/core/db.php', databaseSource({ 1: 'owner' }));
  const flow = { schemaVersion: 2, title: attacks[0], openingImage: 'img/pixel.png',
    notes: attacks.slice(1), slides: [
      { text: '<b>שלום עולם</b> &amp; export', seconds: 60,
        background: { src: 'img/pixel.png', effect: { enabled: true, name: attacks[0],
          engine: 'ripple', config: { imgSrc: 'img/pixel.png', count: 1 } } },
        foregroundLayers: [], audioLayers: [{ src: 'speech/voice.wav', volume: 0.2 }] },
      { text: '<i>שקופית שנייה</i>', seconds: 60, background: { src: 'img/pixel.png' },
        transitionDraft: { enabled: true, engine: 'soft-wipe', duration: 0.1, config: {} },
        foregroundLayers: [], audioLayers: [{ src: 'audio/music.wav', volume: 0.2 }] },
    ] };
  const project = 'private-data/slidedeck/owner/export-test/';
  const flowJson = JSON.stringify(flow);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(44 + 8000 * 2 * 30);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const files = { 'flow.json': Buffer.from(flowJson), 'img/pixel.png': png,
    'speech/voice.wav': wav, 'audio/music.wav': wav };
  for (const [name, bytes] of Object.entries(files)) write(project + name, bytes);
  fs.mkdirSync(path.join(fixture, 'sessions'));
  const zip = php(`$_SERVER['DOCUMENT_ROOT'] = $argv[1];
    ini_set('session.save_path', $argv[2]); session_start();
    $_SESSION['user_id'] = 1; $_SESSION['username'] = 'owner';
    $_SESSION['credential_version'] = $argv[3];
    $_GET['project'] = 'export-test'; require $argv[1] . '/export-project.php';`,
  [documentRoot, path.join(fixture, 'sessions'), version]);
  assert.equal(zip.subarray(0, 2).toString(), 'PK', zip.subarray(0, 300).toString());
  const zipPath = path.join(fixture, 'export.zip');
  fs.writeFileSync(zipPath, zip);
  const extracted = path.join(fixture, 'extracted');
  php(`$zip = new ZipArchive(); if ($zip->open($argv[1]) !== true) exit(1);
    if (!$zip->extractTo($argv[2])) exit(2); $zip->close();`, [zipPath, extracted]);
  const player = path.join(extracted, 'export-test', 'player.html');
  for (const [name, bytes] of Object.entries(files)) {
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(player), name)), bytes, name);
  }
  const html = fs.readFileSync(player, 'utf8');
  // Engine source contains ordinary '<' operators; inspect data separately.
  const bootstrapSource = html.match(/<script>\s*([\s\S]*?)<\/script\s*>/i)[1];
  const context = { window: {} };
  vm.runInNewContext(bootstrapSource, context);
  const bootstrap = context.window.PLAYER_BOOTSTRAP;
  assert.deepEqual(JSON.parse(JSON.stringify(bootstrap.flowData)), flow);
  assert.equal(typeof bootstrap.inlineEngines.ripple.mount, 'function');
  assert.equal(typeof bootstrap.inlineTransitions['soft-wipe'].runTransition, 'function');
  assert.equal((html.match(/<script>/g) || []).length, 2);

  await t.test('exported file plays in Chromium', { skip: process.env.MOVEMENT_TEST_OFFLINE_BROWSER !== '1' }, () => {
    const electron = require('electron');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [path.join(__dirname, 'fixtures', 'offline-player-browser.cjs'), player, fixture],
      { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /OFFLINE_BROWSER_OK/);
  });
});
