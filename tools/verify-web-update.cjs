const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { websiteFiles } = require('./web-files.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/website-update-alpha.8');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-web-update-'));
const unpacked = path.join(fixture, 'unpacked');
const documentRoot = path.join(fixture, 'public');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const slash = file => file.replaceAll('\\', '/');
let server, closed;
function run(exe, args, options = {}) { return execFileSync(exe, args, { cwd: root, windowsHide: true, ...options }); }
function write(file, bytes) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
function request(port, url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('HTTP timeout'))); req.end();
  });
}
(async () => {
  try {
    run('C:/Program Files/7-Zip/7z.exe', ['x', path.join(output, 'Movement-website-update-alpha.8.zip'), `-o${unpacked}`, '-y', '-bso0', '-bsp0']);
    const entries = [];
    const walk = (dir, prefix = '') => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name; if (entry.isDirectory()) walk(path.join(dir, entry.name), relative + '/'); else entries.push(relative);
    } };
    walk(unpacked); assert.deepEqual(entries.sort(), Object.keys(manifest.files).sort());
    for (const [file, meta] of Object.entries(manifest.files)) assert.equal(hash(fs.readFileSync(path.join(unpacked, file))), meta.sha256, file);
    // Reconstruct the pre-conversation tracked website, then apply only this
    // delta. This catches omitted dependencies hidden by a full current copy.
    const tracked = new Set(run('git', ['ls-tree', '-r', '--name-only', manifest.baselineCommit], { encoding: 'utf8' }).trim().split(/\r?\n/));
    for (const file of websiteFiles(root)) if (tracked.has(file)) write(path.join(documentRoot, file), run('git', ['show', `${manifest.baselineCommit}:${file}`]));
    fs.cpSync(unpacked, documentRoot, { recursive: true });
    for (const file of websiteFiles(root)) assert.ok(fs.readFileSync(path.join(documentRoot, file)).equals(fs.readFileSync(path.join(root, file))), 'Delta reconstructs current website: '+file);
    write(path.join(fixture, 'app-config.php'), '<?php $APP_ENVIRONMENT="development";');
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const apache = 'C:/xampp/apache/bin/httpd.exe', apacheRoot = 'C:/xampp/apache', phpRoot = 'C:/xampp/php';
    const config = `ServerRoot "${apacheRoot}"
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
PidFile "${slash(fixture)}/apache.pid"
ErrorLog "${slash(fixture)}/apache-error.log"
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
</Directory>
`;
    write(path.join(fixture, 'apache.conf'), config);
    server = spawn(apache, ['-X', '-f', path.join(fixture, 'apache.conf')], { windowsHide: true, stdio: 'ignore', env: { ...process.env, PATH: phpRoot+path.delimiter+process.env.PATH } });
    closed = once(server, 'close');
    let page;
    for (let i = 0; i < 80; i++) {
      try { page = await request(port, '/download.php'); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(page?.status, 200);
    const html = page.body.toString();
    assert.match(html, /Version 0\.1\.0-alpha\.8/); assert.doesNotMatch(html, /alpha\.2|releases\/download/);
    const links = [...html.matchAll(/href="(\/downloads\/[^\"]+)"/g)].map(match => match[1]);
    assert.equal(links.length, 5);
    for (const link of links) {
      const relative = decodeURIComponent(link.slice(1));
      assert.ok(manifest.files[relative], 'Download link belongs to update');
      const response = await request(port, link, 'HEAD');
      assert.equal(response.status, 200, link); assert.equal(Number(response.headers['content-length']), manifest.files[relative].bytes);
      if (/\.(zip|exe)$/.test(link)) {
        const range = await request(port, link, 'GET', { Range: 'bytes=0-63' });
        assert.equal(range.status, 206); assert.equal(range.body.length, 64);
        assert.ok(range.body.equals(fs.readFileSync(path.join(unpacked, relative)).subarray(0, 64)));
      } else {
        const body = await request(port, link); assert.equal(hash(body.body), manifest.files[relative].sha256);
      }
    }
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const browser = spawnSync(process.execPath, [path.join(root, 'tests/fixtures/download-page-browser.cjs'), `http://127.0.0.1:${port}/download.php`, output, fixture],
      { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(browser.status, 0, `${browser.error || ''}\n${browser.stdout}\n${browser.stderr}`);
    const report = { verifiedAt: new Date().toISOString(), version: manifest.version, baselineCommit: manifest.baselineCommit,
      archiveEntriesVerified: entries.length, reconstructedWebsiteMatchesSource: true, downloadLinksVerified: links,
      desktopHashesMatchPreviouslyVerifiedArtifacts: true, rangeDownloadsVerified: true, browser: browser.stdout.trim(), deployed: false };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (server) { if (server.exitCode === null) server.kill(); await closed; }
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('movement-web-update-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
