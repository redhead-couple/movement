const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const [fixture, origin] = process.argv.slice(2);
app.setPath('userData', path.join(fixture, 'cache-browser-profile'));
app.disableHardwareAcceleration();

function ownerRequest(route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + route, { method: body ? 'POST' : 'GET', headers: {
      Cookie: 'PHPSESSID=backupowner', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body) } : {})
    } }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}

app.whenReady().then(async () => {
  const viewers = [];
  for (const [role, cookie] of [['guest', null], ['other', 'backupother'], ['owner', 'backupowner']]) {
    const win = new BrowserWindow({ show: false, webPreferences: {
      partition: 'cache-review-' + role, nodeIntegration: false, contextIsolation: true, sandbox: true
    } });
    if (cookie) await win.webContents.session.cookies.set({ url: origin, name: 'PHPSESSID', value: cookie, path: '/' });
    await win.loadURL(origin + '/cache-probe.html');
    viewers.push({ role, win });
  }
  const paths = ['flow.json', 'img/photo.png', 'speech/voice.mp3', 'audio/music.ogg'];
  const urls = paths.flatMap(name => ['/media.php?p=owner/published/' + name,
    '/slidedeck/owner/published/' + name]);
  async function read(viewer) {
    // Deliberately use default browser caching: no cache-busting query, reload,
    // clearCache(), disabled-cache setting or fetch cache override.
    return viewer.win.webContents.executeJavaScript(`Promise.all(${JSON.stringify(urls)}.map(async url => {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {status:response.status, cache:response.headers.get('cache-control'),
        data:btoa(String.fromCharCode(...bytes))};
    }))`);
  }
  const before = new Map();
  for (const viewer of viewers) {
    const responses = await read(viewer); before.set(viewer.role, responses);
    for (const response of responses) {
      assert.equal(response.status, 200); assert.match(response.cache, /no-store/);
    }
  }
  const token = (await ownerRequest('/publish-token.php')).body;
  const toggle = () => ownerRequest('/publish-project.php',
    new URLSearchParams({ project: 'published', form_token: token, website: '' }).toString());
  assert.equal((await toggle()).status, 302);
  try {
    for (const viewer of viewers) {
      const responses = await read(viewer);
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        assert.match(response.cache, /no-store/);
        assert.equal(response.status, viewer.role === 'owner' ? 200 : 403, viewer.role + ' ' + urls[i]);
        if (viewer.role === 'owner') {
          if (urls[i].endsWith('flow.json')) assert.equal(JSON.parse(Buffer.from(response.data, 'base64')).isPublished, false);
          else assert.equal(response.data, before.get('owner')[i].data);
        }
      }
    }
  } finally { assert.equal((await toggle()).status, 302); }
  for (const viewer of viewers) {
    const responses = await read(viewer);
    for (const response of responses) assert.equal(response.status, 200, viewer.role);
    viewer.win.destroy();
  }
  console.log('MEDIA_CACHE_REVOCATION_OK'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
