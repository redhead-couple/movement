const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const { sessionData, databaseSource } = require('./helpers/session-fixture.cjs');
const root = path.resolve(__dirname, '..');

test('media replacement preserves old files on failure and keeps projects playable', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-media-replacement-'));
  let child, stopped, log = '';
  t.after(async () => {
    if (child && child.exitCode === null) child.kill();
    if (stopped) await stopped;
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-media-replacement-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name, data) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  }
  for (const file of ['json-maker.php', 'player.php', 'media.php', '404.php', 'not-found.php',
    'server/core/app-init.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/config-loader.php', 'server/core/web-session.php',
    'server/core/security-helpers.php', 'server/core/response.php', 'server/core/project-paths.php',
    'server/core/project-storage.php', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'assets/app.css']) write(file, fs.readFileSync(path.join(root, file)));
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('sessions/sess_mediaowner', sessionData('owner', 1));
  write('sessions/sess_mediaother', sessionData('other', 2));
  write('token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard('json_maker')['token'];");

  // Failure injection exists ONLY in the disposable fixture, never production.
  const helper = fs.readFileSync(path.join(dir, 'server/core/project-storage.php'), 'utf8');
  const replacements = [
    ['@move_uploaded_file($upload[\'tmpName\'], $stage)', 'fixtureMove($upload[\'tmpName\'], $stage)'],
    ['@rename($file[\'stage\'], $file[\'destination\'])', 'fixtureCommit($file[\'stage\'], $file[\'destination\'])'],
    ['@copy($destination, $recovery)', 'fixtureCopy($destination, $recovery)'],
    ['    json_decode($json);', "    if (($_GET['fail'] ?? '') === 'flow') return false;\n    json_decode($json);"]
  ];
  let injected = helper;
  for (const [from, to] of replacements) { assert.ok(injected.includes(from), from); injected = injected.replace(from, to); }
  injected += `
if (($_GET['fail'] ?? '') === 'partial-upload') $_FILES['media']['error'][1] = UPLOAD_ERR_PARTIAL;
if (($_GET['fail'] ?? '') === 'oversized-upload') $_FILES['media']['size'][1] = 50 * 1024 * 1024 + 1;
function fixtureMove($source, $target) {
    static $count = 0; $count++;
    if (($_GET['fail'] ?? '') === 'stage' || (($_GET['fail'] ?? '') === 'stage-second' && $count === 2)) {
        file_put_contents($target, 'incomplete'); return false;
    }
    return move_uploaded_file($source, $target);
}
function fixtureCommit($source, $target) {
    static $count = 0; $count++;
    if (($_GET['fail'] ?? '') === 'commit' || (($_GET['fail'] ?? '') === 'commit-second' && $count === 2)) return false;
    return rename($source, $target);
}
function fixtureCopy($source, $target) {
    if (($_GET['fail'] ?? '') === 'copy') { file_put_contents($target, 'incomplete'); return false; }
    return copy($source, $target);
}
function fixtureReencode($source, $target) {
    if (($_GET['fail'] ?? '') === 'reencode') return false;
    return rename($source, $target);
}
`;
  write('server/core/project-storage.php', injected);
  const endpoint = fs.readFileSync(path.join(dir, 'json-maker.php'), 'utf8');
  assert.ok(endpoint.includes('@rename($reEncodedTmp, $tmpName)'));
  write('json-maker.php', endpoint.replace('@rename($reEncodedTmp, $tmpName)', 'fixtureReencode($reEncodedTmp, $tmpName)'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  child = spawn('php', ['-d', 'extension=gd', '-d', `session.save_path=${path.join(dir, 'sessions')}`,
    '-S', `127.0.0.1:${port}`, '-t', dir], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  stopped = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', data => { log += data; });
  function request(url, cookie = 'mediaowner', body, type) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(cookie ? { Cookie: `PHPSESSID=${cookie}` } : {}), ...(body ? {
          'Content-Type': type, 'Content-Length': body.length } : {}) } }, res => {
        const parts = []; res.on('data', part => parts.push(part));
        res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(parts), body: Buffer.concat(parts).toString() }));
      });
      req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('HTTP timeout'))); req.end(body);
    });
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await request('/404.php', null); break; } catch (error) {
      if (attempt === 99) throw error; await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  function png(red) {
    const result = spawnSync('php', ['-d', 'extension=gd', '-r',
      `$i=imagecreatetruecolor(1,1); imagesetpixel($i,0,0,imagecolorallocate($i,${red},50,100)); imagepng($i);`], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr.toString()); return result.stdout;
  }
  const oldPng = png(10), newPng = png(230);
  // Bundled example audio exercises the production MP3 MIME validation and decoder.
  const oldAudio = fs.readFileSync(path.join(root, 'examples/what-this-project-is/speech/slide8.mp3'));
  const newAudio = fs.readFileSync(path.join(root, 'examples/what-this-project-is/speech/slide9.mp3'));
  const flow = { schemaVersion: 2, title: 'Before', isPublished: true, publishedAt: 123,
    defaultBeatSeconds: 5, openingImage: '', slides: [{ text: '<b>Public playback</b>', seconds: 60,
      background: { src: 'img/pixel.png' }, audioLayers: [{ src: 'speech/voice.mp3' }] }] };
  const base = name => `private-data/slidedeck/owner/${name}/`;
  const read = (name, file) => fs.readFileSync(path.join(dir, base(name), file));
  const fixtures = [
    { name: 'pixel.png', kind: '', folder: 'img', old: oldPng, next: newPng },
    { name: 'voice.mp3', kind: 'speech', folder: 'speech', old: oldAudio, next: newAudio },
    { name: 'music.mp3', kind: 'audio', folder: 'audio', old: oldAudio, next: newAudio }
  ];
  function project(name, published = true) {
    write(base(name) + 'flow.json', JSON.stringify({ ...flow, isPublished: published }));
    for (const file of fixtures) write(base(name) + file.folder + '/' + file.name, file.old);
  }
  function noTemps(name) {
    for (const folder of ['', 'img', 'speech', 'audio']) {
      assert.equal(fs.readdirSync(path.join(dir, base(name), folder)).some(file => file.endsWith('.tmp')), false);
    }
  }
  async function upload(name, files, { full = false, fail = '', replace = true, cookie = 'mediaowner' } = {}) {
    const token = (await request('/token.php', cookie)).body;
    const boundary = 'MediaReplacementFixtureBoundary';
    const parts = [];
    const field = (key, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    field('csrf_token', token);
    if (replace) field('replace_existing', '1');
    if (full) field('json_data', JSON.stringify({ ...flow, title: 'After', isPublished: false }));
    else field('action', 'upload_media');
    files.forEach((file, index) => {
      field(full ? `media_kind[${index}]` : 'media_kind', file.kind);
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${full ? 'media[]' : 'file'}"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.next, Buffer.from('\r\n'));
    });
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return request(`/json-maker.php?project=${name}&fail=${fail}`, cookie, Buffer.concat(parts), `multipart/form-data; boundary=${boundary}`);
  }
  async function playable(name, expected) {
    assert.equal((await request(`/player.php?username=owner&project=${name}`, null)).status, 200);
    for (const file of fixtures) {
      const response = await request(`/media.php?p=owner/${name}/${file.folder}/${file.name}`, null);
      assert.equal(response.status, 200); assert.deepEqual(response.bytes, file[expected]);
    }
  }
  for (const full of [false, true]) {
    for (const file of fixtures) {
      await t.test(`${full ? 'full save' : 'standalone'} replaces ${file.folder} and requires confirmation`, async () => {
        const name = `success-${full}-${file.folder}`; project(name);
        const before = read(name, 'flow.json');
        const denied = await upload(name, [file], { full, replace: false });
        assert.equal(denied.status, 200, denied.body); assert.equal(JSON.parse(denied.body).status, 'needs_confirmation');
        assert.deepEqual(read(name, `${file.folder}/${file.name}`), file.old); assert.deepEqual(read(name, 'flow.json'), before);
        const response = await upload(name, [file], { full });
        assert.equal(response.status, 200, response.body); assert.equal(JSON.parse(response.body).status, 'success');
        assert.deepEqual(read(name, `${file.folder}/${file.name}`), file.next);
        const saved = JSON.parse(read(name, 'flow.json'));
        assert.equal(saved.isPublished, true); assert.equal(saved.title, full ? 'After' : 'Before');
        noTemps(name);
      });
    }
    for (const fail of ['stage', 'copy', 'commit', 'reencode', ...(full ? ['stage-second', 'commit-second', 'flow'] : [])]) {
      await t.test(`${full ? 'full save' : 'standalone'} preserves media and flow after ${fail} failure`, async () => {
        const name = `failure-${full}-${fail}`; project(name);
        const before = read(name, 'flow.json');
        const response = await upload(name, full ? fixtures : [fixtures[0]], { full, fail });
        assert.equal(response.status, 500, response.body); assert.equal(JSON.parse(response.body).success, false);
        assert.deepEqual(read(name, 'flow.json'), before);
        for (const file of fixtures) assert.deepEqual(read(name, `${file.folder}/${file.name}`), file.old);
        noTemps(name); await playable(name, 'old');
        // Retry also proves the project lock was released.
        assert.equal((await upload(name, full ? fixtures : [fixtures[0]], { full })).status, 200);
      });
    }
  }
  await t.test('multi-file success and rollback of newly added files', async () => {
    project('batch'); const response = await upload('batch', fixtures, { full: true });
    assert.equal(response.status, 200, response.body); await playable('batch', 'next'); noTemps('batch');
    project('new-file'); const before = read('new-file', 'flow.json');
    const added = { ...fixtures[0], name: 'added.png' };
    const failed = await upload('new-file', [added, fixtures[1]], { full: true, fail: 'commit-second' });
    assert.equal(failed.status, 500, failed.body);
    assert.equal(fs.existsSync(path.join(dir, base('new-file'), 'img/added.png')), false);
    assert.deepEqual(read('new-file', 'flow.json'), before); await playable('new-file', 'old'); noTemps('new-file');
  });
  await t.test('private project remains private and another account cannot replace media', async () => {
    project('private', false);
    assert.equal((await upload('private', fixtures, { full: true, cookie: 'mediaother' })).status, 404);
    assert.deepEqual(read('private', 'img/pixel.png'), oldPng);
    assert.equal((await upload('private', fixtures, { full: true })).status, 200);
    assert.equal(JSON.parse(read('private', 'flow.json')).isPublished, false);
    assert.equal((await request('/media.php?p=owner/private/img/pixel.png', null)).status, 403);
    assert.deepEqual((await request('/media.php?p=owner/private/img/pixel.png')).bytes, newPng);
  });
  await t.test('invalid, partial and oversized uploads do not replace media or save the flow', async () => {
    project('invalid'); const before = read('invalid', 'flow.json');
    for (const next of [Buffer.from('not an image'), Buffer.alloc(0)]) {
      const response = await upload('invalid', [fixtures[0], { ...fixtures[1], next }], { full: true });
      assert.equal(response.status, 400, response.body); assert.equal(JSON.parse(response.body).success, false);
      assert.deepEqual(read('invalid', 'flow.json'), before); await playable('invalid', 'old'); noTemps('invalid');
    }
    for (const fail of ['partial-upload', 'oversized-upload']) {
      const response = await upload('invalid', fixtures, { full: true, fail });
      assert.equal(response.status, 400, response.body); assert.equal(JSON.parse(response.body).success, false);
      assert.deepEqual(read('invalid', 'flow.json'), before); await playable('invalid', 'old'); noTemps('invalid');
    }
  });
  await t.test('Chromium renders the image and plays audio after success and failed replacement', {
    skip: process.env.MOVEMENT_TEST_MEDIA_BROWSER !== '1'
  }, async () => {
    project('browser-failure');
    assert.equal((await upload('browser-failure', fixtures, { full: true, fail: 'commit-second' })).status, 500);
    for (const name of ['batch', 'browser-failure', 'private']) {
      const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${port}/player.php?username=owner&project=${name}` };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'), dir,
        name === 'private' ? 'mediaowner' : 'mediaguest'], { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
    }
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
