const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const test = require('node:test');
const vm = require('node:vm');
const { createComponentExportService } = require('../desktop/services/component-export-service.cjs');

const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-component-export-'));
  const files = ['desktop/component-export-reviews.json', 'LICENSE',
    'effects/registry.json', 'effects/ripple-maker.html', 'effects/ripple-engine.js',
    'effects/effect-media.js', 'studio/maker/maker-engine.js', 'studio/maker/maker-theme.css',
    'transitions/registry.json', 'transitions/alternating-panels-maker.html',
    'transitions/alternating-panels-engine.js'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^movement-component-export-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, service: createComponentExportService({ applicationRoot: directory }) };
}

// Read the ZIP records independently of the service/writer, verifying CRCs and central records.
function readZip(filename) {
  const bytes = fs.readFileSync(filename);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  let cursor = bytes.readUInt32LE(end + 16);
  const files = new Map();
  const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    assert.equal(bytes.readUInt16LE(cursor + 10), 0);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const offset = bytes.readUInt32LE(cursor + 42);
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    const data = bytes.subarray(start, start + size);
    assert.equal(zlib.crc32(data), bytes.readUInt32LE(cursor + 16));
    assert.ok(!files.has(name));
    files.set(name, data);
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  return files;
}

for (const [type, id, name] of [['effects', 'ripple', 'Ripple'], ['transitions', 'alternating-panels', 'Alternating Panels']]) {
  test(`${id}: exports exactly four files with original bytes and explicit host/license metadata`, t => {
    const { directory, service } = fixture(t);
    const registryBefore = fs.readFileSync(path.join(directory, type, 'registry.json'));
    const destinationPath = path.join(directory, `${id}.component.zip`);
    assert.equal(service.eligibility(type, id).eligible, true);
    const result = service.exportComponent({ type, id, destinationPath });
    assert.equal(result.cancelled, false);
    const files = readZip(destinationPath);
    assert.deepEqual([...files.keys()], ['component.json', 'LICENSE', `${type}/${id}-maker.html`, `${type}/${id}-engine.js`]);
    for (const file of [...files.keys()].filter(file => file !== 'component.json')) {
      assert.deepEqual(files.get(file), fs.readFileSync(path.join(directory, file)));
    }
    assert.deepEqual(JSON.parse(files.get('component.json')), {
      formatVersion: 1, type: type === 'effects' ? 'effect' : 'transition', id, name,
      maker: `${type}/${id}-maker.html`, engine: `${type}/${id}-engine.js`,
      requires: {
        hostContract: type === 'effects' ? 'movement-effect-host-1' : 'movement-transition-host-1',
        sharedFiles: type === 'effects'
          ? ['effects/effect-media.js', 'studio/maker/maker-engine.js', 'studio/maker/maker-theme.css'] : []
      }, license: 'LICENSE'
    });
    assert.deepEqual(fs.readFileSync(path.join(directory, type, 'registry.json')), registryBefore);
  });
}

test('changed source is rejected without executing it or replacing an existing ZIP', t => {
  const { directory, service } = fixture(t);
  const destinationPath = path.join(directory, 'ripple.component.zip');
  const marker = path.join(directory, 'must-not-exist');
  fs.writeFileSync(destinationPath, 'previous archive');
  service.prepare('effects', 'ripple');
  fs.appendFileSync(path.join(directory, 'effects/ripple-engine.js'),
    `\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  assert.throws(() => service.exportComponent({ type: 'effects', id: 'ripple', destinationPath }), /changed since/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'previous archive');
});

test('unknown components, invalid identities and unregistered sources are blocked', t => {
  const { directory, service } = fixture(t);
  assert.equal(service.eligibility('effects', 'zoom').eligible, false);
  assert.match(service.eligibility('effects', 'zoom').reason, /no reviewed/);
  assert.throws(() => service.prepare('effects', '../ripple'), /valid effect/);
  assert.throws(() => service.prepare('unknown', 'ripple'), /valid effect/);
  fs.writeFileSync(path.join(directory, 'effects/registry.json'), '[]');
  assert.throws(() => service.prepare('effects', 'ripple'), /registry before exporting/);
});

for (const missing of ['effects/ripple-maker.html', 'effects/ripple-engine.js', 'effects/effect-media.js', 'LICENSE']) {
  test(`missing required file blocks export: ${missing}`, t => {
    const { directory, service } = fixture(t);
    fs.unlinkSync(path.join(directory, missing));
    assert.throws(() => service.exportComponent({ type: 'effects', id: 'ripple', destinationPath: path.join(directory, 'out.component.zip') }), /missing/);
    assert.equal(fs.existsSync(path.join(directory, 'out.component.zip')), false);
  });
}

function editReview(directory, edit) {
  const filename = path.join(directory, 'desktop/component-export-reviews.json');
  const catalog = JSON.parse(fs.readFileSync(filename, 'utf8'));
  edit(catalog.components[0]);
  fs.writeFileSync(filename, JSON.stringify(catalog));
}

test('extra assets and unsupported dependencies/contracts cannot silently disappear', t => {
  const { directory, service } = fixture(t);
  editReview(directory, item => { item.assets = ['sample.png']; });
  assert.throws(() => service.prepare('effects', 'ripple'), /outside the supported/);
  editReview(directory, item => { item.assets = []; item.sharedFiles.push('effects/extra.js'); });
  assert.throws(() => service.prepare('effects', 'ripple'), /outside the supported/);
  editReview(directory, item => { item.sharedFiles = []; item.hostContract = 'unknown'; });
  assert.throws(() => service.prepare('effects', 'ripple'), /outside the supported/);
});

test('license is explicit, can be component-specific, and never defaults to the repository license', t => {
  const { directory, service } = fixture(t);
  editReview(directory, item => { delete item.license; });
  assert.throws(() => service.prepare('effects', 'ripple'), /explicit component license/);
  const notice = Buffer.from('Custom component notice for this test.\r\nNot the repository MIT notice.\r\n');
  fs.mkdirSync(path.join(directory, 'desktop/component-licenses'));
  fs.writeFileSync(path.join(directory, 'desktop/component-licenses/custom-notice.txt'), notice);
  editReview(directory, item => { item.license = { source: 'desktop/component-licenses/custom-notice.txt', sha256: digest(notice) }; });
  fs.unlinkSync(path.join(directory, 'LICENSE'));
  const destinationPath = path.join(directory, 'custom.component.zip');
  service.exportComponent({ type: 'effects', id: 'ripple', destinationPath });
  assert.deepEqual(readZip(destinationPath).get('LICENSE'), notice);
  fs.appendFileSync(path.join(directory, 'desktop/component-licenses/custom-notice.txt'), 'changed');
  assert.throws(() => service.prepare('effects', 'ripple'), /license notice changed/);
  editReview(directory, item => { item.license.source = '../outside'; });
  assert.throws(() => service.prepare('effects', 'ripple'), /license notice must/);
  editReview(directory, item => { item.license.source = 'private-data/project/flow.json'; });
  assert.throws(() => service.prepare('effects', 'ripple'), /license notice must/);
});

test('only .component.zip destinations are accepted', t => {
  const { directory, service } = fixture(t);
  for (const destinationPath of ['relative.component.zip', path.join(directory, 'ripple-engine.js')]) {
    assert.throws(() => service.exportComponent({ type: 'effects', id: 'ripple', destinationPath }), /component.zip/);
  }
});

test('desktop export handler validates before Save, supports cancellation and rechecks after Save', async t => {
  const { directory, service } = fixture(t);
  const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
  const start = main.indexOf("  ipcMain.handle('component:export'");
  const source = main.slice(start, main.indexOf("  ipcMain.handle('component:install'", start));
  let handler;
  let dialogCalls = 0;
  let trustedChecks = 0;
  let answer = { canceled: true };
  let afterDialog = () => {};
  const destinationPath = path.join(directory, 'ripple.component.zip');
  vm.runInNewContext(source, {
    ipcMain: { handle(channel, fn) { assert.equal(channel, 'component:export'); handler = fn; } },
    assertTrustedIpcSender() { trustedChecks++; }, URL,
    componentExportService: service,
    BrowserWindow: { fromWebContents: () => undefined },
    dialog: { async showSaveDialog(owner, options) {
      dialogCalls++;
      assert.equal(options.defaultPath, 'ripple.component.zip');
      assert.ok(options.properties.includes('showOverwriteConfirmation'));
      afterDialog();
      return answer;
    } }
  });
  const event = { sender: {}, senderFrame: { url: 'movement-app://ui/studio/authoring/registry-editor.html' } };
  assert.equal((await handler(event, 'effects', 'ripple')).cancelled, true);
  assert.equal(fs.existsSync(destinationPath), false);
  await assert.rejects(handler(event, 'effects', 'zoom'), /no reviewed/);
  assert.equal(dialogCalls, 1);
  await assert.rejects(handler({ ...event, senderFrame: { url: 'movement-app://ui/effects/ripple-maker.html' } }, 'effects', 'ripple'), /Registry Editor/);
  answer = { canceled: false, filePath: destinationPath };
  await handler(event, 'effects', 'ripple');
  const original = fs.readFileSync(destinationPath);
  afterDialog = () => fs.appendFileSync(path.join(directory, 'effects/ripple-maker.html'), '\n<!-- changed -->');
  await assert.rejects(handler(event, 'effects', 'ripple'), /changed since/);
  assert.deepEqual(fs.readFileSync(destinationPath), original);
  assert.equal(trustedChecks, 5);
});

test('registry export UI preserves pending edits and reports success, cancellation and failure', async () => {
  const html = fs.readFileSync(path.join(root, 'studio/authoring/registry-editor.html'), 'utf8');
  const start = html.indexOf('        async function exportComponent(');
  const source = html.slice(start, html.indexOf('        function renderEngineRow', start));
  const calls = [];
  const state = { exporting: false, dirty: new Set(['effects']) };
  const elements = { status: { textContent: '', className: '' } };
  let answer = { cancelled: false, filename: 'ripple.component.zip' };
  const context = {
    state, elements,
    api: { async exportComponent(type, id) { calls.push([type, id]); if (answer instanceof Error) throw answer; return answer; } },
    render() { elements.status.textContent = ''; },
    setStatus(message, tone) { elements.status.textContent = message; elements.status.className = tone; }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.exportComponent('effects', 'ripple');
  assert.equal(elements.status.textContent, 'Saved ripple.component.zip.');
  answer = { cancelled: true };
  await context.exportComponent('effects', 'ripple');
  assert.match(elements.status.textContent, /cancelled/);
  answer = new Error('Source changed');
  await context.exportComponent('effects', 'ripple');
  assert.equal(elements.status.textContent, 'Source changed');
  assert.equal(state.exporting, false);
  assert.deepEqual([...state.dirty], ['effects']);
  assert.equal(calls.length, 3);
});
