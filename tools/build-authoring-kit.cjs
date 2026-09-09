const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Arch, Platform, build } = require('electron-builder');
const { verifyAuthoringKit } = require('./verify-authoring-kit.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(
  repositoryRoot,
  'distribution',
  'desktop-authoring-kit.manifest.json'
);
const outputDirectory = path.join(repositoryRoot, 'dist', 'desktop-authoring-kit');

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function validateManifest(manifest) {
  if (!manifest || manifest.name !== 'desktop-authoring-kit') {
    throw new Error('The Desktop Authoring Kit manifest has an invalid name.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('The Desktop Authoring Kit manifest needs a non-empty files allowlist.');
  }

  for (const pattern of manifest.files) {
    const positivePattern = pattern.startsWith('!') ? pattern.slice(1) : pattern;
    if (
      path.isAbsolute(positivePattern)
      || positivePattern.split('/').includes('..')
      || positivePattern.includes('\\')
    ) {
      throw new Error(`Unsafe Desktop Authoring Kit file pattern: ${pattern}`);
    }
  }

  const positivePatterns = manifest.files.filter(pattern => !pattern.startsWith('!'));
  for (const pattern of positivePatterns) {
    const lowerPattern = pattern.toLowerCase();
    if (
      lowerPattern.endsWith('.php')
      || lowerPattern === 'server/**/*'
      || lowerPattern === 'private-data/**/*'
      || lowerPattern === 'templates/**/*'
    ) {
      throw new Error(`Web-only path cannot be included in the Authoring Kit: ${pattern}`);
    }
  }

  return manifest;
}

function createAuthoringKitConfig(packageManifest, kitManifest) {
  return {
    appId: packageManifest.build.appId,
    productName: packageManifest.productName,
    asar: false,
    directories: {
      output: path.relative(repositoryRoot, outputDirectory)
    },
    files: kitManifest.files,
    extraFiles: [
      {
        from: 'distribution/README-FIRST.md',
        to: 'README-FIRST.md'
      },
      {
        from: 'LICENSE',
        to: 'LICENSE'
      }
    ],
    win: {
      icon: packageManifest.build.win.icon,
      target: [
        {
          target: 'zip',
          arch: ['x64']
        }
      ],
      artifactName: '${productName}-Authoring-Kit-${version}-${arch}.${ext}'
    }
  };
}

function sha256(filename) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filename));
  return hash.digest('hex');
}

async function buildAuthoringKit() {
  const packageManifest = readJson(path.join(repositoryRoot, 'package.json'));
  const kitManifest = validateManifest(readJson(manifestPath));
  const config = createAuthoringKitConfig(packageManifest, kitManifest);

  const artifacts = await build({
    projectDir: repositoryRoot,
    targets: Platform.WINDOWS.createTarget(['zip'], Arch.x64),
    config
  });

  const unpackedRoot = path.join(outputDirectory, 'win-unpacked');
  const verification = verifyAuthoringKit(unpackedRoot);
  const zipPath = artifacts.find(filename => filename.toLowerCase().endsWith('.zip'));
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error('Electron Builder did not produce the Authoring Kit ZIP.');
  }

  const checksum = sha256(zipPath);
  const checksumPath = `${zipPath}.sha256`;
  fs.writeFileSync(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`, 'utf8');

  console.log(`AUTHORING_KIT_BUILD_OK ${zipPath}`);
  console.log(`AUTHORING_KIT_SHA256 ${checksum}`);
  console.log(`AUTHORING_KIT_EDITABLE_ROOT ${verification.applicationRoot}`);

  return { artifacts, checksum, checksumPath, verification, zipPath };
}

if (require.main === module) {
  buildAuthoringKit().catch(error => {
    console.error(`AUTHORING_KIT_BUILD_FAILED ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildAuthoringKit,
  createAuthoringKitConfig,
  validateManifest
};
