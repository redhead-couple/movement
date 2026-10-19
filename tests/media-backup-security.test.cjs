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

const applicationRoot = path.resolve(__dirname, '..');
const ownerCookie = 'PHPSESSID=backupowner';
const otherCookie = 'PHPSESSID=backupother';
const backupBody = '{"title":"PRIVATE_BACKUP_CONTENT"}';
const assets = [
  ['img/photo.png', 'image/png', Buffer.from([137, 80, 78, 71, 13, 10, 0, 255])],
  ['img/צילום one.webp', 'image/webp', Buffer.from('WEBP fixture')],
  ['img/nested/backups-cover.jpg', 'image/jpeg', Buffer.from('nested image fixture')],
  ['speech/voice.mp3', 'audio/mpeg', Buffer.from('speech fixture')],
  ['audio/music.ogg', 'audio/ogg', Buffer.from('audio fixture')],
];

function request(port, requestPath, cookie, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers, ...(body ? {
        'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)
      } : {}) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode,
        headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Media test request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('real media controller keeps published-project backups private', async t => {
  // A separate document root and session store: never access real projects,
  // application configuration, database credentials, or user sessions.
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-media-backups-'));
  const documentRoot = path.join(fixtureRoot, 'public');
  const sessions = path.join(fixtureRoot, 'sessions');
  let child, stopped;
  let serverLog = '';
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (stopped) await stopped;
    assert.equal(path.dirname(fixtureRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixtureRoot).startsWith('movement-media-backups-'));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });
  function write(relative, contents) {
    const file = path.join(documentRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  for (const file of ['media.php', 'router.php', 'server/core/web-session.php',
    'server/core/config-loader.php', 'server/core/project-paths.php', 'publish-project.php',
    'server/core/app-init.php', 'server/core/auth-check.php', 'server/core/current-user.php',
    'server/core/current-user-record.php', 'server/core/security-helpers.php', 'server/core/response.php',
    'server/core/project-storage.php', 'server/core/storage-quota.php', '404.php', 'not-found.php']) {
    write(file, fs.readFileSync(path.join(applicationRoot, file)));
  }
  write('server/core/app-config.php', "<?php $APP_ENVIRONMENT = 'development';");
  write('cache-probe.html', '<!doctype html><title>Isolated cache test</title>');
  write('publish-token.php', "<?php require 'server/core/security-helpers.php'; echo ensureFormGuard('publish_project')['token'];");
  fs.mkdirSync(sessions);
  write('server/core/db.php', databaseSource({ 1: 'owner', 2: 'other' }));
  fs.writeFileSync(path.join(sessions, 'sess_backupowner'), sessionData('owner', 1));
  fs.writeFileSync(path.join(sessions, 'sess_backupother'), sessionData('other', 2));
  for (const project of ['published', 'draft']) {
    const base = `private-data/slidedeck/owner/${project}/`;
    write(base + 'flow.json', JSON.stringify({ isPublished: project === 'published', slides: [] }));
    write(base + 'backups/flow-old.json', backupBody);
    write(base + 'backups/nested/flow-older.json', backupBody);
    for (const [name, , body] of assets) write(base + name, body);
  }

  const port = await reservePort();
  child = spawn('php', ['-d', 'display_errors=1', '-d', 'log_errors=1',
    '-d', 'session.serialize_handler=php', '-d', `session.save_path=${sessions}`,
    '-S', `127.0.0.1:${port}`, '-t', documentRoot, 'router.php'],
  { cwd: documentRoot, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let startupError;
  child.on('error', error => { startupError = error; });
  stopped = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', chunk => { serverLog += chunk; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(serverLog);
    try {
      const response = await request(port, '/media.php');
      assert.equal(response.status, 400);
      ready = true;
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  assert.ok(ready, serverLog);
  const mediaUrl = value => '/media.php?p=' + encodeURIComponent(value);
  const backupPaths = ['backups/flow-old.json', '/backups/flow-old.json',
    '//backups//flow-old.json', './backups/flow-old.json', 'backups/./flow-old.json',
    'backups/nested/flow-older.json'];
  if (process.platform === 'win32') {
    backupPaths.push('backups\\flow-old.json', '\\backups\\flow-old.json',
      'BACKUPS/flow-old.json', 'BaCkUpS\\nested\\flow-older.json', 'backups./flow-old.json');
  }

  await t.test('guests and other accounts cannot read backups through filesystem path aliases', async () => {
    for (const project of ['published', 'draft']) {
      for (const cookie of [undefined, otherCookie]) {
        for (const name of backupPaths) {
          const response = await request(port, mediaUrl(`owner/${project}/${name}`), cookie);
          assert.equal(response.status, 403, `${project}/${name}`);
          assert.equal(response.body.toString(), 'Backups are private.');
          assert.doesNotMatch(response.headers['cache-control'] || '', /public/);
        }
      }
    }
  });
  await t.test('the owner can still download exact backup contents in published and draft projects', async () => {
    for (const project of ['published', 'draft']) {
      for (const name of backupPaths) {
        const response = await request(port, mediaUrl(`owner/${project}/${name}`), ownerCookie);
        assert.equal(response.status, 200, `${project}/${name}`);
        assert.equal(response.body.toString(), backupBody);
        assert.match(response.headers['content-type'], /^application\/json/);
        assert.equal(Number(response.headers['content-length']), Buffer.byteLength(backupBody));
        assert.match(response.headers['cache-control'], /^private,/);
      }
    }
  });
  await t.test('published media retains bytes, MIME types and lengths without reusable cached responses', async () => {
    for (const cookie of [undefined, otherCookie, ownerCookie]) {
      for (const [name, mime, body] of assets) {
        const response = await request(port, mediaUrl('owner/published/' + name), cookie);
        assert.equal(response.status, 200, name);
        assert.deepEqual(response.body, body);
        assert.equal(response.headers['content-type'], mime);
        assert.equal(Number(response.headers['content-length']), body.length);
        assert.equal(response.headers['cache-control'], 'private, no-store, max-age=0, must-revalidate');
        assert.equal(response.headers.pragma, 'no-cache');
        assert.equal(response.headers.expires, '0');
      }
      const flow = await request(port, mediaUrl('owner/published/flow.json'), cookie);
      assert.equal(flow.status, 200);
      assert.equal(JSON.parse(flow.body).isPublished, true);
    }
  });
  await t.test('draft media and flow remain owner-only', async () => {
    for (const name of ['flow.json', ...assets.map(asset => asset[0])]) {
      assert.equal((await request(port, mediaUrl('owner/draft/' + name), ownerCookie)).status, 200);
      for (const cookie of [undefined, otherCookie]) {
        assert.equal((await request(port, mediaUrl('owner/draft/' + name), cookie)).status, 403);
      }
    }
  });
  await t.test('friendly routes preserve normal media access and enforce the same backup policy', async () => {
    const response = await request(port, '/slidedeck/owner/published/img/photo.png');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, assets[0][2]);
    for (const suffix of ['backups/flow-old.json', '/backups/flow-old.json']) {
      const url = '/slidedeck/owner/published/' + suffix;
      for (const cookie of [undefined, otherCookie]) assert.equal((await request(port, url, cookie)).status, 403);
      assert.equal((await request(port, url, ownerCookie)).body.toString(), backupBody);
    }
  });
  await t.test('unpublishing denies subsequent media requests and republishing restores access without caching errors', async () => {
    const token = (await request(port, '/publish-token.php', ownerCookie)).body.toString();
    const toggle = () => request(port, '/publish-project.php', ownerCookie, {
      body: new URLSearchParams({ project: 'published', form_token: token, website: '' }).toString()
    });
    const paths = ['flow.json', ...assets.map(asset => asset[0])];
    // All filenames use the canonical controller URL. Exercise friendly URLs
    // with ASCII filenames; the development router does not decode asset paths.
    const urls = paths.flatMap(name => [mediaUrl('owner/published/' + name),
      ...(/^[A-Za-z0-9_./-]+$/.test(name) ? ['/slidedeck/owner/published/' + name] : [])]);
    for (const url of urls) {
      const response = await request(port, url);
      assert.equal(response.status, 200, url); assert.match(response.headers['cache-control'], /no-store/);
    }
    assert.equal((await toggle()).status, 302);
    try {
      for (const url of urls) {
        for (const cookie of [undefined, otherCookie]) {
          const denied = await request(port, url, cookie, { headers: {
            'If-None-Match': '*', 'If-Modified-Since': 'Wed, 01 Jan 2031 00:00:00 GMT'
          } });
          assert.equal(denied.status, 403, url);
          assert.match(denied.headers['cache-control'], /no-store/);
          assert.equal(denied.body.toString(), 'Project is not published.');
        }
        const owner = await request(port, url, ownerCookie);
        assert.equal(owner.status, 200); assert.match(owner.headers['cache-control'], /no-store/);
      }
      for (const [name, , contents] of assets) {
        assert.deepEqual((await request(port, mediaUrl('owner/published/' + name), ownerCookie)).body, contents);
      }
      assert.equal((await request(port, mediaUrl('owner/published/backups/flow-old.json'), ownerCookie)).body.toString(), backupBody);
    } finally { assert.equal((await toggle()).status, 302); }
    for (const url of urls) {
      assert.equal((await request(port, url)).status, 200);
      assert.equal((await request(port, url, otherCookie)).status, 200);
    }
  });
  await t.test('Chromium with normal caching cannot reuse public media after unpublishing', {
    skip: process.env.MOVEMENT_TEST_CACHE_BROWSER !== '1'
  }, () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/media-cache-browser.cjs'),
      fixtureRoot, `http://127.0.0.1:${port}`], { windowsHide: true, encoding: 'utf8', env, timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /MEDIA_CACHE_REVOCATION_OK/);
  });
  await t.test('missing files, forbidden types, traversal and direct storage stay rejected', async () => {
    for (const [url, status] of [
      [mediaUrl('owner/published/img/missing.png'), 404],
      [mediaUrl('owner/published/backups/missing.json'), 404],
      [mediaUrl('owner/published/backups/file.php'), 403],
      [mediaUrl('owner/published/img/../backups/flow-old.json'), 403],
      ['/private-data/slidedeck/owner/published/backups/flow-old.json', 403],
    ]) {
      const response = await request(port, url);
      assert.equal(response.status, status, url);
      if (url.startsWith('/media.php')) assert.match(response.headers['cache-control'], /no-store/);
    }
  });
  assert.doesNotMatch(serverLog, /PHP (?:Warning|Fatal error|Parse error)/);
});
