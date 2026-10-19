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

test('project writes preserve publication and serialize save, restore, upload and publish', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-restore-publication-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(entry => entry.stopped));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-restore-publication-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (name, data) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  for (const file of ['restore-flow.php', 'publish-project.php', 'json-maker.php', 'player.php', 'media.php',
    '404.php', 'not-found.php', 'server/core/app-init.php', 'server/core/auth-check.php',
    'server/core/current-user.php', 'server/core/current-user-record.php', 'server/core/config-loader.php',
    'server/core/web-session.php', 'server/core/security-helpers.php', 'server/core/response.php',
    'server/core/project-paths.php', 'server/core/project-storage.php', 'server/core/storage-quota.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'assets/app.css']) write(file, fs.readFileSync(path.join(root, file)));
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('sessions/sess_restoreowner', sessionData('owner', 1));
  write('sessions/sess_restoreownersecond', sessionData('owner', 1));
  write('sessions/sess_restoreother', sessionData('other', 2));
  write('publish-token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard('publish_project')['token'];");
  write('operation-token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard($_GET['form'])['token'];");
  // Test-only barrier after the REAL flock succeeds. It forces overlap between
  // independent PHP servers/sessions without relying on timing or PHP's own
  // session lock. Never added to production source.
  const helperFile = path.join(dir, 'server/core/project-storage.php');
  const helper = fs.readFileSync(helperFile, 'utf8');
  assert.ok(helper.includes('    return $handle;'));
  fs.writeFileSync(helperFile, helper.replace('    return $handle;', `
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
  const owner = 'PHPSESSID=restoreowner';
  const ownerSecond = 'PHPSESSID=restoreownersecond';
  const other = 'PHPSESSID=restoreother';
  async function startServer(extra = []) {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const serverPort = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const child = spawn('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, ...extra,
      '-S', `127.0.0.1:${serverPort}`, '-t', dir], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push({ child, stopped: new Promise(resolve => child.once('close', resolve)) });
    child.stderr.on('data', chunk => { log += chunk; });
    return serverPort;
  }
  const port = await startServer();
  const secondPort = await startServer();
  const failedRenamePort = await startServer(['-d', 'disable_functions=rename']);
  function request(url, cookie = owner, body, type = 'application/x-www-form-urlencoded', serverPort = port) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: serverPort, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? {
          'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
        const parts = []; res.on('data', part => parts.push(part));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
          bytes: Buffer.concat(parts), body: Buffer.concat(parts).toString() }));
      });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout'))); req.end(body);
    });
  }
  for (const serverPort of [port, secondPort, failedRenamePort]) for (let i = 0; i < 100; i++) {
    try { await request('/404.php', null, undefined, undefined, serverPort); break; } catch (error) {
      if (i === 99) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(44 + 16000 * 5);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const flow = published => ({ title: 'תוכן משוחזר', schemaVersion: 2, isPublished: published,
    publishedAt: 123, defaultBeatSeconds: 5, openingImage: '', slides: [{
      text: '<b>Public playback</b>', seconds: 60, background: { src: 'img/pixel.png' },
      audioLayers: [{ src: 'speech/voice.wav' }], configFixture: { empty: {}, list: [], numericKeys: { 0: 'zero' } }
    }] });
  const base = name => `private-data/slidedeck/owner/${name}/`;
  function project(name, current, incoming) {
    const currentJson = typeof current === 'string' ? current : JSON.stringify(current);
    write(base(name) + 'flow.json', currentJson);
    write(base(name) + 'backups/flow-source.json', typeof incoming === 'string' ? incoming : JSON.stringify(incoming));
    write(base(name) + 'img/pixel.png', png);
    write(base(name) + 'speech/voice.wav', wav);
    return currentJson;
  }
  async function restore(name, action, incoming, tokenOverride) {
    const url = '/restore-flow.php?project=' + name;
    const page = await request(url);
    assert.equal(page.status, 200, page.body);
    const token = tokenOverride ?? page.body.match(/name="form_token" value="([^"]+)"/)[1];
    if (action === 'restore') return request(url, owner, new URLSearchParams({
      action, backup: 'flow-source.json', form_token: token, website: '' }).toString());
    const boundary = 'MovementRestoreBoundary';
    const fields = { action, form_token: token, website: '' };
    let body = Object.entries(fields).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('');
    body += `--${boundary}\r\nContent-Disposition: form-data; name="flow_file"; filename="flow.json"\r\nContent-Type: application/json\r\n\r\n${typeof incoming === 'string' ? incoming : JSON.stringify(incoming)}\r\n--${boundary}--\r\n`;
    return request(url, owner, body, `multipart/form-data; boundary=${boundary}`);
  }
  const publicProjects = [];
  async function operation(name, action, { cookie = owner, serverPort = port, hold = false } = {}) {
    const form = action === 'save' ? 'json_maker' : action === 'publish' ? 'publish_project' : 'restore_flow';
    const token = (await request(`/operation-token.php?form=${form}`, cookie, undefined, undefined, serverPort)).body;
    const suffix = hold ? '&test_hold=1' : '';
    if (action === 'save') return request(`/json-maker.php?project=${name}${suffix}`, cookie,
      new URLSearchParams({ csrf_token: token, json_data: JSON.stringify({ ...flow(true), title: 'Saved content' }),
        title: 'Saved content', description: 'Saved description' }).toString(), undefined, serverPort);
    if (action === 'publish') return request(`/publish-project.php?project=${name}${suffix}`, cookie,
      new URLSearchParams({ form_token: token, project: name, website: '' }).toString(), undefined, serverPort);
    if (action === 'restore') return request(`/restore-flow.php?project=${name}${suffix}`, cookie,
      new URLSearchParams({ form_token: token, action, backup: 'flow-source.json', website: '' }).toString(), undefined, serverPort);
    const boundary = 'ConcurrentFlowUpload';
    let body = Object.entries({ action: 'upload', form_token: token, website: '' }).map(([key, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('');
    body += `--${boundary}\r\nContent-Disposition: form-data; name="flow_file"; filename="flow.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(flow(true))}\r\n--${boundary}--\r\n`;
    return request(`/restore-flow.php?project=${name}${suffix}`, cookie, body, `multipart/form-data; boundary=${boundary}`, serverPort);
  }
  for (const first of ['save', 'restore', 'upload', 'publish']) {
    await t.test(`${first} excludes all competing writes from a second session and server`, async () => {
      const name = `parallel-${first}`;
      const before = project(name, { ...flow(true), title: 'Before overlap' }, flow(false));
      const pending = operation(name, first, { hold: true });
      // Observe rejection too if the request fails before the barrier.
      pending.catch(() => {});
      try {
        const deadline = Date.now() + 4000;
        while (!fs.existsSync(path.join(dir, base(name), 'test-ready'))) {
          assert.ok(Date.now() < deadline, 'writer did not reach the lock barrier');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        for (const competing of ['save', 'restore', 'upload', 'publish']) {
          const response = await operation(name, competing, { cookie: ownerSecond, serverPort: secondPort });
          assert.equal(response.status, 409, `${first}/${competing}: ${response.body}`);
          assert.equal(response.headers.location, undefined);
          assert.equal(fs.readFileSync(path.join(dir, base(name), 'flow.json'), 'utf8'), before);
          assert.deepEqual(fs.readdirSync(path.join(dir, base(name), 'backups')), ['flow-source.json']);
        }
        const during = await request(`/media.php?p=owner/${name}/flow.json`, null, undefined, undefined, secondPort);
        assert.equal(during.status, 200); assert.equal(during.body, before);
      } finally {
        write(base(name) + 'test-release', '1');
      }
      const completed = await pending;
      assert.equal(completed.status, first === 'save' ? 200 : 302, completed.body);
      if (first !== 'publish') {
        assert.equal((await operation(name, 'publish', { cookie: ownerSecond, serverPort: secondPort })).status, 302);
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, base(name), 'flow.json'))).isPublished, false);
      // A retry reads the latest PRIVATE flag; stale client/backup state cannot
      // undo the unpublish that just completed in the other session.
      for (const retry of ['save', 'restore', 'upload']) {
        assert.equal((await operation(name, retry)).status, retry === 'save' ? 200 : 302);
        const stored = JSON.parse(fs.readFileSync(path.join(dir, base(name), 'flow.json')));
        assert.equal(stored.isPublished, false);
        assert.equal(stored.title, retry === 'save' ? 'Saved content' : flow(true).title);
      }
      assert.equal((await request(`/player.php?username=owner&project=${name}`, null)).status, 404);
      assert.equal(fs.readdirSync(path.join(dir, base(name))).some(file => file.endsWith('.tmp')), false);
      assert.ok(fs.readdirSync(path.join(dir, base(name), 'backups')).length >= 4, 'rapid writes retain separate backups');
    });
    await t.test(`${first} reports failed atomic replacement and preserves the previous file`, async () => {
      const name = `failure-${first}`;
      const before = project(name, { ...flow(true), title: 'Must survive failure' }, flow(false));
      const response = await operation(name, first, { serverPort: failedRenamePort });
      assert.equal(response.status, 500, response.body);
      assert.equal(response.headers.location, undefined);
      assert.equal(fs.readFileSync(path.join(dir, base(name), 'flow.json'), 'utf8'), before);
      assert.equal(fs.readdirSync(path.join(dir, base(name))).some(file => file.endsWith('.tmp')), false);
      // The failed request must release its lock, including exit/redirect paths.
      assert.equal((await operation(name, first)).status, first === 'save' ? 200 : 302);
    });
  }
  for (const action of ['restore', 'upload']) {
    for (const published of [false, true]) {
      for (const incomingPublished of [false, true]) {
        await t.test(`${action}: current ${published}, incoming ${incomingPublished}`, async () => {
          const name = `${action}-${published}-${incomingPublished}`;
          const current = { ...flow(published), title: 'Before restore' };
          // Exercise preserving a timestamp as well as removing an imported one.
          if (incomingPublished) delete current.publishedAt;
          const incoming = { ...flow(incomingPublished), publishedAt: 999999 };
          const before = project(name, current, incoming);
          const response = await restore(name, action, incoming);
          assert.equal(response.status, 302, response.body);
          assert.equal(response.headers.location, `/edit/${name}/?restored=1`);
          const result = JSON.parse(fs.readFileSync(path.join(dir, base(name), 'flow.json'), 'utf8'));
          const expected = { ...incoming, isPublished: published };
          if (Object.hasOwn(current, 'publishedAt')) expected.publishedAt = current.publishedAt;
          else delete expected.publishedAt;
          assert.deepEqual(result, expected, 'only current publication metadata overrides incoming content');
          const backups = path.join(dir, base(name), 'backups');
          const safety = fs.readdirSync(backups).filter(file => file.startsWith('flow-before-'));
          assert.equal(safety.length, 1);
          assert.equal(fs.readFileSync(path.join(backups, safety[0]), 'utf8'), before);
          assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backups, 'flow-source.json'), 'utf8')), incoming);
          for (const cookie of [null, other, owner]) {
            const authorized = published || cookie === owner;
            const player = await request(`/player.php?username=owner&project=${name}`, cookie);
            assert.equal(player.status, authorized ? 200 : 404);
            const image = await request(`/media.php?p=owner/${name}/img/pixel.png`, cookie);
            assert.equal(image.status, authorized ? 200 : 403);
            if (authorized) assert.deepEqual(image.bytes, png);
            const data = await request(`/media.php?p=owner/${name}/flow.json`, cookie);
            assert.equal(data.status, authorized ? 200 : 403);
            if (authorized) assert.deepEqual(JSON.parse(data.body), expected);
          }
          if (published && !incomingPublished) publicProjects.push(name);
        });
      }
    }
  }
  for (const action of ['restore', 'upload']) {
    await t.test(`${action}: absent publication flag remains private`, async () => {
      const current = flow(false); delete current.isPublished; delete current.publishedAt;
      const name = `legacy-${action}`; project(name, current, flow(true));
      assert.equal((await restore(name, action, flow(true))).status, 302);
      const result = JSON.parse(fs.readFileSync(path.join(dir, base(name), 'flow.json')));
      assert.equal(result.isPublished, false); assert.equal(Object.hasOwn(result, 'publishedAt'), false);
    });
    await t.test(`${action}: invalid current/incoming data or CSRF cannot overwrite the project`, async () => {
      for (const [label, current, incoming, token] of [
        ['broken-current', '{broken', flow(true)], ['invalid-state', { ...flow(false), isPublished: 'true' }, flow(true)],
        ['broken-source', flow(false), '{broken'], ['csrf', flow(false), flow(true), 'wrong-token']
      ]) {
        const name = `${label}-${action}`; const before = project(name, current, incoming);
        const response = await restore(name, action, incoming, token);
        assert.equal(response.status, 200, response.body);
        assert.equal(fs.readFileSync(path.join(dir, base(name), 'flow.json'), 'utf8'), before);
        assert.deepEqual(fs.readdirSync(path.join(dir, base(name), 'backups')), ['flow-source.json']);
      }
    });
  }
  await t.test('explicit publish and unpublish actions still change access', async () => {
    const name = 'explicit-publish'; project(name, flow(false), flow(true));
    assert.equal((await restore(name, 'restore', flow(true))).status, 302);
    const token = (await request('/publish-token.php')).body;
    for (const expected of [true, false]) {
      assert.equal((await request('/publish-project.php', owner, new URLSearchParams({
        project: name, form_token: token, website: '' }).toString())).status, 302);
      assert.equal((await request(`/player.php?username=owner&project=${name}`, null)).status, expected ? 200 : 404);
    }
  });
  await t.test('normal editor save preserves public playback data', async () => {
    const name = 'play-save'; project(name, flow(true), flow(false));
    const response = await operation(name, 'save');
    assert.equal(response.status, 200, response.body);
    assert.equal(JSON.parse(response.body).status, 'success');
    const stored = JSON.parse(fs.readFileSync(path.join(dir, base(name), 'flow.json')));
    assert.equal(stored.title, 'Saved content');
    assert.equal(stored.isPublished, true);
    publicProjects.push(name);
  });
  await t.test('concurrent readers only see complete JSON during repeated atomic replacement', async () => {
    const name = 'atomic-read';
    const payload = { revision: 0, padding: 'x'.repeat(256 * 1024), shape: { empty: {}, list: [] } };
    project(name, payload, flow(false));
    const target = path.join(dir, base(name), 'flow.json');
    const writer = spawn('php', ['-r', `require 'server/core/project-storage.php';
      $lock = acquireProjectLock(dirname($argv[1])); if (!$lock) exit(2);
      $success = 0;
      for ($i = 1; $i <= 60; $i++) {
        $json = json_encode(['revision' => $i, 'padding' => str_repeat('x', 256 * 1024),
          'shape' => ['empty' => new stdClass(), 'list' => []]]);
        if (saveJsonAtomically($argv[1], $json)) $success++;
        usleep(2000);
      }
      releaseProjectLock($lock); echo $success;`, target],
    { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', done = false;
    writer.stdout.on('data', data => { output += data; });
    writer.stderr.on('data', data => { errors += data; });
    const stopped = new Promise(resolve => writer.once('close', code => { done = true; resolve(code); }));
    children.push({ child: writer, stopped });
    let reads = 0;
    while (!done) {
      const snapshot = JSON.parse(fs.readFileSync(target, 'utf8'));
      assert.ok(snapshot.revision >= 0 && snapshot.revision <= 60);
      assert.equal(snapshot.padding, payload.padding);
      assert.deepEqual(snapshot.shape, payload.shape);
      reads++;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.equal(await stopped, 0, errors);
    assert.equal(errors, '');
    assert.ok(Number(output) > 0, 'no replacement completed');
    assert.ok(reads > 1, 'no concurrent reads were observed');
    assert.equal(fs.readdirSync(path.dirname(target)).some(file => file.endsWith('.tmp')), false);
  });
  await t.test('public projects play in Chromium after save, restore and upload', {
    skip: process.env.MOVEMENT_TEST_RESTORE_BROWSER !== '1'
  }, () => {
    for (const name of publicProjects) {
      const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${port}/player.php?username=owner&project=${name}` };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'), dir, 'restorebrowserguest'],
        { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
    }
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Fatal|Warning|Parse)/.test(line)), []);
});
