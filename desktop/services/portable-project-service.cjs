const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_FLOW_BYTES = 20 * 1024 * 1024;
const MAX_PLAYER_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20000;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const UINT32_MAX = 0xffffffff;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MEDIA_EXTENSIONS = Object.freeze({
  img: new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.pspimage', '.webp']),
  speech: new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']),
  audio: new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav'])
});

function portableError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(state, buffer) {
  let value = state >>> 0;
  for (let index = 0; index < buffer.length; index += 1) {
    value = CRC_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function crc32Buffer(buffer) {
  return (updateCrc32(0xffffffff, buffer) ^ 0xffffffff) >>> 0;
}

function crc32File(filePath) {
  const handle = fs.openSync(filePath, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let state = 0xffffffff;
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, chunk, 0, chunk.length, null);
      if (bytesRead > 0) state = updateCrc32(state, chunk.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return (state ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateValue) {
  const date = dateValue instanceof Date && Number.isFinite(dateValue.getTime())
    ? dateValue
    : new Date();
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += fs.writeSync(handle, buffer, offset, buffer.length - offset);
  }
}

function validateZipEntryName(name) {
  const value = String(name || '').replace(/\\/g, '/');
  if (
    !value
    || value.startsWith('/')
    || /^[a-z]:/i.test(value)
    || value.includes('\0')
    || value.split('/').some(part => part === '..')
  ) {
    throw portableError('UNSAFE_ARCHIVE', 'The archive contains an unsafe file path.');
  }
  return value;
}

function prepareStoredEntry(entry) {
  const name = validateZipEntryName(entry.name);
  const nameBuffer = Buffer.from(name, 'utf8');
  if (nameBuffer.length > 0xffff) {
    throw portableError('ARCHIVE_TOO_LARGE', 'An archive filename is too long.');
  }
  if (entry.buffer) {
    if (entry.buffer.length > UINT32_MAX) {
      throw portableError('ARCHIVE_TOO_LARGE', 'A portable project file is too large.');
    }
    return {
      name,
      nameBuffer,
      size: entry.buffer.length,
      crc: crc32Buffer(entry.buffer),
      buffer: entry.buffer,
      modifiedAt: entry.modifiedAt || new Date()
    };
  }
  const stats = fs.statSync(entry.filePath);
  if (!stats.isFile() || stats.size > UINT32_MAX) {
    throw portableError('ARCHIVE_TOO_LARGE', 'A portable project file is too large.');
  }
  return {
    name,
    nameBuffer,
    size: stats.size,
    crc: crc32File(entry.filePath),
    filePath: entry.filePath,
    modifiedAt: stats.mtime
  };
}

function atomicReplaceFile(temporaryPath, destinationPath) {
  const backupPath = `${temporaryPath}.previous`;
  const existed = fs.existsSync(destinationPath);
  if (existed) fs.renameSync(destinationPath, backupPath);
  try {
    fs.renameSync(temporaryPath, destinationPath);
    if (existed) fs.rmSync(backupPath, { force: true });
  } catch (error) {
    if (existed && fs.existsSync(backupPath) && !fs.existsSync(destinationPath)) {
      fs.renameSync(backupPath, destinationPath);
    }
    throw error;
  }
}

function writeStoredZip(destinationPath, requestedEntries) {
  const entries = requestedEntries.map(prepareStoredEntry);
  if (entries.length === 0 || entries.length > 0xffff) {
    throw portableError('ARCHIVE_TOO_LARGE', 'The portable project contains too many files.');
  }
  const estimatedSize = entries.reduce(
    (total, entry) => total + entry.size + 76 + (entry.nameBuffer.length * 2),
    22
  );
  if (estimatedSize > UINT32_MAX) {
    throw portableError('ARCHIVE_TOO_LARGE', 'This project exceeds the portable ZIP size limit.');
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.${crypto.randomUUID()}.tmp`
  );
  const handle = fs.openSync(temporaryPath, 'wx');
  const centralRecords = [];
  let archiveOffset = 0;
  try {
    for (const entry of entries) {
      const localOffset = archiveOffset;
      const stamp = dosDateTime(entry.modifiedAt);
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(stamp.time, 10);
      localHeader.writeUInt16LE(stamp.date, 12);
      localHeader.writeUInt32LE(entry.crc, 14);
      localHeader.writeUInt32LE(entry.size, 18);
      localHeader.writeUInt32LE(entry.size, 22);
      localHeader.writeUInt16LE(entry.nameBuffer.length, 26);
      localHeader.writeUInt16LE(0, 28);
      writeAll(handle, localHeader);
      writeAll(handle, entry.nameBuffer);
      archiveOffset += localHeader.length + entry.nameBuffer.length;

      if (entry.buffer) {
        writeAll(handle, entry.buffer);
      } else {
        const sourceHandle = fs.openSync(entry.filePath, 'r');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        try {
          let bytesRead;
          do {
            bytesRead = fs.readSync(sourceHandle, chunk, 0, chunk.length, null);
            if (bytesRead > 0) writeAll(handle, chunk.subarray(0, bytesRead));
          } while (bytesRead > 0);
        } finally {
          fs.closeSync(sourceHandle);
        }
      }
      archiveOffset += entry.size;
      centralRecords.push({ ...entry, localOffset, stamp });
    }

    const centralOffset = archiveOffset;
    for (const entry of centralRecords) {
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(entry.stamp.time, 12);
      centralHeader.writeUInt16LE(entry.stamp.date, 14);
      centralHeader.writeUInt32LE(entry.crc, 16);
      centralHeader.writeUInt32LE(entry.size, 20);
      centralHeader.writeUInt32LE(entry.size, 24);
      centralHeader.writeUInt16LE(entry.nameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(entry.localOffset, 42);
      writeAll(handle, centralHeader);
      writeAll(handle, entry.nameBuffer);
      archiveOffset += centralHeader.length + entry.nameBuffer.length;
    }

    const centralSize = archiveOffset - centralOffset;
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralSize, 12);
    endRecord.writeUInt32LE(centralOffset, 16);
    endRecord.writeUInt16LE(0, 20);
    writeAll(handle, endRecord);
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  fs.closeSync(handle);
  atomicReplaceFile(temporaryPath, destinationPath);
  return fs.statSync(destinationPath).size;
}

function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = fs.readSync(handle, buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw portableError('INVALID_ARCHIVE', 'The portable ZIP is truncated.');
    offset += bytesRead;
  }
  return buffer;
}

function decodeEntryName(buffer, flags) {
  if ((flags & 0x0800) === 0 && buffer.some(value => value > 0x7f)) {
    throw portableError('INVALID_ARCHIVE', 'Archive filenames must use UTF-8.');
  }
  const name = buffer.toString('utf8');
  if (name.includes('\ufffd')) {
    throw portableError('INVALID_ARCHIVE', 'The archive contains an invalid filename.');
  }
  return validateZipEntryName(name);
}

function readZipDirectory(zipPath) {
  const stats = fs.statSync(zipPath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_ARCHIVE_BYTES) {
    throw portableError('ARCHIVE_TOO_LARGE', 'Choose a portable project ZIP no larger than 12 GB.');
  }
  const handle = fs.openSync(zipPath, 'r');
  try {
    const tailLength = Math.min(stats.size, 0xffff + 22);
    const tailOffset = stats.size - tailLength;
    const tail = readAt(handle, tailLength, tailOffset);
    let endIndex = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        endIndex = index;
        break;
      }
    }
    if (endIndex < 0) throw portableError('INVALID_ARCHIVE', 'This is not a supported ZIP archive.');
    const diskNumber = tail.readUInt16LE(endIndex + 4);
    const centralDisk = tail.readUInt16LE(endIndex + 6);
    const diskEntries = tail.readUInt16LE(endIndex + 8);
    const entryCount = tail.readUInt16LE(endIndex + 10);
    const centralSize = tail.readUInt32LE(endIndex + 12);
    const centralOffset = tail.readUInt32LE(endIndex + 16);
    if (
      diskNumber !== 0
      || centralDisk !== 0
      || diskEntries !== entryCount
      || entryCount === 0
      || entryCount > MAX_ARCHIVE_ENTRIES
      || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
      || centralOffset + centralSize > stats.size
    ) {
      throw portableError('INVALID_ARCHIVE', 'This ZIP format is not supported.');
    }

    const central = readAt(handle, centralSize, centralOffset);
    const entries = [];
    const names = new Set();
    let expandedSize = 0;
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw portableError('INVALID_ARCHIVE', 'The ZIP directory is invalid.');
      }
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const crc = central.readUInt32LE(offset + 16);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const externalAttributes = central.readUInt32LE(offset + 38);
      const localOffset = central.readUInt32LE(offset + 42);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (offset + recordLength > central.length) {
        throw portableError('INVALID_ARCHIVE', 'The ZIP directory is truncated.');
      }
      if ((flags & 0x0001) !== 0 || ![0, 8].includes(method)) {
        throw portableError('INVALID_ARCHIVE', 'Encrypted or unsupported ZIP entries are not allowed.');
      }
      if (
        compressedSize === UINT32_MAX
        || uncompressedSize === UINT32_MAX
        || localOffset === UINT32_MAX
      ) {
        throw portableError('ARCHIVE_TOO_LARGE', 'ZIP64 portable projects are not supported.');
      }
      const name = decodeEntryName(
        central.subarray(offset + 46, offset + 46 + nameLength),
        flags
      );
      const key = name.toLowerCase();
      if (names.has(key)) {
        throw portableError('INVALID_ARCHIVE', 'The ZIP contains duplicate filenames.');
      }
      names.add(key);
      const unixMode = (externalAttributes >>> 16) & 0xf000;
      if (unixMode === 0xa000) {
        throw portableError('UNSAFE_ARCHIVE', 'Symbolic links are not allowed in portable projects.');
      }
      const isDirectory = name.endsWith('/');
      if (!isDirectory) {
        expandedSize += uncompressedSize;
        if (expandedSize > MAX_EXPANDED_BYTES) {
          throw portableError('ARCHIVE_TOO_LARGE', 'The expanded project is too large.');
        }
      }
      entries.push({
        name,
        flags,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        localOffset,
        isDirectory
      });
      offset += recordLength;
    }
    return { zipPath, archiveSize: stats.size, entries };
  } finally {
    fs.closeSync(handle);
  }
}

function entryDataOffset(zipPath, entry) {
  const handle = fs.openSync(zipPath, 'r');
  try {
    const header = readAt(handle, 30, entry.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) {
      throw portableError('INVALID_ARCHIVE', 'A ZIP entry has an invalid local header.');
    }
    const method = header.readUInt16LE(8);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if (method !== entry.method) {
      throw portableError('INVALID_ARCHIVE', 'A ZIP entry header does not match its directory.');
    }
    return entry.localOffset + 30 + nameLength + extraLength;
  } finally {
    fs.closeSync(handle);
  }
}

function readArchiveEntryBuffer(zipPath, entry, maximumBytes) {
  if (entry.uncompressedSize > maximumBytes || entry.compressedSize > maximumBytes * 2) {
    throw portableError('ARCHIVE_TOO_LARGE', 'A portable project file is too large.');
  }
  const handle = fs.openSync(zipPath, 'r');
  let compressed;
  try {
    compressed = readAt(handle, entry.compressedSize, entryDataOffset(zipPath, entry));
  } finally {
    fs.closeSync(handle);
  }
  let output;
  try {
    output = entry.method === 0
      ? compressed
      : zlib.inflateRawSync(compressed, { maxOutputLength: maximumBytes });
  } catch {
    throw portableError('INVALID_ARCHIVE', 'A ZIP entry could not be decompressed.');
  }
  if (output.length !== entry.uncompressedSize || crc32Buffer(output) !== entry.crc) {
    throw portableError('INVALID_ARCHIVE', 'A ZIP entry failed its integrity check.');
  }
  return output;
}

function normalizePortableArchive(zipPath) {
  const directory = readZipDirectory(zipPath);
  const files = directory.entries.filter(entry => !entry.isDirectory);
  const meaningful = files.filter(entry => !(
    entry.name.startsWith('__MACOSX/')
    || /(?:^|\/)\.DS_Store$/i.test(entry.name)
  ));
  const rootFlow = meaningful.find(entry => entry.name.toLowerCase() === 'flow.json');
  let rootPrefix = '';
  if (!rootFlow) {
    const candidates = meaningful.filter(entry => (
      entry.name.split('/').length === 2
      && entry.name.toLowerCase().endsWith('/flow.json')
    ));
    if (candidates.length !== 1) {
      throw portableError('INVALID_PROJECT', 'The ZIP must contain one project with a flow.json.');
    }
    rootPrefix = candidates[0].name.slice(0, candidates[0].name.lastIndexOf('/') + 1);
  }

  const normalizedEntries = [];
  for (const entry of meaningful) {
    if (rootPrefix && !entry.name.startsWith(rootPrefix)) {
      throw portableError('INVALID_PROJECT', 'The ZIP must contain one project folder.');
    }
    const relativeName = rootPrefix ? entry.name.slice(rootPrefix.length) : entry.name;
    if (!relativeName) continue;
    const parts = relativeName.split('/');
    if (relativeName === 'flow.json' || relativeName === 'player.html') {
      normalizedEntries.push({ ...entry, relativeName });
      continue;
    }
    if (
      parts.length !== 2
      || !Object.prototype.hasOwnProperty.call(MEDIA_EXTENSIONS, parts[0])
      || !parts[1]
      || parts[1].startsWith('.')
      || WINDOWS_RESERVED_NAMES.test(parts[1])
      || /[\u0000-\u001f\u007f<>:"|?*]/.test(parts[1])
    ) {
      throw portableError(
        'INVALID_PROJECT',
        'Portable projects may contain only flow.json, player.html, and flat img, speech, or audio media files.'
      );
    }
    const extension = path.extname(parts[1]).toLowerCase();
    if (!MEDIA_EXTENSIONS[parts[0]].has(extension)) {
      throw portableError('UNSAFE_MEDIA_TYPE', `Unsupported project media file: ${parts[1]}`);
    }
    const sizeLimit = parts[0] === 'img' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (entry.uncompressedSize <= 0 || entry.uncompressedSize > sizeLimit) {
      throw portableError('INVALID_MEDIA_SIZE', `Project media file is empty or too large: ${parts[1]}`);
    }
    normalizedEntries.push({ ...entry, relativeName, type: parts[0], filename: parts[1] });
  }

  const flowEntry = normalizedEntries.find(entry => entry.relativeName === 'flow.json');
  if (!flowEntry || flowEntry.uncompressedSize <= 0 || flowEntry.uncompressedSize > MAX_FLOW_BYTES) {
    throw portableError('INVALID_PROJECT', 'The portable project does not contain a valid-sized flow.json.');
  }
  const playerEntry = normalizedEntries.find(entry => entry.relativeName === 'player.html');
  if (playerEntry && playerEntry.uncompressedSize > MAX_PLAYER_BYTES) {
    throw portableError('INVALID_PROJECT', 'The portable player.html is too large.');
  }
  const flowRaw = readArchiveEntryBuffer(zipPath, flowEntry, MAX_FLOW_BYTES).toString('utf8');
  let flow;
  try {
    flow = JSON.parse(flowRaw);
  } catch {
    throw portableError('INVALID_FLOW', 'The portable project flow.json is not valid JSON.');
  }
  const rootName = rootPrefix ? rootPrefix.slice(0, -1) : '';
  return {
    ...directory,
    entries: normalizedEntries,
    flowRaw,
    flow,
    rootName,
    hasPlayer: !!playerEntry,
    mediaCount: normalizedEntries.filter(entry => entry.type).length
  };
}

function mediaSignatureMatches(extension, header) {
  const ascii = header.toString('latin1');
  if (extension === '.png') {
    return header.length >= 8 && header.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (extension === '.gif') return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
  if (extension === '.webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (extension === '.bmp') return ascii.startsWith('BM');
  if (extension === '.avif') return ascii.slice(4, 8) === 'ftyp' && /(?:avif|avis)/.test(ascii.slice(8, 32));
  if (extension === '.pspimage') return ascii.startsWith('Paint Shop Pro Image File');
  if (extension === '.wav') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
  if (extension === '.ogg') return ascii.startsWith('OggS');
  if (extension === '.flac') return ascii.startsWith('fLaC');
  if (extension === '.m4a') return ascii.slice(4, 8) === 'ftyp';
  if (extension === '.aac') return header.length >= 2 && header[0] === 0xff && (header[1] & 0xf6) === 0xf0;
  if (extension === '.mp3') {
    return ascii.startsWith('ID3')
      || (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  }
  return false;
}

function validateExtractedMedia(type, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!MEDIA_EXTENSIONS[type].has(extension)) {
    throw portableError('UNSAFE_MEDIA_TYPE', `Unsupported project media file: ${path.basename(filePath)}`);
  }
  const handle = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(32);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  if (!mediaSignatureMatches(extension, header.subarray(0, bytesRead))) {
    throw portableError(
      'MEDIA_SIGNATURE_MISMATCH',
      `Media contents do not match the filename: ${path.basename(filePath)}`
    );
  }
}

async function extractEntryToFile(zipPath, entry, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const dataOffset = entryDataOffset(zipPath, entry);
  if (entry.compressedSize === 0) {
    fs.writeFileSync(destinationPath, Buffer.alloc(0), { flag: 'wx' });
    return;
  }
  let count = 0;
  let crcState = 0xffffffff;
  const monitor = new Transform({
    transform(chunk, _encoding, callback) {
      count += chunk.length;
      if (count > entry.uncompressedSize) {
        callback(portableError('INVALID_ARCHIVE', 'A ZIP entry expanded beyond its declared size.'));
        return;
      }
      crcState = updateCrc32(crcState, chunk);
      callback(null, chunk);
    },
    flush(callback) {
      const crc = (crcState ^ 0xffffffff) >>> 0;
      if (count !== entry.uncompressedSize || crc !== entry.crc) {
        callback(portableError('INVALID_ARCHIVE', 'A ZIP entry failed its integrity check.'));
        return;
      }
      callback();
    }
  });
  const source = fs.createReadStream(zipPath, {
    start: dataOffset,
    end: dataOffset + entry.compressedSize - 1
  });
  const destination = fs.createWriteStream(destinationPath, { flags: 'wx' });
  try {
    if (entry.method === 8) {
      await pipeline(source, zlib.createInflateRaw(), monitor, destination);
    } else {
      await pipeline(source, monitor, destination);
    }
  } catch (error) {
    fs.rmSync(destinationPath, { force: true });
    throw error;
  }
}

async function extractPortableMedia(inspection, destinationRoot) {
  for (const entry of inspection.entries.filter(item => item.type)) {
    const destinationPath = path.join(destinationRoot, entry.type, entry.filename);
    await extractEntryToFile(inspection.zipPath, entry, destinationPath);
    validateExtractedMedia(entry.type, destinationPath);
  }
}

function normalizeEngineName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ? name : '';
}

function extractEngineName(spec) {
  if (typeof spec === 'string') {
    const value = spec.trim();
    if (!value) return '';
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return extractEngineName(JSON.parse(value));
      } catch {
        return '';
      }
    }
    return normalizeEngineName(value);
  }
  if (spec && typeof spec === 'object') {
    // Project data is untrusted. enginePath is intentionally ignored; portable players may
    // inline only a registered slug resolved under the application's fixed effects folder.
    return normalizeEngineName(spec.engine);
  }
  return '';
}

function collectProjectEngines(flow) {
  const effectEngines = new Set();
  const transitionEngines = new Set();
  for (const slide of Array.isArray(flow.slides) ? flow.slides : []) {
    if (!slide || typeof slide !== 'object') continue;
    const specs = [];
    if (slide.background && typeof slide.background === 'object') {
      specs.push(slide.background.effect);
    }
    if (slide.bgEffect) specs.push(slide.bgEffect);
    for (const layer of Array.isArray(slide.foregroundLayers) ? slide.foregroundLayers : []) {
      if (layer && typeof layer === 'object') specs.push(layer.effect);
    }
    if (slide.fgEffect) specs.push(slide.fgEffect);
    for (const spec of specs) {
      const name = extractEngineName(spec);
      if (name) effectEngines.add(name);
    }
    const transition = slide.transitionDraft;
    if (transition && typeof transition === 'object' && transition.enabled) {
      const name = normalizeEngineName(transition.engine || 'soft-wipe');
      if (name) transitionEngines.add(name);
    }
  }
  return {
    effects: [...effectEngines].sort(),
    transitions: [...transitionEngines].sort()
  };
}

function transformEngineSource(source) {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/^\s*import\s+\{[^}]+\}\s+from\s+["']\.\/effect-media\.js["'];?\s*$/gm, '')
    .replace(/^\s*export\s+function\s+/gm, 'function ')
    .replace(/^\s*export\s+const\s+/gm, 'const ')
    .replace(/^\s*export\s+\{[^}]+\};?\s*$/gm, '')
    .replace(
      /([A-Za-z_$][A-Za-z0-9_$]*)\.crossOrigin\s*=\s*["']Anonymous["'];?/g,
      'if (location.protocol !== "file:") { $1.crossOrigin = "Anonymous"; }'
    )
    .trimEnd();
}

function registeredEngineNames(applicationRoot, folder) {
  const registryPath = path.join(applicationRoot, folder, 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (!Array.isArray(registry)) {
    throw portableError('INVALID_ENGINE_REGISTRY', `The ${folder} registry is invalid.`);
  }
  const names = new Set();
  for (const group of registry) {
    for (const rawName of String(group && group.engines || '').split(',')) {
      const name = normalizeEngineName(rawName);
      if (name) names.add(name);
    }
  }
  return names;
}

function inlineEngineRegistry(applicationRoot, folder, names, registryName) {
  const chunks = [`window.PLAYER_BOOTSTRAP.${registryName} = {};`];
  const approvedNames = registeredEngineNames(applicationRoot, folder);
  const effectMediaSource = folder === 'effects'
    ? transformEngineSource(fs.readFileSync(path.join(applicationRoot, 'effects', 'effect-media.js'), 'utf8'))
    : '';
  for (const name of names) {
    if (!normalizeEngineName(name)) {
      throw portableError('INVALID_ENGINE', 'The slideshow contains an invalid engine name.');
    }
    if (!approvedNames.has(name)) {
      throw portableError('UNREGISTERED_ENGINE', `Unregistered ${folder} engine: ${name}`);
    }
    const enginePath = path.join(applicationRoot, folder, `${name}-engine.js`);
    if (!fs.existsSync(enginePath) || !fs.statSync(enginePath).isFile()) {
      throw portableError('MISSING_ENGINE', `Required ${folder} engine is missing: ${name}`);
    }
    const rawSource = fs.readFileSync(enginePath, 'utf8');
    const source = transformEngineSource(rawSource);
    const inlineSource = effectMediaSource && rawSource.includes('./effect-media.js')
      ? `${effectMediaSource}\n\n${source}`
      : source;
    chunks.push(
      `window.PLAYER_BOOTSTRAP.${registryName}[${JSON.stringify(name)}] = (function () {\n`
      + `${inlineSource}\n`
      + 'return {\n'
      + 'mount: (typeof mount === "function" ? mount : null),\n'
      + 'runTransition: (typeof runTransition === "function" ? runTransition : null)\n'
      + '};\n'
      + '})();'
    );
  }
  return chunks.join('\n\n');
}

function escapeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

function buildPortablePlayerHtml(applicationRoot, flow) {
  const templatePath = path.join(applicationRoot, 'studio', 'player', 'local-player.html');
  const cssPath = path.join(applicationRoot, 'assets', 'app.css');
  const runtimePath = path.join(applicationRoot, 'studio', 'player', 'player-runtime.js');
  const template = fs.readFileSync(templatePath, 'utf8');
  const appCss = fs.readFileSync(cssPath, 'utf8').replace(/<\/style/gi, '<\\/style');
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  const engines = collectProjectEngines(flow);
  const bootstrap = {
    flowData: flow,
    imgBase: 'img/',
    speechBase: 'speech/',
    audioBase: 'audio/',
    engineBase: '',
    transitionEngineBase: '',
    cacheBustSpeech: false,
    preloadAheadSlides: 6,
    desktopMode: false
  };
  const bootstrapSource = [
    `window.PLAYER_BOOTSTRAP = ${JSON.stringify(bootstrap)};`,
    inlineEngineRegistry(applicationRoot, 'effects', engines.effects, 'inlineEngines'),
    inlineEngineRegistry(
      applicationRoot,
      'transitions',
      engines.transitions,
      'inlineTransitions'
    )
  ].join('\n\n');
  const inlinedStyles = template.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']\/?assets\/app\.css["']\s*\/?>/i,
    `<style>\n${appCss}\n</style>`
  );
  const adjustedScriptStart = inlinedStyles.lastIndexOf('<script>');
  const adjustedScriptEndStart = adjustedScriptStart >= 0
    ? inlinedStyles.indexOf('</script>', adjustedScriptStart)
    : -1;
  if (
    adjustedScriptStart < 0
    || adjustedScriptEndStart < 0
    || /<link\s+rel=["']stylesheet["']\s+href=["']\/?assets\/app\.css["']/i.test(inlinedStyles)
  ) {
    throw portableError('PLAYER_TEMPLATE_ERROR', 'The local player template could not be bundled.');
  }
  const adjustedScriptEnd = adjustedScriptEndStart + '</script>'.length;
  const playerScripts = [
    '<script>',
    escapeInlineScript(bootstrapSource),
    '</script>',
    '<script>',
    escapeInlineScript(runtime),
    '</script>'
  ].join('\n');
  return (
    inlinedStyles.slice(0, adjustedScriptStart)
    + playerScripts
    + inlinedStyles.slice(adjustedScriptEnd)
  ).replace(
    '<title>Local Timeline Player</title>',
    `<title>${String(flow.title || 'Portable Slideshow')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</title>`
  );
}

function collectPortableMediaEntries(projectRoot, archiveRoot) {
  const entries = [];
  for (const type of Object.keys(MEDIA_EXTENSIONS)) {
    const mediaRoot = path.join(projectRoot, type);
    if (!fs.existsSync(mediaRoot)) continue;
    for (const entry of fs.readdirSync(mediaRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink() || entry.isDirectory()) {
        throw portableError(
          'UNSAFE_PROJECT',
          'Portable project media folders cannot contain links or nested folders.'
        );
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!MEDIA_EXTENSIONS[type].has(extension)) {
        throw portableError('UNSAFE_MEDIA_TYPE', `Unsupported project media file: ${entry.name}`);
      }
      const filePath = path.join(mediaRoot, entry.name);
      validateExtractedMedia(type, filePath);
      entries.push({
        name: `${archiveRoot}/${type}/${entry.name}`,
        filePath
      });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function createPortableProjectZip({
  applicationRoot,
  projectRoot,
  projectId,
  flow,
  serializedFlow,
  destinationPath
}) {
  const playerHtml = buildPortablePlayerHtml(applicationRoot, flow);
  if (Buffer.byteLength(playerHtml, 'utf8') > MAX_PLAYER_BYTES) {
    throw portableError('PLAYER_TOO_LARGE', 'The generated standalone player is too large.');
  }
  const archiveRoot = String(projectId).replace(/[^a-z0-9_-]+/gi, '-');
  const entries = [
    {
      name: `${archiveRoot}/player.html`,
      buffer: Buffer.from(playerHtml, 'utf8')
    },
    {
      name: `${archiveRoot}/flow.json`,
      buffer: Buffer.from(serializedFlow, 'utf8')
    },
    ...collectPortableMediaEntries(projectRoot, archiveRoot)
  ];
  const archiveSize = writeStoredZip(destinationPath, entries);
  return {
    status: 'success',
    filename: path.basename(destinationPath),
    archiveSize,
    mediaCount: entries.length - 2,
    effectEngineCount: collectProjectEngines(flow).effects.length,
    transitionEngineCount: collectProjectEngines(flow).transitions.length
  };
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  buildPortablePlayerHtml,
  createPortableProjectZip,
  extractPortableMedia,
  normalizePortableArchive,
  portableError,
  validateExtractedMedia,
  writeStoredZip
};
