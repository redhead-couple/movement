const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');
const diagnostics = /\b(?:fatal error|warning|notice|deprecated|parse error)(?:<\/b>)?:|\b(?:stack trace:|uncaught (?:error|exception)|undefined constant)\b/i;
const privateMarkers = ['M06_PRIVATE_TITLE', 'M06_PRIVATE_DESCRIPTION', 'M06_PRIVATE_MEDIA', 'M06_CONFIG_SECRET'];

function request(port, requestPath, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1', port, path: requestPath,
      headers: cookie ? { Cookie: cookie } : {},
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('HTTP test request timed out')));
    req.on('error', reject);
  });
}

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('M06 actual PHP not-found routes', async t => {
  // Copy the real controllers/helpers, using only synthetic private data and
  // configuration. Never read or change the developer's projects or sessions.
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-m06-'));
  let child;
  let stopped;
  let serverLog = '';
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (stopped) await stopped;
    assert.equal(path.dirname(fixtureRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixtureRoot).startsWith('movement-m06-'));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });
  for (const file of [
    '404.php', 'not-found.php', 'router.php', 'player.php',
    'server/core/web-session.php', 'server/core/project-paths.php', 'server/core/response.php',
    'templates/player/player-page-template.php', 'studio/player/player-runtime.js', 'assets/app.css',
    'examples/what-this-project-is/flow.json',
  ]) {
    const destination = path.join(fixtureRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(applicationRoot, file), destination);
  }
  fs.writeFileSync(path.join(fixtureRoot, 'server/core/app-config.php'),
    "<?php\n$APP_ENVIRONMENT = 'development';\n$DB_PASS = 'M06_CONFIG_SECRET';\n");
  const sessions = path.join(fixtureRoot, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'sess_m06owner'), 'username|s:9:"m06-owner";');
  fs.writeFileSync(path.join(sessions, 'sess_m06other'), 'username|s:9:"m06-other";');
  for (const [project, published] of [['draft', false], ['published', true]]) {
    const folder = path.join(fixtureRoot, 'private-data/slidedeck/m06-owner', project);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'flow.json'), JSON.stringify({
      schemaVersion: 2, isPublished: published,
      title: published ? 'M06 Public Project' : privateMarkers[0],
      description: published ? 'Public description' : privateMarkers[1],
      slides: [{ text: published ? 'Public slide' : privateMarkers[2] }],
    }));
  }

  function assertSafe(body) {
    assert.doesNotMatch(body, diagnostics);
    for (const marker of privateMarkers) assert.equal(body.includes(marker), false, `Leaked ${marker}`);
    for (const root of [applicationRoot, fixtureRoot]) {
      assert.equal(body.includes(root), false, 'Leaked filesystem path');
      assert.equal(body.includes(root.replaceAll('\\', '/')), false, 'Leaked filesystem path');
    }
    assert.doesNotMatch(body, /private-data|ENVIRONMENT_NAME|PLAYER_BOOTSTRAP/);
  }
  function assertNotFound(response) {
    assert.equal(response.status, 404);
    assertSafe(response.body);
    assert.match(response.body, /<title>Page Not Found<\/title>/);
    assert.match(response.body, /<h1>Wrong turn\.<\/h1>/);
    assert.match(response.body, /<\/html>\s*$/);
  }

  const port = await reservePort();
  child = spawn('php', [
    '-d', 'display_errors=1', '-d', 'display_startup_errors=1', '-d', 'error_reporting=-1',
    '-d', 'log_errors=1', '-d', 'session.serialize_handler=php',
    '-d', `session.save_path=${sessions}`,
    '-S', `127.0.0.1:${port}`, '-t', fixtureRoot, 'router.php',
  ], { cwd: fixtureRoot, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let startupError;
  child.on('error', error => { startupError = error; });
  stopped = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', chunk => { serverLog += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`PHP exited: ${serverLog}`);
    try {
      assert.equal((await request(port, '/assets/app.css')).status, 200);
      ready = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  assert.ok(ready, `PHP server did not start: ${serverLog}`);

  await t.test('direct 404.php and not-found.php return complete safe HTTP 404 pages', async () => {
    for (const page of ['404.php', 'not-found.php']) {
      const response = await request(port, `/${page}?secret=M06_QUERY_SECRET`);
      t.diagnostic(`${page}: HTTP ${response.status}`);
      assertNotFound(response);
      assert.equal(response.body.includes('M06_QUERY_SECRET'), false);
    }
  });
  await t.test('missing public example returns HTTP 404', async () => {
    assertNotFound(await request(port, '/player.php?example=m06-missing-example'));
  });
  await t.test('private draft is hidden from guests and other users with HTTP 404', async () => {
    for (const cookie of [undefined, 'PHPSESSID=m06other']) {
      for (const route of [
        '/slidedeck/m06-owner/draft',
        '/player.php?username=m06-owner&project=draft',
      ]) assertNotFound(await request(port, route, cookie));
    }
    const draft = await request(port, '/player.php?username=m06-owner&project=draft');
    const missing = await request(port, '/player.php?username=m06-owner&project=missing');
    assert.equal(draft.body, missing.body, 'Draft existence must not change the error page');
  });
  await t.test('missing project returns HTTP 404 through clean and direct player routes', async () => {
    for (const route of [
      '/slidedeck/m06-owner/missing', '/slidedeck/m06-owner/missing/',
      '/player.php?username=m06-owner&project=missing', '/player.php',
    ]) assertNotFound(await request(port, route));
  });
  await t.test('legitimate example, published project, and owner draft still return HTTP 200', async () => {
    for (const [route, cookie] of [
      ['/player.php?example=what-this-project-is'],
      ['/slidedeck/m06-owner/published'],
      ['/slidedeck/m06-owner/draft', 'PHPSESSID=m06owner'],
    ]) {
      const response = await request(port, route, cookie);
      assert.equal(response.status, 200);
      assert.doesNotMatch(response.body, diagnostics);
      assert.match(response.body, /window\.PLAYER_BOOTSTRAP = /);
      assert.match(response.body, /<\/html>\s*$/);
    }
  });
  await t.test('both 404 entry points also execute cleanly in PHP CLI', () => {
    for (const page of ['404.php', 'not-found.php']) {
      const result = spawnSync('php', ['-d', 'display_errors=1', '-d', 'error_reporting=-1', page], {
        cwd: fixtureRoot, encoding: 'utf8', timeout: 10000, windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assertSafe(result.stdout);
      assert.match(result.stdout, /<title>Page Not Found<\/title>/);
      assert.match(result.stdout, /<\/html>\s*$/);
    }
  });
  await t.test('PHP server log contains no warnings, notices, or fatal errors', () => {
    assert.doesNotMatch(serverLog, diagnostics);
  });
});
