const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

// Conservative fallback for custom/older media fields and URL-encoded paths.
function mediaReferenceText(flow) {
  const values = [];
  function visit(value) {
    if (typeof value === 'string') {
      values.push(value.toLowerCase());
      try { values.push(decodeURIComponent(value).toLowerCase()); } catch {}
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(flow);
  return values.join('\n');
}

function cleanupToken(overview, type = 'img') {
  return crypto.createHash('sha256').update(JSON.stringify([
    overview.revision, type, overview.media[type]
  ])).digest('hex');
}

function safePart(value) {
  return typeof value === 'string' && value && !value.startsWith('.')
    && !/[\\/\x00-\x1f\x7f:]/.test(value);
}

function assertPlainPath(root, ...parts) {
  let current = root;
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked media folders are not supported.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}

function listMediaTrash(root) {
  const trash = assertPlainPath(root, '.movement-media-trash');
  if (!fs.existsSync(trash)) return [];
  const result = [];
  for (const entry of fs.readdirSync(trash, { withFileTypes: true })) {
    if (!entry.isDirectory() || !safePart(entry.name)) continue;
    for (const type of ['img', 'speech', 'audio']) {
      const directory = assertPlainPath(root, '.movement-media-trash', entry.name, type);
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!file.isFile() || !safePart(file.name)) continue;
        result.push({ trashId: entry.name, type, filename: file.name });
      }
    }
  }
  return result.sort((a, b) => b.trashId.localeCompare(a.trashId));
}

function mediaTrashSnapshot(root) {
  const files = listMediaTrash(root);
  const state = files.map(item => {
    const stat = fs.lstatSync(assertPlainPath(root, '.movement-media-trash', item.trashId, item.type, item.filename));
    return [item, stat.size, stat.mtimeMs, stat.ino];
  });
  return { files, token: crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex') };
}

function emptyMediaTrash(root, expectedToken) {
  const snapshot = mediaTrashSnapshot(root);
  if (!expectedToken || expectedToken !== snapshot.token) throw new Error('Media Trash changed. Refresh and review it again.');
  let deleted = 0;
  for (const item of snapshot.files) {
    try {
      const file = assertPlainPath(root, '.movement-media-trash', item.trashId, item.type, item.filename);
      fs.unlinkSync(file);
      deleted++;
    } catch {
      return { deleted, error: 'Some files could not be deleted. The remaining files are still in Media Trash.' };
    }
  }
  return { deleted };
}

function restoreMediaTrash(root, trashId, type, filename) {
  if (!safePart(trashId) || !safePart(filename) || !['img', 'speech', 'audio'].includes(type)) {
    throw new Error('Invalid media trash entry.');
  }
  const source = assertPlainPath(root, '.movement-media-trash', trashId, type, filename);
  const target = assertPlainPath(root, type, filename);
  if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) throw new Error('Trash file not found.');
  if (fs.existsSync(target)) throw new Error('A file with this name already exists. Nothing was overwritten; the old file remains in Trash.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Exclusive creation also protects against another writer between the check and restore.
  try {
    fs.linkSync(source, target);
  } catch (error) {
    if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error;
    // Removable drives may not support hard links. Keep the trash source until
    // an exclusive copy finishes; even termination during copying cannot lose it.
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
  fs.unlinkSync(source);
  return { filename, type };
}

function resolveTrashPreview(root, trashId, type, filename) {
  const extensions = type === 'img' ? ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp']
    : ['audio', 'speech'].includes(type) ? ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'] : [];
  if (!safePart(trashId) || !safePart(filename) || !extensions.includes(path.extname(filename).toLowerCase())) {
    throw new Error('Media preview not available.');
  }
  const file = assertPlainPath(root, '.movement-media-trash', trashId, type, filename);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error('Media preview not available.');
  return file;
}

// Called only with a path returned by resolveTrashPreview. Unlike file fetch,
// explicit length/ranges let Chromium show duration and seek without loading all audio.
function trashPreviewResponse(file, request) {
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', mp3: 'audio/mpeg',
    wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4' };
  const size = fs.statSync(file).size;
  const headers = new Headers({ 'Content-Type': mime[path.extname(file).slice(1).toLowerCase()],
    'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'" });
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end) || start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length', String(Math.max(0, end - start + 1)));
  const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status, headers });
}

module.exports = { mediaReferenceText, cleanupToken, assertPlainPath, listMediaTrash, mediaTrashSnapshot, emptyMediaTrash, restoreMediaTrash, resolveTrashPreview, trashPreviewResponse };
