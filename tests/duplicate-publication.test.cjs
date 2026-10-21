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

test('project duplication creates private drafts without changing the source', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-duplicate-publication-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(entry => entry.stopped));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-duplicate-publication-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (name, data) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  for (const file of ['duplicate-project.php', 'publish-project.php', 'player.php', 'media.php',
    '404.php', 'not-found.php', 'server/core/app-init.php', 'server/core/auth-check.php',
    'server/core/current-user.php', 'server/core/current-user-record.php', 'server/core/config-loader.php',
    'server/core/web-session.php', 'server/core/security-helpers.php', 'server/core/response.php',
    'server/core/project-paths.php', 'server/core/project-storage.php', 'server/core/storage-quota.php', 'server/core/published-projects.php',
    'templates/player/player-page-template.php', 'studio/player/player-runtime.js', 'assets/app.css']) {
    write(file, fs.readFileSync(path.join(root, file)));
  }
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('sessions/sess_duplicateowner', sessionData('owner', 1));
  write('sessions/sess_duplicateother', sessionData('other', 2));
  write('token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard($_GET['form'])['token'];");
  write('feed.php', "<?php require 'server/core/published-projects.php'; echo json_encode(getPublishedProjects());");
  // Pause only the fixture, after the actual file copy and before creating the
  // live flow. A second PHP server can probe guest access while copying is active.
  const endpoint = fs.readFileSync(path.join(dir, 'duplicate-project.php'), 'utf8');
  const marker = 'copyProjectFolder($sourceDir, $targetDir);';
  assert.ok(endpoint.includes(marker));
  write('duplicate-project.php', endpoint.replace(marker, marker + `
    if (isset($_POST['test_hold'])) {
        file_put_contents(__DIR__ . '/test-ready', '1');
        $deadline = microtime(true) + 15;
        while (!is_file(__DIR__ . '/test-release')) {
            clearstatcache();
            if (microtime(true) > $deadline) throw new RuntimeException('Test barrier timed out');
            usleep(10000);
        }
    }`));
  const owner = 'PHPSESSID=duplicateowner';
  const other = 'PHPSESSID=duplicateother';
  async function startServer(extra = []) {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, ...extra,
      '-S', `127.0.0.1:${port}`, '-t', dir], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push({ child, stopped: new Promise(resolve => child.once('close', resolve)) });
    child.stderr.on('data', chunk => { log += chunk; });
    return port;
  }
  const port = await startServer();
  const secondPort = await startServer();
  const failedCopyPort = await startServer(['-d', 'disable_functions=copy']);
  function request(url, cookie = owner, body, serverPort = port) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: serverPort, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
        const parts = []; res.on('data', part => parts.push(part));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
          bytes: Buffer.concat(parts), body: Buffer.concat(parts).toString() }));
      });
      req.on('error', reject); req.setTimeout(20000, () => req.destroy(new Error('HTTP timeout'))); req.end(body);
    });
  }
  for (const serverPort of [port, secondPort, failedCopyPort]) for (let i = 0; i < 100; i++) {
    try { await request('/404.php', null, undefined, serverPort); break; } catch (error) {
      if (i === 99) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const base = name => `private-data/slidedeck/owner/${name}/`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(44 + 16000 * 5);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const flow = published => ({ title: 'פרויקט לשכפול', schemaVersion: 2, isPublished: published,
    publishedAt: 123, defaultBeatSeconds: 5, openingImage: '', slides: [{
      text: '<b>Public playback</b>', seconds: 60, background: { src: 'img/pixel.png' },
      audioLayers: [{ src: 'speech/voice.wav' }], settings: { empty: {}, list: [], numericKeys: { 0: 'zero' } }
    }] });
  function project(name, data) {
    write(base(name) + 'flow.json', typeof data === 'string' ? data : JSON.stringify(data));
    write(base(name) + 'img/pixel.png', png);
    write(base(name) + 'img/nested/second.png', png);
    write(base(name) + 'speech/voice.wav', wav);
    write(base(name) + 'audio/music.wav', wav);
    write(base(name) + 'backups/flow.json', JSON.stringify(flow(true)));
    fs.mkdirSync(path.join(dir, base(name), 'empty-folder'));
  }
  function snapshot(name) {
    const result = {};
    function walk(folder, prefix = '') {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const key = prefix + entry.name;
        if (entry.isDirectory()) { result[key + '/'] = null; walk(path.join(folder, entry.name), key + '/'); }
        else result[key] = fs.readFileSync(path.join(folder, entry.name)).toString('base64');
      }
    }
    walk(path.join(dir, base(name))); return result;
  }
  const stored = name => JSON.parse(fs.readFileSync(path.join(dir, base(name), 'flow.json')));
  async function duplicate(name, { cookie = owner, serverPort = port, hold = false } = {}) {
    const token = (await request('/token.php?form=duplicate_project', cookie, undefined, serverPort)).body;
    return request('/duplicate-project.php', cookie, new URLSearchParams({
      project: name, form_token: token, website: '', ...(hold ? { test_hold: '1' } : {})
    }).toString(), serverPort);
  }
  const player = name => `/player.php?username=owner&project=${name}`;
  const media = (name, file) => `/media.php?p=owner/${name}/${file}`;
  async function assertPrivate(name, serverPort = port, incomplete = false) {
    for (const cookie of [null, other]) {
      assert.equal((await request(player(name), cookie, undefined, serverPort)).status, 404);
      for (const file of ['flow.json', 'img/pixel.png', 'speech/voice.wav', 'backups/flow.json']) {
        assert.equal((await request(media(name, file), cookie, undefined, serverPort)).status,
          incomplete && file === 'flow.json' ? 404 : 403);
      }
    }
    assert.equal(JSON.parse((await request('/feed.php', null, undefined, serverPort)).body)
      .some(item => item.project === name), false);
  }
  for (const [name, data] of [['public', flow(true)], ['private', flow(false)],
    ['legacy', { ...flow(true), isPublished: undefined }]]) {
    await t.test(`${name} source produces a private draft with unchanged content, media and original`, async () => {
      project(name, data);
      const before = snapshot(name);
      const response = await duplicate(name);
      assert.equal(response.status, 302, response.body);
      assert.equal(response.headers.location, `/edit/${name}-copy/`);
      const expected = JSON.parse(JSON.stringify({ ...data, isPublished: false }));
      delete expected.publishedAt;
      assert.deepEqual(stored(name + '-copy'), expected);
      const copied = snapshot(name + '-copy');
      for (const [file, bytes] of Object.entries(before)) if (file !== 'flow.json') assert.equal(copied[file], bytes, file);
      assert.match(Buffer.from(copied['.htaccess'], 'base64').toString(), /Require all denied/);
      assert.deepEqual(snapshot(name), before);
      await assertPrivate(name + '-copy');
      assert.equal((await request(player(name + '-copy'))).status, 200);
      assert.deepEqual((await request(media(name + '-copy', 'img/pixel.png'))).bytes, png);
      assert.deepEqual((await request(media(name + '-copy', 'speech/voice.wav'))).bytes, wav);
      assert.equal((await request(media(name + '-copy', 'backups/flow.json'))).status, 200);
      assert.equal((await request(player(name), null)).status, data.isPublished ? 200 : 404);
    });
  }
  await t.test('a second duplicate receives a new name without overwriting the first', async () => {
    const first = snapshot('public-copy');
    const before = snapshot('public');
    const response = await duplicate('public');
    assert.equal(response.headers.location, '/edit/public-copy-2/');
    assert.deepEqual(stored('public-copy-2'), stored('public-copy'));
    assert.deepEqual(snapshot('public-copy'), first);
    assert.deepEqual(snapshot('public'), before);
  });
  await t.test('no public access or feed entry during duplication', async () => {
    project('in-progress', flow(true));
    const before = snapshot('in-progress');
    const pending = duplicate('in-progress', { hold: true });
    try {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(path.join(dir, 'test-ready'))) {
        assert.ok(Date.now() < deadline, 'copy did not reach barrier');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(fs.existsSync(path.join(dir, base('in-progress-copy'), 'flow.json')), false);
      await assertPrivate('in-progress-copy', secondPort, true);
    } finally { write('test-release', '1'); }
    assert.equal((await pending).status, 302);
    await assertPrivate('in-progress-copy');
    assert.deepEqual(snapshot('in-progress'), before);
  });
  await t.test('invalid source JSON creates no copy and leaves source unchanged', async () => {
    for (const [name, data] of [['broken', '{invalid'], ['array', '[]'], ['null', 'null']]) {
      project(name, data); const before = snapshot(name);
      assert.equal((await duplicate(name)).status, 500);
      assert.equal(fs.existsSync(path.join(dir, base(name + '-copy'))), false);
      assert.deepEqual(snapshot(name), before);
    }
  });
  await t.test('failed media copy reports failure and removes the incomplete draft', async () => {
    project('failed-copy', flow(true)); const before = snapshot('failed-copy');
    assert.equal((await duplicate('failed-copy', { serverPort: failedCopyPort })).status, 500);
    assert.equal(fs.existsSync(path.join(dir, base('failed-copy-copy'))), false);
    assert.deepEqual(snapshot('failed-copy'), before);
  });
  await t.test('guest and another account cannot duplicate the owner project', async () => {
    const before = snapshot('public');
    assert.equal((await duplicate('public', { cookie: other })).status, 404);
    assert.equal((await duplicate('public', { cookie: null })).status, 302);
    assert.equal(fs.existsSync(path.join(dir, base('public-copy-3'))), false);
    assert.deepEqual(snapshot('public'), before);
  });
  await t.test('owner can play the private copy and guests can still play the source in Chromium', {
    skip: process.env.MOVEMENT_TEST_DUPLICATE_BROWSER !== '1'
  }, () => {
    for (const [name, session] of [['public-copy', 'duplicateowner'], ['public', 'duplicateguest']]) {
      const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${port}${player(name)}` };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'), dir, session],
        { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
    }
  });
  await t.test('copy becomes public only through explicit publication, without changing source', async () => {
    const before = snapshot('public');
    const token = (await request('/token.php?form=publish_project')).body;
    const response = await request('/publish-project.php', owner, new URLSearchParams({
      project: 'public-copy', form_token: token, website: '' }).toString());
    assert.equal(response.status, 302, response.body);
    assert.equal(stored('public-copy').isPublished, true);
    assert.equal((await request(player('public-copy'), null)).status, 200);
    assert.deepEqual((await request(media('public-copy', 'img/pixel.png'), null)).bytes, png);
    assert.deepEqual(snapshot('public'), before);
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
