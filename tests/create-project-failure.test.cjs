const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { sessionData, databaseSource } = require('./helpers/session-fixture.cjs');
const root = path.resolve(__dirname, '..');

test('new projects appear only after complete creation and failures clean up staging', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-create-failure-'));
  const children = [];
  let log = '';
  t.after(async () => {
    for (const child of children) {
      if (child.process.exitCode === null) child.process.kill();
      await child.stopped;
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-create-failure-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name, data) {
    const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  for (const name of ['create-project.php', 'json-maker.php', 'player.php', 'media.php', 'dashboard.php',
    '404.php', 'not-found.php', 'server/core/app-init.php', 'server/core/auth-check.php',
    'server/core/current-user.php', 'server/core/current-user-record.php', 'server/core/config-loader.php',
    'server/core/web-session.php', 'server/core/security-helpers.php', 'server/core/project-paths.php',
    'server/core/project-storage.php', 'server/core/storage-quota.php', 'server/core/response.php',
    'templates/player/player-page-template.php', 'studio/player/player-runtime.js']) {
    write(name, fs.readFileSync(path.join(root, name)));
  }
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other', 3: 'fresh' }));
  write('quota', '1073741824');
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT='development'; $USER_STORAGE_QUOTA_BYTES=(int)file_get_contents(__DIR__.'/../../quota');");
  for (const [cookie, name, id] of [['createowner', 'owner', 1], ['createsecond', 'owner', 1],
    ['createother', 'other', 2], ['createfresh', 'fresh', 3]]) {
    write('sessions/sess_' + cookie, sessionData(name, id));
  }
  write('token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard('create_project')['token'];");

  // Fault injection changes only this isolated copy, never production hooks.
  let controller = fs.readFileSync(path.join(dir, 'create-project.php'), 'utf8');
  for (const name of ['mkdir', 'file_put_contents', 'chmod', 'rename']) {
    controller = controller.replace(new RegExp('\\b' + name + '\\(', 'g'), 'creation_test_' + name + '(');
  }
  write('create-project.php', controller.replace('<?php', "<?php require __DIR__.'/creation-fixture.php';"));
  write('creation-fixture.php', `<?php
function creation_test_phase($path) {
    $name=basename($path);
    if (str_starts_with($name,'.create-')) return 'stage';
    if (in_array($name,['owner','other','fresh'],true)) return 'library';
    return $name;
}
function creation_test_mkdir($path,$mode=0777,$recursive=false) {
    if (($_GET['fail']??'') === 'mkdir:'.creation_test_phase($path)) return false;
    return mkdir($path,$mode,$recursive);
}
function creation_test_file_put_contents($path,$data,$flags=0) {
    $failure=$_GET['fail']??''; $name=basename($path);
    if ($failure==='write:'.$name) return false;
    if ($failure==='partial:'.$name) return file_put_contents($path,substr($data,0,3),$flags);
    if ($name==='flow.json' && $failure==='exception') throw new RuntimeException('Injected write exception');
    if ($name==='flow.json' && $failure==='shutdown') { http_response_code(500); exit('Injected early shutdown'); }
    return file_put_contents($path,$data,$flags);
}
function creation_test_chmod($path,$mode) {
    if (($_GET['fail']??'') === 'chmod:'.basename($path)) return false;
    return chmod($path,$mode);
}
function creation_test_rename($from,$to) {
    if (isset($_GET['hold'])) {
        file_put_contents(__DIR__.'/ready','1'); $deadline=microtime(true)+12;
        while (!is_file(__DIR__.'/release')) {
            clearstatcache(); if(microtime(true)>$deadline) throw new RuntimeException('Barrier timeout'); usleep(10000);
        }
    }
    if (($_GET['fail']??'') === 'rename') return false;
    return rename($from,$to);
}`);
  async function startServer() {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const process = spawn('php', ['-d', `session.save_path=${path.join(dir, 'sessions')}`, '-S', `127.0.0.1:${port}`, '-t', dir],
      { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push({ process, stopped: new Promise(resolve => process.once('close', resolve)) });
    process.stderr.on('data', chunk => { log += chunk; }); return port;
  }
  const port = await startServer(), secondPort = await startServer();
  function request(url, { cookie = 'createowner', body, serverPort = port } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: serverPort, path: url, method: body ? 'POST' : 'GET',
        headers: { ...(cookie ? { Cookie: 'PHPSESSID=' + cookie } : {}), ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)
        } : {}) } }, res => {
        let content = ''; res.on('data', chunk => { content += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: content }));
      });
      req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('Request timed out'))); req.end(body);
    });
  }
  for (const serverPort of [port, secondPort]) for (let i = 0; i < 100; i++) {
    try { await request('/404.php', { serverPort }); break; } catch (error) {
      if (i === 99) throw error; await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const tokens = {};
  for (const cookie of ['createowner', 'createsecond', 'createother', 'createfresh']) {
    tokens[cookie] = (await request('/token.php', { cookie })).body;
  }
  const userDir = name => path.join(dir, 'private-data/slidedeck', name);
  const projectDir = (name, user = 'owner') => path.join(userDir(user), name);
  function create(name, { fail = '', hold = false, cookie = 'createowner', token = tokens[cookie], serverPort = port } = {}) {
    return request('/create-project.php?' + new URLSearchParams({ fail, ...(hold ? { hold: '1' } : {}) }), {
      cookie, serverPort, body: new URLSearchParams({ project: name, form_token: token || '', website: '' }).toString()
    });
  }
  function noStaging(user = 'owner') {
    if (fs.existsSync(userDir(user))) assert.deepEqual(fs.readdirSync(userDir(user)).filter(name => name.startsWith('.create-')), []);
  }
  function complete(name, response, user = 'owner') {
    assert.equal(response.status, 302, response.body);
    assert.equal(response.headers.location, '/edit/' + name + '/?created=1');
    const folder = projectDir(name, user);
    assert.deepEqual(fs.readdirSync(folder).sort(), ['.htaccess', 'audio', 'flow.json', 'img', 'speech']);
    for (const media of ['img', 'speech', 'audio']) assert.ok(fs.statSync(path.join(folder, media)).isDirectory());
    assert.match(fs.readFileSync(path.join(folder, '.htaccess'), 'utf8'), /Require all denied/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'flow.json'))), {
      title: '', isPublished: false, schemaVersion: 2, defaultBeatSeconds: 5, slides: [], openingImage: ''
    });
    noStaging(user);
  }

  await t.test('normal creation prepares a private project that its owner can open', async () => {
    complete('normal', await create('normal'));
    assert.equal((await request('/json-maker.php?project=normal')).status, 200);
    assert.equal((await request('/player.php?username=owner&project=normal')).status, 200);
    assert.equal((await request('/media.php?p=owner/normal/flow.json')).status, 200);
    for (const cookie of [null, 'createother']) {
      assert.equal((await request('/player.php?username=owner&project=normal', { cookie })).status, 404);
      assert.equal((await request('/media.php?p=owner/normal/flow.json', { cookie })).status, 403);
    }
  });
  await t.test('failure preparing a first-time user library returns an error and can be retried', async () => {
    const response = await create('first', { cookie: 'createfresh', fail: 'mkdir:library' });
    assert.equal(response.status, 500); assert.equal(response.headers.location, undefined);
    assert.equal(fs.existsSync(projectDir('first', 'fresh')), false); noStaging('fresh');
    complete('first', await create('first', { cookie: 'createfresh' }), 'fresh');
  });
  for (const [index, failure] of ['mkdir:stage', 'mkdir:project', 'mkdir:img', 'mkdir:speech', 'mkdir:audio',
    'write:.htaccess', 'partial:.htaccess', 'chmod:.htaccess', 'write:flow.json', 'partial:flow.json',
    'chmod:flow.json', 'chmod:project', 'rename', 'exception', 'shutdown'].entries()) {
    await t.test(`${failure} leaves no partial project or staging files and permits same-name retry`, async () => {
      const name = 'failed-' + index;
      const response = await create(name, { fail: failure });
      assert.equal(response.status, 500, response.body); assert.equal(response.headers.location, undefined);
      assert.equal(fs.existsSync(projectDir(name)), false); noStaging();
      complete(name, await create(name, { cookie: 'createsecond', serverPort: secondPort }));
    });
  }
  await t.test('existing projects and directories are never overwritten or cleaned up', async () => {
    const before = fs.readFileSync(path.join(projectDir('normal'), 'flow.json'));
    assert.equal((await create('normal')).headers.location, '/new-project.php');
    assert.deepEqual(fs.readFileSync(path.join(projectDir('normal'), 'flow.json')), before);
    write('private-data/slidedeck/owner/reserved/sentinel', 'keep');
    assert.equal((await create('reserved')).headers.location, '/new-project.php');
    assert.equal(fs.readFileSync(path.join(projectDir('reserved'), 'sentinel'), 'utf8'), 'keep'); noStaging();
  });
  await t.test('staging stays out of the library and competing creation cannot overwrite it', async () => {
    const pending = create('parallel', { hold: true }); pending.catch(() => {});
    try {
      const deadline = Date.now() + 6000;
      while (!fs.existsSync(path.join(dir, 'ready'))) {
        assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(fs.existsSync(projectDir('parallel')), false);
      const library = await request('/dashboard.php', { cookie: 'createsecond', serverPort: secondPort });
      assert.equal(library.status, 200); assert.doesNotMatch(library.body, /\.create-/);
      assert.equal((await request('/json-maker.php?project=parallel', { cookie: 'createsecond', serverPort: secondPort })).status, 404);
      assert.equal((await create('parallel', { cookie: 'createsecond', serverPort: secondPort })).status, 409);
    } finally { write('release', '1'); }
    complete('parallel', await pending);
  });
  await t.test('quota, CSRF, invalid names and guest requests create no partial projects', async () => {
    write('quota', '1');
    try { assert.equal((await create('quota-blocked')).status, 507); }
    finally { write('quota', '1073741824'); }
    assert.equal((await create('csrf-blocked', { token: 'bad' })).headers.location, '/new-project.php');
    assert.equal((await create('bad name')).headers.location, '/new-project.php');
    assert.equal((await create('guest-blocked', { cookie: null })).headers.location, '/login.php');
    for (const name of ['quota-blocked', 'csrf-blocked', 'bad name', 'guest-blocked']) assert.equal(fs.existsSync(projectDir(name)), false);
    noStaging();
  });
  assert.deepEqual(log.split('\n').filter(line => /PHP (?:Warning|Fatal|Parse)/.test(line)), []);
});
