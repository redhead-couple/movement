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

test('per-user storage quota covers all writes and serializes independent project operations', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-storage-quota-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(entry => entry.stopped));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-storage-quota-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name, data) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  }
  for (const file of ['create-project.php', 'duplicate-project.php', 'import-project.php', 'restore-flow.php', 'publish-project.php', 'server/core/portable-project-import.php', 'project-media.php', 'json-maker.php', 'player.php', 'media.php', '404.php', 'not-found.php',
    'server/core/app-init.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/config-loader.php', 'server/core/web-session.php',
    'server/core/security-helpers.php', 'server/core/response.php', 'server/core/project-paths.php',
    'server/core/project-storage.php', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
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
    for (const form of ['json_maker', 'project_media', 'create_project', 'duplicate_project', 'import_project', 'restore_flow', 'publish_project']) {
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
  const userRoot = path.join(dir, 'private-data/slidedeck/owner');
  function snapshot(directory = userRoot) {
    const result = {};
    function visit(folder, prefix = '') {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.name.endsWith('.lock')) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) visit(path.join(folder, entry.name), relative + '/');
        else result[relative] = fs.readFileSync(path.join(folder, entry.name)).toString('base64');
      }
    }
    visit(directory); return result;
  }
  function usage() {
    return Object.values(snapshot()).reduce((total, data) => total + Buffer.from(data, 'base64').length, 0);
  }
  function quota(bytes) { write('quota.txt', String(bytes)); }
  project('source'); project('another');
  write(base('source') + 'backups/flow-source.json', JSON.stringify(flow));
  const zipPath = path.join(dir, 'fixture.zip');
  write('fixture-flow.json', JSON.stringify(flow)); write('fixture.png', newPng);
  const zipped = spawnSync('php', ['-r', `$z=new ZipArchive(); $z->open($argv[1], ZipArchive::CREATE);
    $z->addFile($argv[2], 'imported/flow.json'); $z->addFile($argv[3], 'imported/img/pixel.png'); $z->close();`,
  zipPath, path.join(dir, 'fixture-flow.json'), path.join(dir, 'fixture.png')], { windowsHide: true });
  assert.equal(zipped.status, 0, zipped.stderr.toString());
  const zipBytes = fs.readFileSync(zipPath);
  async function quotaOperation(action, { name = 'source', cookie = 'lockowner', port = firstPort, hold = false,
    filename = 'added.png', bytes = newPng } = {}) {
    if (['save', 'editor-upload', 'upload', 'delete'].includes(action)) {
      return operation(name, action, { cookie, port, hold, filename, bytes });
    }
    const form = { create: 'create_project', duplicate: 'duplicate_project', import: 'import_project',
      restore: 'restore_flow', publish: 'publish_project' }[action];
    // Import rotates its CSRF token after success AND after quota rejection.
    tokens[cookie][form] = (await request(`/token.php?form=${form}`, { cookie, port })).body;
    const fields = { form_token: tokens[cookie][form], website: '', project: name };
    if (action === 'restore') Object.assign(fields, { action: 'restore', backup: 'flow-source.json' });
    const endpoint = { create: 'create-project', duplicate: 'duplicate-project', import: 'import-project',
      restore: 'restore-flow', publish: 'publish-project' }[action];
    let body = new URLSearchParams(fields).toString(), type;
    if (action === 'import') {
      const boundary = 'QuotaImportFixture';
      const parts = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="portable_zip"; filename="fixture.zip"\r\nContent-Type: application/zip\r\n\r\n`), zipBytes, Buffer.from(`\r\n--${boundary}--\r\n`));
      body = Buffer.concat(parts); type = `multipart/form-data; boundary=${boundary}`;
    }
    return request(`/${endpoint}.php?project=${name}${hold ? '&test_hold=1' : ''}`, { cookie, port, body, type });
  }
  await t.test('full quota rejects every growth path without changing existing content', async () => {
    const before = snapshot(); quota(usage());
    for (const action of ['upload', 'editor-upload', 'save', 'duplicate', 'import', 'restore', 'publish', 'create']) {
      const response = await quotaOperation(action, { name: action === 'create' ? 'blocked-new' : 'source' });
      if (action === 'import') {
        assert.equal(response.status, 302, response.body);
        assert.match((await request('/flash.php')).body, /storage limit/i);
      } else {
        assert.equal(response.status, 507, `${action}: ${response.body}`); assert.match(response.body, /storage limit/i);
      }
      assert.deepEqual(snapshot(), before, action + ' changed existing content');
    }
    assert.equal(fs.existsSync(path.join(userRoot, 'blocked-new')), false);
    assert.equal(fs.readdirSync(userRoot).some(name => name.startsWith('.import-') || name.includes('-copy')), false);
    await checkPlayback('source', oldPng);
  });
  await t.test('temporary replacement copies and safety backups count toward the quota', async () => {
    const before = snapshot(), currentUsage = usage();
    // Final replacement is the same size, but preparing it needs space for
    // both the staged upload and a recovery copy of the old media.
    quota(currentUsage + newPng.length);
    assert.equal((await quotaOperation('editor-upload')).status, 507);
    assert.deepEqual(snapshot(), before);
    // Enough for the new flow alone is not enough for flow + safety backup + media.
    quota(currentUsage + JSON.stringify(flow).length);
    assert.equal((await quotaOperation('save')).status, 507);
    assert.deepEqual(snapshot(), before);
  });
  await t.test('deletion works above quota and releases space for a subsequent upload', async () => {
    quota(usage() - 1);
    const deleted = await quotaOperation('delete', { filename: 'spare.png' });
    assert.equal(deleted.status, 302, deleted.body);
    quota(usage() + newPng.length);
    const uploaded = await quotaOperation('upload');
    assert.equal(uploaded.status, 302, uploaded.body);
    assert.deepEqual(read('source', 'img/added.png'), newPng);
    assert.equal(usage(), Number(fs.readFileSync(path.join(dir, 'quota.txt'))));
  });
  await t.test('normal save, media upload, create, import and duplication work below quota', async () => {
    quota(10 * 1024 * 1024);
    for (const action of ['save', 'editor-upload', 'upload', 'duplicate', 'import', 'create']) {
      const response = await quotaOperation(action, { name: action === 'create' ? 'new-project' : 'source', filename: 'normal.png' });
      assert.equal(response.status, ['save', 'editor-upload'].includes(action) ? 200 : 302, `${action}: ${response.body}`);
      if (action === 'import') assert.equal((await request('/flash.php')).body, '');
    }
    assert.equal(JSON.parse(read('source', 'flow.json')).isPublished, true);
    assert.equal(JSON.parse(read('source-copy', 'flow.json')).isPublished, false);
    assert.equal(JSON.parse(read('imported', 'flow.json')).isPublished, false);
    assert.deepEqual(read('source-copy', 'img/pixel.png'), newPng);
    assert.deepEqual(read('imported', 'img/pixel.png'), newPng);
    assert.ok(fs.existsSync(path.join(userRoot, 'new-project/flow.json')));
    await checkPlayback('source', newPng);
  });
  for (const first of ['upload', 'save', 'import', 'duplicate']) {
    await t.test(`${first} locks the account against every writer in another project`, async () => {
      quota(10 * 1024 * 1024);
      for (const marker of ['test-ready', 'test-release']) {
        const file = path.join(dir, marker); if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      const before = snapshot();
      const pending = quotaOperation(first, { hold: true, filename: `parallel-${first}.png` }); pending.catch(() => {});
      try {
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(path.join(dir, 'test-ready'))) {
          assert.ok(Date.now() < deadline, 'operation did not acquire the account lock');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        for (const competing of ['upload', 'editor-upload', 'save', 'duplicate', 'import', 'create', 'restore', 'publish', 'delete']) {
          const response = await quotaOperation(competing, { ...second, name: competing === 'create' ? 'parallel-created' : 'another' });
          if (competing === 'import') {
            assert.equal(response.status, 302); assert.match((await request('/flash.php', second)).body, /operation is in progress/i);
          } else assert.equal(response.status, 409, `${first}/${competing}: ${response.body}`);
          assert.deepEqual(snapshot(), before);
        }
        // Another account must not be blocked by the owner's storage lock.
        const other = await quotaOperation('create', { cookie: 'lockother', port: secondPort, name: `independent-${first}` });
        assert.equal(other.status, 302, other.body);
        await checkPlayback('source', newPng);
      } finally { write('test-release', '1'); }
      const completed = await pending;
      assert.equal(completed.status, first === 'save' ? 200 : 302, completed.body);
      assert.ok(usage() <= 10 * 1024 * 1024);
    });
  }
  await t.test('two concurrent uploads cannot spend the same remaining bytes', async () => {
    for (const marker of ['test-ready', 'test-release']) fs.unlinkSync(path.join(dir, marker));
    quota(usage() + newPng.length);
    const pending = quotaOperation('upload', { hold: true, filename: 'last-space.png' }); pending.catch(() => {});
    try {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(path.join(dir, 'test-ready'))) {
        assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal((await quotaOperation('upload', { ...second, name: 'another', filename: 'over-limit.png' })).status, 409);
    } finally { write('test-release', '1'); }
    assert.equal((await pending).status, 302);
    const before = snapshot();
    assert.equal((await quotaOperation('upload', { ...second, name: 'another', filename: 'over-limit.png' })).status, 507);
    assert.deepEqual(snapshot(), before);
    assert.ok(usage() <= Number(fs.readFileSync(path.join(dir, 'quota.txt'))));
  });
  await t.test('invalid quota configuration fails closed and recovers after correction', async () => {
    const before = snapshot(); quota(0);
    const response = await quotaOperation('upload', { filename: 'invalid-config.png' });
    assert.equal(response.status, 503); assert.match(response.body, /configuration is unavailable/i);
    assert.deepEqual(snapshot(), before);
    quota(10 * 1024 * 1024);
    assert.equal((await quotaOperation('upload', { filename: 'valid-config.png' })).status, 302);
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
