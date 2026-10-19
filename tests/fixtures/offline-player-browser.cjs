// Invoked by offline-player-security.test.cjs with MOVEMENT_TEST_OFFLINE_BROWSER=1.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const [player, fixture] = process.argv.slice(2);
app.setPath('userData', path.join(fixture, 'browser-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 700,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: false } });
  const errors = [];
  const failedRequests = [];
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  win.webContents.session.webRequest.onErrorOccurred(details => failedRequests.push(details.url));
  const js = source => win.webContents.executeJavaScript(source, true);
  async function until(source) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await js(source)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${source}\n${errors.join('\n')}`);
  }
  await win.loadFile(player);
  await until("document.querySelector('#maxLabel').textContent === '2' && document.querySelector('#captionText b') !== null");
  const flow = JSON.parse(fs.readFileSync(path.join(path.dirname(player), 'flow.json'), 'utf8'));
  assert.deepEqual(await js('window.PLAYER_BOOTSTRAP.flowData'), flow);
  assert.equal(await js('globalThis.exportInjection'), undefined);
  assert.equal(await js('document.scripts.length'), 2);
  assert.equal(await js("document.querySelector('#title').textContent"), flow.title);
  assert.equal(await js("document.querySelector('#opener').naturalWidth"), 1);
  await until("[...document.querySelectorAll('canvas.layer-bg')].some(c => c.width > 0 && c.getContext('2d').getImageData(0, 0, 1, 1).data[3] > 0)");
  await js("document.querySelector('#startBtn').click()");
  await until("document.querySelector('#speech').currentTime > 0 && !document.querySelector('#speech').paused");
  assert.equal(await js("document.querySelector('#playPauseBtn').textContent"), 'Pause');
  await js("document.querySelector('#playPauseBtn').click()");
  assert.equal(await js("document.querySelector('#speech').paused"), true);
  assert.equal(await js("document.querySelector('#playPauseBtn').textContent"), 'Resume');
  await js("document.querySelector('#playPauseBtn').click()");
  await until("!document.querySelector('#speech').paused");
  // Finishing the audio exercises automatic advance and the inline transition.
  await js("document.querySelector('#speech').currentTime = 29.9");
  await until("document.querySelector('#posLabel').textContent === '2' && document.querySelector('#captionText i')?.textContent === 'שקופית שנייה'");
  await until("document.querySelector('#speech').src.endsWith('/audio/music.wav') && document.querySelector('#speech').currentTime > 0");
  assert.ok(await js("[...document.querySelectorAll('img.layer-bg')].some(img => img.complete && img.naturalWidth === 1)"));
  await js("document.querySelector('#prevBtn').click()");
  await until("document.querySelector('#posLabel').textContent === '1' && document.querySelector('#captionText b') !== null");
  await js("document.querySelector('#nextBtn').click()");
  await until("document.querySelector('#posLabel').textContent === '2' && document.querySelector('#captionText i') !== null");
  assert.equal(await js('globalThis.exportInjection'), undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  console.log('OFFLINE_BROWSER_OK: data, script isolation, image, effect paint, audio, pause/resume, next/previous');
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
