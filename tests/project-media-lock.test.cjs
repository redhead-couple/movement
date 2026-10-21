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
    'server/core/project-storage.php', 'server/core/media-trash.php', 'templates/media-trash-view.php', 'studio/editor/media-trash-preview.js', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
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
  function request(url, { cookie = 'lockowner', body, type = 'application/x-www-form-urlencoded', port = firstPort, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method: body ? 'POST' : 'GET',
        headers: { ...headers, ...(cookie ? { Cookie: `PHPSESSID=${cookie}` } : {}), ...(body ? {
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
        for (const action of ['trash_unused_images', 'restore_image']) {
          const response = await request(`/project-media.php?project=${name}`, { ...second,
            body: new URLSearchParams({ action, folder: 'img', form_token: tokens.locksecond.project_media,
              cleanup_token: page.body.match(/name="cleanup_token" value="([a-f0-9]+)"/)[1] }).toString() });
          assert.equal(response.status, 409, response.body);
          assert.deepEqual(read(name, 'img/spare.png'), oldPng);
        }
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
  await t.test('bulk image trash and restore use authenticated CSRF-protected requests and preserve saved playback', async () => {
    const name = 'cleanup'; project(name);
    const imageNames = ['opening.png', 'layer.png', 'frame.png', 'multi.png', 'encoded image.png'];
    for (const image of imageNames) write(base(name) + 'img/' + image, oldPng);
    write(base(name) + 'img/second.png', newPng);
    const story = { ...flow, openingImage: 'img/opening.png', slides: [{ ...flow.slides[0],
      foregroundLayers: [{ src: 'img/layer.png' }], bgEffect: { frames: ['img/frame.png'], images: ['img/multi.png'] },
      fgEffect: { custom: 'img/encoded%20image.png' } }] };
    write(base(name) + 'flow.json', JSON.stringify(story));
    const before = read(name, 'flow.json');
    const page = await request(`/project-media.php?project=${name}`);
    assert.equal(page.status, 200, page.body);
    assert.match(page.body, /Delete all unused images \(2\)/);
    const token = page.body.match(/name="cleanup_token" value="([a-f0-9]+)"/)[1];
    const fields = { action: 'trash_unused_images', folder: 'img',
      cleanup_token: token, form_token: tokens.lockowner.project_media };
    const post = (fields, options = {}) => request(`/project-media.php?project=${name}`, {
      ...options, body: new URLSearchParams(fields).toString()
    });
    // Reviewing/cancelling the page does not mutate anything.
    assert.deepEqual(read(name, 'img/spare.png'), oldPng);
    assert.equal((await post({ ...fields, form_token: 'invalid' })).status, 403);
    assert.equal((await post(fields, { cookie: 'lockother' })).status, 404);
    assert.doesNotMatch(page.body, /saved_and_closed|closed its editor windows/);
    assert.match(page.body, /Delete all 2 unused images\?/);
    write(base(name) + 'flow.json', JSON.stringify({ ...story, title: 'Changed elsewhere' }));
    assert.equal((await post(fields)).status, 302);
    assert.deepEqual(read(name, 'img/spare.png'), oldPng);
    assert.match((await request(`/project-media.php?project=${name}`)).body, /changed.*Refresh/);
    write(base(name) + 'flow.json', before);
    assert.equal((await post(fields)).status, 302);
    assert.equal(fs.existsSync(path.join(dir, base(name), 'img/spare.png')), false);
    assert.equal(fs.existsSync(path.join(dir, base(name), 'img/second.png')), false);
    for (const image of imageNames) assert.deepEqual(read(name, 'img/' + image), oldPng);
    await checkPlayback(name, oldPng);
    const trashPage = await request(`/project-media.php?project=${name}&view=trash`);
    assert.match(trashPage.body, /Media Trash \(2\)/);
    const id = trashPage.body.match(/name="trash_id" value="([^"]+)"/)[1];
    const preview = `/media.php?p=owner/${name}/.movement-media-trash/${id}/img/spare.png&trash_preview=1`;
    const imagePreview = await request(preview);
    assert.equal(imagePreview.status, 200);
    assert.deepEqual(imagePreview.bytes, oldPng);
    assert.match(imagePreview.headers['cache-control'], /no-store/);
    assert.equal(imagePreview.headers['x-content-type-options'], 'nosniff');
    for (const cookie of [null, 'lockother']) assert.equal((await request(preview, { cookie })).status, 403);
    assert.equal((await request(`/media.php?p=owner/${name}/img/pixel.png&trash_preview=1`)).status, 403);
    write(base(name) + `.movement-media-trash/${id}/img/private.json`, '{}');
    assert.equal((await request(preview.replace('spare.png', 'private.json'))).status, 403);
    fs.unlinkSync(path.join(dir, base(name), `.movement-media-trash/${id}/img/private.json`));
    for (const alias of [`.movement-media-trash/${id}/img/spare.png`, `./.movement-media-trash//${id}/img/spare.png`,
      ...(process.platform === 'win32' ? [`.MOVEMENT-MEDIA-TRASH\\${id}\\img\\spare.png`] : [])]) {
      for (const cookie of [null, 'lockother', 'lockowner']) {
        assert.equal((await request('/media.php?p=' + encodeURIComponent(`owner/${name}/${alias}`), { cookie })).status, 403);
      }
    }
    const restore = { action: 'restore_image', folder: 'img', trash_id: id, filename: 'spare.png', form_token: tokens.lockowner.project_media };
    assert.equal((await post({ ...restore, form_token: 'invalid' })).status, 403);
    assert.equal((await post(restore, { cookie: 'lockother' })).status, 404);
    write(base(name) + 'img/spare.png', newPng);
    await post(restore);
    assert.deepEqual(read(name, 'img/spare.png'), newPng);
    assert.deepEqual(read(name, `.movement-media-trash/${id}/img/spare.png`), oldPng);
    fs.unlinkSync(path.join(dir, base(name), 'img/spare.png'));
    await post(restore);
    assert.deepEqual(read(name, 'img/spare.png'), oldPng);
    assert.equal((await request(preview)).status, 404);
    await post({ ...restore, filename: 'second.png' });
    assert.deepEqual(read(name, 'img/second.png'), newPng);
    assert.deepEqual(read(name, 'flow.json'), before);
    assert.match((await request(`/project-media.php?project=${name}`)).body, /data-trash-count="0"/);
    await checkPlayback(name, oldPng);
  });

  await t.test('bulk cleanup refuses corrupt saved flow and stale media lists', async () => {
    const name = 'cleanup-invalid'; project(name);
    const page = await request(`/project-media.php?project=${name}`);
    const token = page.body.match(/name="cleanup_token" value="([a-f0-9]+)"/)[1];
    const body = new URLSearchParams({ action: 'trash_unused_images', folder: 'img',
      cleanup_token: token, form_token: tokens.lockowner.project_media }).toString();
    write(base(name) + 'img/new.png', newPng);
    await request(`/project-media.php?project=${name}`, { body });
    assert.deepEqual(read(name, 'img/spare.png'), oldPng);
    write(base(name) + 'flow.json', '{broken');
    await request(`/project-media.php?project=${name}`, { body });
    assert.deepEqual(read(name, 'img/spare.png'), oldPng);
    assert.match((await request(`/project-media.php?project=${name}`)).body, /saved slideshow cannot be read/);
  });

  await t.test('audio and speech cleanup preserve used tracks, reject stale/type-swapped tokens and restore original bytes', async () => {
    const name = 'cleanup-sound'; project(name);
    const story = { ...flow, globalAudioLayers: [{ src: 'audio/global.mp3' }], slides: [{ ...flow.slides[0],
      speech: 'speech/legacy.mp3', audio: 'speech/old-voice.mp3',
      audioLayers: [{ src: 'speech/voice.mp3' }, { src: 'audio/layer.mp3' }],
      custom: { track: 'audio/encoded%20track.mp3', narration: 'speech/custom.mp3' } }] };
    write(base(name) + 'flow.json', JSON.stringify(story));
    const used = { audio: ['global.mp3', 'layer.mp3', 'encoded track.mp3'], speech: ['voice.mp3', 'legacy.mp3', 'old-voice.mp3', 'custom.mp3'] };
    const before = read(name, 'flow.json');
    for (const folder of ['audio', 'speech']) {
      for (const filename of [...used[folder], 'unused-one.mp3', 'unused-two.mp3']) write(base(name) + `${folder}/${filename}`, audio);
    }
    const post = fields => request(`/project-media.php?project=${name}`, { body: new URLSearchParams({
      form_token: tokens.lockowner.project_media, ...fields }).toString() });
    for (const folder of ['audio', 'speech']) {
      const page = await request(`/project-media.php?project=${name}`);
      const form = page.body.match(new RegExp(`<form[^>]+data-cleanup-type="${folder}"[\\s\\S]*?</form>`))[0];
      const token = form.match(/name="cleanup_token" value="([a-f0-9]+)"/)[1];
      const fields = { action: 'trash_unused_media', folder, cleanup_token: token };
      assert.match(form, /\(2\)/);
      await post({ ...fields, folder: folder === 'audio' ? 'speech' : 'audio' });
      assert.deepEqual(read(name, `${folder}/unused-one.mp3`), audio);
      write(base(name) + 'flow.json', JSON.stringify({ ...story, title: 'Changed' }));
      await post(fields);
      assert.deepEqual(read(name, `${folder}/unused-one.mp3`), audio);
      write(base(name) + 'flow.json', before);
      assert.equal((await post(fields)).status, 302);
      for (const filename of used[folder]) assert.deepEqual(read(name, `${folder}/${filename}`), audio);
      assert.equal(fs.existsSync(path.join(dir, base(name), `${folder}/unused-one.mp3`)), false);
      const trashPage = await request(`/project-media.php?project=${name}&view=trash`);
      const section = trashPage.body.match(new RegExp(`<form[^>]+data-trash-type="${folder}"[\\s\\S]*?</form>`))[0];
      const id = section.match(/name="trash_id" value="([^"]+)"/)[1];
      const preview = `/media.php?p=owner/${name}/.movement-media-trash/${id}/${folder}/unused-one.mp3&trash_preview=1`;
      const sample = await request(preview, { headers: { Range: 'bytes=10-29' } });
      assert.equal(sample.status, 206);
      assert.deepEqual(sample.bytes, audio.subarray(10, 30));
      assert.equal(sample.headers['content-range'], `bytes 10-29/${audio.length}`);
      assert.equal((await request(preview, { headers: { Range: `bytes=${audio.length + 1}-` } })).status, 416);
      for (const cookie of [null, 'lockother']) assert.equal((await request(preview, { cookie })).status, 403);
      assert.equal((await request(`/media.php?p=owner/${name}/.movement-media-trash/${id}/${folder}/unused-one.mp3`, { cookie: null })).status, 403);
      for (const filename of ['unused-one.mp3', 'unused-two.mp3']) {
        await post({ action: 'restore_media', folder, trash_id: id, filename });
        assert.deepEqual(read(name, `${folder}/${filename}`), audio);
      }
    }
    assert.deepEqual(read(name, 'flow.json'), before);
    await checkPlayback(name, oldPng);
  });

  await t.test('empty trash enforces ownership, CSRF, project locking and reviewed snapshot; live media is preserved', async () => {
    const name = 'empty-trash'; project(name);
    const before = read(name, 'flow.json');
    for (const type of ['img', 'audio', 'speech']) write(base(name) + `.movement-media-trash/batch/${type}/discard.bin`, type);
    const url = `/project-media.php?project=${name}&view=trash`;
    const getToken = async () => (await request(url)).body.match(/name="trash_token" value="([a-f0-9]+)"/)[1];
    const fields = { action: 'empty_media_trash', form_token: tokens.lockowner.project_media, trash_token: await getToken() };
    const post = (changes = {}, options = {}) => request(url, { ...options, body: new URLSearchParams({ ...fields, ...changes }).toString() });
    assert.equal((await post({ form_token: 'invalid' })).status, 403);
    assert.equal((await post({ form_token: tokens.lockother.project_media }, { cookie: 'lockother' })).status, 404);
    assert.equal((await post({}, { cookie: null })).status, 302);
    write(base(name) + '.movement-media-trash/new/img/new.png', newPng);
    assert.equal((await post()).status, 302);
    assert.match((await request(url)).body, /Media Trash changed/);
    for (const type of ['img', 'audio', 'speech']) assert.equal(read(name, `.movement-media-trash/batch/${type}/discard.bin`).toString(), type);
    fields.trash_token = await getToken();
    const held = operation(name, 'save', { hold: true, bytes: oldPng });
    try {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(path.join(dir, base(name), 'test-ready'))) {
        assert.ok(Date.now() < deadline, 'writer did not acquire the shared lock');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal((await post({ form_token: tokens.locksecond.project_media }, { cookie: 'locksecond', port: secondPort })).status, 409);
    } finally { write(base(name) + 'test-release', '1'); await held; }
    // Restore the fixture's flow so the byte-for-byte assertion checks only empty-trash effects.
    write(base(name) + 'flow.json', before);
    const result = await post();
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, url);
    assert.match((await request(url)).body, /Permanently deleted 4 files/);
    for (const type of ['img', 'audio', 'speech']) assert.equal(fs.existsSync(path.join(dir, base(name), `.movement-media-trash/batch/${type}/discard.bin`)), false);
    assert.deepEqual(read(name, 'img/pixel.png'), oldPng);
    assert.deepEqual(read(name, 'img/spare.png'), oldPng);
    assert.deepEqual(read(name, 'speech/voice.mp3'), audio);
    assert.deepEqual(read(name, 'flow.json'), before);
  });

  await t.test('website media trash form works in Chromium', { skip: process.env.MOVEMENT_TEST_WEB_TRASH_BROWSER !== '1' }, async () => {
    project('cleanup-ui');
    write(base('cleanup-ui') + 'audio/unused.mp3', audio);
    write(base('cleanup-ui') + 'speech/unused.mp3', audio);
    const before = read('cleanup-ui', 'flow.json');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const browser = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/media-trash-web-browser.cjs'), dir,
      `http://127.0.0.1:${secondPort}/project-media.php?project=cleanup-ui`], { windowsHide: true, encoding: 'utf8', env, timeout: 45000 });
    assert.equal(browser.status, 0, browser.stdout + browser.stderr);
    assert.match(browser.stdout, /MEDIA_TRASH_WEB_BROWSER_OK/);
    assert.deepEqual(read('cleanup-ui', 'flow.json'), before);
    assert.equal(fs.existsSync(path.join(dir, base('cleanup-ui'), 'img/spare.png')), false);
    assert.deepEqual(read('cleanup-ui', 'img/pixel.png'), oldPng);
  });

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
