const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createPortableProjectZip,
  extractPortableMedia,
  normalizePortableArchive
} = require('./portable-project-service.cjs');

const EXAMPLES_WORKSPACE_ID = 'examples';
const APPLICATION_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_METADATA = '.movement-workspace.json';
const MAX_FLOW_BYTES = 20 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const MAX_BACKUPS = 20;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const IMAGE_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);
const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const MEDIA_EXTENSIONS = Object.freeze({
  img: new Set(IMAGE_TYPES.keys()),
  speech: AUDIO_EXTENSIONS,
  audio: AUDIO_EXTENSIONS
});

function workspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function mediaTypeOrThrow(requestedType) {
  const type = ['img', 'speech', 'audio'].includes(requestedType)
    ? requestedType
    : null;
  if (!type) throw workspaceError('INVALID_MEDIA_TYPE', 'Unknown media type.');
  return type;
}

function cleanMediaFilename(sourcePath) {
  const original = path.basename(String(sourcePath || '')).normalize('NFKC');
  const extension = path.extname(original).toLowerCase();
  const stemLimit = 180 - extension.length;
  const stem = path.basename(original, path.extname(original))
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, Math.max(1, stemLimit))
    .replace(/[.\s]+$/g, '');
  if (!stem || WINDOWS_RESERVED_NAMES.test(stem)) {
    throw workspaceError('INVALID_MEDIA_NAME', 'Choose a media file with a portable filename.');
  }
  return `${stem}${extension}`;
}

function hasMediaSignature(extension, header) {
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
  if (extension === '.avif') {
    return ascii.slice(4, 8) === 'ftyp' && /(?:avif|avis)/.test(ascii.slice(8, 32));
  }
  if (extension === '.wav') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
  if (extension === '.ogg') return ascii.startsWith('OggS');
  if (extension === '.flac') return ascii.startsWith('fLaC');
  if (extension === '.m4a') return ascii.slice(4, 8) === 'ftyp';
  if (extension === '.aac') {
    return header.length >= 2 && header[0] === 0xff && (header[1] & 0xf6) === 0xf0;
  }
  if (extension === '.mp3') {
    return ascii.startsWith('ID3')
      || (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  }
  return false;
}

function validateMediaSource(type, sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!MEDIA_EXTENSIONS[type].has(extension)) {
    const label = type === 'img' ? 'image' : 'audio';
    throw workspaceError('UNSAFE_MEDIA_TYPE', `This file is not a supported ${label} type.`);
  }
  if (!isFile(sourcePath)) throw workspaceError('MEDIA_NOT_FOUND', 'The selected media file was not found.');

  const size = fs.statSync(sourcePath).size;
  const limit = type === 'img' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (size <= 0 || size > limit) {
    throw workspaceError(
      'INVALID_MEDIA_SIZE',
      type === 'img'
        ? 'Images must be larger than 0 bytes and no larger than 100 MB.'
        : 'Audio files must be larger than 0 bytes and no larger than 1 GB.'
    );
  }

  const handle = fs.openSync(sourcePath, 'r');
  const header = Buffer.alloc(32);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  if (!hasMediaSignature(extension, header.subarray(0, bytesRead))) {
    throw workspaceError(
      'MEDIA_SIGNATURE_MISMATCH',
      'The selected file contents do not match its file extension.'
    );
  }
  return { extension, size };
}

function normalizeMediaReference(value, folder) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  if (!normalized || /^(?:blob|data|file|https?|movement-project):/i.test(normalized)) return '';
  normalized = normalized.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return '';
  const folderIndex = parts.findIndex(part => part.toLowerCase() === folder);
  const filename = folderIndex >= 0 && parts[folderIndex + 1]
    ? parts.slice(folderIndex + 1).pop()
    : parts[parts.length - 1];
  return filename && filename !== '.' && filename !== '..' ? filename : '';
}

function createMediaUsageMaps() {
  return {
    img: new Map(),
    speech: new Map(),
    audio: new Map()
  };
}

function addMediaUsage(usage, type, value, reference) {
  const filename = normalizeMediaReference(value, type);
  if (!filename) return;
  const key = filename.toLowerCase();
  if (!usage[type].has(key)) {
    usage[type].set(key, { filename, references: [] });
  }
  const entry = usage[type].get(key);
  const normalizedReference = {
    scope: reference.scope,
    slideNumber: Number.isInteger(reference.slideNumber) ? reference.slideNumber : null,
    role: String(reference.role || 'Media').slice(0, 120)
  };
  const referenceKey = [
    normalizedReference.scope,
    normalizedReference.slideNumber || '',
    normalizedReference.role
  ].join('|');
  if (!entry.references.some(item => (
    [item.scope, item.slideNumber || '', item.role].join('|') === referenceKey
  ))) {
    entry.references.push(normalizedReference);
  }
}

function collectEffectImageUsage(value, usage, reference, rolePrefix) {
  if (!value || typeof value !== 'object') return;
  const singularKeys = /^(?:background|foreground|image|image[12]|imageSrc|imgSrc|imgSrc2|maskSrc|src|textureSrc)$/i;
  const collectionKeys = /^(?:frames|images)$/i;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && singularKeys.test(key)) {
      addMediaUsage(usage, 'img', item, {
        ...reference,
        role: `${rolePrefix}: ${key}`
      });
      continue;
    }
    if (Array.isArray(item) && collectionKeys.test(key)) {
      for (const mediaValue of item) {
        if (typeof mediaValue === 'string') {
          addMediaUsage(usage, 'img', mediaValue, {
            ...reference,
            role: `${rolePrefix}: ${key}`
          });
        } else {
          collectEffectImageUsage(mediaValue, usage, reference, rolePrefix);
        }
      }
      continue;
    }
    if (item && typeof item === 'object') {
      collectEffectImageUsage(item, usage, reference, rolePrefix);
    }
  }
}

function collectProjectMediaUsage(flow) {
  const usage = createMediaUsageMaps();
  if (!flow || typeof flow !== 'object') return usage;

  addMediaUsage(usage, 'img', flow.openingImage, {
    scope: 'opening',
    slideNumber: null,
    role: 'Opening image'
  });

  if (Array.isArray(flow.globalAudioLayers)) {
    flow.globalAudioLayers.forEach((layer, index) => {
      if (!layer || typeof layer !== 'object') return;
      const name = typeof layer.name === 'string' && layer.name.trim()
        ? layer.name.trim()
        : `Global audio ${index + 1}`;
      addMediaUsage(usage, 'audio', layer.src, {
        scope: 'global',
        slideNumber: null,
        role: name
      });
    });
  }

  const slides = Array.isArray(flow.slides) ? flow.slides : [];
  slides.forEach((slide, index) => {
    if (!slide || typeof slide !== 'object') return;
    const slideNumber = index + 1;
    const reference = { scope: 'slide', slideNumber };
    const background = slide.background;
    if (typeof background === 'string') {
      addMediaUsage(usage, 'img', background, { ...reference, role: 'Background' });
    } else if (background && typeof background === 'object') {
      addMediaUsage(usage, 'img', background.src, { ...reference, role: 'Background' });
      collectEffectImageUsage(background.effect, usage, reference, 'Background effect');
    }
    addMediaUsage(usage, 'img', slide.bgImage, { ...reference, role: 'Background' });
    collectEffectImageUsage(slide.bgEffect, usage, reference, 'Background effect');

    const foregroundLayers = Array.isArray(slide.foregroundLayers)
      ? slide.foregroundLayers
      : [];
    foregroundLayers.forEach((layer, layerIndex) => {
      if (!layer || typeof layer !== 'object') return;
      const name = typeof layer.name === 'string' && layer.name.trim()
        ? layer.name.trim()
        : `Foreground ${layerIndex + 1}`;
      addMediaUsage(usage, 'img', layer.src, { ...reference, role: name });
      collectEffectImageUsage(layer.effect, usage, reference, `${name} effect`);
    });
    addMediaUsage(usage, 'img', slide.foreground, { ...reference, role: 'Foreground' });
    addMediaUsage(usage, 'img', slide.fgImage, { ...reference, role: 'Foreground' });
    collectEffectImageUsage(slide.fgEffect || slide.frEffect, usage, reference, 'Foreground effect');

    addMediaUsage(usage, 'speech', slide.speech, { ...reference, role: 'Speech' });
    addMediaUsage(usage, 'speech', slide.audio, { ...reference, role: 'Speech' });
    const audioLayers = Array.isArray(slide.audioLayers) ? slide.audioLayers : [];
    audioLayers.forEach((layer, layerIndex) => {
      if (!layer || typeof layer !== 'object') return;
      const source = typeof layer.src === 'string' ? layer.src : '';
      const name = typeof layer.name === 'string' && layer.name.trim()
        ? layer.name.trim()
        : (layerIndex === 0 ? 'Speech' : `Audio ${layerIndex + 1}`);
      const normalizedSource = source.replace(/\\/g, '/');
      const isAudio = /^audio\//i.test(normalizedSource)
        || (layerIndex > 0 && !/^speech\//i.test(normalizedSource) && name.toLowerCase() !== 'speech');
      addMediaUsage(usage, isAudio ? 'audio' : 'speech', source, {
        ...reference,
        role: name
      });
    });
  });

  return usage;
}

function compareMediaReferences(a, b) {
  const scopeOrder = { opening: 0, global: 1, slide: 2 };
  const scopeDifference = (scopeOrder[a.scope] ?? 9) - (scopeOrder[b.scope] ?? 9);
  if (scopeDifference !== 0) return scopeDifference;
  const slideDifference = (a.slideNumber || 0) - (b.slideNumber || 0);
  if (slideDifference !== 0) return slideDifference;
  return a.role.localeCompare(b.role, undefined, { numeric: true });
}

function buildProjectMediaOverview(projectRoot, flow, revision, readOnly) {
  const usage = collectProjectMediaUsage(flow);
  const media = { img: [], speech: [], audio: [] };
  const missing = { img: [], speech: [], audio: [] };

  for (const type of Object.keys(media)) {
    const mediaRoot = path.join(projectRoot, type);
    const files = isDirectory(mediaRoot)
      ? fs.readdirSync(mediaRoot, { withFileTypes: true })
        .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
        .map(entry => {
          const stats = fs.statSync(path.join(mediaRoot, entry.name));
          const usageEntry = usage[type].get(entry.name.toLowerCase());
          return {
            type,
            filename: entry.name,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            references: usageEntry
              ? [...usageEntry.references].sort(compareMediaReferences)
              : []
          };
        })
        .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }))
      : [];
    media[type] = files;
    const existingKeys = new Set(files.map(item => item.filename.toLowerCase()));
    missing[type] = [...usage[type].entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([, item]) => ({
        type,
        filename: item.filename,
        references: [...item.references].sort(compareMediaReferences)
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
  }

  return {
    revision,
    readOnly,
    slideCount: Array.isArray(flow.slides) ? flow.slides.length : 0,
    media,
    missing
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cleanDisplayName(value, label = 'name') {
  const name = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (!name) throw workspaceError('INVALID_NAME', `Enter a ${label}.`);
  return name;
}

function cleanWorkspaceName(value) {
  const name = cleanDisplayName(value, 'workspace name')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 80);
  if (!name || WINDOWS_RESERVED_NAMES.test(name)) {
    throw workspaceError('INVALID_NAME', 'Choose a different workspace name.');
  }
  return name;
}

function slugifyProjectName(value) {
  const slug = cleanDisplayName(value, 'slideshow name')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  if (!slug || WINDOWS_RESERVED_NAMES.test(slug)) {
    throw workspaceError(
      'INVALID_NAME',
      'Use a slideshow name containing at least one letter or number.'
    );
  }
  return slug;
}

function workspaceIdForPath(rootPath) {
  return `workspace-${crypto
    .createHash('sha256')
    .update(normalizedPathKey(rootPath))
    .digest('hex')
    .slice(0, 16)}`;
}

function readWorkspaceName(rootPath) {
  try {
    const metadata = readJson(path.join(rootPath, WORKSPACE_METADATA));
    if (metadata && typeof metadata.name === 'string' && metadata.name.trim()) {
      return cleanWorkspaceName(metadata.name);
    }
  } catch {
    // Folder name is the safe fallback for absent or invalid metadata.
  }
  return path.basename(rootPath);
}

function revisionForRaw(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function validateAndSerializeFlow(flow) {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) {
    throw workspaceError('INVALID_FLOW', 'The project flow must be a JSON object.');
  }
  if (Number(flow.schemaVersion) !== 2) {
    throw workspaceError('INVALID_FLOW', 'Only flow schema version 2 can be saved.');
  }
  if (typeof flow.title !== 'string') {
    throw workspaceError('INVALID_FLOW', 'The project flow must contain a title.');
  }
  if (!Array.isArray(flow.slides)) {
    throw workspaceError('INVALID_FLOW', 'The project flow must contain a slides array.');
  }

  let serialized;
  try {
    serialized = `${JSON.stringify(flow, null, 2)}\n`;
  } catch {
    throw workspaceError('INVALID_FLOW', 'The project flow is not valid JSON data.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FLOW_BYTES) {
    throw workspaceError('FLOW_TOO_LARGE', 'The project flow is too large to save safely.');
  }
  return serialized;
}

function starterFlow(title) {
  return {
    title,
    description: '',
    isPublished: false,
    schemaVersion: 2,
    defaultBeatSeconds: 5,
    openingImage: '',
    globalAudioLayers: [],
    slides: []
  };
}

function atomicWrite(filePath, contents) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.movement-${path.basename(filePath)}-${process.pid}-${crypto.randomUUID()}.tmp`
  );
  fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (isFile(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function createBackup(flowPath) {
  if (!isFile(flowPath)) return null;
  const backupDirectory = path.join(path.dirname(flowPath), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `flow-${stamp}-${crypto.randomUUID().slice(0, 8)}.json`;
  fs.copyFileSync(flowPath, path.join(backupDirectory, backupName), fs.constants.COPYFILE_EXCL);

  const backups = fs.readdirSync(backupDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^flow-.*\.json$/i.test(entry.name))
    .map(entry => entry.name)
    .sort();
  for (const expired of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
    fs.unlinkSync(path.join(backupDirectory, expired));
  }
  return backupName;
}

function projectSummary(projectRoot, entryName, readOnly) {
  const flowPath = path.join(projectRoot, entryName, 'flow.json');
  try {
    const raw = fs.readFileSync(flowPath, 'utf8');
    const flow = JSON.parse(raw);
    const slideCount = Array.isArray(flow.slides) ? flow.slides.length : 0;
    return {
      id: entryName,
      title: typeof flow.title === 'string' && flow.title.trim()
        ? flow.title.trim()
        : entryName,
      description: typeof flow.description === 'string' ? flow.description.trim() : '',
      schemaVersion: Number(flow.schemaVersion || 0),
      slideCount,
      status: slideCount >= 5 ? 'In progress' : slideCount > 0 ? 'Started' : 'Empty project',
      openingImage: typeof flow.openingImage === 'string' ? path.basename(flow.openingImage) : '',
      isPublished: Boolean(flow.isPublished),
      valid: Number(flow.schemaVersion || 0) === 2 && Array.isArray(flow.slides),
      revision: revisionForRaw(raw),
      readOnly
    };
  } catch {
    return {
      id: entryName,
      title: entryName,
      description: '',
      schemaVersion: 0,
      slideCount: 0,
      status: 'Needs attention',
      openingImage: '',
      isPublished: false,
      valid: false,
      revision: null,
      readOnly
    };
  }
}

function scanProjects(projectRoot, readOnly = false) {
  if (!isDirectory(projectRoot)) return [];
  return fs.readdirSync(projectRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter(entry => isFile(path.join(projectRoot, entry.name, 'flow.json')))
    .map(entry => projectSummary(projectRoot, entry.name, readOnly))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

function containsProjects(rootPath) {
  if (!isDirectory(rootPath)) return false;
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .some(entry => (
      entry.isDirectory()
      && !entry.name.startsWith('.')
      && isFile(path.join(rootPath, entry.name, 'flow.json'))
    ));
}

function isRecognizedWorkspace(rootPath) {
  return isFile(path.join(rootPath, WORKSPACE_METADATA)) || containsProjects(rootPath);
}

function assertTemporaryProjectPath(workspaceRoot, temporaryPath) {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(temporaryPath));
  if (
    !relative
    || relative.includes(path.sep)
    || !relative.startsWith('.movement-tmp-')
    || relative.startsWith('..')
  ) {
    throw new Error('Refusing to clean an unexpected temporary project path.');
  }
}

function removeTemporaryProject(workspaceRoot, temporaryPath) {
  if (!fs.existsSync(temporaryPath)) return;
  assertTemporaryProjectPath(workspaceRoot, temporaryPath);
  fs.rmSync(temporaryPath, { recursive: true, force: true });
}

function copyProjectTree(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: false });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === 'backups' || entry.name === '.save.lock' || entry.name.startsWith('.movement-')) {
      continue;
    }
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw workspaceError('UNSAFE_PROJECT', 'Projects containing symbolic links cannot be copied.');
    }
    if (entry.isDirectory()) {
      copyProjectTree(source, destination);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
  }
}

function nextAvailableSlug(workspaceRoot, preferredSlug) {
  if (!fs.existsSync(path.join(workspaceRoot, preferredSlug))) return preferredSlug;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${preferredSlug}-${index}`;
    if (!fs.existsSync(path.join(workspaceRoot, candidate))) return candidate;
  }
  throw workspaceError('CONFLICT', 'Unable to find an available project name.');
}

function parseProjectTrashName(trashName) {
  const value = String(trashName || '');
  const match = value.match(
    /^([a-z0-9][a-z0-9._-]{0,119})--(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z--([a-f0-9]{8})$/i
  );
  if (!match) return null;
  const removedAt = `${match[2]}T${match[3]}:${match[4]}:${match[5]}.${match[6]}Z`;
  if (!Number.isFinite(Date.parse(removedAt))) return null;
  return {
    trashId: value,
    originalProjectId: match[1],
    removedAt
  };
}

function createWorkspaceService({ examplesRoot, storageRoot }) {
  if (!path.isAbsolute(examplesRoot) || !path.isAbsolute(storageRoot)) {
    throw new Error('Workspace service paths must be absolute.');
  }

  let selectedWorkspaceId = null;

  function internalWorkspaces() {
    if (!isDirectory(storageRoot)) return [];
    return fs.readdirSync(storageRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => {
        const rootPath = path.join(storageRoot, entry.name);
        return { rootPath };
      })
      .filter(item => isRecognizedWorkspace(item.rootPath))
      .map(item => ({
        id: workspaceIdForPath(item.rootPath),
        name: readWorkspaceName(item.rootPath),
        rootPath: item.rootPath
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  function publicWorkspace(item, kind = 'user') {
    const readOnly = kind === 'examples';
    const projectRoot = readOnly ? examplesRoot : item.rootPath;
    return {
      id: item.id,
      name: item.name,
      kind,
      readOnly,
      projectCount: scanProjects(projectRoot, readOnly).length
    };
  }

  function listWorkspaces() {
    return [
      publicWorkspace({ id: EXAMPLES_WORKSPACE_ID, name: 'Examples' }, 'examples'),
      ...internalWorkspaces().map(item => publicWorkspace(item))
    ];
  }

  function getCurrentWorkspace() {
    const workspaces = listWorkspaces();
    const selected = workspaces.find(item => item.id === selectedWorkspaceId);
    if (selected) return selected;
    const userWorkspaces = workspaces.filter(item => item.kind === 'user');
    if (userWorkspaces.length === 1) return userWorkspaces[0];
    if (userWorkspaces.length === 0) {
      return workspaces.find(item => item.id === EXAMPLES_WORKSPACE_ID) || null;
    }
    return null;
  }

  function selectWorkspace(workspaceId) {
    const match = listWorkspaces().find(item => item.id === workspaceId);
    if (!match) throw workspaceError('NOT_FOUND', 'Workspace not found.');
    selectedWorkspaceId = match.id;
    return match;
  }

  function resolveUserWorkspace(workspaceId) {
    if (workspaceId === EXAMPLES_WORKSPACE_ID) {
      throw workspaceError('READ_ONLY', 'Examples are read-only. Copy the project first.');
    }
    const workspace = internalWorkspaces().find(item => item.id === workspaceId);
    if (!workspace) throw workspaceError('NOT_FOUND', 'Workspace not found.');
    return workspace;
  }

  function resolveProjectRoot(workspaceId, projectId, requireWritable = false) {
    const safeProjectId = path.basename(projectId);
    if (!safeProjectId || safeProjectId !== projectId || safeProjectId.startsWith('.')) {
      throw workspaceError('NOT_FOUND', 'Project not found.');
    }
    if (workspaceId === EXAMPLES_WORKSPACE_ID) {
      if (requireWritable) {
        throw workspaceError('READ_ONLY', 'Examples are read-only. Copy the project first.');
      }
      return path.join(examplesRoot, safeProjectId);
    }
    return path.join(resolveUserWorkspace(workspaceId).rootPath, safeProjectId);
  }

  function listProjects(workspaceId) {
    const selectedId = workspaceId || (getCurrentWorkspace() && getCurrentWorkspace().id);
    if (!selectedId) return [];
    if (selectedId === EXAMPLES_WORKSPACE_ID) return scanProjects(examplesRoot, true);
    return scanProjects(resolveUserWorkspace(selectedId).rootPath, false);
  }

  function createWorkspace(requestedName) {
    const name = cleanWorkspaceName(requestedName);
    fs.mkdirSync(storageRoot, { recursive: true });
    const destinationRoot = path.join(storageRoot, name);
    if (fs.existsSync(destinationRoot)) {
      throw workspaceError('CONFLICT', `A workspace named "${name}" already exists.`);
    }

    const temporaryRoot = path.join(storageRoot, `.movement-tmp-workspace-${crypto.randomUUID()}`);
    fs.mkdirSync(temporaryRoot, { recursive: false });
    try {
      atomicWrite(
        path.join(temporaryRoot, WORKSPACE_METADATA),
        `${JSON.stringify({ version: 1, name }, null, 2)}\n`
      );
      fs.renameSync(temporaryRoot, destinationRoot);
    } catch (error) {
      removeTemporaryProject(storageRoot, temporaryRoot);
      throw error;
    }

    const created = publicWorkspace({
      id: workspaceIdForPath(destinationRoot),
      name,
      rootPath: destinationRoot
    });
    selectedWorkspaceId = created.id;
    return created;
  }

  function createProject(workspaceId, requestedTitle) {
    const workspace = resolveUserWorkspace(workspaceId);
    const title = cleanDisplayName(requestedTitle, 'slideshow name');
    const slug = slugifyProjectName(title);
    const destinationRoot = path.join(workspace.rootPath, slug);
    if (fs.existsSync(destinationRoot)) {
      throw workspaceError('CONFLICT', `A slideshow named "${title}" already exists.`);
    }

    const temporaryRoot = path.join(
      workspace.rootPath,
      `.movement-tmp-project-${crypto.randomUUID()}`
    );
    fs.mkdirSync(temporaryRoot, { recursive: false });
    try {
      for (const folder of ['img', 'speech', 'audio', 'backups']) {
        fs.mkdirSync(path.join(temporaryRoot, folder));
      }
      atomicWrite(
        path.join(temporaryRoot, 'flow.json'),
        validateAndSerializeFlow(starterFlow(title))
      );
      fs.renameSync(temporaryRoot, destinationRoot);
    } catch (error) {
      removeTemporaryProject(workspace.rootPath, temporaryRoot);
      throw error;
    }
    return projectSummary(workspace.rootPath, slug, false);
  }

  function loadProjectFlow(workspaceId, projectId) {
    const projectRoot = resolveProjectRoot(workspaceId, projectId);
    const flowPath = path.join(projectRoot, 'flow.json');
    if (!isFile(flowPath)) throw workspaceError('NOT_FOUND', 'Project flow not found.');
    const raw = fs.readFileSync(flowPath, 'utf8');
    let flow;
    try {
      flow = JSON.parse(raw);
    } catch {
      throw workspaceError('INVALID_FLOW', 'The project flow is not valid JSON.');
    }
    return { flow, revision: revisionForRaw(raw), readOnly: workspaceId === EXAMPLES_WORKSPACE_ID };
  }

  function saveProjectFlow(workspaceId, projectId, flow, expectedRevision = null) {
    const projectRoot = resolveProjectRoot(workspaceId, projectId, true);
    const flowPath = path.join(projectRoot, 'flow.json');
    if (!isFile(flowPath)) throw workspaceError('NOT_FOUND', 'Project flow not found.');
    const existingRaw = fs.readFileSync(flowPath, 'utf8');
    const existingRevision = revisionForRaw(existingRaw);
    if (expectedRevision && expectedRevision !== existingRevision) {
      throw workspaceError(
        'REVISION_CONFLICT',
        'This slideshow changed since it was opened. Reload it before saving.'
      );
    }

    const serialized = validateAndSerializeFlow(flow);
    const backupName = createBackup(flowPath);
    atomicWrite(flowPath, serialized);
    return {
      revision: revisionForRaw(serialized),
      backupName,
      project: projectSummary(path.dirname(projectRoot), projectId, false)
    };
  }

  function copyProject(sourceRoot, workspace, title, preferredSlug) {
    const slug = nextAvailableSlug(workspace.rootPath, preferredSlug);
    const destinationRoot = path.join(workspace.rootPath, slug);
    const temporaryRoot = path.join(
      workspace.rootPath,
      `.movement-tmp-copy-${crypto.randomUUID()}`
    );
    try {
      copyProjectTree(sourceRoot, temporaryRoot);
      fs.mkdirSync(path.join(temporaryRoot, 'backups'), { recursive: true });
      const copiedFlow = readJson(path.join(temporaryRoot, 'flow.json'));
      copiedFlow.title = title;
      copiedFlow.isPublished = false;
      delete copiedFlow.publishedAt;
      atomicWrite(
        path.join(temporaryRoot, 'flow.json'),
        validateAndSerializeFlow(copiedFlow)
      );
      fs.renameSync(temporaryRoot, destinationRoot);
    } catch (error) {
      removeTemporaryProject(workspace.rootPath, temporaryRoot);
      throw error;
    }
    return projectSummary(workspace.rootPath, slug, false);
  }

  function copyExample(exampleId, targetWorkspaceId) {
    const sourceRoot = resolveProjectRoot(EXAMPLES_WORKSPACE_ID, exampleId);
    if (!isFile(path.join(sourceRoot, 'flow.json'))) {
      throw workspaceError('NOT_FOUND', 'Example project not found.');
    }
    const workspace = resolveUserWorkspace(targetWorkspaceId);
    const sourceFlow = readJson(path.join(sourceRoot, 'flow.json'));
    const sourceTitle = typeof sourceFlow.title === 'string' && sourceFlow.title.trim()
      ? sourceFlow.title.trim()
      : exampleId;
    return copyProject(
      sourceRoot,
      workspace,
      `${sourceTitle} (Copy)`,
      nextAvailableSlug(workspace.rootPath, `${slugifyProjectName(exampleId)}-copy`)
    );
  }

  function duplicateProject(workspaceId, projectId) {
    const workspace = resolveUserWorkspace(workspaceId);
    const sourceRoot = resolveProjectRoot(workspaceId, projectId, true);
    if (!isFile(path.join(sourceRoot, 'flow.json'))) {
      throw workspaceError('NOT_FOUND', 'Project not found.');
    }
    const sourceFlow = readJson(path.join(sourceRoot, 'flow.json'));
    const sourceTitle = typeof sourceFlow.title === 'string' && sourceFlow.title.trim()
      ? sourceFlow.title.trim()
      : projectId;
    return copyProject(
      sourceRoot,
      workspace,
      `${sourceTitle} (Copy)`,
      nextAvailableSlug(workspace.rootPath, `${slugifyProjectName(projectId)}-copy`)
    );
  }

  function renameProject(workspaceId, projectId, requestedTitle) {
    const workspace = resolveUserWorkspace(workspaceId);
    const sourceRoot = resolveProjectRoot(workspaceId, projectId, true);
    if (!isFile(path.join(sourceRoot, 'flow.json'))) {
      throw workspaceError('NOT_FOUND', 'Project not found.');
    }

    const title = cleanDisplayName(requestedTitle, 'slideshow name');
    const newSlug = slugifyProjectName(title);
    const destinationRoot = path.join(workspace.rootPath, newSlug);
    if (newSlug !== projectId && fs.existsSync(destinationRoot)) {
      throw workspaceError('CONFLICT', `A slideshow named "${title}" already exists.`);
    }

    const loaded = loadProjectFlow(workspaceId, projectId);
    const renamedFlow = { ...loaded.flow, title };
    saveProjectFlow(workspaceId, projectId, renamedFlow, loaded.revision);
    if (newSlug !== projectId) {
      try {
        fs.renameSync(sourceRoot, destinationRoot);
      } catch (error) {
        atomicWrite(path.join(sourceRoot, 'flow.json'), validateAndSerializeFlow(loaded.flow));
        throw error;
      }
    }
    return projectSummary(workspace.rootPath, newSlug, false);
  }

  function moveProjectToTrash(workspaceId, projectId) {
    const workspace = resolveUserWorkspace(workspaceId);
    const sourceRoot = resolveProjectRoot(workspaceId, projectId, true);
    if (!isFile(path.join(sourceRoot, 'flow.json'))) {
      throw workspaceError('NOT_FOUND', 'Project not found.');
    }
    const metadataPath = path.join(workspace.rootPath, WORKSPACE_METADATA);
    if (!isFile(metadataPath)) {
      atomicWrite(
        metadataPath,
        `${JSON.stringify({
          version: 1,
          name: readWorkspaceName(workspace.rootPath)
        }, null, 2)}\n`
      );
    }
    const trashRoot = path.join(workspace.rootPath, '.movement-trash');
    fs.mkdirSync(trashRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashName = `${projectId}--${stamp}--${crypto.randomUUID().slice(0, 8)}`;
    fs.renameSync(sourceRoot, path.join(trashRoot, trashName));
    return { projectId, recoverable: true, trashName };
  }

  function resolveProjectTrashEntry(workspaceId, trashId) {
    const workspace = resolveUserWorkspace(workspaceId);
    const parsed = parseProjectTrashName(trashId);
    if (!parsed) throw workspaceError('NOT_FOUND', 'Trashed slideshow not found.');
    const trashRoot = path.join(workspace.rootPath, '.movement-trash');
    const entryRoot = path.join(trashRoot, parsed.trashId);
    let stats;
    try {
      stats = fs.lstatSync(entryRoot);
    } catch {
      throw workspaceError('NOT_FOUND', 'Trashed slideshow not found.');
    }
    if (
      !stats.isDirectory()
      || stats.isSymbolicLink()
      || !isFile(path.join(entryRoot, 'flow.json'))
    ) {
      throw workspaceError('NOT_FOUND', 'Trashed slideshow not found.');
    }
    return { workspace, trashRoot, entryRoot, ...parsed };
  }

  function trashedProjectSummary(workspaceId, trashId) {
    const entry = resolveProjectTrashEntry(workspaceId, trashId);
    const summary = projectSummary(entry.trashRoot, entry.trashId, false);
    return {
      trashId: entry.trashId,
      originalProjectId: entry.originalProjectId,
      title: summary.title,
      description: summary.description,
      slideCount: summary.slideCount,
      valid: summary.valid,
      removedAt: entry.removedAt,
      conflict: fs.existsSync(path.join(entry.workspace.rootPath, entry.originalProjectId))
    };
  }

  function listTrashedProjects(workspaceId) {
    const workspace = resolveUserWorkspace(workspaceId);
    const trashRoot = path.join(workspace.rootPath, '.movement-trash');
    if (!isDirectory(trashRoot)) return [];
    return fs.readdirSync(trashRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => {
        try {
          return trashedProjectSummary(workspaceId, entry.name);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.removedAt.localeCompare(a.removedAt));
  }

  function restoreProjectFromTrash(workspaceId, trashId, restoreAsCopy = false) {
    const entry = resolveProjectTrashEntry(workspaceId, trashId);
    const conflict = fs.existsSync(
      path.join(entry.workspace.rootPath, entry.originalProjectId)
    );
    if (conflict && !restoreAsCopy) {
      throw workspaceError(
        'CONFLICT',
        `A slideshow named "${entry.originalProjectId}" already exists in this workspace.`
      );
    }
    const targetProjectId = conflict
      ? nextAvailableSlug(entry.workspace.rootPath, entry.originalProjectId)
      : entry.originalProjectId;
    const destinationRoot = path.join(entry.workspace.rootPath, targetProjectId);
    fs.renameSync(entry.entryRoot, destinationRoot);
    return {
      ...projectSummary(entry.workspace.rootPath, targetProjectId, false),
      restoredAsCopy: conflict && restoreAsCopy,
      originalProjectId: entry.originalProjectId
    };
  }

  function deleteTrashedProject(workspaceId, trashId) {
    const entry = resolveProjectTrashEntry(workspaceId, trashId);
    const summary = trashedProjectSummary(workspaceId, trashId);
    fs.rmSync(entry.entryRoot, { recursive: true, force: false });
    return {
      deleted: true,
      trashId: entry.trashId,
      originalProjectId: entry.originalProjectId,
      title: summary.title
    };
  }

  function resolveProjectAssetPath(workspaceId, projectId, relativeAssetPath) {
    const normalized = String(relativeAssetPath || '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (
      parts.length < 2
      || !['img', 'speech', 'audio'].includes(parts[0])
      || parts.some(part => part === '.' || part === '..' || part.includes('\0'))
    ) {
      throw workspaceError('NOT_FOUND', 'Project asset not found.');
    }

    const projectRoot = resolveProjectRoot(workspaceId, projectId);
    const assetPath = path.resolve(projectRoot, ...parts);
    const relative = path.relative(path.resolve(projectRoot), assetPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !isFile(assetPath)) {
      throw workspaceError('NOT_FOUND', 'Project asset not found.');
    }
    return assetPath;
  }

  function listProjectMedia(workspaceId, projectId, requestedType) {
    const type = mediaTypeOrThrow(requestedType);
    const projectRoot = resolveProjectRoot(workspaceId, projectId);
    const mediaRoot = path.join(projectRoot, type);
    if (!isDirectory(mediaRoot)) return [];
    return fs.readdirSync(mediaRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  function getProjectMediaOverview(workspaceId, projectId) {
    const projectRoot = resolveProjectRoot(workspaceId, projectId);
    const loaded = loadProjectFlow(workspaceId, projectId);
    return buildProjectMediaOverview(
      projectRoot,
      loaded.flow,
      loaded.revision,
      loaded.readOnly
    );
  }

  function moveUnusedProjectMediaToTrash(
    workspaceId,
    projectId,
    requestedType,
    requestedFilename,
    expectedRevision = null
  ) {
    const type = mediaTypeOrThrow(requestedType);
    const filename = String(requestedFilename || '');
    if (
      !filename
      || filename.startsWith('.')
      || filename !== path.basename(filename)
      || /[\u0000-\u001f\u007f]/.test(filename)
    ) {
      throw workspaceError('INVALID_MEDIA_NAME', 'Invalid project media filename.');
    }

    const projectRoot = resolveProjectRoot(workspaceId, projectId, true);
    const loaded = loadProjectFlow(workspaceId, projectId);
    if (expectedRevision && expectedRevision !== loaded.revision) {
      throw workspaceError(
        'REVISION_CONFLICT',
        'This slideshow changed since the media list was opened. Refresh the media list and try again.'
      );
    }
    const overview = buildProjectMediaOverview(
      projectRoot,
      loaded.flow,
      loaded.revision,
      false
    );
    const item = overview.media[type].find(candidate => (
      candidate.filename.toLowerCase() === filename.toLowerCase()
    ));
    if (!item) throw workspaceError('MEDIA_NOT_FOUND', 'The project media file was not found.');
    if (item.references.length > 0) {
      throw workspaceError(
        'MEDIA_IN_USE',
        'This file is used by the slideshow. Remove every reference before removing the file.'
      );
    }

    const sourcePath = path.join(projectRoot, type, item.filename);
    if (!isFile(sourcePath)) throw workspaceError('MEDIA_NOT_FOUND', 'The project media file was not found.');
    const removedAt = new Date().toISOString();
    const trashId = `${removedAt.replace(/[:.]/g, '-')}--${crypto.randomUUID().slice(0, 8)}`;
    const trashEntryRoot = path.join(projectRoot, '.movement-media-trash', trashId);
    const trashFolder = path.join(trashEntryRoot, type);
    const destinationPath = path.join(trashFolder, item.filename);
    fs.mkdirSync(trashFolder, { recursive: true });
    fs.renameSync(sourcePath, destinationPath);
    try {
      atomicWrite(
        path.join(trashEntryRoot, 'metadata.json'),
        `${JSON.stringify({
          version: 1,
          projectId,
          type,
          filename: item.filename,
          removedAt
        }, null, 2)}\n`
      );
    } catch (error) {
      fs.renameSync(destinationPath, sourcePath);
      fs.rmSync(trashEntryRoot, { recursive: true, force: true });
      throw error;
    }

    return {
      status: 'success',
      type,
      filename: item.filename,
      recoverable: true,
      trashId
    };
  }

  function exportPortableProject(workspaceId, projectId, destinationPath) {
    const projectRoot = resolveProjectRoot(workspaceId, projectId);
    const loaded = loadProjectFlow(workspaceId, projectId);
    const serializedFlow = validateAndSerializeFlow(loaded.flow);
    const requestedPath = String(destinationPath || '');
    const outputPath = path.resolve(requestedPath);
    if (!path.isAbsolute(requestedPath) || path.extname(outputPath).toLowerCase() !== '.zip') {
      throw workspaceError('INVALID_EXPORT_PATH', 'Choose a destination ZIP file.');
    }
    return createPortableProjectZip({
      applicationRoot: APPLICATION_ROOT,
      projectRoot,
      projectId,
      flow: loaded.flow,
      serializedFlow,
      destinationPath: outputPath
    });
  }

  function preparePortableImport(workspaceId, archivePath) {
    const workspace = resolveUserWorkspace(workspaceId);
    const requestedPath = String(archivePath || '');
    const inputPath = path.resolve(requestedPath);
    if (!path.isAbsolute(requestedPath) || path.extname(inputPath).toLowerCase() !== '.zip' || !isFile(inputPath)) {
      throw workspaceError('INVALID_ARCHIVE', 'Choose a portable slideshow ZIP.');
    }
    const inspection = normalizePortableArchive(inputPath);
    const serializedFlow = validateAndSerializeFlow(inspection.flow);
    const title = cleanDisplayName(inspection.flow.title, 'slideshow title');
    const rootName = String(inspection.rootName || '');
    const preferredProjectId = (
      /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(rootName)
      && !WINDOWS_RESERVED_NAMES.test(rootName)
    )
      ? rootName
      : slugifyProjectName(title);
    return {
      workspace,
      inputPath,
      inspection,
      serializedFlow,
      title,
      preferredProjectId,
      conflict: fs.existsSync(path.join(workspace.rootPath, preferredProjectId))
    };
  }

  function inspectPortableProject(workspaceId, archivePath) {
    const prepared = preparePortableImport(workspaceId, archivePath);
    return {
      title: prepared.title,
      preferredProjectId: prepared.preferredProjectId,
      conflict: prepared.conflict,
      slideCount: Array.isArray(prepared.inspection.flow.slides)
        ? prepared.inspection.flow.slides.length
        : 0,
      mediaCount: prepared.inspection.mediaCount,
      hasPlayer: prepared.inspection.hasPlayer
    };
  }

  async function importPortableProject(workspaceId, archivePath, importAsCopy = false) {
    const prepared = preparePortableImport(workspaceId, archivePath);
    if (prepared.conflict && !importAsCopy) {
      throw workspaceError(
        'CONFLICT',
        `A project named "${prepared.preferredProjectId}" already exists in this workspace.`
      );
    }
    const targetProjectId = prepared.conflict
      ? nextAvailableSlug(prepared.workspace.rootPath, prepared.preferredProjectId)
      : prepared.preferredProjectId;
    const flow = prepared.conflict && importAsCopy
      ? { ...prepared.inspection.flow, title: `${prepared.title} Copy` }
      : prepared.inspection.flow;
    const serializedFlow = validateAndSerializeFlow(flow);
    const temporaryRoot = path.join(
      prepared.workspace.rootPath,
      `.movement-tmp-import-${crypto.randomUUID()}`
    );
    const destinationRoot = path.join(prepared.workspace.rootPath, targetProjectId);
    fs.mkdirSync(temporaryRoot, { recursive: false });
    try {
      fs.writeFileSync(path.join(temporaryRoot, 'flow.json'), serializedFlow, {
        encoding: 'utf8',
        flag: 'wx'
      });
      for (const type of ['img', 'speech', 'audio']) {
        fs.mkdirSync(path.join(temporaryRoot, type), { recursive: false });
      }
      await extractPortableMedia(prepared.inspection, temporaryRoot);
      fs.mkdirSync(path.join(temporaryRoot, 'backups'), { recursive: false });
      fs.renameSync(temporaryRoot, destinationRoot);
    } catch (error) {
      removeTemporaryProject(prepared.workspace.rootPath, temporaryRoot);
      throw error;
    }
    return {
      ...projectSummary(prepared.workspace.rootPath, targetProjectId, false),
      importedAsCopy: prepared.conflict && importAsCopy,
      portablePlayerIncluded: prepared.inspection.hasPlayer,
      mediaCount: prepared.inspection.mediaCount
    };
  }

  function importProjectMedia(workspaceId, projectId, requestedType, selectedPath, replaceExisting = false) {
    resolveUserWorkspace(workspaceId);
    const type = mediaTypeOrThrow(requestedType);
    const projectRoot = resolveProjectRoot(workspaceId, projectId, true);
    if (!isFile(path.join(projectRoot, 'flow.json'))) {
      throw workspaceError('NOT_FOUND', 'Project not found.');
    }

    const sourcePath = path.resolve(String(selectedPath || ''));
    const { size } = validateMediaSource(type, sourcePath);
    const filename = cleanMediaFilename(sourcePath);
    const mediaRoot = path.join(projectRoot, type);
    const destinationPath = path.join(mediaRoot, filename);
    const sameFile = normalizedPathKey(sourcePath) === normalizedPathKey(destinationPath);
    const exists = isFile(destinationPath);

    if (sameFile) {
      return { status: 'success', type, filename, size, disposition: 'existing' };
    }
    if (exists && !replaceExisting) {
      return { status: 'needs_confirmation', type, filename, size };
    }

    fs.mkdirSync(mediaRoot, { recursive: true });
    const token = crypto.randomUUID();
    const temporaryPath = path.join(mediaRoot, `.${filename}.${token}.import`);
    const rollbackPath = path.join(mediaRoot, `.${filename}.${token}.previous`);
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);

    try {
      if (exists) {
        fs.renameSync(destinationPath, rollbackPath);
        try {
          fs.renameSync(temporaryPath, destinationPath);
        } catch (error) {
          fs.renameSync(rollbackPath, destinationPath);
          throw error;
        }
        try {
          fs.rmSync(rollbackPath, { force: true });
        } catch {
          // A hidden rollback copy is safer than failing after the replacement succeeded.
        }
      } else {
        fs.renameSync(temporaryPath, destinationPath);
      }
    } finally {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Ignore cleanup failure for an already-moved temporary file.
      }
    }

    return {
      status: 'success',
      type,
      filename,
      size,
      disposition: exists ? 'replaced' : 'imported'
    };
  }

  function getProjectThumbnail(workspaceId, projectId) {
    const projectRoot = resolveProjectRoot(workspaceId, projectId);
    const flowPath = path.join(projectRoot, 'flow.json');
    if (!isFile(flowPath)) return null;
    let openingImage = '';
    try {
      const flow = readJson(flowPath);
      openingImage = typeof flow.openingImage === 'string'
        ? path.basename(flow.openingImage)
        : '';
    } catch {
      return null;
    }
    if (!openingImage) return null;
    const imagePath = path.join(projectRoot, 'img', openingImage);
    const mimeType = IMAGE_TYPES.get(path.extname(openingImage).toLowerCase());
    if (!mimeType || !isFile(imagePath) || fs.statSync(imagePath).size > MAX_THUMBNAIL_BYTES) {
      return null;
    }
    return `data:${mimeType};base64,${fs.readFileSync(imagePath).toString('base64')}`;
  }

  return Object.freeze({
    listWorkspaces,
    getCurrentWorkspace,
    selectWorkspace,
    createWorkspace,
    listProjects,
    createProject,
    loadProjectFlow,
    saveProjectFlow,
    copyExample,
    duplicateProject,
    renameProject,
    moveProjectToTrash,
    listTrashedProjects,
    restoreProjectFromTrash,
    deleteTrashedProject,
    resolveProjectAssetPath,
    listProjectMedia,
    getProjectMediaOverview,
    moveUnusedProjectMediaToTrash,
    exportPortableProject,
    inspectPortableProject,
    importPortableProject,
    importProjectMedia,
    getProjectThumbnail
  });
}

module.exports = {
  EXAMPLES_WORKSPACE_ID,
  MAX_BACKUPS,
  WORKSPACE_METADATA,
  cleanWorkspaceName,
  createWorkspaceService,
  isRecognizedWorkspace,
  scanProjects,
  slugifyProjectName,
  validateAndSerializeFlow
};
