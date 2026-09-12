const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');
const webSessionPath = path.join(applicationRoot, 'server', 'core', 'web-session.php');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, requestPath = '/', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      headers,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
  });
}

async function startPhpServer(environment, options = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-web-session-'));
  const documentRoot = options.applicationRoot ? applicationRoot : temporaryRoot;
  if (!options.applicationRoot) {
    const phpPath = webSessionPath.replaceAll('\\', '/').replaceAll("'", "\\'");
    fs.writeFileSync(path.join(documentRoot, 'index.php'), `<?php
require_once '${phpPath}';
startWebSession();
$isLogout = ($_GET['action'] ?? '') === 'logout';
if ($isLogout) {
    destroyWebSession();
}
header('Content-Type: application/json');
echo json_encode(['session' => session_name(), 'logout' => $isLogout]);
`);
  }
  const sessionPath = path.join(temporaryRoot, 'sessions');
  fs.mkdirSync(sessionPath);

  const port = await reservePort();
  const child = spawn('php', [
    '-d', `session.save_path=${sessionPath}`,
    '-S', `127.0.0.1:${port}`,
    '-t', documentRoot,
  ], {
    cwd: applicationRoot,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`PHP test server exited early (${child.exitCode}): ${errors}`);
    }
    try {
      await request(port);
      return {
        port,
        stop() {
          child.kill();
          fs.rmSync(temporaryRoot, { recursive: true, force: true });
        },
      };
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  child.kill();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  throw new Error(`PHP test server did not become ready: ${errors}`);
}

function cookieHeaders(response) {
  return response.headers['set-cookie'] ?? [];
}

test('production HTTP redirects to the configured canonical HTTPS origin', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'production',
    MOVEMENT_HTTPS_ORIGIN: 'https://redhead-couple.org',
    MOVEMENT_TRUST_PROXY: '1',
  });
  t.after(() => server.stop());

  const response = await request(server.port, '/?return=%2Fdashboard.php');
  assert.equal(response.statusCode, 308);
  assert.equal(
    response.headers.location,
    'https://redhead-couple.org/?return=%2Fdashboard.php'
  );
  assert.deepEqual(cookieHeaders(response), []);
});

test('production HTTPS session cookies are Secure, HttpOnly, and SameSite=Lax without a loop', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'production',
    MOVEMENT_HTTPS_ORIGIN: 'https://redhead-couple.org',
    MOVEMENT_TRUST_PROXY: '1',
  });
  t.after(() => server.stop());

  const response = await request(server.port, '/', { 'X-Forwarded-Proto': 'https' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.location, undefined);
  const sessionCookie = cookieHeaders(response).find(value => value.startsWith('PHPSESSID='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /; path=\//i);
  assert.match(sessionCookie, /; secure/i);
  assert.match(sessionCookie, /; HttpOnly/i);
  assert.match(sessionCookie, /; SameSite=Lax/i);
});

test('an untrusted X-Forwarded-Proto header cannot bypass the production redirect', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'production',
    MOVEMENT_HTTPS_ORIGIN: 'https://redhead-couple.org',
    MOVEMENT_TRUST_PROXY: '0',
  });
  t.after(() => server.stop());

  const response = await request(server.port, '/', { 'X-Forwarded-Proto': 'https' });
  assert.equal(response.statusCode, 308);
  assert.equal(response.headers.location, 'https://redhead-couple.org/');
  assert.deepEqual(cookieHeaders(response), []);
});

test('local HTTP sessions remain usable and do not force a localhost HTTPS redirect', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'development',
    MOVEMENT_HTTPS_ORIGIN: '',
    MOVEMENT_TRUST_PROXY: '0',
  });
  t.after(() => server.stop());

  const response = await request(server.port, '/');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.location, undefined);
  const sessionCookie = cookieHeaders(response).find(value => value.startsWith('PHPSESSID='));
  assert.ok(sessionCookie);
  assert.doesNotMatch(sessionCookie, /; secure/i);
  assert.match(sessionCookie, /; HttpOnly/i);
  assert.match(sessionCookie, /; SameSite=Lax/i);
});

test('logout expires the session cookie with matching production attributes', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'production',
    MOVEMENT_HTTPS_ORIGIN: 'https://redhead-couple.org',
    MOVEMENT_TRUST_PROXY: '1',
  });
  t.after(() => server.stop());

  const response = await request(server.port, '/?action=logout', { 'X-Forwarded-Proto': 'https' });
  assert.equal(response.statusCode, 200);
  const deletionCookie = cookieHeaders(response).find(value =>
    value.startsWith('PHPSESSID=') && /Max-Age=0/i.test(value)
  );
  assert.ok(deletionCookie, JSON.stringify({ cookies: cookieHeaders(response), body: response.body }));
  assert.match(deletionCookie, /; path=\//i);
  assert.match(deletionCookie, /; secure/i);
  assert.match(deletionCookie, /; HttpOnly/i);
  assert.match(deletionCookie, /; SameSite=Lax/i);
});

test('all PHP session starts and session destruction use the shared boundary', () => {
  const phpFiles = [];
  const pending = [applicationRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'private-data', 'node_modules', 'dist', 'tmp'].includes(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      if (entry.isFile() && entry.name.endsWith('.php')) phpFiles.push(fullPath);
    }
  }

  for (const phpFile of phpFiles) {
    if (phpFile === webSessionPath) continue;
    const source = fs.readFileSync(phpFile, 'utf8');
    assert.doesNotMatch(source, /\bsession_start\s*\(/, path.relative(applicationRoot, phpFile));
    assert.doesNotMatch(source, /\bsession_destroy\s*\(/, path.relative(applicationRoot, phpFile));
  }
});

test('the real local PHP entry points remain usable over HTTP', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'development',
    MOVEMENT_HTTPS_ORIGIN: '',
    MOVEMENT_TRUST_PROXY: '0',
  }, { applicationRoot: true });
  t.after(() => server.stop());

  for (const requestPath of [
    '/index.php',
    '/login.php',
    '/signup.php',
    '/feed.php',
    '/player.php?example=about',
  ]) {
    const response = await request(server.port, requestPath);
    assert.equal(response.statusCode, 200, requestPath);
    assert.equal(response.headers.location, undefined, requestPath);
  }
});

test('representative real production PHP entry points redirect before application work', async t => {
  const server = await startPhpServer({
    MOVEMENT_APP_ENV: 'production',
    MOVEMENT_HTTPS_ORIGIN: 'https://redhead-couple.org',
    MOVEMENT_TRUST_PROXY: '1',
  }, { applicationRoot: true });
  t.after(() => server.stop());

  for (const requestPath of [
    '/index.php',
    '/login.php',
    '/signup.php',
    '/dashboard.php',
    '/player.php?example=about',
  ]) {
    const response = await request(server.port, requestPath);
    assert.equal(response.statusCode, 308, requestPath);
    assert.equal(response.headers.location, `https://redhead-couple.org${requestPath}`);
    assert.deepEqual(cookieHeaders(response), [], requestPath);
  }
});
