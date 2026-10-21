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

test('project deletion and rename share the stable account lock with saves', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-project-lifecycle-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(entry => entry.stopped));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-project-lifecycle-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name, data) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  }
  for (const file of ['delete-project.php', 'rename-project.php', 'create-project.php', 'duplicate-project.php', 'import-project.php', 'restore-flow.php', 'publish-project.php', 'server/core/portable-project-import.php', 'project-media.php', 'json-maker.php', 'player.php', 'media.php', '404.php', 'not-found.php',
    'server/core/app-init.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/config-loader.php', 'server/core/web-session.php',
    'server/core/security-helpers.php', 'server/core/response.php', 'server/core/project-paths.php',
    'server/core/project-storage.php', 'server/core/media-trash.php', 'templates/media-trash-view.php', 'studio/editor/media-trash-preview.js', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'assets/app.css']) write(file, fs.readFileSync(path.join(root, file)));
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  write('quota.txt', '1073741824');
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development'; $USER_STORAGE_QUOTA_BYTES = (int) file_get_contents(__DIR__ . '/../../quota.txt');");
  write('flash.php', "<?php require 'server/core/security-helpers.php'; echo $_SESSION['flash_error'] ?? ''; unset($_SESSION['flash_error']);");
  write('sessions/sess_lockowner', sessionData('owner', 1));
  write('sessions/sess_locksecond', sessionData('owner', 1));
  write('sessions/sess_lockother', sessionData('other', 2));
  write('token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard($_GET['form'])['token'];");
  // Fixture-only barrier AFTER the real flock succeeds, BEFORE any mutation.
  // Two PHP processes and two sessions ensure neither PHP's single-threaded
  // development server nor its session mutex can produce a false pass.
  const helper = fs.readFileSync(path.join(dir, 'server/core/storage-quota.php'), 'utf8');
  assert.ok(helper.includes('    return new UserStorageLock($handle);'));
  write('server/core/storage-quota.php', helper.replace('    return new UserStorageLock($handle);', `
    if (isset($_GET['test_hold'])) {
        file_put_contents(dirname(__DIR__, 2) . '/test-ready', '1');
        $deadline = microtime(true) + 15;
        while (!is_file(dirname(__DIR__, 2) . '/test-release')) {
            clearstatcache();
            if (microtime(true) > $deadline) throw new RuntimeException('Test barrier timed out');
            usleep(10000);
        }
    }
    return new UserStorageLock($handle);`));
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
    for (const form of ['json_maker', 'project_media', 'create_project', 'duplicate_project', 'import_project', 'restore_flow', 'publish_project', 'delete_project', 'rename_project']) {
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
  function snapshot(name) {
    const result = {};
    function walk(directory, prefix = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.endsWith('.lock')) continue;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), prefix + entry.name + '/');
        else result[prefix + entry.name] = fs.readFileSync(path.join(directory, entry.name)).toString('base64');
      }
    }
    walk(path.join(dir, base(name))); return result;
  }
  function resetBarrier() {
    for (const marker of ['test-ready', 'test-release']) {
      const file = path.join(dir, marker); if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  async function waitForLock() {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(path.join(dir, 'test-ready'))) {
      assert.ok(Date.now() < deadline, 'writer did not acquire the account lock');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async function lifecycle(name, action, { cookie = 'lockowner', port = firstPort, hold = false,
    destination = name + '-renamed', confirm = 'yes', badToken = false } = {}) {
    if (action === 'save') return operation(name, 'save', { cookie, port, hold });
    const fields = { form_token: badToken ? 'invalid' : tokens[cookie]?.[action + '_project'], website: '', confirm, new_slug: destination };
    return request(`/${action}-project.php?project=${name}${hold ? '&test_hold=1' : ''}`, {
      cookie, port, body: new URLSearchParams(fields).toString()
    });
  }
  for (const first of ['save', 'delete', 'rename']) {
    await t.test(`${first} excludes saving, deletion and rename from a separate connection`, async () => {
      resetBarrier(); const name = 'parallel-' + first; project(name); project(name + '-independent');
      const before = snapshot(name);
      const pending = lifecycle(name, first, { hold: true }); pending.catch(() => {});
      try {
        await waitForLock();
        for (const competing of ['save', 'delete', 'rename']) {
          const response = await lifecycle(name, competing, second);
          assert.equal(response.status, 409, `${first}/${competing}: ${response.body}`);
          assert.equal(response.headers.location, undefined);
          assert.deepEqual(snapshot(name), before);
          assert.equal(fs.existsSync(path.join(dir, base(name + '-renamed'))), false);
        }
        await checkPlayback(name, oldPng);
      } finally { write('test-release', '1'); }
      const response = await pending;
      assert.equal(response.status, first === 'save' ? 200 : 302, response.body);
      if (first === 'delete') {
        assert.equal(fs.existsSync(path.join(dir, base(name))), false);
        assert.equal((await lifecycle(name, 'save', second)).status, 404);
      } else if (first === 'rename') {
        assert.equal(response.headers.location, `/edit/${name}-renamed/?renamed=1`);
        assert.equal(fs.existsSync(path.join(dir, base(name))), false);
        assert.deepEqual(snapshot(name + '-renamed'), before);
        assert.equal((await lifecycle(name, 'save', second)).status, 404);
        await checkPlayback(name + '-renamed', oldPng);
        assert.equal((await lifecycle(name + '-renamed', 'save', second)).status, 200);
      } else {
        assert.equal(JSON.parse(read(name, 'flow.json')).title, 'After');
        assert.equal((await lifecycle(name, 'rename', second)).status, 302);
        await checkPlayback(name + '-renamed', newPng);
      }
      // Redirects/success must release the account lock too.
      assert.equal((await lifecycle(name + '-independent', 'save', second)).status, 200);
    });
  }
  for (const action of ['delete', 'rename']) {
    await t.test(`${action} rechecks source existence after acquiring the lock`, async () => {
      resetBarrier(); const name = 'missing-' + action; project(name);
      const pending = lifecycle(name, action, { hold: true }); pending.catch(() => {});
      try {
        await waitForLock();
        // Fixture-only intervention between the initial page checks and the
        // locked checks. PHP must discard its cached file metadata.
        fs.unlinkSync(path.join(dir, base(name), 'flow.json'));
      } finally { write('test-release', '1'); }
      assert.equal((await pending).status, 404);
      assert.deepEqual(read(name, 'img/pixel.png'), oldPng);
      assert.equal(fs.existsSync(path.join(dir, base(name + '-renamed'))), false);
    });
  }
  await t.test('rename rechecks destination and never overwrites an existing project', async () => {
    resetBarrier(); project('source'); const before = snapshot('source');
    const pending = lifecycle('source', 'rename', { hold: true, destination: 'occupied' }); pending.catch(() => {});
    let targetBefore;
    try {
      await waitForLock(); project('occupied'); targetBefore = snapshot('occupied');
    } finally { write('test-release', '1'); }
    const response = await pending;
    assert.equal(response.status, 200); assert.match(response.body, /That slug already exists/);
    assert.deepEqual(snapshot('source'), before); assert.deepEqual(snapshot('occupied'), targetBefore);
    assert.equal((await lifecycle('source', 'save', second)).status, 200);
  });
  await t.test('normal rename preserves private/public state and all media and backups', async () => {
    for (const published of [true, false]) {
      const name = `normal-${published}`; project(name, published);
      write(base(name) + 'backups/flow-source.json', JSON.stringify(flow));
      write(base(name) + '.save.lock', ''); // Existing project locks must not prevent Windows rename/delete.
      const before = snapshot(name);
      assert.equal((await lifecycle(name, 'rename')).status, 302);
      assert.deepEqual(snapshot(name + '-renamed'), before);
      await checkPlayback(name + '-renamed', oldPng, published);
      assert.equal((await request(`/player.php?username=owner&project=${name}`, { cookie: null })).status, 404);
      if (!published) assert.equal((await request(`/media.php?p=owner/${name}-renamed/img/pixel.png`, { cookie: null })).status, 403);
    }
  });
  await t.test('deletion works above quota and cancellation and rejected requests preserve contents', async () => {
    project('over-quota'); write(base('over-quota') + '.save.lock', '');
    write('quota.txt', '1');
    assert.equal((await lifecycle('over-quota', 'delete')).status, 302);
    assert.equal(fs.existsSync(path.join(dir, base('over-quota'))), false);
    project('protected'); const before = snapshot('protected');
    assert.equal((await lifecycle('protected', 'delete', { confirm: 'no' })).status, 302);
    for (const action of ['delete', 'rename']) {
      assert.match((await lifecycle('protected', action, { badToken: true })).body, /session expired/i);
      assert.equal((await lifecycle('protected', action, { cookie: 'lockother' })).status, 404);
      assert.equal((await lifecycle('protected', action, { cookie: null })).status, 302);
      assert.deepEqual(snapshot('protected'), before);
    }
    write('quota.txt', '1073741824');
    assert.equal((await lifecycle('protected', 'save', second)).status, 200);
  });
  await t.test('renamed projects render and play in Chromium at their new URL', {
    skip: process.env.MOVEMENT_TEST_LIFECYCLE_BROWSER !== '1'
  }, () => {
    for (const name of ['normal-true-renamed', 'normal-false-renamed']) {
      const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${secondPort}/player.php?username=owner&project=${name}` };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'), dir,
        name.includes('false') ? 'locksecond' : 'lifecycleguest'], { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
    }
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
