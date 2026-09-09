const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PRODUCT_NAME = 'Movement Timeline Studio';
const STORAGE_DIRECTORY_SEGMENTS = ['private-data', 'slidedeck'];
const PORTABLE_STORAGE_DIRECTORY = 'workspace';

function requireAbsolutePath(candidate, description) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new TypeError(`${description} must be an absolute path.`);
  }
  return path.resolve(candidate);
}

function resolvePackagedStorageRoot(documentsRoot, productName = DEFAULT_PRODUCT_NAME) {
  const safeDocumentsRoot = requireAbsolutePath(documentsRoot, 'Documents folder');
  const safeProductName = String(productName || '').trim();
  if (!safeProductName || safeProductName === '.' || safeProductName === '..') {
    throw new TypeError('Product name is required.');
  }
  if (safeProductName.includes('/') || safeProductName.includes('\\')) {
    throw new TypeError('Product name cannot contain path separators.');
  }

  return path.join(safeDocumentsRoot, safeProductName, ...STORAGE_DIRECTORY_SEGMENTS);
}

function resolvePortableStorageRoot(executablePath) {
  const safeExecutablePath = requireAbsolutePath(executablePath, 'Application executable');
  return path.join(path.dirname(safeExecutablePath), PORTABLE_STORAGE_DIRECTORY);
}

function getStorageLocationLabel(isPackaged, productName = DEFAULT_PRODUCT_NAME) {
  return isPackaged
    ? `Documents / ${productName} / ${STORAGE_DIRECTORY_SEGMENTS.join(' / ')}`
    : `Development project / ${STORAGE_DIRECTORY_SEGMENTS.join(' / ')}`;
}

function getPortableStorageLocationLabel() {
  return `Extracted application / ${PORTABLE_STORAGE_DIRECTORY}`;
}

function prepareWritableStorageRoot(storageRoot) {
  const safeStorageRoot = requireAbsolutePath(storageRoot, 'Project library');
  const probeName = `.movement-write-test-${process.pid}-${crypto.randomUUID()}.tmp`;
  const probePath = path.join(safeStorageRoot, probeName);

  try {
    fs.mkdirSync(safeStorageRoot, { recursive: true });
    fs.writeFileSync(probePath, 'Movement write check', {
      encoding: 'utf8',
      flag: 'wx'
    });
    fs.unlinkSync(probePath);
  } catch (error) {
    try {
      fs.rmSync(probePath, { force: true });
    } catch {
      // Preserve the original storage error.
    }

    const storageError = new Error(
      'Movement Timeline Studio cannot write to its project library. '
      + 'Check the permissions for your Documents folder and try again.'
    );
    storageError.code = 'STORAGE_NOT_WRITABLE';
    storageError.cause = error;
    throw storageError;
  }

  return safeStorageRoot;
}

module.exports = {
  DEFAULT_PRODUCT_NAME,
  getPortableStorageLocationLabel,
  getStorageLocationLabel,
  prepareWritableStorageRoot,
  resolvePackagedStorageRoot,
  resolvePortableStorageRoot
};
