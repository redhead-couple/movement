const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createComponentInstallService, appendRegistryId } = require('../desktop/services/component-install-service.cjs');
const { createComponentExportService } = require('../desktop/services/component-export-service.cjs');
const root = path.resolve(__dirname, '..');
const exporter = createComponentExportService({ applicationRoot: root });

function fixture(t, type = 'effects', id = 'ripple') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-component-install-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^movement-component-install-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const prepared = exporter.prepare(type, id);
  for (const folder of ['effects', 'transitions']) {
    fs.mkdirSync(path.join(directory, folder));
    fs.writeFileSync(path.join(directory, folder, 'registry.json'), '[\r\n {"Category":"Experimental", "engines":"other", "custom":{"large":9007199254740993}},\r\n {"engines":"untouched", "Category":"Other", "extra":[1,true,null]}\r\n]\r\n');
  }
  for (const file of prepared.manifest.requires.sharedFiles) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  const zip = path.join(directory, `${id}.component.zip`);
  exporter.exportComponent({ type, id, destinationPath: zip });
  const service = createComponentInstallService({ applicationRoot: directory });
  const registryPath = path.join(directory, type, 'registry.json');
  const original = fs.readFileSync(registryPath, 'utf8');
  const inspect = () => service.inspect(zip, 42);
  const install = (token = inspect().token, overrides = {}) => service.install({ token, category: 'Experimental', trustCode: true, ...overrides }, 42);
  return { directory, zip, service, prepared, registryPath, original, inspect, install, type, id };
}
function patch(t, name, fn) {
  const original = fs[name];
  fs[name] = (...args) => fn(original, ...args);
  t.after(() => { fs[name] = original; });
}
function absent(fix) {
  for (const file of [fix.prepared.manifest.maker, fix.prepared.manifest.engine, '.movement-components', '.movement-component-install.lock']) {
    assert.equal(fs.existsSync(path.join(fix.directory, file)), false, file);
  }
  assert.equal(fs.readdirSync(fix.directory).some(name => name.startsWith('.movement-component-transaction-')), false);
}

for (const [type, id] of [['effects', 'ripple'], ['transitions', 'alternating-panels']]) {
  test(`${id}: installs only approved bytes and appends ID without changing any other registry bytes`, t => {
    const fix = fixture(t, type, id);
    const untouched = fs.readFileSync(path.join(fix.directory, type === 'effects' ? 'transitions' : 'effects', 'registry.json'));
    const { report, token } = fix.inspect();
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.categories, ['Experimental', 'Other']);
    const result = fix.install(token);
    assert.equal(result.installed, true);
    assert.deepEqual(result.warnings, []);
    for (const entry of fix.prepared.entries) {
      const destination = ['component.json', 'LICENSE'].includes(entry.name)
        ? `.movement-components/${type}/${id}/${entry.name}` : entry.name;
      assert.deepEqual(fs.readFileSync(path.join(fix.directory, destination)), entry.buffer, destination);
    }
    assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), fix.original.replace('"engines":"other"', `"engines":"other, ${id}"`));
    assert.deepEqual(fs.readFileSync(path.join(fix.directory, type === 'effects' ? 'transitions' : 'effects', 'registry.json')), untouched);
    assert.equal(fs.existsSync(path.join(fix.directory, '.movement-component-install.lock')), false);
    assert.equal(fs.readdirSync(fix.directory).some(name => name.startsWith('.movement-component-transaction-')), false);
    assert.throws(() => fix.install(token), /Inspect the ZIP again/);
    const conflict = fix.inspect();
    assert.equal(conflict.token, null);
    assert.deepEqual(conflict.report.conflicts, { registered: true, makerExists: true, engineExists: true, metadataExists: true });
  });
}

test('approval is explicit, owned by the inspecting window, and invalidated by another inspection', t => {
  const fix = fixture(t);
  const { token } = fix.inspect();
  for (const trustCode of [false, undefined, 'true', 1]) assert.throws(() => fix.install(token, { trustCode }), /explicitly acknowledge/);
  assert.throws(() => fix.service.install({ token, category: 'Experimental', trustCode: true }, 99), /Inspect the ZIP again/);
  fix.inspect();
  assert.throws(() => fix.install(token), /Inspect the ZIP again/);
  const latest = fix.inspect(); fix.service.forget(42);
  assert.throws(() => fix.install(latest.token), /Inspect the ZIP again/);
  absent(fix);
});

test('changed ZIP bytes require inspection again, even if the replacement is a valid component package', t => {
  const fix = fixture(t);
  const { token } = fix.inspect();
  exporter.exportComponent({ type: 'transitions', id: 'alternating-panels', destinationPath: fix.zip });
  assert.throws(() => fix.install(token), /ZIP changed after inspection/);
  absent(fix);
});

for (const change of ['maker', 'engine', 'metadata', 'registration', 'shared', 'category']) {
  test(`revalidates ${change} changed since approval`, t => {
    const fix = fixture(t);
    const { token } = fix.inspect();
    let external;
    if (change === 'maker' || change === 'engine') {
      external = path.join(fix.directory, fix.prepared.manifest[change]); fs.writeFileSync(external, 'other work');
    } else if (change === 'metadata') {
      external = path.join(fix.directory, '.movement-components/effects/ripple'); fs.mkdirSync(external, { recursive: true });
    } else if (change === 'shared') fs.unlinkSync(path.join(fix.directory, 'effects/effect-media.js'));
    else fs.writeFileSync(fix.registryPath, fix.original.replace(change === 'registration' ? '"other"' : '"Experimental"', change === 'registration' ? '"RIPPLE"' : '"Renamed"'));
    const registry = fs.readFileSync(fix.registryPath);
    assert.throws(() => fix.install(token), /exists|registered|required|Required|category/);
    assert.deepEqual(fs.readFileSync(fix.registryPath), registry);
    if (external) assert.ok(fs.existsSync(external));
    assert.equal(fs.existsSync(path.join(fix.directory, '.movement-component-install.lock')), false);
  });
}

test('unrelated registry edits since inspection are retained while adding the ID', t => {
  const fix = fixture(t);
  const { token } = fix.inspect();
  const edited = fix.original.replace('"untouched"', '"untouched, another"');
  fs.writeFileSync(fix.registryPath, edited);
  fix.install(token);
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), edited.replace('"other"', '"other, ripple"'));
});

for (const failure of ['engine-write', 'manifest-write', 'license-write', 'registry-stage', 'capture', 'publish']) {
  test(`rolls back this operation on ${failure} failure`, t => {
    const fix = fixture(t);
    const token = fix.inspect().token;
    if (['capture', 'publish'].includes(failure)) {
      patch(t, failure === 'capture' ? 'renameSync' : 'linkSync', () => { throw new Error('Injected failure'); });
    } else {
      const suffix = { 'engine-write': 'ripple-engine.js', 'manifest-write': 'component.json', 'license-write': 'LICENSE', 'registry-stage': 'next.json' }[failure];
      patch(t, 'openSync', (original, filename, ...args) => {
        if (String(filename).endsWith(suffix) && args[0] === 'wx') throw new Error('Injected failure');
        return original(filename, ...args);
      });
    }
    assert.throws(() => fix.install(token), /Injected failure/);
    assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), fix.original);
    absent(fix);
  });
}

test('a partial file write is rolled back', t => {
  const fix = fixture(t); const token = fix.inspect().token;
  let count = 0;
  patch(t, 'writeFileSync', (original, filename, bytes, ...args) => {
    if (typeof filename === 'number' && ++count === 3) {
      original(filename, bytes.subarray(0, 11), ...args); throw new Error('Partial write');
    }
    return original(filename, bytes, ...args);
  });
  assert.throws(() => fix.install(token), /Partial write/);
  absent(fix);
});

test('registry changed at capture is restored with the other edits intact', t => {
  const fix = fixture(t); const token = fix.inspect().token;
  const edited = fix.original.replace('untouched', 'external-edit');
  patch(t, 'renameSync', (original, source, target) => {
    if (source === fix.registryPath) fs.writeFileSync(source, edited);
    return original(source, target);
  });
  assert.throws(() => fix.install(token), /registry changed/);
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), edited);
  absent(fix);
});

test('concurrent new registry is never overwritten, and captured original is retained for recovery', t => {
  const fix = fixture(t); const token = fix.inspect().token;
  const edited = fix.original.replace('untouched', 'external-edit');
  patch(t, 'linkSync', (original, source, target) => {
    if (target === fix.registryPath) fs.writeFileSync(target, edited, { flag: 'wx' });
    return original(source, target);
  });
  assert.throws(() => fix.install(token), /recovery copy retained/);
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), edited);
  const transaction = fs.readdirSync(fix.directory).find(name => name.startsWith('.movement-component-transaction-'));
  assert.equal(fs.readFileSync(path.join(fix.directory, transaction, 'original.json'), 'utf8'), fix.original);
  assert.equal(fs.existsSync(path.join(fix.directory, 'effects/ripple-engine.js')), false);
});

test('rollback preserves an installed-path file edited by another operation', t => {
  const fix = fixture(t); const token = fix.inspect().token;
  const maker = path.join(fix.directory, 'effects/ripple-maker.html');
  patch(t, 'linkSync', () => { fs.writeFileSync(maker, 'external changes'); throw new Error('Publish failure'); });
  assert.throws(() => fix.install(token), /changed by another operation untouched/);
  assert.equal(fs.readFileSync(maker, 'utf8'), 'external changes');
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), fix.original);
  assert.equal(fs.existsSync(path.join(fix.directory, 'effects/ripple-engine.js')), false);
});

test('read-only applications cannot issue install approval', t => {
  const fix = fixture(t);
  const readOnly = createComponentInstallService({ applicationRoot: fix.directory, forceReadOnly: true });
  assert.equal(readOnly.inspect(fix.zip, 42).token, null);
  assert.throws(() => readOnly.install({ trustCode: true }, 42), /editable/);
  absent(fix);
});

test('an existing install lock blocks approval and is never removed', t => {
  const fix = fixture(t);
  const token = fix.inspect().token;
  const lock = path.join(fix.directory, '.movement-component-install.lock');
  fs.writeFileSync(lock, 'another operation');
  assert.throws(() => fix.install(token), /installation lock/);
  assert.equal(fix.inspect().token, null);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'another operation');
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), fix.original);
});

test('rollback preserves a file another operation truncated to a prefix of the original', t => {
  const fix = fixture(t); const token = fix.inspect().token;
  const maker = path.join(fix.directory, 'effects/ripple-maker.html');
  patch(t, 'linkSync', () => { fs.truncateSync(maker, 5); throw new Error('Publish failure'); });
  assert.throws(() => fix.install(token), /changed by another operation untouched/);
  assert.equal(fs.statSync(maker).size, 5);
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), fix.original);
});

test('a junction in the metadata path prevents writing outside the component destination', t => {
  const fix = fixture(t); const token = fix.inspect().token;
  const target = path.join(fix.directory, 'unrelated'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'untouched');
  fs.symlinkSync(target, path.join(fix.directory, '.movement-components'), 'junction');
  assert.throws(() => fix.install(token), /inaccessible/);
  assert.deepEqual(fs.readdirSync(target), ['keep.txt']);
  assert.equal(fs.readFileSync(fix.registryPath, 'utf8'), fix.original);
});

test('install controls stay disabled for conflicts, unsaved edits, missing trust, missing category and in-flight operations', () => {
  const html = fs.readFileSync(path.join(root, 'studio/authoring/registry-editor.html'), 'utf8');
  const start = html.indexOf('        function updateInstallControls(');
  const source = html.slice(start, html.indexOf('        async function installComponent', start));
  const state = { inspection: { token: 'approved', report: { problems: [] } }, writable: true, dirty: new Set(), installing: false };
  const elements = { installationCategory: { value: 'Experimental' }, installationTrust: { checked: false },
    installComponentBtn: {}, installationHint: {}, reloadBtn: { disabled: false } };
  const context = { state, elements }; vm.createContext(context); vm.runInContext(source, context);
  context.updateInstallControls(); assert.equal(elements.installComponentBtn.disabled, true);
  elements.installationTrust.checked = true; context.updateInstallControls(); assert.equal(elements.installComponentBtn.disabled, false);
  for (const block of [
    () => { state.inspection.report.problems = ['conflict']; },
    () => { state.dirty.add('transitions'); },
    () => { state.installing = true; },
    () => { elements.reloadBtn.disabled = true; },
    () => { elements.installationCategory.value = ''; },
    () => { state.writable = false; },
    () => { state.inspection.token = null; }
  ]) {
    block(); context.updateInstallControls(); assert.equal(elements.installComponentBtn.disabled, true);
    state.inspection = { token: 'approved', report: { problems: [] } }; state.dirty.clear();
    state.installing = false; state.writable = true; elements.reloadBtn.disabled = false; elements.installationCategory.value = 'Experimental';
  }
});

test('minimal registry edit handles escaped keys, empty lists and trailing commas without dropping metadata', () => {
  for (const old of ['', '  ', 'existing, ']) {
    const source = `[ { "Category":"Test", "eng\\u0069nes":${JSON.stringify(old)}, "nested":{"engines":"x"} } ]`;
    const result = appendRegistryId(source, 'Test', 'ripple').toString();
    assert.equal(result, source.replace(JSON.stringify(old), JSON.stringify(old + 'ripple')));
  }
  assert.throws(() => appendRegistryId('[{"Category":"Test","engines":"x","engines":"y"}]', 'Test', 'ripple'), /ambiguous/);
});

test('install IPC accepts only the Registry Editor main frame, binds approval owner, and notifies Hubs after commit', () => {
  const main = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
  const start = main.indexOf("  ipcMain.handle('component:install'");
  const source = main.slice(start, main.indexOf("  ipcMain.handle('registry:save'", start));
  let handler, allowed = true, committed = false;
  const sent = [];
  const frame = { url: 'movement-app://ui/studio/authoring/registry-editor.html' };
  const event = { senderFrame: frame, sender: { id: 42, mainFrame: frame } };
  vm.runInNewContext(source, {
    URL, assertTrustedIpcSender() { if (!allowed) throw new Error('Untrusted sender'); },
    ipcMain: { handle(channel, fn) { assert.equal(channel, 'component:install'); handler = fn; } },
    componentInstallService: { install(request, owner) {
      assert.equal(owner, 42); assert.equal(request.token, 'approved'); assert.equal(request.trustCode, true);
      committed = true; return { installed: true, type: 'effects', warnings: [] };
    } },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false,
      send(channel, detail) { assert.ok(committed); sent.push([channel, detail.type]); } } }] }
  });
  assert.equal(handler(event, { token: 'approved', category: 'Experimental', trustCode: true, zipPath: 'ignored' }).installed, true);
  assert.deepEqual(sent, [['registry:changed', 'effects']]);
  assert.throws(() => handler({ ...event, senderFrame: { ...frame } }, {}), /Registry Editor/);
  allowed = false; assert.throws(() => handler(event, {}), /Untrusted sender/);
});
