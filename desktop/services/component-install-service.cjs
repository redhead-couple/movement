const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createComponentInspectionService, readBoundedFile, localFileState, LIMITS
} = require('./component-inspection-service.cjs');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;

// Change only the chosen engines string in the original JSON text. Keep all
// other bytes, including unknown properties, large numbers and formatting.
function appendRegistryId(source, category, id) {
  const registry = JSON.parse(source);
  if (!Array.isArray(registry) || registry.some(group => !group || typeof group.Category !== 'string'
    || typeof group.engines !== 'string' || !group.Category.trim())
    || new Set(registry.map(group => group.Category.trim().toLowerCase())).size !== registry.length) {
    throw new Error('The local registry is invalid.');
  }
  const selected = registry.findIndex(group => group.Category === category);
  if (selected < 0) throw new Error('The selected category no longer exists. Inspect the ZIP again.');
  if (registry.some(group => group.engines.split(',').some(value => value.trim().toLowerCase() === id))) {
    throw new Error(`Component ID is already registered: ${id}`);
  }
  let depth = 0, groupIndex = -1;
  const candidates = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      const start = i++;
      while (source[i] !== '"') i += source[i] === '\\' ? 2 : 1;
      const end = i + 1;
      if (depth !== 2 || groupIndex !== selected || JSON.parse(source.slice(start, end)) !== 'engines') continue;
      let cursor = end;
      while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++;
      if (source[cursor++] !== ':') continue;
      while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++;
      if (source[cursor] !== '"') throw new Error('The category engines entry is invalid.');
      const valueStart = cursor++;
      while (source[cursor] !== '"') cursor += source[cursor] === '\\' ? 2 : 1;
      candidates.push([valueStart, cursor + 1]);
    } else if (char === '{' || char === '[') {
      if (depth === 1 && char === '{') groupIndex++;
      depth++;
    } else if (char === '}' || char === ']') depth--;
  }
  if (candidates.length !== 1) throw new Error('The selected category has ambiguous engines entries.');
  const old = registry[selected].engines;
  const next = old + (old.trim() && !old.trimEnd().endsWith(',') ? ', ' : '') + id;
  const [start, end] = candidates[0];
  const output = source.slice(0, start) + JSON.stringify(next) + source.slice(end);
  if (Buffer.byteLength(output) > LIMITS.registryBytes) throw new Error('The updated registry exceeds the size limit.');
  return Buffer.from(output);
}

function createComponentInstallService({ applicationRoot, forceReadOnly = false }) {
  const root = path.resolve(applicationRoot);
  const inspector = createComponentInspectionService({ applicationRoot });
  // One pending inspection per Registry Editor. Tokens never contain paths or code.
  const approvals = new Map();
  function inspect(zipPath, owner) {
    approvals.delete(owner);
    const snapshot = inspector.inspectSnapshot(zipPath);
    const { report } = snapshot;
    if (forceReadOnly) report.problems.push('This application is read-only. Use the editable Windows Authoring Kit.');
    if (report.component && !report.categories.length) report.problems.push('No existing registry category is available.');
    let token = null;
    if (!report.problems.length) {
      token = crypto.randomUUID();
      approvals.set(owner, { token, zipPath, hash: digest(snapshot.bytes), expires: Date.now() + 30 * 60 * 1000 });
    }
    return { report, token };
  }
  function forget(owner) { approvals.delete(owner); }

  function install({ token, category, trustCode }, owner) {
    if (forceReadOnly || /\.asar(?:[\\/]|$)/i.test(root)) throw new Error('Installation requires the editable Windows Authoring Kit.');
    if (trustCode !== true) throw new Error('You must explicitly acknowledge that you trust this component’s executable code.');
    const approval = approvals.get(owner);
    if (!approval || approval.token !== token || approval.expires < Date.now()) throw new Error('Inspect the ZIP again before installing.');
    approvals.delete(owner); // Each approval permits only one attempt.
    if (typeof category !== 'string') throw new Error('Choose an existing registry category.');
    const bytes = readBoundedFile(approval.zipPath, LIMITS.archiveBytes);
    if (digest(bytes) !== approval.hash) throw new Error('The ZIP changed after inspection. Inspect it again and review its contents.');
    const { report, manifest, files } = inspector.inspectSnapshot(approval.zipPath, bytes);
    if (report.problems.length) throw new Error(report.problems.join('\n'));
    if (!report.categories.includes(category)) throw new Error('The selected category no longer exists. Inspect the ZIP again.');

    const folder = manifest.type === 'effect' ? 'effects' : 'transitions';
    const registryRelative = `${folder}/registry.json`;
    const registryPath = path.join(root, registryRelative);
    const metadata = `.movement-components/${folder}/${manifest.id}`;
    const createdFiles = [], createdDirs = [], warnings = [];
    let originalPath, captured = false, committed = false;

    function ownDirectory(relative, allowExisting = false) {
      const filename = path.join(root, relative);
      try { fs.mkdirSync(filename); }
      catch (error) {
        if (error.code !== 'EEXIST' || !allowExisting) throw error;
        const stat = fs.lstatSync(filename);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe destination directory: ${relative}`);
        return;
      }
      createdDirs.push({ filename, stat: fs.lstatSync(filename) });
    }
    function ownFile(relative, buffer) {
      if (localFileState(root, relative) !== 'missing') throw new Error(`Destination already exists or is inaccessible: ${relative}`);
      const filename = path.join(root, relative);
      const handle = fs.openSync(filename, 'wx');
      const record = { filename, stat: fs.fstatSync(handle), buffer, complete: false };
      createdFiles.push(record);
      try { fs.writeFileSync(handle, buffer); record.complete = true; fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
    }
    function cleanup() {
      for (const record of [...createdFiles].reverse()) {
        try {
          const stat = fs.lstatSync(record.filename);
          if (!sameFile(stat, record.stat) || stat.isSymbolicLink()
            || (record.complete ? stat.size !== record.buffer.length : stat.size > record.buffer.length)
            || !fs.readFileSync(record.filename).equals(record.buffer.subarray(0, stat.size))) {
            warnings.push(`Left a file changed by another operation untouched: ${record.filename}`);
            continue;
          }
          fs.unlinkSync(record.filename);
        } catch (error) { if (error.code !== 'ENOENT') warnings.push(`Could not remove ${record.filename}: ${error.message}`); }
      }
      for (const record of [...createdDirs].reverse()) {
        try {
          if (sameFile(fs.lstatSync(record.filename), record.stat)) fs.rmdirSync(record.filename);
        } catch (error) { if (error.code !== 'ENOENT') warnings.push(`Retained directory ${record.filename}: ${error.message}`); }
      }
    }

    try {
      // Synchronous main-process work cannot interleave with this app's registry
      // saves. Exclusive creation also rejects a second installer/process.
      ownFile('.movement-component-install.lock', Buffer.from(token));
      const folderStat = fs.lstatSync(path.join(root, folder));
      if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw new Error('The component directory is not usable.');
      ownDirectory('.movement-components', true);
      ownDirectory(`.movement-components/${folder}`, true);
      ownDirectory(metadata);
      ownFile(manifest.maker, files.get(manifest.maker));
      ownFile(manifest.engine, files.get(manifest.engine));
      ownFile(`${metadata}/component.json`, files.get('component.json'));
      ownFile(`${metadata}/LICENSE`, files.get('LICENSE'));

      for (const record of createdFiles.slice(1)) {
        const relative = path.relative(root, record.filename).split(path.sep).join('/');
        if (localFileState(root, relative) !== 'present'
          || !sameFile(fs.lstatSync(record.filename), record.stat)
          || !readBoundedFile(record.filename, LIMITS.fileBytes).equals(record.buffer)) {
          throw new Error('An installed destination changed during installation.');
        }
      }
      for (const file of manifest.requires.sharedFiles) {
        if (localFileState(root, file) !== 'present') throw new Error(`Required shared application file is unavailable: ${file}`);
      }
      if (localFileState(root, registryRelative) !== 'present') throw new Error('The local registry is not usable.');
      const original = readBoundedFile(registryPath, LIMITS.registryBytes);
      const updated = appendRegistryId(new TextDecoder('utf-8', { fatal: true }).decode(original), category, manifest.id);
      const transaction = `.movement-component-transaction-${crypto.randomUUID()}`;
      ownDirectory(transaction);
      ownFile(`${transaction}/next.json`, updated);
      originalPath = path.join(root, transaction, 'original.json');

      // Capture the current registry, then publish with an exclusive hard link.
      // Unlike rename-over-destination, link cannot overwrite a concurrent edit.
      // Registration is the last fallible operation of the transaction.
      fs.renameSync(registryPath, originalPath);
      captured = true;
      if (!readBoundedFile(originalPath, LIMITS.registryBytes).equals(original)) {
        throw new Error('The registry changed during installation. Inspect the ZIP again.');
      }
      fs.linkSync(path.join(root, transaction, 'next.json'), registryPath);
      committed = true;
    } catch (error) {
      if (captured && !committed) {
        try { fs.copyFileSync(originalPath, registryPath, fs.constants.COPYFILE_EXCL); fs.unlinkSync(originalPath); captured = false; }
        catch (restoreError) {
          // Never replace a registry created/edited by someone else while ours
          // was captured. Preserve the captured original for manual recovery.
          warnings.push(`Registry recovery copy retained at ${originalPath}. Current registry was not overwritten: ${restoreError.message}`);
        }
      }
      cleanup();
      throw new Error(`Installation failed: ${error.message}${warnings.length ? '\n' + warnings.join('\n') : ''}`);
    }

    // Installation has committed. Only best-effort housekeeping remains; never
    // undo registration because a notification or temporary-file cleanup fails.
    createdFiles.splice(1, 4); // Keep the installed maker, engine, manifest, license.
    createdDirs.splice(0, createdDirs.length - 1); // Only the transaction directory is temporary.
    try { fs.unlinkSync(originalPath); }
    catch (error) { warnings.push(`Installed successfully; registry recovery copy retained at ${originalPath}: ${error.message}`); }
    cleanup();
    return { installed: true, type: folder, id: manifest.id, name: manifest.name, category,
      files: [manifest.maker, manifest.engine, `${metadata}/component.json`, `${metadata}/LICENSE`], warnings };
  }
  return Object.freeze({ inspect, install, forget });
}

module.exports = { createComponentInstallService, appendRegistryId };
