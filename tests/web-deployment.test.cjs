const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync, spawn } = require('node:child_process');
const test = require('node:test');
const { websiteFiles, forbidden } = require('../tools/web-files.cjs');
const { hash } = require('../tools/build-web.cjs');

const sourceRoot = path.resolve(__dirname, '..');
const uploadRoot = path.join(sourceRoot, 'dist/website/upload');
const manifestPath = path.join(sourceRoot, 'dist/website/manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
const slash = value => value.replaceAll('\\', '/');

function temporary(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-web-deploy-'));
  t.after(() => {
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('movement-web-deploy-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function write(root, relative, data) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data);
}

test('build contains exactly allowed website source, never configuration, data, or desktop entry pages', t => {
  if (!manifest) { t.skip('Run npm run web:build to verify generated website output'); return; }
  assert.deepEqual(Object.keys(manifest.files).sort(), websiteFiles(sourceRoot));
  const discovered = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative + '/');
      else discovered.push(relative);
    }
  }
  walk(uploadRoot);
  assert.deepEqual(discovered.sort(), Object.keys(manifest.files).sort());
  for (const [relative, meta] of Object.entries(manifest.files)) {
    assert.equal(forbidden(relative), false, relative);
    const packaged = fs.readFileSync(path.join(uploadRoot, relative));
    assert.equal(hash(packaged), meta.sha256, relative);
    assert.ok(packaged.equals(fs.readFileSync(path.join(sourceRoot, relative))), relative);
  }
  for (const absent of ['router.php', 'server/core/app-config.php', 'server/core/app-config.example.php', 'server/migrations',
    'private-data', 'examples', 'desktop', 'tools', 'tests', 'node_modules', 'package.json',
    'studio/editor/json-maker.html', 'studio/player/local-player.html', 'studio/authoring/registry-editor.html']) {
    assert.equal(fs.existsSync(path.join(uploadRoot, absent)), false, absent);
  }
});

test('static runtime resource URLs resolve to code assets or preserved examples', t => {
  if (!manifest) { t.skip('Run npm run web:build to verify generated website output'); return; }
  for (const relative of Object.keys(manifest.files).filter(p => /\.(php|html|css|js)$/.test(p))) {
    const source = fs.readFileSync(path.join(uploadRoot, relative), 'utf8');
    let base = new URL(relative, 'https://fixture.test/');
    const baseTag = source.match(/<base\s+href="([^"]+)"/i);
    if (baseTag) base = new URL(baseTag[1], base);
    const urls = [];
    if (/\.(php|html)$/.test(relative)) {
      for (const match of source.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) urls.push(match[1]);
    }
    if (relative.endsWith('.css')) {
      for (const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) urls.push(match[1]);
    }
    for (const value of urls) {
      if (/[<$\{]/.test(value) || /^(?:https?:|data:|#|%23)/.test(value)) continue;
      const resolved = new URL(value, base).pathname.slice(1);
      if (resolved.startsWith('examples/') || resolved === 'media.php') continue;
      assert.ok(fs.existsSync(path.join(uploadRoot, resolved)), `${relative}: missing ${resolved}`);
    }
  }
  for (const dir of ['effects', 'transitions']) {
    const registry = fs.readFileSync(path.join(uploadRoot, dir, 'registry.json'), 'utf8');
    for (const match of registry.matchAll(/"([^"\n]+\.(?:js|html))"/g)) {
      const relative = match[1].replace(/^\//, '');
      assert.ok(fs.existsSync(path.join(uploadRoot, relative.startsWith(dir + '/') ? relative : dir + '/' + relative)), relative);
    }
  }
});

function get(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on('error', reject); request.setTimeout(4000, () => request.destroy(new Error('HTTP timeout')));
  });
}

test('generated website runs under Apache/PHP with real access rules and synthetic preserved content', async t => {
  if (!manifest) { t.skip('Run npm run web:build to verify generated website output'); return; }
  const apache = process.env.MOVEMENT_TEST_APACHE || 'C:/xampp/apache/bin/httpd.exe';
  if (!fs.existsSync(apache)) { t.skip('Set MOVEMENT_TEST_APACHE to a local Apache with PHP module'); return; }
  const parent = temporary(t); const documentRoot = path.join(parent, 'public_html');
  fs.cpSync(uploadRoot, documentRoot, { recursive: true });
  write(parent, 'app-config.php', '<?php $APP_ENVIRONMENT="development"; $DB_PASS="SYNTHETIC_ONLY";');
  write(documentRoot, 'examples/test/flow.json', '{"schemaVersion":2,"title":"Example","slides":[]}');
  write(documentRoot, 'examples/test/img/image.txt', 'PUBLIC_EXAMPLE');
  write(documentRoot, 'examples/test/backups/old.json', 'PRIVATE_BACKUP');
  write(documentRoot, 'private-data/slidedeck/test/published/flow.json', '{"title":"Published","isPublished":true,"slides":[]}');
  write(documentRoot, 'private-data/slidedeck/test/draft/flow.json', '{"title":"PRIVATE_DRAFT","isPublished":false,"slides":[]}');
  // Fixture-only probe, never added to the deployment build.
  write(documentRoot, 'configuration-check.php', `<?php
require 'server/core/config-loader.php'; require 'server/core/project-paths.php';
echo json_encode([MOVEMENT_CONFIG_LOADED, $DB_PASS === 'SYNTHETIC_ONLY',
is_file(getProjectPaths('test', 'draft')['flowPath']), is_file(getExampleProjectPaths('test')['flowPath'])]);`);
  fs.mkdirSync(path.join(parent, 'sessions'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const apacheRoot = slash(path.resolve(path.dirname(apache), '..'));
  const phpRoot = slash(path.resolve(apacheRoot, '../php'));
  const config = `ServerRoot "${apacheRoot}"
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
PidFile "${slash(parent)}/apache.pid"
ErrorLog "${slash(parent)}/apache-error.log"
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule dir_module modules/mod_dir.so
LoadModule mime_module modules/mod_mime.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule php_module "${phpRoot}/php8apache2_4.dll"
PHPIniDir "${phpRoot}"
TypesConfig "${apacheRoot}/conf/mime.types"
DocumentRoot "${slash(documentRoot)}"
DirectoryIndex index.php index.html
<FilesMatch "\\.php$">
SetHandler application/x-httpd-php
</FilesMatch>
<Directory "${slash(documentRoot)}">
AllowOverride All
Require all granted
php_admin_value session.save_path "${slash(parent)}/sessions"
</Directory>
`;
  write(parent, 'apache.conf', config);
  const child = spawn(apache, ['-X', '-f', path.join(parent, 'apache.conf')], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PATH: phpRoot + path.delimiter + process.env.PATH },
  });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  const stopped = once(child, 'close');
  t.after(async () => { if (child.exitCode === null) child.kill(); await stopped; });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { await get(port, '/'); ready = true; break; }
    catch { if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, errors);
  assert.deepEqual(JSON.parse((await get(port, '/configuration-check.php')).body), [true, true, true, true]);
  for (const url of ['/', '/login.php', '/feed.php', '/player.php?example=test', '/slidedeck/test/published/', '/examples/test/img/image.txt']) {
    assert.equal((await get(port, url)).status, 200, url);
  }
  for (const url of ['/private-data/slidedeck/test/draft/flow.json', '/private-data/',
    '/server/core/config-loader.php', '/examples/test/backups/old.json', '/media.php?p=test/draft/flow.json']) {
    const response = await get(port, url);
    assert.equal(response.status, 403, url); assert.doesNotMatch(response.body, /PRIVATE_DRAFT|PRIVATE_BACKUP|SYNTHETIC_ONLY/);
  }
  assert.equal((await get(port, '/slidedeck/test/draft/')).status, 404);
  const editor = await get(port, '/edit/test/');
  assert.equal(editor.status, 302); assert.match(editor.headers.location, /login\.php/);
});
