const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const { websiteFiles } = require('../tools/web-files.cjs');
const root = path.resolve(__dirname, '..');
const slash = value => value.replaceAll('\\', '/');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function request(port, url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url,
      method: options.method || 'GET',
      headers: { 'X-Forwarded-Proto': 'https', ...options.headers } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout'))); req.end();
  });
}

async function server(t, environment) {
  const apache = process.env.MOVEMENT_TEST_APACHE || 'C:/xampp/apache/bin/httpd.exe';
  if (!fs.existsSync(apache)) {
    t.skip('Set MOVEMENT_TEST_APACHE to a local Apache with PHP module');
    return null;
  }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-indexing-'));
  const documentRoot = path.join(parent, 'public');
  let child, stopped;
  t.after(async () => {
    if (child && child.exitCode === null) child.kill();
    if (stopped) await stopped;
    assert.equal(path.dirname(parent), path.resolve(os.tmpdir()));
    assert(path.basename(parent).startsWith('movement-indexing-'));
    fs.rmSync(parent, { recursive: true, force: true });
  });
  for (const file of websiteFiles(root)) write(documentRoot, file, fs.readFileSync(path.join(root, file)));
  write(parent, 'app-config.php', `<?php
$APP_ENVIRONMENT='${environment}'; $APP_HTTPS_ORIGIN='https://redhead-couple.org'; $APP_TRUST_PROXY=true;
$DB_PASS='SYNTHETIC_ONLY'; $ADMIN_USER='test'; $ADMIN_PASS='synthetic-password';`);
  // Conflicting process environment must not override the existing private config.
  write(parent, 'sessions/sess_indexowner', 'username|s:5:"owner";user_id|i:1;');
  for (const [name, published] of [['published', true], ['draft', false]]) {
    const flow = JSON.stringify({ schemaVersion: 2, isPublished: published,
      title: published ? 'Public slideshow' : 'PRIVATE_DRAFT', slides: [{ text: 'Fixture' }] });
    write(documentRoot, `private-data/slidedeck/owner/${name}/flow.json`, flow);
    write(documentRoot, `examples/${name}/flow.json`, flow);
  }
  write(documentRoot, 'private-data/slidedeck/owner/invalid/flow.json', '{invalid');
  write(documentRoot, 'examples/invalid/flow.json', '{invalid');
  write(documentRoot, 'private-data/slidedeck/owner/unsupported/flow.json', '{"schemaVersion":999,"isPublished":true,"slides":[]}');
  write(documentRoot, 'examples/published/backups/old.json', 'PRIVATE_BACKUP');
  write(documentRoot, 'concept/index.html', '<html><meta name="robots" content="noindex">STALE_CONCEPT</html>');
  write(documentRoot, 'tmp/preview.html', '<html>Temporary preview</html>');
  write(documentRoot, 'tmp/preview.php', '<?php echo "Temporary preview";');
  write(documentRoot, 'fail.php', '<?php require "server/core/web-session.php"; setWebPageDiscovery(true); http_response_code(500); echo webRobotsMeta();');
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const apacheRoot = slash(path.resolve(path.dirname(apache), '..'));
  const phpRoot = slash(path.resolve(apacheRoot, '../php'));
  write(parent, 'apache.conf', `ServerRoot "${apacheRoot}"
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
PidFile "${slash(parent)}/apache.pid"
ErrorLog "${slash(parent)}/error.log"
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule dir_module modules/mod_dir.so
LoadModule mime_module modules/mod_mime.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule headers_module modules/mod_headers.so
LoadModule php_module "${phpRoot}/php8apache2_4.dll"
PHPIniDir "${phpRoot}"
TypesConfig "${apacheRoot}/conf/mime.types"
DocumentRoot "${slash(documentRoot)}"
DirectoryIndex index.html index.php
<FilesMatch "\\.php$">
SetHandler application/x-httpd-php
</FilesMatch>
<Directory "${slash(documentRoot)}">
AllowOverride All
Require all granted
php_admin_value session.save_path "${slash(parent)}/sessions"
php_admin_flag opcache.enable Off
</Directory>
`);
  child = spawn(apache, ['-X', '-f', path.join(parent, 'apache.conf')], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, MOVEMENT_APP_ENV: environment === 'production' ? 'development' : 'production',
      PATH: phpRoot + path.delimiter + process.env.PATH },
  });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  stopped = once(child, 'close');
  for (let i = 0; i < 100; i++) {
    try { await request(port, '/'); return { port, parent }; }
    catch { if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  throw new Error('Apache failed to start: ' + errors);
}

function assertPolicy(response, indexable, html = true) {
  if (indexable) {
    assert.equal(response.status, 200);
    assert.equal(response.headers['x-robots-tag'], undefined);
    assert.doesNotMatch(response.body, /<meta[^>]+(?:robots|googlebot)[^>]*>/i);
  } else {
    assert.match(response.headers['x-robots-tag'] || '', /noindex/i);
    if (html) assert.match(response.body, /<meta name="robots" content="noindex, nofollow">/);
  }
  assert.doesNotMatch(response.body, /SYNTHETIC_ONLY|PRIVATE_BACKUP|Fatal error|Warning:/);
}

for (const environment of ['production', 'development']) {
  test(`${environment}: real Apache/PHP indexing and access responses`, async t => {
    const fixture = await server(t, environment);
    if (!fixture) return;
    const { port, parent } = fixture;
    const production = environment === 'production';
    await t.test('public pages and published players use the configured environment', async () => {
      for (const url of ['/', '/index.php', '/concept/', '/concept/index.html', '/concept/index.php',
        '/download.php', '/feed.php', '/feed.php?user=owner', '/privacy.php', '/terms.php',
        '/player.php?example=published', '/player.php?username=owner&project=published', '/slidedeck/owner/published/']) {
        const response = await request(port, url);
        assert.equal(response.status, 200, url); assertPolicy(response, production);
        assert.doesNotMatch(response.body, /STALE_CONCEPT/);
      }
      assertPolicy(await request(port, '/?APP_ENVIRONMENT=production&environment=production&index=1'), production);
      assertPolicy(await request(port, '/', { method: 'HEAD' }), production, false);
      assertPolicy(await request(port, '/', { method: 'POST' }), false);
    });
    await t.test('drafts, private previews, missing and invalid projects remain excluded', async () => {
      const owner = { headers: { Cookie: 'PHPSESSID=indexowner' } };
      for (const url of ['/player.php?username=owner&project=draft', '/slidedeck/owner/draft/']) {
        const denied = await request(port, url); assert.equal(denied.status, 404); assertPolicy(denied, false);
        assert.doesNotMatch(denied.body, /PRIVATE_DRAFT/);
        const preview = await request(port, url, owner); assert.equal(preview.status, 200); assertPolicy(preview, false);
      }
      assertPolicy(await request(port, '/player.php?example=draft'), false);
      for (const url of ['/player.php?example=missing', '/player.php?example=invalid',
        '/player.php?username=owner&project=missing', '/player.php?username=owner&project=invalid', '/404.php', '/not-found.php']) {
        const response = await request(port, url); assert.equal(response.status, 404, url); assertPolicy(response, false);
      }
      assertPolicy(await request(port, '/player.php?username=owner&project=invalid', owner), false);
      assertPolicy(await request(port, '/player.php?username=owner&project=unsupported'), false);
    });
    await t.test('authentication, editors, static previews and error responses stay excluded', async () => {
      for (const url of ['/login.php', '/signup.php', '/forgot-password.php', '/contact.php', '/effects/highlight-maker.html']) {
        const response = await request(port, url); assert.equal(response.status, 200, url); assertPolicy(response, false);
      }
      for (const url of ['/json-maker.php', '/edit/test/', '/dashboard.php', '/admin-messages.php',
        '/tmp/preview.html', '/tmp/preview.php', '/missing.html', '/server/core/web-session.php',
        '/private-data/slidedeck/owner/published/flow.json', '/media.php?p=owner/draft/flow.json',
        '/examples/published/backups/old.json']) assertPolicy(await request(port, url), false, false);
      const fail = await request(port, '/fail.php'); assert.equal(fail.status, 500); assertPolicy(fail, false);
      const robots = await request(port, '/robots.txt'); assert.equal(robots.status, 200);
      assert.match(robots.body, /Disallow:\s*$/); assert.doesNotMatch(robots.body, /Disallow:\s*\//);
      // Even early configuration errors must not be indexable.
      write(parent, 'app-config.php', '<?php invalid syntax');
      const configError = await request(port, '/'); assert.equal(configError.status, 500); assertPolicy(configError, false, false);
    });
  });
}

test('offline player export still defaults to noindex', () => {
  const result = spawnSync('php', ['-r', 'require "templates/player/player-page-template.php"; echo renderPlayerPage([]);'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<meta name="robots" content="noindex, nofollow">/);
});
