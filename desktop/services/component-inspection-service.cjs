const fs = require('node:fs');
const path = require('node:path');
const { crc32, inflateRawSync } = require('node:zlib');
const { TextDecoder } = require('node:util');
const { HOST_CONTRACTS, supportsHostRequirements } = require('./component-export-service.cjs');

const LIMITS = Object.freeze({
  archiveBytes: 16 * 1024 * 1024,
  entries: 4,
  expandedBytes: 16 * 1024 * 1024,
  fileBytes: 5 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  registryBytes: 512 * 1024
});
const TRUST_NOTICE = 'Structural checks do not establish trust or prove that component code is safe. No package code was executed or previewed. Nothing was installed.';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) { throw new Error(message); }

function utf8(bytes, label) {
  try { return decoder.decode(bytes); } catch { fail(`${label} must contain valid UTF-8 text.`); }
}

function safeArchiveName(name) {
  if (!name || name.length > 200 || !/^[a-zA-Z0-9._/-]+$/.test(name)
    || name.split('/').some(part => !part || part === '.' || part === '..'
      || part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    fail('The ZIP contains an unsafe path or directory entry.');
  }
  return name;
}

function readBoundedFile(filename, maximum) {
  const handle = fs.openSync(filename, 'r');
  try {
    const before = fs.fstatSync(handle);
    if (!before.isFile() || before.size === 0 || before.size > maximum) {
      fail(`File is empty, not a regular file, or exceeds the ${maximum} byte limit.`);
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(handle, bytes, offset, bytes.length - offset, offset);
      if (!count) fail('The file was truncated while being inspected.');
      offset += count;
    }
    const after = fs.fstatSync(handle);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      fail('The file changed while being inspected. Select it again.');
    }
    return bytes;
  } finally { fs.closeSync(handle); }
}

// This deliberately supports only the small, canonical format-1 package layout.
// No extraction, component imports, HTML parsing or evaluation takes place.
function readComponentArchive(bytes) {
  const end = bytes.length - 22;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) {
    fail('Not a supported component ZIP: missing end record, trailing data, or archive comment.');
  }
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== count || bytes.readUInt16LE(end + 20)
    || count < 1 || count > LIMITS.entries || centralOffset + centralSize !== end) {
    fail('Unsupported ZIP structure: use at most four entries, one disk, no ZIP64 or comments.');
  }
  const records = [];
  const names = new Set();
  let expanded = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('Invalid ZIP directory.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const offset = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength > end || !nameLength || extraLength || commentLength
      || bytes.readUInt16LE(cursor + 34) || bytes.readUInt16LE(cursor + 6) > 20
      || (flags & ~0x0800) !== 0 || ![0, 8].includes(method)) {
      fail('Unsupported ZIP entry: encryption, data descriptors, extra fields and comments are not accepted.');
    }
    const mode = (attributes >>> 16) & 0xf000;
    if ((attributes & 0x10) || (mode !== 0 && mode !== 0x8000)) fail('ZIP links, directories and special files are not accepted.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeArchiveName(utf8(nameBytes, 'ZIP filename'));
    if (names.has(name.toLowerCase())) fail(`Duplicate ZIP entry: ${name}`);
    names.add(name.toLowerCase());
    const maximum = name === 'component.json' ? LIMITS.manifestBytes : LIMITS.fileBytes;
    expanded += size;
    if (!size || size > maximum || expanded > LIMITS.expandedBytes
      || compressedSize > LIMITS.archiveBytes || !compressedSize) {
      fail(`ZIP entry is empty or exceeds decompressed size limits: ${name}`);
    }
    if (offset + 30 > centralOffset || bytes.readUInt32LE(offset) !== 0x04034b50) fail('Invalid ZIP local header.');
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const dataStart = offset + 30 + localNameLength;
    const dataEnd = dataStart + compressedSize;
    if (bytes.readUInt16LE(offset + 4) > 20 || bytes.readUInt16LE(offset + 28)
      || localNameLength !== nameLength || bytes.readUInt16LE(offset + 6) !== flags
      || bytes.readUInt16LE(offset + 8) !== method || bytes.readUInt32LE(offset + 14) !== crc
      || bytes.readUInt32LE(offset + 18) !== compressedSize || bytes.readUInt32LE(offset + 22) !== size
      || dataEnd > centralOffset || !bytes.subarray(offset + 30, dataStart).equals(nameBytes)) {
      fail('ZIP local header and directory disagree.');
    }
    records.push({ name, method, crc, size, offset, dataStart, dataEnd });
    cursor += 46 + nameLength;
  }
  if (cursor !== end) fail('Unexpected data in ZIP directory.');
  let localEnd = 0;
  for (const record of [...records].sort((a, b) => a.offset - b.offset)) {
    if (record.offset !== localEnd) fail('ZIP entries overlap or contain unexpected data.');
    localEnd = record.dataEnd;
  }
  if (localEnd !== centralOffset) fail('Unexpected data before ZIP directory.');
  const files = new Map();
  for (const entry of records) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataEnd);
    let output;
    try {
      if (entry.method === 0) output = compressed;
      else {
        const inflated = inflateRawSync(compressed, { maxOutputLength: entry.size, info: true });
        if (inflated.engine.bytesWritten !== compressed.length) fail('Unused compressed data.');
        output = inflated.buffer;
      }
    } catch { fail(`Could not decompress within the declared size: ${entry.name}`); }
    if (output.length !== entry.size || crc32(output) !== entry.crc) fail(`ZIP integrity check failed: ${entry.name}`);
    files.set(entry.name, output);
  }
  return files;
}

function objectWithKeys(value, required) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === required.length
    && required.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function parseManifestJson(bytes) {
  const text = utf8(bytes, 'component.json');
  const value = JSON.parse(text);
  // JSON.parse accepts duplicate object keys. Reject them, including escaped aliases,
  // so different readers cannot disagree about a manifest's identity or entry paths.
  const frames = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1;
      }
      const frame = frames[frames.length - 1];
      if (frame && frame.keys && frame.expectKey) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (frame.keys.has(key)) fail('component.json contains duplicate object keys.');
        frame.keys.add(key);
        frame.expectKey = false;
      }
    } else if (char === '{') frames.push({ keys: new Set(), expectKey: true });
    else if (char === '[') frames.push({});
    else if (char === '}' || char === ']') frames.pop();
    else if (char === ',' && frames.length && frames[frames.length - 1].keys) {
      frames[frames.length - 1].expectKey = true;
    }
  }
  return value;
}

function validateManifest(value) {
  if (!objectWithKeys(value, ['formatVersion', 'type', 'id', 'name', 'maker', 'engine', 'requires', 'license'])) {
    fail('component.json must contain exactly the format-1 manifest fields.');
  }
  if (!Number.isSafeInteger(value.formatVersion) || value.formatVersion < 1) fail('The package format version must be a positive integer.');
  if (!['effect', 'transition'].includes(value.type) || typeof value.id !== 'string'
    || value.id.length > 100 || !SLUG.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200
    || /[\u0000-\u001f\u007f]/.test(value.name)) fail('The component name, ID or type is invalid.');
  const folder = value.type === 'effect' ? 'effects' : 'transitions';
  safeArchiveName(value.id); // The ID is also an installed metadata directory name.
  if (value.maker !== `${folder}/${value.id}-maker.html` || value.engine !== `${folder}/${value.id}-engine.js`
    || value.license !== 'LICENSE') fail('Manifest entry paths must match the component ID, type and LICENSE filename.');
  if (!objectWithKeys(value.requires, ['hostContract', 'sharedFiles'])
    || typeof value.requires.hostContract !== 'string' || value.requires.hostContract.length > 100
    || !SLUG.test(value.requires.hostContract) || !Array.isArray(value.requires.sharedFiles)
    || value.requires.sharedFiles.length > 16
    || value.requires.sharedFiles.some(file => typeof file !== 'string')
    || new Set(value.requires.sharedFiles).size !== value.requires.sharedFiles.length) {
    fail('The manifest host requirements are invalid or duplicated.');
  }
  value.requires.sharedFiles.forEach(safeArchiveName);
  return value;
}

function localFileState(root, relative) {
  let filename = root;
  try {
    for (const part of relative.split('/')) {
      filename = path.join(filename, part);
      if (fs.lstatSync(filename).isSymbolicLink()) return 'unusable';
    }
    return fs.statSync(filename).isFile() ? 'present' : 'unusable';
  } catch (error) { return error.code === 'ENOENT' ? 'missing' : 'unusable'; }
}

function createComponentInspectionService({ applicationRoot }) {
  if (!path.isAbsolute(applicationRoot)) throw new TypeError('An absolute application root is required.');
  const root = path.resolve(applicationRoot);

  function inspectSnapshot(zipPath, suppliedBytes) {
    let files, manifest, bytes;
    const report = {
      filename: typeof zipPath === 'string' ? path.basename(zipPath) : '',
      component: null, files: [], licenseText: '', structureValid: false,
      formatSupported: null, hostContractSupported: null, hostContract: '', sharedFiles: [],
      conflicts: { registered: null, makerExists: null, engineExists: null, metadataExists: null },
      categories: [],
      problems: [], trustNotice: TRUST_NOTICE
    };
    try {
      if (typeof zipPath !== 'string' || !path.isAbsolute(zipPath)) fail('Select a local component ZIP.');
      if (/\.asar(?:[\\/]|$)/i.test(root)) fail('Component inspection requires the editable Windows Authoring Kit.');
      bytes = suppliedBytes || readBoundedFile(zipPath, LIMITS.archiveBytes);
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMITS.archiveBytes) fail('Invalid package size.');
      files = readComponentArchive(bytes);
      report.files = [...files.keys()];
      if (!files.has('component.json')) fail('The ZIP is missing component.json.');
      let raw;
      try { raw = parseManifestJson(files.get('component.json')); }
      catch (error) {
        if (error.message === 'component.json contains duplicate object keys.') throw error;
        fail('component.json is not valid UTF-8 JSON.');
      }
      report.formatSupported = raw?.formatVersion === 1;
      manifest = validateManifest(raw);
      report.component = {
        name: manifest.name, id: manifest.id, type: manifest.type,
        maker: manifest.maker, engine: manifest.engine
      };
      report.hostContract = manifest.requires.hostContract;
      report.hostContractSupported = supportsHostRequirements(manifest.type, manifest.requires);
      const expected = ['component.json', 'LICENSE', manifest.maker, manifest.engine];
      for (const name of expected) if (!files.has(name)) report.problems.push(`Missing package file: ${name}`);
      for (const name of files.keys()) if (!expected.includes(name)) report.problems.push(`Unexpected package file: ${name}`);
      if (files.has('LICENSE')) {
        report.licenseText = utf8(files.get('LICENSE'), 'LICENSE');
        if (!report.licenseText.trim() || report.licenseText.includes('\0')) report.problems.push('LICENSE must contain a nonempty text notice without null bytes.');
      }
      report.structureValid = report.problems.length === 0;
      if (!report.formatSupported) report.problems.push('This package format version is not supported. Only format 1 is supported.');
      if (!report.hostContractSupported) report.problems.push('The declared host contract or shared dependencies are not supported.');
      const knownShared = new Set(Object.values(HOST_CONTRACTS).flatMap(contract => contract.sharedFiles));
      report.sharedFiles = manifest.requires.sharedFiles.map(file => {
        const status = knownShared.has(file) ? localFileState(root, file) : 'unsupported';
        if (status !== 'present') report.problems.push(`Required shared application file is ${status}: ${file}`);
        return { path: file, status };
      });
      const folder = manifest.type === 'effect' ? 'effects' : 'transitions';
      if (localFileState(root, '.movement-component-install.lock') !== 'missing') {
        report.problems.push('Another installation is active, or an installation lock needs recovery.');
      }
      for (const [field, file] of [['makerExists', manifest.maker], ['engineExists', manifest.engine],
        ['metadataExists', `.movement-components/${folder}/${manifest.id}`]]) {
        report.conflicts[field] = localFileState(root, file) !== 'missing';
        if (report.conflicts[field]) report.problems.push(`Destination already exists or is inaccessible: ${file}`);
      }
      const registryPath = `${folder}/registry.json`;
      if (localFileState(root, registryPath) !== 'present') fail('The local registry cannot be checked.');
      const registry = JSON.parse(utf8(readBoundedFile(path.join(root, registryPath), LIMITS.registryBytes), 'Local registry'));
      if (!Array.isArray(registry) || registry.some(group => !group || typeof group.engines !== 'string'
        || typeof group.Category !== 'string' || !group.Category.trim())
        || new Set(registry.map(group => group.Category.trim().toLowerCase())).size !== registry.length) fail('The local registry is invalid.');
      report.categories = registry.map(group => group.Category);
      report.conflicts.registered = registry.some(group => group.engines.split(',').map(id => id.trim().toLowerCase()).includes(manifest.id));
      if (report.conflicts.registered) report.problems.push(`Component ID is already registered: ${manifest.id}`);
    } catch (error) { report.problems.push(error.message || 'The package could not be inspected.'); }
    return { report, files, manifest, bytes };
  }
  function inspect(zipPath) { return inspectSnapshot(zipPath).report; }
  return Object.freeze({ inspect, inspectSnapshot });
}

module.exports = { createComponentInspectionService, LIMITS, TRUST_NOTICE, readBoundedFile, localFileState };
