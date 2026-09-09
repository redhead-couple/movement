const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const manifestRelativePath = 'distribution/media-provenance.json';
const privateExcludedDirectories = ['private-data', 'slidedeck'];
const forbiddenManifestSegments = [
  'private-data',
  'slidedeck',
  'backups',
  '.movement-media-trash'
];
const forbiddenManifestNames = ['.save.lock'];

function normalizePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function readManifest(root) {
  const manifestPath = path.join(root, ...manifestRelativePath.split('/'));
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Media provenance manifest is missing: ' + manifestPath);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function listPublicMediaFiles(root, manifest) {
  const extensions = new Set(manifest.inventory.mediaExtensions.map(value => value.toLowerCase()));
  const excludedDirectories = new Set(
    [
      ...manifest.inventory.excludedDirectoryNames,
      ...privateExcludedDirectories
    ].map(value => value.toLowerCase())
  );
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name.toLowerCase())) visit(absolutePath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(normalizePath(path.relative(root, absolutePath)));
      }
    }
  }

  visit(root);
  return files.sort();
}

function validatePublicPath(relativePath, manifest, label) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || path.isAbsolute(relativePath)
    || relativePath.includes('\\')
  ) {
    throw new Error(label + ' is not a safe repository-relative path: ' + relativePath);
  }

  const segments = relativePath.toLowerCase().split('/');
  if (segments.includes('..') || segments.includes('.')) {
    throw new Error(label + ' contains an unsafe path segment: ' + relativePath);
  }

  for (const forbidden of forbiddenManifestSegments) {
    if (segments.includes(forbidden.toLowerCase())) {
      throw new Error(label + ' contains forbidden private/generated state: ' + relativePath);
    }
  }
  for (const forbidden of forbiddenManifestNames) {
    if (segments.includes(forbidden.toLowerCase())) {
      throw new Error(label + ' contains forbidden private/generated state: ' + relativePath);
    }
  }
}

function selectorMatches(selector, relativePath) {
  if ((selector.excludePaths || []).includes(relativePath)) return false;
  if ((selector.paths || []).includes(relativePath)) return true;

  const extension = path.posix.extname(relativePath).toLowerCase();
  return (selector.directories || []).some(directory => (
    relativePath.startsWith(directory + '/')
    && (!selector.extensions || selector.extensions.includes(extension))
  ));
}

function validateManifest(manifest) {
  if (!manifest || manifest.name !== 'movement-public-media-provenance') {
    throw new Error('Media provenance manifest has an invalid name.');
  }
  if (!manifest.inventory || !Array.isArray(manifest.inventory.mediaExtensions)) {
    throw new Error('Media provenance manifest has no media-extension inventory.');
  }
  if (!Array.isArray(manifest.provenanceRecords) || manifest.provenanceRecords.length === 0) {
    throw new Error('Media provenance manifest has no provenance records.');
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('Media provenance manifest has no exact asset mappings.');
  }
  const ownerPolicy = manifest.ownerMediaPolicy;
  if (
    !ownerPolicy
    || ownerPolicy.independentReuseLicense !== 'NOT_GRANTED'
    || ownerPolicy.independentModificationLicense !== 'NOT_GRANTED'
    || ownerPolicy.relicensingPermission !== 'NOT_GRANTED'
    || ownerPolicy.standaloneRedistributionLicense !== 'NOT_GRANTED'
    || ownerPolicy.mandatoryCreditLine
      !== 'NONE_UNLESS_AN_INDIVIDUAL_ASSET_RECORD_EXPLICITLY_STATES_OTHERWISE'
    || ownerPolicy.repositoryLicense !== 'NOT_COVERED_BY_REPOSITORY_MIT'
  ) {
    throw new Error('Media provenance manifest has an incomplete owner-media policy.');
  }

  const requiredLicenseMarker = manifest.licensePolicy.requiredMediaLicenseMarker;
  const records = new Map();
  for (const record of manifest.provenanceRecords) {
    if (!record.id || records.has(record.id)) {
      throw new Error('Duplicate or missing provenance record id: ' + record.id);
    }
    if (record.repositoryLicense !== requiredLicenseMarker) {
      throw new Error(
        'Media provenance record ' + record.id
        + ' incorrectly describes repository MIT coverage.'
      );
    }
    for (const requiredField of [
      'mediaType',
      'publicArea',
      'creator',
      'sourceTool',
      'aiGeneratedStatus',
      'recognizableRealPersonStatus',
      'voiceType',
      'permissionBasis',
      'redistributionStatus',
      'modificationStatus',
      'attributionRequirement',
      'provenanceConfidence',
      'provenanceSources',
      'includedInAuthoringKit'
    ]) {
      if (!(requiredField in record)) {
        throw new Error('Media provenance record ' + record.id + ' lacks ' + requiredField + '.');
      }
    }
    for (const relativePath of [
      ...(record.selector.paths || []),
      ...(record.selector.directories || []),
      ...(record.selector.excludePaths || [])
    ]) {
      validatePublicPath(relativePath, manifest, 'Provenance selector');
    }
    records.set(record.id, record);
  }

  const assetPaths = new Set();
  for (const asset of manifest.assets) {
    validatePublicPath(asset.path, manifest, 'Media asset mapping');
    if (assetPaths.has(asset.path)) {
      throw new Error('Media provenance manifest maps a path more than once: ' + asset.path);
    }
    if (!records.has(asset.provenanceId)) {
      throw new Error(
        'Media asset ' + asset.path + ' refers to missing record ' + asset.provenanceId + '.'
      );
    }
    if (!selectorMatches(records.get(asset.provenanceId).selector, asset.path)) {
      throw new Error(
        'Media asset ' + asset.path + ' does not match provenance selector '
        + asset.provenanceId + '.'
      );
    }
    assetPaths.add(asset.path);
  }

  for (const recordId of ownerPolicy.appliesToProvenanceRecords) {
    const record = records.get(recordId);
    if (!record) {
      throw new Error('Owner-media policy refers to missing record: ' + recordId);
    }
    if (!record.redistributionStatus.startsWith('OWNER_AUTHORIZED_FOR_PROJECT_BUNDLES_ONLY')) {
      throw new Error('Owner-media record lacks project-bundle authorization: ' + recordId);
    }
    if (
      record.modificationStatus
        !== 'NO_SEPARATE_LICENSE_FOR_INDEPENDENT_MODIFICATION_REUSE_RELICENSING_OR_STANDALONE_REDISTRIBUTION'
    ) {
      throw new Error('Owner-media record grants or obscures independent reuse rights: ' + recordId);
    }
    if (
      record.attributionRequirement
        !== 'NO_MANDATORY_CREDIT_LINE_UNLESS_AN_INDIVIDUAL_ASSET_RECORD_STATES_OTHERWISE'
    ) {
      throw new Error('Owner-media record has an inconsistent credit policy: ' + recordId);
    }
  }

  for (const group of manifest.exactDuplicateGroups || []) {
    if (!/^[0-9a-f]{64}$/.test(group.sha256) || !Array.isArray(group.paths)) {
      throw new Error('Media provenance manifest contains an invalid duplicate group.');
    }
    for (const relativePath of group.paths) {
      validatePublicPath(relativePath, manifest, 'Duplicate asset path');
      if (!assetPaths.has(relativePath)) {
        throw new Error('Duplicate asset has no provenance mapping: ' + relativePath);
      }
    }
  }

  return { assetPaths, records };
}

function verifyRecordedChecksums(root, manifest, assetPaths, records, profile) {
  for (const record of manifest.provenanceRecords) {
    if (profile === 'authoring-kit' && !record.includedInAuthoringKit) continue;

    if (record.expectedSha256) {
      const paths = manifest.assets.filter(asset => asset.provenanceId === record.id);
      if (paths.length !== 1) {
        throw new Error('Record ' + record.id + ' needs one asset for expectedSha256.');
      }
      const relativePath = paths[0].path;
      if (sha256(path.join(root, ...relativePath.split('/'))) !== record.expectedSha256) {
        throw new Error('Media checksum changed without provenance review: ' + relativePath);
      }
    }

    for (const [relativePath, expectedHash] of Object.entries(
      record.expectedSha256ByPath || {}
    )) {
      if (!assetPaths.has(relativePath)) {
        throw new Error('Checksum refers to an unrecorded media path: ' + relativePath);
      }
      if (sha256(path.join(root, ...relativePath.split('/'))) !== expectedHash) {
        throw new Error('Media checksum changed without provenance review: ' + relativePath);
      }
    }
  }

  for (const group of manifest.exactDuplicateGroups || []) {
    for (const relativePath of group.paths) {
      if (profile === 'authoring-kit') {
        const asset = manifest.assets.find(item => item.path === relativePath);
        if (!records.get(asset.provenanceId).includedInAuthoringKit) continue;
      }
      if (sha256(path.join(root, ...relativePath.split('/'))) !== group.sha256) {
        throw new Error('Recorded exact duplicate checksum changed: ' + relativePath);
      }
    }
  }
}

function verifyMediaProvenance(root = repositoryRoot, options = {}) {
  const profile = options.profile || 'source';
  if (!['source', 'authoring-kit'].includes(profile)) {
    throw new Error('Unknown media provenance verification profile: ' + profile);
  }

  const safeRoot = path.resolve(root);
  const manifest = readManifest(safeRoot);
  const { assetPaths, records } = validateManifest(manifest);
  const expectedAssets = manifest.assets.filter(asset => (
    profile === 'source' || records.get(asset.provenanceId).includedInAuthoringKit
  ));
  const expectedPaths = new Set(expectedAssets.map(asset => asset.path));
  const actualFiles = listPublicMediaFiles(safeRoot, manifest);
  const actualPaths = new Set(actualFiles);

  for (const relativePath of actualFiles) {
    if (!expectedPaths.has(relativePath)) {
      throw new Error('Public media has no provenance record: ' + relativePath);
    }
  }
  for (const relativePath of expectedPaths) {
    if (!actualPaths.has(relativePath)) {
      throw new Error('Media provenance manifest refers to a missing file: ' + relativePath);
    }
  }

  const expectedCount = profile === 'source'
    ? manifest.inventory.expectedSourceFileCount
    : manifest.inventory.expectedAuthoringKitFileCount;
  if (actualFiles.length !== expectedCount || expectedPaths.size !== expectedCount) {
    throw new Error(
      'Media provenance count mismatch for ' + profile + ': files=' + actualFiles.length
      + ' mappings=' + expectedPaths.size + ' expected=' + expectedCount
    );
  }

  const recordCounts = new Map();
  for (const asset of expectedAssets) {
    recordCounts.set(asset.provenanceId, (recordCounts.get(asset.provenanceId) || 0) + 1);
  }
  for (const record of manifest.provenanceRecords) {
    if (profile === 'authoring-kit' && !record.includedInAuthoringKit) continue;
    const count = recordCounts.get(record.id) || 0;
    if (count !== record.expectedFileCount) {
      throw new Error(
        'Provenance record count mismatch for ' + record.id + ': mapped=' + count
        + ' expected=' + record.expectedFileCount
      );
    }
  }

  verifyRecordedChecksums(safeRoot, manifest, assetPaths, records, profile);

  let totalBytes = 0;
  const uniqueHashes = new Set();
  const inventoryHash = crypto.createHash('sha256');
  for (const relativePath of actualFiles) {
    const filename = path.join(safeRoot, ...relativePath.split('/'));
    const fileHash = sha256(filename);
    totalBytes += fs.statSync(filename).size;
    uniqueHashes.add(fileHash);
    inventoryHash.update(relativePath + '\0' + fileHash + '\n');
  }
  const inventorySha256 = inventoryHash.digest('hex');
  const expectedInventorySha256 = profile === 'source'
    ? manifest.inventory.expectedSourceInventorySha256
    : manifest.inventory.expectedAuthoringKitInventorySha256;
  if (inventorySha256 !== expectedInventorySha256) {
    throw new Error(
      'Public media inventory checksum changed for ' + profile + ': actual='
      + inventorySha256 + ' expected=' + expectedInventorySha256
    );
  }
  if (profile === 'source') {
    if (totalBytes !== manifest.inventory.expectedSourceTotalBytes) {
      throw new Error(
        'Public media byte count changed: actual=' + totalBytes
        + ' expected=' + manifest.inventory.expectedSourceTotalBytes
      );
    }
    if (uniqueHashes.size !== manifest.inventory.expectedUniqueSha256) {
      throw new Error(
        'Public media unique-hash count changed: actual=' + uniqueHashes.size
        + ' expected=' + manifest.inventory.expectedUniqueSha256
      );
    }
  }

  return {
    fileCount: actualFiles.length,
    mappedCount: expectedPaths.size,
    profile,
    provenanceRecordCount: manifest.provenanceRecords.length,
    totalBytes,
    inventorySha256,
    uniqueSha256: uniqueHashes.size
  };
}

if (require.main === module) {
  try {
    const profileArgument = process.argv.find(value => value.startsWith('--profile='));
    const profile = profileArgument ? profileArgument.slice('--profile='.length) : 'source';
    const rootArgument = process.argv.slice(2).find(value => !value.startsWith('--'));
    const result = verifyMediaProvenance(rootArgument || repositoryRoot, { profile });
    console.log(
      'MEDIA_PROVENANCE_VERIFY_OK profile=' + result.profile + ' files=' + result.fileCount
      + ' mapped=' + result.mappedCount + ' records=' + result.provenanceRecordCount
      + ' bytes=' + result.totalBytes + ' uniqueSha256=' + result.uniqueSha256
      + ' inventorySha256=' + result.inventorySha256
    );
  } catch (error) {
    console.error('MEDIA_PROVENANCE_VERIFY_FAILED ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  listPublicMediaFiles,
  selectorMatches,
  validateManifest,
  verifyMediaProvenance
};
