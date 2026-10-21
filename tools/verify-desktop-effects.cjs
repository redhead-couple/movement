const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');

async function verifyDesktopEffects(unpackedRoot) {
  const root = path.resolve(unpackedRoot);
  const archive = path.join(root, 'resources', 'app.asar');
  const applicationRoot = fs.existsSync(archive) ? archive : path.join(root, 'resources', 'app');
  const asar = fs.existsSync(archive) ? await import('@electron/asar') : null;
  const read = relative => asar
    ? asar.extractFile(archive, relative.split('/').join(path.sep))
    : fs.readFileSync(path.join(applicationRoot, relative));
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.version, require('../package.json').version);

  const makers = fs.readdirSync(path.join(repositoryRoot, 'effects'))
    .filter(name => name.endsWith('-maker.html')).sort();
  const files = [
    ...makers.map(name => `effects/${name}`),
    'studio/maker/maker-engine.js', 'effects/effect-media.js',
    'desktop/main.cjs', 'desktop/preload.cjs',
    'desktop/services/workspace-service.cjs', 'desktop/services/portable-project-service.cjs',
    'desktop/services/media-trash-service.cjs', 'desktop/component-export-reviews.json',
    'shared/frontend/app.js', 'shared/frontend/index.html', 'shared/frontend/platform-adapter.js',
    'studio/editor/json-maker.html', 'studio/editor/json-maker-logic.js',
    'studio/editor/media-trash-preview.js', 'assets/app.css',
    'studio/hubs/effects-hub.html', 'studio/player/local-player.html',
    'studio/player/player-runtime.js'
  ];
  const hashes = {};
  for (const relative of files) {
    const packaged = read(relative);
    assert.ok(packaged.equals(fs.readFileSync(path.join(repositoryRoot, relative))),
      `Packaged source differs from checkout: ${relative}`);
    hashes[relative] = crypto.createHash('sha256').update(packaged).digest('hex');
  }

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-distribution-effects-'));
  try {
    const effectRoot = path.join(fixture, 'packaged-source');
    fs.mkdirSync(path.join(effectRoot, 'effects'), { recursive: true });
    for (const name of makers) fs.writeFileSync(path.join(effectRoot, 'effects', name), read(`effects/${name}`));
    const unit = spawnSync(process.execPath, [
      '--test', '--test-reporter=tap', path.join(repositoryRoot, 'tests/effect-maker-security.test.cjs')
    ], {
      cwd: repositoryRoot,
      env: { ...process.env, MOVEMENT_EFFECT_TEST_ROOT: effectRoot },
      encoding: 'utf8', windowsHide: true, timeout: 30000
    });
    assert.equal(unit.status, 0, `${unit.error || ''}\n${unit.stdout}\n${unit.stderr}`);
    console.log(unit.stdout.split(/\r?\n/).filter(line => /^# (tests|pass|fail) /.test(line)).join('\n'));

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MOVEMENT_ELECTRON_SMOKE_TEST;
    delete env.MOVEMENT_ELECTRON_SMOKE_SURFACE;
    const browser = spawnSync(require('electron'), [
      path.join(repositoryRoot, 'tests/fixtures/desktop-effects-distribution.cjs'),
      applicationRoot, fixture
    ], { cwd: repositoryRoot, env, encoding: 'utf8', windowsHide: true, timeout: 120000,
      maxBuffer: 4 * 1024 * 1024 });
    console.log(browser.stdout);
    assert.equal(browser.status, 0, `${browser.error || ''}\n${browser.stdout}\n${browser.stderr}`);
    assert.match(browser.stdout, /DESKTOP_EFFECTS_BROWSER_OK/);
    assert.match(browser.stdout, /SAVE_STATE_BROWSER_OK/);
    const uiResults = {};
    for (const [name, prefix, expected] of [
      ['media-trash-browser.cjs', 'movement-image-trash-', /MEDIA_TRASH_BROWSER_OK/],
      ['project-backups-browser.cjs', 'movement-backups-', /BACKUPS_BROWSER_OK/]
    ]) {
      const isolatedRoot = fs.mkdtempSync(path.join(fixture, prefix));
      const result = spawnSync(require('electron'), [
        path.join(repositoryRoot, 'tests/fixtures', name), applicationRoot, isolatedRoot
      ], { cwd: repositoryRoot, env, encoding: 'utf8', windowsHide: true, timeout: 60000,
        maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, expected);
      if (name === 'media-trash-browser.cjs') assert.match(result.stdout, /MEDIA_TRASH_PREVIEWS_OK/);
      uiResults[name] = result.stdout.trim();
      console.log(result.stdout.trim());
    }
    // Node cannot load ASAR files. Extract the installer payload verbatim for
    // the ZIP-playback and process-interruption tests; the Kit is already loose.
    const regressionRoot = asar ? path.join(fixture, 'packaged-application') : applicationRoot;
    if (asar) asar.extractAll(archive, regressionRoot);
    const audio = spawnSync(process.execPath, ['--test', path.join(repositoryRoot, 'tests/player-audio-preload.test.cjs')], {
      cwd: repositoryRoot,
      env: { ...env, MOVEMENT_AUDIO_TEST_ROOT: regressionRoot, MOVEMENT_TEST_AUDIO_BROWSER: '1' },
      encoding: 'utf8', windowsHide: true, timeout: 140000, maxBuffer: 4 * 1024 * 1024
    });
    assert.equal(audio.status, 0, `${audio.error || ''}\n${audio.stdout}\n${audio.stderr}`);
    assert.match(audio.stdout, /PLAYER_AUDIO_PRELOAD_OK/);
    console.log(audio.stdout.trim());
    const regressions = spawnSync(process.execPath, [
      '--test', '--test-reporter=tap',
      path.join(repositoryRoot, 'tests/desktop-portable-player.test.cjs'),
      path.join(repositoryRoot, 'tests/media-replacement-recovery.test.cjs'),
      path.join(repositoryRoot, 'tests/unused-images-trash.test.cjs')
    ], {
      cwd: repositoryRoot,
      env: { ...env, MOVEMENT_DESKTOP_TEST_ROOT: regressionRoot, MOVEMENT_TEST_OFFLINE_BROWSER: '1' },
      encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024
    });
    assert.equal(regressions.status, 0, `${regressions.error || ''}\n${regressions.stdout}\n${regressions.stderr}`);
    assert.match(regressions.stdout, /DESKTOP_PORTABLE_PLAYBACK_OK count=3/);
    console.log(regressions.stdout.split(/\r?\n/).filter(line =>
      /^# (tests|pass|fail|PLAYBACK_OK|DESKTOP_PORTABLE_PLAYBACK_OK)/.test(line)).join('\n'));
    let rippleExportVerified = false;
    if (!asar) {
      const { createComponentExportService } = require(path.join(regressionRoot, 'desktop/services/component-export-service.cjs'));
      const service = createComponentExportService({ applicationRoot: regressionRoot });
      const eligibility = service.eligibility('effects', 'ripple');
      assert.equal(eligibility.eligible, true, eligibility.reason);
      const result = service.exportComponent({ type: 'effects', id: 'ripple',
        destinationPath: path.join(fixture, 'ripple.component.zip') });
      assert.ok(result.archiveSize > 0);
      rippleExportVerified = true;
      console.log('PACKAGED_RIPPLE_EXPORT_OK');
    }
    const report = {
      version: manifest.version, applicationRoot, verifiedAt: new Date().toISOString(),
      packagedSourceHashes: hashes, unitSummary: unit.stdout.match(/# tests \d+[\s\S]*$/)?.[0],
      browserOutput: browser.stdout.trim(), saveStateVerified: true,
      mediaCleanupVerified: true, backupRestoreVerified: true, uiResults, rippleExportVerified,
      trashImagePreviewVerified: true, trashAudioPlaybackVerified: true,
      trashRestoreVerified: true, trashEmptyVerified: true,
      regressionOutput: regressions.stdout.trim(),
      portablePlaybackVerified: true, mediaReplacementVerified: true,
      audioPreloadVerified: true, audioPreloadOutput: audio.stdout.trim()
    };
    const reportPath = path.join(root, 'effects-verification.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`DESKTOP_EFFECTS_DISTRIBUTION_OK version=${manifest.version} makers=${makers.length} report=${reportPath}`);
    return report;
  } finally {
    // Delete only this verifier's freshly allocated temporary directory.
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.match(path.basename(fixture), /^movement-distribution-effects-/);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node tools/verify-desktop-effects.cjs <win-unpacked directory>');
  verifyDesktopEffects(process.argv[2]).catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { verifyDesktopEffects };
