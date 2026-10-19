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

test('media management shares the project save lock across independent servers and sessions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-media-lock-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(entry => entry.stopped));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-media-lock-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name, data) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  }
  for (const file of ['project-media.php', 'json-maker.php', 'player.php', 'media.php', '404.php', 'not-found.php',
    'server/core/app-init.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/config-loader.php', 'server/core/web-session.php',
    'server/core/security-helpers.php', 'server/core/response.php', 'server/core/project-paths.php',
    'server/core/project-storage.php', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'assets/app.css']) write(file, fs.readFileSync(path.join(root, file)));
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('sessions/sess_lockowner', sessionData('owner', 1));
  write('sessions/sess_locksecond', sessionData('owner', 1));
  write('sessions/sess_lockother', sessionData('other', 2));
  write('token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard($_GET['form'])['token'];");
  // Fixture-only barrier AFTER the real flock succeeds, BEFORE any mutation.
  // Two PHP processes and two sessions ensure neither PHP's single-threaded
  // development server nor its session mutex can produce a false pass.
  const helper = fs.readFileSync(path.join(dir, 'server/core/project-storage.php'), 'utf8');
  assert.ok(helper.includes('    return $handle;'));
  write('server/core/project-storage.php', helper.replace('    return $handle;', `
    if (isset($_GET['test_hold'])) {
        file_put_contents($projectFsDir . '/test-ready', '1');
        $deadline = microtime(true) + 15;
        while (!is_file($projectFsDir . '/test-release')) {
            clearstatcache();
            if (microtime(true) > $deadline) throw new RuntimeException('Test barrier timed out');
            usleep(10000);
        }
    }
    return $handle;`));
  async function startServer() {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn('php', ['-d', 'extension=gd', '-d', `session.save_path=${path.join(dir, 'sessions')}`,
      '-S', `127.0.0.1:${port}`, '-t', dir], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push({ child, stopped: new Promise(resolve => child.once('close', resolve)) });
    child.stderr.on('data', data => { log += data; });
    return port;
  }
  const firstPort = await startServer(), secondPort = await startServer();
  function request(url, { cookie = 'lockowner', body, type = 'application/x-www-form-urlencoded', port = firstPort } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(cookie ? { Cookie: `PHPSESSID=${cookie}` } : {}), ...(body ? {
          'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
        const parts = []; res.on('data', part => parts.push(part));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
          bytes: Buffer.concat(parts), body: Buffer.concat(parts).toString() }));
      });
      req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('HTTP timeout'))); req.end(body);
    });
  }
  for (const port of [firstPort, secondPort]) for (let attempt = 0; attempt < 100; attempt++) {
    try { await request('/404.php', { port, cookie: null }); break; } catch (error) {
      if (attempt === 99) throw error; await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const tokens = {};
  for (const cookie of ['lockowner', 'locksecond', 'lockother']) {
    tokens[cookie] = {};
    for (const form of ['json_maker', 'project_media']) {
      tokens[cookie][form] = (await request(`/token.php?form=${form}`, { cookie })).body;
    }
  }
  function png(red) {
    const result = spawnSync('php', ['-d', 'extension=gd', '-r',
      `$i=imagecreatetruecolor(1,1); imagesetpixel($i,0,0,imagecolorallocate($i,${red},50,100)); imagepng($i);`], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr.toString()); return result.stdout;
  }
  const oldPng = png(10), newPng = png(230);
  const audio = fs.readFileSync(path.join(root, 'examples/what-this-project-is/speech/slide8.mp3'));
  const flow = { schemaVersion: 2, title: 'Before', isPublished: true, publishedAt: 123,
    defaultBeatSeconds: 5, openingImage: '', slides: [{ text: '<b>Public playback</b>', seconds: 60,
      background: { src: 'img/pixel.png' }, audioLayers: [{ src: 'speech/voice.mp3' }] }] };
  const base = name => `private-data/slidedeck/owner/${name}/`;
  const read = (name, file) => fs.readFileSync(path.join(dir, base(name), file));
  function project(name, published = true) {
    write(base(name) + 'flow.json', JSON.stringify({ ...flow, isPublished: published }));
    write(base(name) + 'img/pixel.png', oldPng); write(base(name) + 'img/spare.png', oldPng);
    write(base(name) + 'speech/voice.mp3', audio);
  }
  async function operation(name, action, { cookie = 'lockowner', port = firstPort, hold = false,
    filename = action === 'delete' ? 'spare.png' : 'added.png', folder = 'img', bytes = newPng, badToken = false } = {}) {
    const editor = action === 'save' || action === 'editor-upload';
    const fields = editor ? { csrf_token: tokens[cookie].json_maker, replace_existing: '1' }
      : { action, folder, form_token: badToken ? 'invalid' : tokens[cookie].project_media, website: '' };
    if (action === 'save') fields.json_data = JSON.stringify({ ...flow, title: 'After', isPublished: false });
    if (action === 'editor-upload') fields.action = 'upload_media';
    let body, type;
    if (action === 'delete') {
      body = new URLSearchParams({ ...fields, filename }).toString();
    } else {
      const boundary = 'ProjectMediaLockFixture';
      const parts = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${editor ? (action === 'save' ? 'media[]' : 'file') : 'media_file'}"; filename="${editor ? 'pixel.png' : filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
      body = Buffer.concat(parts); type = `multipart/form-data; boundary=${boundary}`;
    }
    return request(`/${editor ? 'json-maker' : 'project-media'}.php?project=${name}${hold ? '&test_hold=1' : ''}`, { cookie, port, body, type });
  }
  const second = { cookie: 'locksecond', port: secondPort };
  async function checkPlayback(name, expectedImage, published = true) {
    for (const cookie of ['locksecond', ...(published ? [null] : [])]) {
      const opts = { cookie, port: secondPort };
      assert.equal((await request(`/player.php?username=owner&project=${name}`, opts)).status, 200);
      const image = await request(`/media.php?p=owner/${name}/img/pixel.png`, opts);
      assert.equal(image.status, 200); assert.deepEqual(image.bytes, expectedImage);
      const speech = await request(`/media.php?p=owner/${name}/speech/voice.mp3`, opts);
      assert.equal(speech.status, 200); assert.deepEqual(speech.bytes, audio);
    }
  }
  for (const first of ['save', 'editor-upload', 'upload', 'delete']) {
    await t.test(`${first} excludes uploads, deletes and saves from another session; readers still work`, async () => {
      const name = `parallel-${first}`; project(name);
      const before = read(name, 'flow.json');
      const pending = operation(name, first, { hold: true }); pending.catch(() => {});
      try {
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(path.join(dir, base(name), 'test-ready'))) {
          assert.ok(Date.now() < deadline, 'writer did not acquire the shared lock');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        for (const competing of ['save', 'editor-upload', 'upload', 'delete']) {
          const response = await operation(name, competing, second);
          assert.equal(response.status, 409, `${first}/${competing}: ${response.body}`);
          assert.equal(response.headers.location, undefined);
          assert.deepEqual(read(name, 'flow.json'), before);
          assert.deepEqual(read(name, 'img/pixel.png'), oldPng);
          assert.deepEqual(read(name, 'img/spare.png'), oldPng);
          assert.equal(fs.existsSync(path.join(dir, base(name), 'img/added.png')), false);
          assert.equal(fs.existsSync(path.join(dir, base(name), 'audio')), false, 'blocked operations must not create directories');
        }
        const page = await request(`/project-media.php?project=${name}`, second);
        assert.equal(page.status, 200, page.body);
        assert.equal(fs.existsSync(path.join(dir, base(name), 'audio')), false, 'GET must not create directories');
        await checkPlayback(name, oldPng);
      } finally { write(base(name) + 'test-release', '1'); }
      const completed = await pending;
      assert.equal(completed.status, first === 'save' || first === 'editor-upload' ? 200 : 302, completed.body);
      if (first === 'upload') assert.deepEqual(read(name, 'img/added.png'), newPng);
      if (first === 'delete') assert.equal(fs.existsSync(path.join(dir, base(name), 'img/spare.png')), false);
      const afterFirst = read(name, 'flow.json');
      if (first !== 'save') assert.deepEqual(afterFirst, before, 'media actions must not rewrite flow');
      assert.equal(JSON.parse(afterFirst).isPublished, true);
      await checkPlayback(name, first === 'save' || first === 'editor-upload' ? newPng : oldPng);
      // Successful retry from the other session proves success/redirect releases the lock.
      assert.equal((await operation(name, 'upload', { ...second, filename: 'retry.png' })).status, 302);
      assert.equal((await operation(name, 'delete', { ...second, filename: 'retry.png' })).status, 302);
      assert.equal((await operation(name, 'save', second)).status, 200);
      await checkPlayback(name, newPng);
    });
  }
  await t.test('normal image, speech and music upload/delete works without replacing existing files', async () => {
    project('normal'); const before = read('normal', 'flow.json');
    for (const folder of ['img', 'speech', 'audio']) {
      const filename = folder === 'img' ? 'extra.png' : 'extra.mp3';
      const bytes = folder === 'img' ? newPng : audio;
      const options = { folder, filename, bytes };
      const uploaded = await operation('normal', 'upload', options);
      assert.equal(uploaded.status, 302, uploaded.body); assert.equal(uploaded.headers.location, '/project-media.php?project=normal');
      assert.deepEqual(read('normal', `${folder}/${filename}`), bytes);
      assert.equal((await operation('normal', 'upload', options)).status, 409);
      assert.deepEqual(read('normal', `${folder}/${filename}`), bytes);
      assert.equal((await operation('normal', 'delete', { ...options, ...second })).status, 302);
      assert.equal(fs.existsSync(path.join(dir, base('normal'), folder, filename)), false);
    }
    assert.deepEqual(read('normal', 'flow.json'), before); await checkPlayback('normal', oldPng);
  });
  await t.test('errors release the lock and invalid CSRF or other users cannot mutate media', async () => {
    project('errors');
    const cases = [
      ['upload', { bytes: Buffer.from('not a picture') }, 400],
      ['upload', { filename: 'pixel.png' }, 409],
      ['delete', { filename: 'missing.png' }, 404],
      ['delete', { badToken: true }, 403],
      ['delete', { cookie: 'lockother' }, 404]
    ];
    for (const [action, options, status] of cases) {
      const response = await operation('errors', action, options);
      assert.equal(response.status, status, response.body);
      assert.deepEqual(read('errors', 'img/spare.png'), oldPng);
      assert.equal((await operation('errors', 'save', second)).status, 200);
    }
  });
  await t.test('private projects remain private after upload and deletion', async () => {
    project('private', false);
    assert.equal((await operation('private', 'upload')).status, 302);
    assert.equal((await operation('private', 'delete', { filename: 'added.png' })).status, 302);
    assert.equal(JSON.parse(read('private', 'flow.json')).isPublished, false);
    assert.equal((await request('/media.php?p=owner/private/img/pixel.png', { cookie: null })).status, 403);
    await checkPlayback('private', oldPng, false);
  });
  await t.test('Chromium renders and plays public and owner-only projects after media operations', {
    skip: process.env.MOVEMENT_TEST_MEDIA_LOCK_BROWSER !== '1'
  }, () => {
    for (const name of ['parallel-upload', 'parallel-delete', 'private']) {
      const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${secondPort}/player.php?username=owner&project=${name}` };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'), dir,
        name === 'private' ? 'locksecond' : 'lockguest'], { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
    }
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
