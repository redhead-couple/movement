const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeStoredZip } = require('./portable-project-service.cjs');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const HOST_CONTRACTS = Object.freeze({
  effect: {
    id: 'movement-effect-host-1',
    sharedFiles: ['effects/effect-media.js', 'studio/maker/maker-engine.js', 'studio/maker/maker-theme.css']
  },
  transition: { id: 'movement-transition-host-1', sharedFiles: [] }
});

function reject(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function supportsHostRequirements(type, requirements) {
  if (!Object.prototype.hasOwnProperty.call(HOST_CONTRACTS, type)) return false;
  const contract = HOST_CONTRACTS[type];
  return Boolean(requirements && requirements.hostContract === contract.id
    && Array.isArray(requirements.sharedFiles)
    && requirements.sharedFiles.every(file => contract.sharedFiles.includes(file))
    && new Set(requirements.sharedFiles).size === requirements.sharedFiles.length);
}

function createComponentExportService({ applicationRoot }) {
  if (!path.isAbsolute(applicationRoot)) throw new TypeError('An absolute application root is required.');
  const root = path.resolve(applicationRoot);

  function readLocalFile(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\')
      || relative.split('/').some(part => !part || part === '.' || part === '..')
      || /[:\0]/.test(relative) || path.isAbsolute(relative)) {
      reject('The component review contains an invalid local path.');
    }
    let filename = root;
    for (const part of relative.split('/')) {
      filename = path.join(filename, part);
      if (!fs.existsSync(filename) || fs.lstatSync(filename).isSymbolicLink()) {
        reject(`Required file is missing or linked: ${relative}`);
      }
    }
    const stats = fs.statSync(filename);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) reject(`Required file is invalid or too large: ${relative}`);
    return fs.readFileSync(filename);
  }

  function prepare(type, id) {
    if (/\.asar(?:[\\/]|$)/i.test(root)) reject('Component export requires the editable Windows Authoring Kit.');
    if (!['effects', 'transitions'].includes(type) || typeof id !== 'string' || !SLUG.test(id)) {
      reject('Choose a valid effect or transition.');
    }
    const kind = type === 'effects' ? 'effect' : 'transition';
    const registry = JSON.parse(readLocalFile(`${type}/registry.json`).toString('utf8'));
    if (!Array.isArray(registry) || !registry.some(group => (
      String(group.engines || '').split(',').map(value => value.trim()).includes(id)
    ))) reject('Save this component in the registry before exporting it.');

    const catalog = JSON.parse(readLocalFile('desktop/component-export-reviews.json').toString('utf8'));
    if (catalog.formatVersion !== 1 || !Array.isArray(catalog.components)) reject('The component export review catalog is invalid.');
    const matches = catalog.components.filter(item => item.type === kind && item.id === id);
    if (matches.length !== 1) {
      reject('Export unavailable: this component has no reviewed dependency and license declaration.');
    }
    const review = matches[0];
    const contract = HOST_CONTRACTS[kind];
    if (!supportsHostRequirements(kind, review)
      || !Array.isArray(review.assets) || review.assets.length !== 0
      || typeof review.name !== 'string' || !review.name.trim()) {
      reject('Export unavailable: the reviewed requirements are outside the supported host contract.');
    }
    const maker = `${type}/${id}-maker.html`;
    const engine = `${type}/${id}-engine.js`;
    const makerBytes = readLocalFile(maker);
    const engineBytes = readLocalFile(engine);
    if (sha256(makerBytes) !== review.makerSha256 || sha256(engineBytes) !== review.engineSha256) {
      reject('Export unavailable: maker or engine changed since dependency and license review. Review the changed source before exporting.');
    }
    if (!review.license || !review.license.source || !review.license.sha256) {
      reject('Export unavailable: an explicit component license notice is required.');
    }
    if (review.license.source !== 'LICENSE'
      && !/^desktop\/component-licenses\/[a-z0-9][a-z0-9._-]*$/i.test(review.license.source)) {
      reject('The license notice must be LICENSE or a file under desktop/component-licenses.');
    }
    const licenseBytes = readLocalFile(review.license.source);
    if (!licenseBytes.toString('utf8').trim() || sha256(licenseBytes) !== review.license.sha256) {
      reject('Export unavailable: the component license notice changed or is empty.');
    }
    for (const file of review.sharedFiles) readLocalFile(file);

    const manifest = {
      formatVersion: 1,
      type: kind,
      id,
      name: review.name,
      maker,
      engine,
      requires: { hostContract: contract.id, sharedFiles: [...review.sharedFiles] },
      license: 'LICENSE'
    };
    return {
      manifest,
      entries: [
        { name: 'component.json', buffer: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
        { name: 'LICENSE', buffer: licenseBytes },
        { name: maker, buffer: makerBytes },
        { name: engine, buffer: engineBytes }
      ]
    };
  }

  function eligibility(type, id) {
    try {
      prepare(type, id);
      return { eligible: true, reason: '' };
    } catch (error) {
      return { eligible: false, reason: error.message };
    }
  }

  function exportComponent({ type, id, destinationPath }) {
    if (typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath)
      || !destinationPath.toLowerCase().endsWith('.component.zip')) {
      reject('Choose a filename ending in .component.zip.');
    }
    // Snapshot and validate bytes again after the Save dialog. Never import/evaluate source.
    const prepared = prepare(type, id);
    const archiveSize = writeStoredZip(destinationPath, prepared.entries);
    return { cancelled: false, filename: path.basename(destinationPath), archiveSize };
  }

  return Object.freeze({ prepare, eligibility, exportComponent });
}

module.exports = { createComponentExportService, HOST_CONTRACTS, supportsHostRequirements };
