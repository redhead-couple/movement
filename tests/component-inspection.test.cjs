const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { crc32, deflateRawSync } = require('node:zlib');
const test = require('node:test');
const { createComponentInspectionService, LIMITS, TRUST_NOTICE } = require('../desktop/services/component-inspection-service.cjs');
const { createComponentExportService } = require('../desktop/services/component-export-service.cjs');

const root = path.resolve(__dirname, '..');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-component-inspect-'));
  for (const folder of ['effects', 'transitions']) {
    fs.mkdirSync(path.join(directory, folder));
    fs.writeFileSync(path.join(directory, folder, 'registry.json'), '[]');
  }
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^movement-component-inspect-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const service = createComponentInspectionService({ applicationRoot: directory });
  return { directory, service };
}

function manifest(overrides = {}) {
  return { formatVersion: 1, type: 'transition', id: 'test-transition', name: 'Test transition',
    maker: 'transitions/test-transition-maker.html', engine: 'transitions/test-transition-engine.js',
    requires: { hostContract: 'movement-transition-host-1', sharedFiles: [] }, license: 'LICENSE', ...overrides };
}
function entries(data = manifest()) {
  return [
    { name: 'component.json', data: JSON.stringify(data) },
    { name: 'LICENSE', data: 'Test author license notice.' },
    { name: 'transitions/test-transition-maker.html', data: '<script>throw new Error("DO NOT RUN");</script>' },
    { name: 'transitions/test-transition-engine.js', data: 'throw new Error("DO NOT IMPORT");' }
  ];
}

// Independent fixture writer supports malformed headers and real DEFLATE payloads.
function archive(items, options = {}) {
  const chunks = [];
  const records = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name);
    const raw = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data || 'x');
    const method = item.method ?? options.method ?? 0;
    const payload = method === 8 ? deflateRawSync(raw) : raw;
    const flags = item.flags ?? 0x800;
    const crc = item.crc ?? crc32(raw);
    const size = item.size ?? raw.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(payload.length, 18); header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, payload);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8); record.writeUInt16LE(method, 10); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(payload.length, 20); record.writeUInt32LE(size, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(item.attributes || 0, 38); record.writeUInt32LE(offset, 42);
    records.push(record, name);
    offset += header.length + name.length + payload.length;
  }
  const central = Buffer.concat(records);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
function inspectBytes(fix, bytes) {
  const filename = path.join(fix.directory, 'test.component.zip');
  fs.writeFileSync(filename, bytes);
  return fix.service.inspect(filename);
}

for (const [folder, id] of [['effects', 'ripple'], ['transitions', 'alternating-panels']]) {
  test(`${id}: exported package reports all existing conflicts without modifying the real Kit`, t => {
    const fix = fixture(t);
    const unchanged = [`${folder}/registry.json`, `${folder}/${id}-maker.html`, `${folder}/${id}-engine.js`];
    const before = unchanged.map(file => fs.readFileSync(path.join(root, file)));
    const filename = path.join(fix.directory, `${id}.component.zip`);
    createComponentExportService({ applicationRoot: root }).exportComponent({ type: folder, id, destinationPath: filename });
    const report = createComponentInspectionService({ applicationRoot: root }).inspect(filename);
    assert.equal(report.structureValid, true);
    assert.equal(report.formatSupported, true);
    assert.equal(report.hostContractSupported, true);
    assert.deepEqual(report.conflicts, { registered: true, makerExists: true, engineExists: true, metadataExists: false });
    assert.equal(report.problems.length, 3);
    assert.equal(report.licenseText, fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'));
    assert.ok(report.sharedFiles.every(file => file.status === 'present'));
    assert.equal(report.trustNotice, TRUST_NOTICE);
    unchanged.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(root, file)), before[index]));
  });
}

for (const method of [0, 8]) {
  test(`valid method ${method} package passes structural checks without executing or installing its code`, t => {
    const fix = fixture(t);
    const report = inspectBytes(fix, archive(entries(), { method }));
    assert.deepEqual(report.problems, []);
    assert.equal(report.structureValid, true);
    assert.deepEqual(report.conflicts, { registered: false, makerExists: false, engineExists: false, metadataExists: false });
    assert.deepEqual(fs.readdirSync(path.join(fix.directory, 'transitions')), ['registry.json']);
    assert.equal(fs.readFileSync(path.join(fix.directory, 'transitions/registry.json'), 'utf8'), '[]');
    assert.match(report.trustNotice, /do not establish trust/);
  });
}

const invalidNames = ['../outside.js', '/outside.js', 'C:/outside.js', 'effects\\outside.js',
  'effects//outside.js', 'effects/./outside.js', 'effects/outside.', 'effects/CON.txt', 'effects/', 'effects/a:b.js'];
for (const name of invalidNames) {
  test(`rejects unsafe ZIP name ${name}`, t => {
    const fix = fixture(t);
    const items = entries(); items[3].name = name;
    assert.match(inspectBytes(fix, archive(items)).problems.join(' '), /unsafe path/);
  });
}

test('rejects duplicate names including Windows case collisions', t => {
  const fix = fixture(t);
  for (const name of ['LICENSE', 'license']) {
    const items = entries(); items[3].name = name;
    assert.match(inspectBytes(fix, archive(items)).problems.join(' '), /Duplicate/);
  }
});

test('rejects unexpected/missing files, including project data and extra scripts', t => {
  const fix = fixture(t);
  for (const name of ['flow.json', 'extra.js', 'img/user.webp']) {
    const items = entries(); items[3].name = name;
    const report = inspectBytes(fix, archive(items));
    assert.equal(report.structureValid, false);
    assert.ok(report.problems.some(problem => problem.includes('Unexpected package file')));
    assert.ok(report.problems.some(problem => problem.includes('Missing package file')));
  }
  assert.match(inspectBytes(fix, archive(entries().slice(1))).problems.join(' '), /missing component.json/);
});

test('enforces archive byte and entry limits before processing payloads', t => {
  const fix = fixture(t);
  assert.match(inspectBytes(fix, archive([...entries(), { name: 'extra', data: 'x' }])).problems.join(' '), /at most four/);
  const filename = path.join(fix.directory, 'huge.zip');
  const fd = fs.openSync(filename, 'w'); fs.ftruncateSync(fd, LIMITS.archiveBytes + 1); fs.closeSync(fd);
  assert.match(fix.service.inspect(filename).problems.join(' '), /exceeds/);
});

test('enforces per-file, manifest and total decompressed limits', t => {
  const fix = fixture(t);
  for (const [index, size] of [[0, LIMITS.manifestBytes + 1], [3, LIMITS.fileBytes + 1]]) {
    const items = entries(); items[index].size = size;
    assert.match(inspectBytes(fix, archive(items)).problems.join(' '), /size limits/);
  }
  const items = ['a', 'b', 'c', 'd'].map(name => ({ name, size: LIMITS.fileBytes, data: 'x' }));
  assert.match(inspectBytes(fix, archive(items)).problems.join(' '), /size limits/);
  const bomb = entries(); bomb[3] = { ...bomb[3], data: 'x'.repeat(100000), method: 8, size: 1 };
  assert.match(inspectBytes(fix, archive(bomb)).problems.join(' '), /declared size/);
});

test('rejects corrupt payloads, truncation, prefixes/trailing data and conflicting local headers', t => {
  const fix = fixture(t);
  const badCrc = entries(); badCrc[3].crc = 123;
  assert.match(inspectBytes(fix, archive(badCrc)).problems.join(' '), /integrity check/);
  const good = archive(entries());
  for (const bytes of [good.subarray(0, good.length - 1), Buffer.concat([good, Buffer.from('x')]), Buffer.concat([Buffer.from('x'), good])]) {
    assert.ok(inspectBytes(fix, bytes).problems.length > 0);
  }
  const disagree = Buffer.from(good); disagree[30] = 'X'.charCodeAt(0);
  assert.match(inspectBytes(fix, disagree).problems.join(' '), /disagree/);
});

test('rejects encrypted, descriptor, special-file, extra-field, unsupported compression and ZIP64 entries', t => {
  const fix = fixture(t);
  for (const edit of [item => { item.flags = 1; }, item => { item.flags = 8; },
    item => { item.method = 12; }, item => { item.attributes = (0xa000 << 16) >>> 0; },
    item => { item.attributes = (0x6000 << 16) >>> 0; }]) {
    const items = entries(); edit(items[3]);
    assert.ok(inspectBytes(fix, archive(items)).problems.length > 0);
  }
  const extra = archive(entries()); extra.writeUInt16LE(1, 28);
  assert.match(inspectBytes(fix, extra).problems.join(' '), /disagree/);
  const zip64 = entries(); zip64[3].size = 0xffffffff;
  assert.match(inspectBytes(fix, archive(zip64)).problems.join(' '), /size limits/);
});

test('validates manifest fields, paths, JSON and license text', t => {
  const fix = fixture(t);
  for (const data of [manifest({ id: '../escape' }), manifest({ maker: 'effects/other-maker.html' }),
    manifest({ type: 'unknown' }), manifest({ license: '../../LICENSE' }), manifest({ extra: true }),
    manifest({ formatVersion: '1' }), manifest({ requires: { hostContract: 'movement-transition-host-1', sharedFiles: ['a', 'a'] } })]) {
    assert.ok(inspectBytes(fix, archive(entries(data))).problems.length > 0);
  }
  for (const data of ['{invalid', Buffer.from([0xff])]) {
    const items = entries(); items[0].data = data;
    assert.match(inspectBytes(fix, archive(items)).problems.join(' '), /valid UTF-8 JSON/);
  }
  for (const data of ['   ', Buffer.from([0xff]), 'license\0text']) {
    const items = entries(); items[1].data = data;
    assert.ok(inspectBytes(fix, archive(items)).problems.length > 0);
  }
});

test('rejects duplicate manifest keys including escaped names and nested requirements', t => {
  const fix = fixture(t);
  for (const raw of [
    JSON.stringify(manifest()).replace('"id":', '"id":"other","id":'),
    JSON.stringify(manifest()).replace('"id":', '"\\u0069d":"other","id":'),
    JSON.stringify(manifest()).replace('"sharedFiles":', '"sharedFiles":[],"sharedFiles":')
  ]) {
    const items = entries(); items[0].data = raw;
    assert.match(inspectBytes(fix, archive(items)).problems.join(' '), /duplicate object keys/);
  }
});

test('unsupported format/host and missing or unsupported shared dependencies are explicit blockers', t => {
  const fix = fixture(t);
  const future = inspectBytes(fix, archive(entries(manifest({ formatVersion: 2 }))));
  assert.equal(future.formatSupported, false);
  assert.match(future.problems.join(' '), /format version/);
  const host = inspectBytes(fix, archive(entries(manifest({ requires: { hostContract: 'future-host', sharedFiles: [] } }))));
  assert.equal(host.hostContractSupported, false);
  const missing = manifest({ type: 'effect', id: 'demo', maker: 'effects/demo-maker.html', engine: 'effects/demo-engine.js',
    requires: { hostContract: 'movement-effect-host-1', sharedFiles: ['effects/effect-media.js'] } });
  const items = entries(missing); items[2].name = missing.maker; items[3].name = missing.engine;
  const report = inspectBytes(fix, archive(items));
  assert.equal(report.hostContractSupported, true);
  assert.deepEqual(report.sharedFiles, [{ path: 'effects/effect-media.js', status: 'missing' }]);
  assert.match(report.problems.join(' '), /Required shared application file is missing/);
  missing.requires.sharedFiles = ['private-data/secret.js'];
  items[0].data = JSON.stringify(missing);
  const unsupported = inspectBytes(fix, archive(items));
  assert.equal(unsupported.sharedFiles[0].status, 'unsupported');
  assert.equal(unsupported.hostContractSupported, false);
});

test('a broken local registry reports an unchecked conflict, not a clean result', t => {
  const fix = fixture(t);
  fs.writeFileSync(path.join(fix.directory, 'transitions/registry.json'), '{}');
  const report = inspectBytes(fix, archive(entries()));
  assert.equal(report.conflicts.registered, null);
  assert.match(report.problems.join(' '), /local registry is invalid/);
});

test('inspection handler uses only a native-selected path, preserves cancellation and restricts the caller', async () => {
  const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
  const start = main.indexOf("  ipcMain.handle('component:inspect'");
  const source = main.slice(start, main.indexOf("  ipcMain.handle('component:export'", start));
  let handler;
  let trusted = 0;
  let answer = { canceled: true };
  const calls = [];
  vm.runInNewContext(source, {
    ipcMain: { handle(channel, fn) { assert.equal(channel, 'component:inspect'); handler = fn; } },
    assertTrustedIpcSender() { trusted++; }, URL,
    BrowserWindow: { fromWebContents: () => undefined },
    dialog: { async showOpenDialog(owner, options) { assert.deepEqual([...options.properties], ['openFile']); return answer; } },
    componentInstallService: { inspect(filename) { calls.push(filename); return { report: { filename } }; } }
  });
  const event = { sender: {}, senderFrame: { url: 'movement-app://ui/studio/authoring/registry-editor.html' } };
  assert.equal((await handler(event)).cancelled, true);
  assert.equal(calls.length, 0);
  answer = { canceled: false, filePaths: ['chosen.component.zip'] };
  assert.equal((await handler(event, 'ignored-renderer-path')).report.filename, 'chosen.component.zip');
  await assert.rejects(handler({ ...event, senderFrame: { url: 'movement-app://ui/studio/editor/json-maker.html' } }), /Registry Editor/);
  assert.deepEqual(calls, ['chosen.component.zip']);
  assert.equal(trusted, 3);
});

test('report renders hostile names/licenses as plain text and inspection preserves unsaved registry state', async t => {
  const fix = fixture(t);
  const hostile = '<img src=x onerror="throw 1"><script>throw 2</script>';
  const items = entries(manifest({ name: hostile })); items[1].data = hostile;
  const report = inspectBytes(fix, archive(items));
  const html = fs.readFileSync(path.join(root, 'studio/authoring/registry-editor.html'), 'utf8');
  const start = html.indexOf('        function renderInspectionReport(');
  const source = html.slice(start, html.indexOf('        function markDirty', start));
  const plain = () => Object.defineProperty({ textContent: '' }, 'innerHTML', { set() { assert.fail('Must not interpret package HTML'); } });
  const elements = { inspectionTrust: plain(), inspectionSummary: plain(), inspectionLicense: plain(),
    inspectionReport: { hidden: true }, inspectComponentBtn: { disabled: false },
    installationTrust: {}, installationCategory: { replaceChildren() {}, appendChild() {} },
    installationHint: {}, installComponentBtn: {}, reloadBtn: {} };
  const state = { dirty: new Set(['effects']) };
  let result = { cancelled: false, report };
  const context = { elements, state, document: { createElement: plain }, api: { async inspectComponentZip() { return result; } }, setStatus() {} };
  vm.createContext(context); vm.runInContext(source, context);
  await context.inspectComponentZip();
  assert.equal(elements.inspectionLicense.textContent, hostile);
  assert.ok(elements.inspectionSummary.textContent.includes(hostile));
  assert.equal(elements.inspectionTrust.textContent, TRUST_NOTICE);
  assert.equal(elements.inspectionReport.hidden, false);
  assert.equal(elements.inspectComponentBtn.disabled, false);
  assert.deepEqual([...state.dirty], ['effects']);
  result = { cancelled: true };
  await context.inspectComponentZip();
  assert.equal(elements.inspectionLicense.textContent, hostile);
  assert.deepEqual([...state.dirty], ['effects']);
});
