const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const { sessionData, databaseSource } = require('./helpers/session-fixture.cjs');
const root = path.resolve(__dirname, '..');

test('development router denies physical aliases without changing controller access', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-router-security-'));
  const doc = path.join(dir, 'public');
  const aliases = [];
  let child, stopped, log = '';
  t.after(async () => {
    if (child && child.exitCode === null) child.kill();
    if (stopped) await stopped;
    // Remove the junctions themselves before recursively cleaning the fixture.
    for (const alias of aliases) fs.unlinkSync(alias);
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('movement-router-security-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (name, content) => {
    const file = path.join(doc, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
  };
  for (const file of ['router.php', 'media.php', 'player.php', '404.php', 'not-found.php',
    'server/core/web-session.php', 'server/core/config-loader.php', 'server/core/project-paths.php',
    'server/core/response.php', 'templates/player/player-page-template.php',
    'studio/player/player-runtime.js', 'assets/app.css']) write(file, fs.readFileSync(path.join(root, file)));
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  write('sessions/sess_routerowner', sessionData('owner', 1));
  write('sessions/sess_routerother', sessionData('other', 2));
  write('server/private-probe.txt', 'INTERNAL_ONLY');
  write('server/private-probe.php', "<?php echo 'INTERNAL_ONLY';");
  write('public-probe.php', "<?php echo 'PUBLIC_HANDLER';");
  write('private-data-public/probe.json', '{"public":true}');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(44 + 16000 * 5);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const flow = published => ({ schemaVersion: 2, title: 'ROUTER_PROJECT', isPublished: published, slides: [{
    text: '<b>Public playback</b>', seconds: 60, background: { src: 'img/pixel.png' }, audioLayers: [{ src: 'speech/voice.wav' }]
  }] });
  const backup = '{"title":"PRIVATE_BACKUP"}';
  for (const [base, published] of [['private-data/slidedeck/owner/draft/', false],
    ['private-data/slidedeck/owner/published/', true], ['examples/demo/', true]]) {
    write(base + 'flow.json', JSON.stringify(flow(published)));
    write(base + 'img/pixel.png', png); write(base + 'speech/voice.wav', wav);
    write(base + 'backups/flow-old.json', backup);
  }
  write('examples/demo/.movement-media-trash/old.png', png);
  write('examples/demo/.save.lock', 'PRIVATE_LOCK');
  function alias(name, target) {
    const link = path.join(doc, name);
    fs.symlinkSync(path.join(doc, target), link, process.platform === 'win32' ? 'junction' : 'dir');
    aliases.push(link);
  }
  alias('storage-alias', 'private-data');
  alias('internal-alias', 'server');
  alias('example-alias', 'examples');
  // Existing physical aliases must not intercept the authorized virtual routes.
  alias('slidedeck', 'private-data/slidedeck');
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  child = spawn('php', ['-d', `session.save_path=${path.join(doc, 'sessions')}`, '-S', `127.0.0.1:${port}`, '-t', doc, 'router.php'],
    { cwd: doc, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  stopped = new Promise(resolve => child.once('close', resolve)); child.stderr.on('data', data => { log += data; });
  function request(url, cookie) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: url, headers: cookie ? { Cookie: cookie } : {} }, res => {
        const chunks = []; res.on('data', data => chunks.push(data));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
    });
  }
  for (let i = 0; i < 100; i++) {
    try { await request('/public-probe.php'); break; } catch (error) {
      if (i === 99) throw error; await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const owner = 'PHPSESSID=routerowner', other = 'PHPSESSID=routerother';
  async function denied(url, cookie) {
    const res = await request(url, cookie);
    assert.equal(res.status, 403, url + ': ' + res.body);
    assert.equal(res.body, 'Forbidden', url);
  }
  await t.test('direct storage and internal files are denied for guests, owners and other users', async () => {
    const paths = ['/private-data/slidedeck/owner/draft/flow.json', '/private-data/slidedeck/owner/published/img/pixel.png',
      '/private-data/slidedeck/owner/published/backups/flow-old.json', '/%70rivate-data/slidedeck/owner/draft/flow.json',
      '/private-data//slidedeck/owner/draft/flow.json', '/private-data/./slidedeck/owner/draft/flow.json',
      '/SERVER/private-probe.txt', '/%73erver/private-probe.txt', '/server/private-probe.php/extra',
      '/server/missing.txt'];
    for (const cookie of [undefined, owner, other]) for (const url of paths) await denied(url, cookie);
  });
  await t.test('Windows trailing dots, spaces, backslashes and NTFS stream paths cannot bypass denial', {
    skip: process.platform !== 'win32'
  }, async () => {
    const variants = ['/private-data.', '/private-data%20', '/private-data.%20', '/PRIVATE-DATA...',
      '/private-data%5c', '/private-data::$INDEX_ALLOCATION'];
    for (const cookie of [undefined, owner, other]) {
      for (const prefix of variants) await denied(prefix + '/slidedeck/owner/draft/flow.json', cookie);
      await denied('/private-data%5cslidedeck%5cowner%5cdraft%5cflow.json', cookie);
      await denied('/server.%20/private-probe.txt', cookie);
    }
  });
  await t.test('filesystem aliases and PHP PATH_INFO resolve to the protected tree', async () => {
    for (const url of ['/storage-alias/slidedeck/owner/draft/flow.json', '/storage-alias/slidedeck/owner/draft/missing.json',
      '/internal-alias/private-probe.txt', '/internal-alias/private-probe.php/extra',
      '/example-alias/demo/backups/flow-old.json']) await denied(url);
  });
  await t.test('example backup/lock/trash restrictions remain intact while public example assets work', async () => {
    for (const url of ['/examples/demo/backups/flow-old.json', '/examples/demo/.save.lock',
      '/examples/demo/.movement-media-trash/old.png']) await denied(url);
    if (process.platform === 'win32') {
      for (const url of ['/examples./demo/backups./flow-old.json', '/examples%5cdemo%5cbackups%5cflow-old.json']) await denied(url);
    }
    assert.deepEqual((await request('/examples/demo/img/pixel.png')).bytes, png);
    assert.equal((await request('/player.php?example=demo')).status, 200);
  });
  await t.test('owners retain byte-exact private media and backups through both supported routes', async () => {
    for (const project of ['draft', 'published']) for (const [file, bytes] of [['img/pixel.png', png],
      ['speech/voice.wav', wav], ['backups/flow-old.json', Buffer.from(backup)]]) {
      for (const url of ['/media.php?p=' + encodeURIComponent(`owner/${project}/${file}`), `/slidedeck/owner/${project}/${file}`]) {
        const res = await request(url, owner); assert.equal(res.status, 200, url); assert.deepEqual(res.bytes, bytes, url);
      }
    }
    assert.equal((await request('/slidedeck/owner/draft/', owner)).status, 200);
  });
  await t.test('public playback remains accessible while private projects and all backups reject other viewers', async () => {
    for (const cookie of [undefined, other]) {
      assert.equal((await request('/slidedeck/owner/published/', cookie)).status, 200);
      assert.equal((await request('/slidedeck/owner/draft/', cookie)).status, 404);
      assert.deepEqual((await request('/slidedeck/owner/published/img/pixel.png', cookie)).bytes, png);
      assert.deepEqual((await request('/media.php?p=owner/published/speech/voice.wav', cookie)).bytes, wav);
      for (const project of ['draft', 'published']) {
        assert.equal((await request(`/slidedeck/owner/${project}/backups/flow-old.json`, cookie)).status, 403);
      }
      assert.equal((await request('/media.php?p=owner/draft/img/pixel.png', cookie)).status, 403);
    }
  });
  await t.test('ordinary static files and public PHP handlers remain available', async () => {
    assert.equal((await request('/assets/app.css')).status, 200);
    assert.equal((await request('/studio/player/player-runtime.js')).status, 200);
    assert.equal((await request('/public-probe.php')).body, 'PUBLIC_HANDLER');
    assert.equal((await request('/router.php')).status, 200);
    assert.equal((await request('/private-data-public/probe.json')).body, '{"public":true}');
    assert.equal((await request('/missing-public-file.txt')).status, 404);
  });
  await t.test('Chromium plays public projects for guests and private projects for their owner', {
    skip: process.env.MOVEMENT_TEST_ROUTER_BROWSER !== '1'
  }, () => {
    for (const [project, session] of [['published', 'routerguest'], ['draft', 'routerowner']]) {
      const env = { ...process.env, SESSION_TEST_PLAYER_URL: `http://127.0.0.1:${port}/slidedeck/owner/${project}/` };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/session-player-browser.cjs'), dir, session],
        { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /PUBLIC_SESSION_PLAYER_OK/);
    }
  });
  assert.doesNotMatch(log, /PHP (?:Warning|Fatal error|Parse error)/);
});
