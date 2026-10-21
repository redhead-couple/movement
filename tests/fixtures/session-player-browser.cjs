const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const [fixture, oldSession] = process.argv.slice(2);
const url = process.env.SESSION_TEST_PLAYER_URL;
app.setPath('userData', path.join(fixture, 'browser-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.webContents.session.cookies.set({ url, name: 'PHPSESSID', value: oldSession, path: '/' });
  await win.loadURL(url);
  const js = source => win.webContents.executeJavaScript(source, true);
  async function until(source) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await js(source)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out: ' + source);
  }
  await until("document.querySelector('#captionText b')?.textContent === 'Public playback'");
  assert.ok(await js("[...document.querySelectorAll('img.layer-bg')].some(img => img.naturalWidth === 1)"));
  await js("document.querySelector('#startBtn').click()");
  await until("document.querySelector('#speech').currentTime > 0 && !document.querySelector('#speech').paused");
  await js("document.querySelector('#playPauseBtn').click()");
  assert.equal(await js("document.querySelector('#speech').paused"), true);
  console.log('PUBLIC_SESSION_PLAYER_OK');
  win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
