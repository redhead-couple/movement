const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, session } = require('electron');
const [fixture, url] = process.argv.slice(2);
assert.match(path.basename(fixture), /^movement-media-lock-/);
app.setPath('userData', path.join(fixture, 'trash-browser-profile'));
app.disableHardwareAcceleration();
const js = (win, code) => win.webContents.executeJavaScript(code, true);
async function until(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for media page.');
}
(async () => {
  await app.whenReady();
  await session.defaultSession.cookies.set({ url, name: 'PHPSESSID', value: 'locksecond' });
  // Render in an offscreen window without taking over the user's browser.
  const win = new BrowserWindow({ show: false, width: 1200, height: 1000,
    webPreferences: { offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true } });
  await win.loadURL(url);
  assert.equal(await js(win, "document.querySelector('[name=saved_and_closed]')"), null);
  for (const [type, prefix, label] of [['img', 'unusedImages', 'image'], ['audio', 'unusedAudio', 'audio file'], ['speech', 'unusedSpeech', 'speech file']]) {
    const form = `document.querySelector('[data-cleanup-type="${type}"]')`;
    assert.equal(await js(win, `${form}.checkValidity()`), true);
    assert.equal(await js(win, `Boolean(${form}.previousElementSibling && ${form}.previousElementSibling.classList.contains('file-items'))`), true, type + ' button must follow its file list');
    await js(win, `${form}.querySelector('button').click()`);
    assert.equal(await js(win, `document.querySelector('#${prefix}Confirmation').open`), true);
    assert.equal(await js(win, `document.querySelector('#${prefix}Question').textContent`), `Delete 1 unused ${label}?`);
    assert.equal(await js(win, `document.querySelector('#${prefix}Recovery').textContent`), 'You can restore them from Trash.');
    assert.equal(await js(win, 'document.activeElement.textContent'), 'Cancel');
    await js(win, `document.querySelector('#${prefix}Confirmation button[type=submit]').click()`);
    assert.equal(await js(win, `document.querySelector('#${prefix}Confirmation').open`), false);
    assert.equal(await js(win, "document.querySelectorAll('[name=trash_id]').length"), 0);
    await js(win, `${form}.querySelector('button').click(); document.querySelector('[data-confirm-cleanup="${type}"]').click()`);
    await until(() => js(win, "document.querySelector('#openMediaTrash')?.dataset.trashCount === '1'"));
    assert.equal(await js(win, "document.querySelectorAll('[name=trash_id]').length"), 0);
    assert.equal(await js(win, `${form}.querySelector('button').disabled`), true);
    assert.equal(await js(win, "document.querySelector('#openMediaTrash .media-trash-card__count').textContent"), '1 file');
    assert.equal(await js(win, "document.querySelector('#openMediaTrash .media-trash-card__description').textContent"), 'Restore deleted files or empty the trash.');
    if (type === 'img' && process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR) {
      await new Promise(resolve => setTimeout(resolve, 250));
      fs.writeFileSync(path.join(process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR, 'online-media-trash-card.png'), (await win.webContents.capturePage()).toPNG());
    }
    await js(win, "document.querySelector('#openMediaTrash').click()");
    await until(() => js(win, `document.querySelectorAll('[data-trash-type="${type}"] [name=trash_id]').length === 1`));
    assert.equal(await js(win, "document.querySelectorAll('[data-cleanup-type]').length"), 0);
    if (type === 'img') {
      await until(() => js(win, "document.querySelector('.media-trash-thumbnail img')?.naturalWidth > 0"));
      await js(win, "document.querySelector('.media-trash-thumbnail').click()");
      await until(() => js(win, "document.querySelector('.media-trash-image-dialog')?.open && document.querySelector('.media-trash-image-dialog img').naturalWidth > 0"));
      await js(win, "document.querySelector('.media-trash-preview-close').click()");
      assert.equal(await js(win, "document.querySelector('.media-trash-image-dialog').open"), false);
    } else {
      await until(() => js(win, "document.querySelector('.media-trash-preview audio')?.readyState >= 1"));
      assert.equal(await js(win, "Number.isFinite(document.querySelector('.media-trash-preview audio').duration)"), true);
      await js(win, "document.querySelector('.media-trash-preview audio').play()");
      await until(() => js(win, "document.querySelector('.media-trash-preview audio').currentTime > 0.05"));
      await js(win, "{ const track = document.querySelector('.media-trash-preview audio'); track.currentTime = track.duration / 2; }");
      await until(() => js(win, "!document.querySelector('.media-trash-preview audio').seeking"));
    }
    await js(win, `document.querySelector('[data-trash-type="${type}"] button[type=submit]').click()`);
    await until(() => js(win, "document.querySelectorAll('[name=trash_id]').length === 0 && document.body.textContent.includes('File restored to the media library.')"));
    await js(win, "document.querySelector('#backToProjectMedia').click()");
    await until(() => js(win, "Boolean(document.querySelector('#openMediaTrash'))"));
  }
  await until(() => js(win, "[...document.querySelectorAll('img.thumb-preview')].every(img => img.complete && img.naturalWidth > 0)"));
  // The restored unused files can be moved again, then emptied together.
  for (const [type, prefix] of [['img', 'unusedImages'], ['audio', 'unusedAudio'], ['speech', 'unusedSpeech']]) {
    await js(win, `document.querySelector('[data-cleanup-type="${type}"] button').click(); document.querySelector('[data-confirm-cleanup="${type}"]').click()`);
    await until(() => js(win, `document.querySelector('[data-cleanup-type="${type}"] button')?.disabled`));
  }
  await js(win, "document.querySelector('#openMediaTrash').click()");
  await until(() => js(win, "document.querySelectorAll('[name=trash_id]').length === 3"));
  await until(() => js(win, "[...document.querySelectorAll('.media-trash-preview audio')].length === 2 && [...document.querySelectorAll('.media-trash-preview audio')].every(a => a.readyState >= 1)"));
  await js(win, "document.querySelectorAll('.media-trash-preview audio')[0].play()");
  await js(win, "document.querySelectorAll('.media-trash-preview audio')[1].play()");
  await until(() => js(win, "document.querySelectorAll('.media-trash-preview audio')[0].paused && !document.querySelectorAll('.media-trash-preview audio')[1].paused"));
  await new Promise(resolve => setTimeout(resolve, 250));
  if (process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR) fs.writeFileSync(path.join(process.env.MOVEMENT_MEDIA_TRASH_SCREENSHOT_DIR, 'online-media-trash.png'), (await win.webContents.capturePage()).toPNG());
  await js(win, "document.querySelector('#emptyMediaTrashForm button').click()");
  assert.equal(await js(win, "document.querySelector('#emptyMediaTrashQuestion').textContent"), 'Permanently delete 3 files from Media Trash?');
  assert.equal(await js(win, "document.querySelector('#emptyMediaTrashWarning').textContent"), 'This cannot be undone.');
  assert.equal(await js(win, 'document.activeElement.textContent'), 'Cancel');
  await js(win, "document.querySelector('#emptyMediaTrashConfirmation button[type=submit]').click()");
  assert.equal(await js(win, "document.querySelectorAll('[name=trash_id]').length"), 3);
  await js(win, "document.querySelector('#emptyMediaTrashForm button').click(); document.querySelector('#confirmEmptyMediaTrash').click()");
  await until(() => js(win, "document.querySelectorAll('[name=trash_id]').length === 0 && document.body.textContent.includes('Permanently deleted 3 files.')"));
  assert.equal(await js(win, "document.querySelector('#emptyMediaTrashForm button').disabled"), true);
  await js(win, "document.querySelector('#backToProjectMedia').click()");
  await until(() => js(win, "document.querySelector('#openMediaTrash')?.dataset.trashCount === '0'"));
  assert.equal(await js(win, "document.querySelector('#openMediaTrash .media-trash-card__description').textContent.includes('Trash is empty.')"), true);
  assert.equal(await js(win, "document.querySelector('#openMediaTrash').classList.contains('has-files')"), false);
  console.log('MEDIA_TRASH_WEB_BROWSER_OK all three types, buttons after lists, counts, cancel, confirmation, restore');
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
