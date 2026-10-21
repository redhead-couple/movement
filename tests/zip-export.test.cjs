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

test('website ZIP export is a locked snapshot and fails before sending download bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-zip-export-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(entry => entry.stopped));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-zip-export-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name, data) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  }
  for (const file of ['export-project.php', 'server/core/player-module-policy.php', 'templates/player/offline-player-template.php', 'effects/registry.json', 'transitions/registry.json', 'delete-project.php', 'rename-project.php', 'create-project.php', 'duplicate-project.php', 'import-project.php', 'restore-flow.php', 'publish-project.php', 'server/core/portable-project-import.php', 'project-media.php', 'json-maker.php', 'player.php', 'media.php', '404.php', 'not-found.php',
    'server/core/app-init.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/config-loader.php', 'server/core/web-session.php',
    'server/core/security-helpers.php', 'server/core/response.php', 'server/core/project-paths.php',
    'server/core/project-storage.php', 'server/core/media-trash.php', 'templates/media-trash-view.php', 'studio/editor/media-trash-preview.js', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'effects/effect-media.js', 'assets/app.css']) write(file, fs.readFileSync(path.join(root, file)));
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
  write('tmp/.keep', '');
  async function startServer() {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn('php', ['-d', 'extension=gd', '-d', `sys_temp_dir=${path.join(dir, 'tmp')}`, '-d', `session.save_path=${path.join(dir, 'sessions')}`,
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
  // Inject failures and barriers only into the isolated controller copy.
  // The proxy delegates successful calls to the real PHP ZipArchive.
  write('zip-fixture.php', `<?php
function exportFixtureBarrier($phase) {
    file_put_contents(__DIR__ . '/test-ready', $phase);
    $deadline = microtime(true) + 15;
    while (!is_file(__DIR__ . '/test-release')) {
        clearstatcache();
        if (microtime(true) > $deadline) throw new RuntimeException('Export barrier timed out');
        usleep(10000);
    }
}
class ExportFixtureZip {
    private $zip;
    private $calls = [];
    public function __construct() { $this->zip = new ZipArchive(); }
    public function __call($method, $args) {
        $this->calls[$method] = ($this->calls[$method] ?? 0) + 1;
        if ($method === 'close' && $this->calls[$method] === 1 && isset($_GET['close_hold'])) exportFixtureBarrier('closing');
        if (($_GET['fail'] ?? '') === $method && $this->calls[$method] === 1) return false;
        if (($_GET['fail'] ?? '') === 'exception' && $method === 'addFile') throw new RuntimeException('Injected read failure');
        return $this->zip->$method(...$args);
    }
}
`);
  let controller = fs.readFileSync(path.join(dir, 'export-project.php'), 'utf8');
  assert.ok(controller.includes('$zip = new ZipArchive();'));
  controller = controller.replace('$zip = new ZipArchive();', "require_once __DIR__ . '/zip-fixture.php'; $zip = new ExportFixtureZip();");
  const streamMarker = "$userStorageLock = null;\ntry {\n    header('Content-Type: application/zip');";
  assert.ok(controller.includes(streamMarker));
  controller = controller.replace(streamMarker, "$userStorageLock = null;\nif (isset($_GET['stream_hold'])) exportFixtureBarrier('streaming');\ntry {\n    header('Content-Type: application/zip');");
  write('export-project.php', controller);
  function exportZip(name, suffix = '', options = {}) {
    return request(`/export-project.php?project=${name}${suffix}`, options);
  }
  function resetBarrier() {
    for (const marker of ['test-ready', 'test-release']) {
      const file = path.join(dir, marker); if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  async function waitForLock() {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(path.join(dir, 'test-ready'))) {
      assert.ok(Date.now() < deadline, 'operation did not reach the barrier');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  function noExportTemps() {
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')).filter(name => name.startsWith('project_export_')), []);
  }
  function verifyZip(response, name, expectedFlow, expectedImage) {
    assert.equal(response.status, 200, response.body.slice(0, 300));
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.equal(Number(response.headers['content-length']), response.bytes.length);
    assert.equal(response.bytes.subarray(0, 2).toString(), 'PK');
    const zipPath = path.join(dir, `${name}-download.zip`);
    fs.writeFileSync(zipPath, response.bytes);
    const extracted = fs.mkdtempSync(path.join(dir, 'extracted-'));
    const result = spawnSync('php', ['-r', `$z=new ZipArchive();
      if ($z->open($argv[1], ZipArchive::CHECKCONS) !== true) exit(1);
      if (!$z->extractTo($argv[2])) exit(2); if (!$z->close()) exit(3);`, zipPath, extracted], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr.toString());
    const folder = path.join(extracted, name);
    assert.deepEqual(fs.readFileSync(path.join(folder, 'flow.json')), expectedFlow);
    assert.deepEqual(fs.readFileSync(path.join(folder, 'img/pixel.png')), expectedImage);
    assert.deepEqual(fs.readFileSync(path.join(folder, 'speech/voice.mp3')), audio);
    assert.ok(fs.readFileSync(path.join(folder, 'player.html'), 'utf8').includes('PLAYER_BOOTSTRAP'));
    assert.equal(fs.existsSync(path.join(folder, 'backups')), false);
    assert.equal(fs.existsSync(path.join(folder, 'img/.hidden.tmp')), false);
    noExportTemps();
  }
  await t.test('normal private and public exports contain exact flow and media', async () => {
    for (const published of [true, false]) {
      const name = 'normal-' + published; project(name, published);
      write(base(name) + 'backups/flow-source.json', 'private backup');
      write(base(name) + 'img/.hidden.tmp', 'temporary recovery file');
      verifyZip(await exportZip(name), name, read(name, 'flow.json'), oldPng);
    }
  });
  await t.test('export holds the lock through ZIP finalization and blocks saves and media changes', async () => {
    resetBarrier(); project('export-first');
    const before = read('export-first', 'flow.json');
    const pending = exportZip('export-first', '&close_hold=1'); pending.catch(() => {});
    try {
      await waitForLock();
      for (const action of ['save', 'editor-upload', 'upload', 'delete']) {
        const response = await operation('export-first', action, second);
        assert.equal(response.status, 409, response.body);
      }
      assert.deepEqual(read('export-first', 'flow.json'), before);
      assert.deepEqual(read('export-first', 'img/pixel.png'), oldPng);
      await checkPlayback('export-first', oldPng);
    } finally { write('test-release', '1'); }
    verifyZip(await pending, 'export-first', before, oldPng);
    assert.equal((await operation('export-first', 'save', second)).status, 200);
  });
  for (const first of ['save', 'editor-upload', 'upload', 'delete']) {
    await t.test(`export rejects while ${first} is active and succeeds on retry`, async () => {
      resetBarrier(); const name = 'writer-' + first; project(name);
      const pending = operation(name, first, { hold: true }); pending.catch(() => {});
      try {
        await waitForLock();
        const blocked = await exportZip(name, '', second);
        assert.equal(blocked.status, 409); assert.equal(blocked.headers['content-disposition'], undefined);
        noExportTemps();
      } finally { write('test-release', '1'); }
      assert.equal((await pending).status, ['save', 'editor-upload'].includes(first) ? 200 : 302);
      verifyZip(await exportZip(name), name, read(name, 'flow.json'), read(name, 'img/pixel.png'));
    });
  }
  for (const fail of ['open', 'addEmptyDir', 'addFromString', 'addFile', 'close', 'exception']) {
    await t.test(`${fail} failure sends an error, cleans temporary files and releases the lock`, async () => {
      const name = 'failure-' + fail; project(name); const before = read(name, 'flow.json');
      const failed = await exportZip(name, '&fail=' + fail);
      assert.equal(failed.status, 500, failed.body);
      assert.match(failed.headers['content-type'], /^text\/plain/);
      assert.equal(failed.headers['content-disposition'], undefined);
      assert.doesNotMatch(failed.body, /^PK/); assert.match(failed.body, /complete ZIP archive/);
      assert.deepEqual(read(name, 'flow.json'), before); assert.deepEqual(read(name, 'img/pixel.png'), oldPng);
      noExportTemps();
      verifyZip(await exportZip(name, '', second), name, before, oldPng);
    });
  }
  await t.test('player generation failure returns an error without leaking files or locks', async () => {
    project('player-failure'); const before = read('player-failure', 'flow.json');
    const dependency = path.join(dir, 'effects/effect-media.js');
    const contents = fs.readFileSync(dependency);
    fs.unlinkSync(dependency);
    try {
      const failed = await exportZip('player-failure');
      assert.equal(failed.status, 500, failed.body);
      assert.match(failed.headers['content-type'], /^text\/plain/);
      assert.equal(failed.headers['content-disposition'], undefined);
      assert.match(failed.body, /complete ZIP archive/);
      assert.deepEqual(read('player-failure', 'flow.json'), before);
      assert.deepEqual(read('player-failure', 'img/pixel.png'), oldPng);
      noExportTemps();
    } finally { fs.writeFileSync(dependency, contents); }
    verifyZip(await exportZip('player-failure', '', second), 'player-failure', before, oldPng);
  });
  await t.test('completed download releases account AND session locks before streaming', async () => {
    resetBarrier(); project('slow-download'); const before = read('slow-download', 'flow.json');
    const pending = exportZip('slow-download', '&stream_hold=1'); pending.catch(() => {});
    try {
      await waitForLock();
      // Same PHP session on a second server: this also detects an accidentally
      // retained PHP session lock, even if the account lock was released.
      const saved = await operation('slow-download', 'save', { cookie: 'lockowner', port: secondPort });
      assert.equal(saved.status, 200, saved.body);
    } finally { write('test-release', '1'); }
    verifyZip(await pending, 'slow-download', before, oldPng);
    assert.equal(JSON.parse(read('slow-download', 'flow.json')).title, 'After');
  });
  await t.test('guests and other accounts cannot export the owner project', async () => {
    project('restricted', false);
    assert.equal((await exportZip('restricted', '', { cookie: null })).status, 302);
    assert.equal((await exportZip('restricted', '', { cookie: 'lockother' })).status, 404);
    noExportTemps();
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
