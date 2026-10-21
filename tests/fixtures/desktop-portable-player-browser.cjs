const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const [fixture, ...players] = process.argv.slice(2);
app.setPath('userData', path.join(fixture, 'browser-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const networkRequests = [];
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => { networkRequests.push(details.url); callback({ cancel: true }); }
  );
  for (const player of players) {
    const flow = JSON.parse(fs.readFileSync(path.join(path.dirname(player), 'flow.json'), 'utf8'));
    const win = new BrowserWindow({ show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    const js = source => win.webContents.executeJavaScript(source, true);
    async function until(source) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (await js(source)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${source}\n${errors.join('\n')}`);
    }
    await win.loadFile(player);
    await until("document.querySelector('#maxLabel').textContent === '2' && document.querySelector('#opener').naturalWidth === 1");
    assert.deepEqual(await js('window.PLAYER_BOOTSTRAP.flowData'), flow);
    assert.equal(await js("document.querySelector('#title').textContent"), flow.title);
    assert.equal(await js('document.title'), flow.title);
    assert.equal(await js('document.scripts.length'), 2);
    assert.equal(await js('globalThis.exportInjection'), undefined);
    await js("document.querySelector('#startBtn').click()");
    await until("document.querySelector('#playPauseBtn').textContent === 'Pause' && document.querySelector('#captionText b')?.textContent === 'First slide'");
    await until("[...document.querySelectorAll('img.layer-bg')].some(img => img.complete && img.naturalWidth === 1)");
    await js("document.querySelector('#playPauseBtn').click()");
    assert.equal(await js("document.querySelector('#playPauseBtn').textContent"), 'Resume');
    await js("document.querySelector('#playPauseBtn').click()");
    assert.equal(await js("document.querySelector('#playPauseBtn').textContent"), 'Pause');
    await js("document.querySelector('#nextBtn').click()");
    await until("document.querySelector('#posLabel').textContent === '2' && document.querySelector('#captionText i')?.textContent === 'Second slide'");
    await js("document.querySelector('#prevBtn').click()");
    await until("document.querySelector('#posLabel').textContent === '1' && document.querySelector('#captionText b') !== null");
    assert.deepEqual(errors, []);
    console.log(`PLAYBACK_OK ${JSON.stringify(flow.title)}: title, images, play, pause/resume, next/previous`);
    win.destroy();
  }
  assert.deepEqual(networkRequests, []);
  console.log(`DESKTOP_PORTABLE_PLAYBACK_OK count=${players.length} networkRequests=0`);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
