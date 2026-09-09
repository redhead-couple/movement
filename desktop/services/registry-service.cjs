const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_REGISTRY_BYTES = 512 * 1024;
const MAX_REGISTRY_BACKUPS = 20;
const REGISTRY_BACKUP_DIRECTORY = '.movement-registry-backups';
const ENGINE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isFile(filename) {
  try {
    return fs.statSync(filename).isFile();
  } catch {
    return false;
  }
}

function normalizeUrlPath(filename) {
  return filename.split(path.sep).join('/');
}

function revisionFor(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function atomicWrite(filename, contents) {
  const temporaryPath = path.join(
    path.dirname(filename),
    `.movement-${path.basename(filename)}-${process.pid}-${crypto.randomUUID()}.tmp`
  );
  fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporaryPath, filename);
  } finally {
    if (isFile(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function createRegistryService({
  applicationRoot,
  forceReadOnly = false,
  maxBackups = MAX_REGISTRY_BACKUPS
}) {
  if (typeof applicationRoot !== 'string' || !path.isAbsolute(applicationRoot)) {
    throw new TypeError('Application root must be an absolute path.');
  }
  if (!Number.isInteger(maxBackups) || maxBackups < 1) {
    throw new TypeError('Registry backup limit must be a positive integer.');
  }

  const safeApplicationRoot = path.resolve(applicationRoot);
  const registryConfig = Object.freeze({
    effects: {
      label: 'Effects',
      registryPath: path.join(safeApplicationRoot, 'effects', 'registry.json'),
      engineDirectory: path.join(safeApplicationRoot, 'effects'),
      makerDirectory: path.join(safeApplicationRoot, 'effects'),
      assetDirectory: 'effects'
    },
    transitions: {
      label: 'Transitions',
      registryPath: path.join(safeApplicationRoot, 'transitions', 'registry.json'),
      engineDirectory: path.join(safeApplicationRoot, 'transitions'),
      makerDirectory: path.join(safeApplicationRoot, 'transitions'),
      assetDirectory: 'transitions'
    }
  });

  function getConfig(type) {
    if (!Object.prototype.hasOwnProperty.call(registryConfig, type)) {
      throw registryError('UNKNOWN_REGISTRY', 'Choose the effects or transitions registry.');
    }
    return registryConfig[type];
  }

  function readRegistrySource(type) {
    const config = getConfig(type);
    let source;
    try {
      source = fs.readFileSync(config.registryPath, 'utf8');
    } catch {
      throw registryError('REGISTRY_UNAVAILABLE', `${config.label} registry could not be read.`);
    }
    if (Buffer.byteLength(source, 'utf8') > MAX_REGISTRY_BYTES) {
      throw registryError('REGISTRY_TOO_LARGE', `${config.label} registry is too large.`);
    }
    return source;
  }

  function parseRegistry(type, source) {
    const config = getConfig(type);
    let registry;
    try {
      registry = JSON.parse(source);
    } catch {
      throw registryError('INVALID_REGISTRY', `${config.label} registry contains invalid JSON.`);
    }
    if (!Array.isArray(registry)) {
      throw registryError('INVALID_REGISTRY', `${config.label} registry must contain a JSON array.`);
    }
    return registry;
  }

  function discoverRegistryAssets(type) {
    const config = getConfig(type);
    const available = [];
    const issues = [];
    const engineNames = fs.existsSync(config.engineDirectory)
      ? fs.readdirSync(config.engineDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('-engine.js'))
        .map(entry => entry.name.slice(0, -'-engine.js'.length))
      : [];
    const candidateNames = [...new Set(engineNames)]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const engine of candidateNames) {
      if (!ENGINE_NAME_PATTERN.test(engine)) {
        issues.push({ engine, reason: `Unsupported effect or transition name: ${engine}` });
        continue;
      }

      const engineFile = `${engine}-engine.js`;
      const makerFile = `${engine}-maker.html`;
      const makerPath = path.join(config.makerDirectory, makerFile);
      const enginePath = path.join(config.engineDirectory, engineFile);
      const makerRelativePath = normalizeUrlPath(path.join(config.assetDirectory, makerFile));
      const engineRelativePath = normalizeUrlPath(path.join(config.assetDirectory, engineFile));
      const warnings = [];
      if (!isFile(makerPath)) warnings.push(`Maker file is missing: ${makerRelativePath}`);
      if (!isFile(enginePath)) warnings.push(`Engine file is missing: ${engineRelativePath}`);
      warnings.forEach(reason => issues.push({ engine, reason }));

      available.push({
        engine,
        maker: makerRelativePath,
        engineFile: engineRelativePath,
        status: warnings.length ? 'needs-attention' : 'available',
        warnings
      });
    }

    return { available, issues };
  }

  function normalizeRegistryInput(type, input) {
    if (!Array.isArray(input)) {
      throw registryError('INVALID_REGISTRY', 'Registry categories must be an array.');
    }

    const usedCategories = new Set();
    const usedEngines = new Set();

    return input.map((group, index) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        throw registryError('INVALID_CATEGORY', `Category ${index + 1} is invalid.`);
      }

      const category = String(group.Category || '').trim();
      if (!category) {
        throw registryError('INVALID_CATEGORY', `Category ${index + 1} needs a name.`);
      }
      if (category.length > 80) {
        throw registryError('INVALID_CATEGORY', `Category "${category}" is too long.`);
      }
      const categoryKey = category.toLowerCase();
      if (usedCategories.has(categoryKey)) {
        throw registryError('DUPLICATE_CATEGORY', `Category "${category}" is duplicated.`);
      }
      usedCategories.add(categoryKey);

      const rawEngines = Array.isArray(group.engines)
        ? group.engines
        : String(group.engines || '').split(',');
      const engines = rawEngines.map(value => String(value || '').trim()).filter(Boolean);
      for (const engine of engines) {
        if (!ENGINE_NAME_PATTERN.test(engine)) {
          throw registryError(
            'UNSAFE_ENGINE_NAME',
            `"${engine}" must use lowercase letters, numbers, and single hyphens only.`
          );
        }
        if (usedEngines.has(engine)) {
          throw registryError(
            'DUPLICATE_ENGINE',
            `"${engine}" appears in more than one category.`
          );
        }
        usedEngines.add(engine);
      }

      return {
        Category: category,
        engines: engines.join(', ')
      };
    });
  }

  function buildRegistryPayload(type) {
    const source = readRegistrySource(type);
    const registry = parseRegistry(type, source);
    if (!registry.some(group => String(group && group.Category || '').trim().toLowerCase() === 'experimental')) {
      registry.push({ Category: 'Experimental', engines: '' });
    }
    const discovered = discoverRegistryAssets(type);
    const availableNames = new Set(discovered.available.map(item => item.engine));
    const invalidEntries = [];

    for (const group of registry) {
      String(group && group.engines || '')
        .split(',')
        .map(engine => engine.trim())
        .filter(Boolean)
        .forEach(engine => {
          if (!availableNames.has(engine)) invalidEntries.push(engine);
        });
    }
    for (const engine of [...new Set(invalidEntries)]) {
      const config = getConfig(type);
      discovered.available.push({
        engine,
        maker: normalizeUrlPath(path.join(config.assetDirectory, `${engine}-maker.html`)),
        engineFile: normalizeUrlPath(path.join(
          config.assetDirectory,
          `${engine}-engine.js`
        )),
        status: 'needs-attention',
        warnings: ['The expected maker and engine files were not found.']
      });
    }

    return {
      registry,
      available: discovered.available,
      issues: discovered.issues,
      invalidEntries: [...new Set(invalidEntries)],
      revision: revisionFor(source)
    };
  }

  function probeWritable() {
    if (forceReadOnly) {
      return {
        writable: false,
        reason: 'This sealed application edition cannot modify its bundled registries.'
      };
    }

    const probePath = path.join(
      safeApplicationRoot,
      `.movement-registry-write-test-${process.pid}-${crypto.randomUUID()}.tmp`
    );
    try {
      fs.writeFileSync(probePath, 'Movement registry write check', {
        encoding: 'utf8',
        flag: 'wx'
      });
      fs.unlinkSync(probePath);
      return { writable: true, reason: '' };
    } catch {
      try {
        fs.rmSync(probePath, { force: true });
      } catch {
        // The original write result is enough for the user-facing status.
      }
      return {
        writable: false,
        reason: 'The application folder is not writable. Use the Developer Edition in a writable folder.'
      };
    }
  }

  function createBackup(type) {
    const config = getConfig(type);
    const backupDirectory = path.join(safeApplicationRoot, REGISTRY_BACKUP_DIRECTORY);
    fs.mkdirSync(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${type}-registry-${stamp}-${crypto.randomUUID().slice(0, 8)}.json`;
    fs.copyFileSync(
      config.registryPath,
      path.join(backupDirectory, backupName),
      fs.constants.COPYFILE_EXCL
    );

    const backupPattern = new RegExp(`^${type}-registry-.*\\.json$`, 'i');
    const backups = fs.readdirSync(backupDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && backupPattern.test(entry.name))
      .map(entry => entry.name)
      .sort();
    for (const expired of backups.slice(0, Math.max(0, backups.length - maxBackups))) {
      fs.unlinkSync(path.join(backupDirectory, expired));
    }
    return backupName;
  }

  function listRegistries() {
    const writeStatus = probeWritable();
    return {
      effects: buildRegistryPayload('effects'),
      transitions: buildRegistryPayload('transitions'),
      writable: writeStatus.writable,
      writeBlockReason: writeStatus.reason
    };
  }

  function saveRegistry(type, input, expectedRevision) {
    const config = getConfig(type);
    const writeStatus = probeWritable();
    if (!writeStatus.writable) {
      throw registryError('REGISTRY_READ_ONLY', writeStatus.reason);
    }

    const currentSource = readRegistrySource(type);
    const currentRevision = revisionFor(currentSource);
    if (!expectedRevision || expectedRevision !== currentRevision) {
      throw registryError(
        'REGISTRY_CHANGED',
        `${config.label} registry changed on disk. Reload it before saving.`
      );
    }

    const registry = normalizeRegistryInput(type, input);
    const serialized = `${JSON.stringify(registry, null, 4)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REGISTRY_BYTES) {
      throw registryError('REGISTRY_TOO_LARGE', `${config.label} registry is too large.`);
    }

    const backupName = createBackup(type);
    atomicWrite(config.registryPath, serialized);
    return {
      ...buildRegistryPayload(type),
      backupName,
      writable: true,
      writeBlockReason: ''
    };
  }

  return Object.freeze({
    listRegistries,
    saveRegistry
  });
}

module.exports = {
  MAX_REGISTRY_BACKUPS,
  REGISTRY_BACKUP_DIRECTORY,
  createRegistryService
};
