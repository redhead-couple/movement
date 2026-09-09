const fs = require('node:fs');
const path = require('node:path');
const { verifyMediaProvenance } = require('./verify-media-provenance.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const defaultUnpackedRoot = path.join(
  repositoryRoot,
  'dist',
  'desktop-authoring-kit',
  'win-unpacked'
);

function listFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
      }
    }
  }

  visit(root);
  return files;
}

function listExampleProjectIds(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(projectId => fs.existsSync(path.join(root, projectId, 'flow.json')))
    .sort();
}

function verifyAuthoringKit(unpackedRoot = defaultUnpackedRoot) {
  const safeUnpackedRoot = path.resolve(unpackedRoot);
  const applicationRoot = path.join(safeUnpackedRoot, 'resources', 'app');
  const manifestPath = path.join(
    applicationRoot,
    'distribution',
    'desktop-authoring-kit.manifest.json'
  );

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Authoring Kit manifest is missing: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const packagedFiles = listFiles(applicationRoot);
  const packagedSet = new Set(packagedFiles);

  for (const requiredPath of manifest.requiredPaths) {
    if (!packagedSet.has(requiredPath)) {
      throw new Error(`Authoring Kit required file is missing: ${requiredPath}`);
    }
  }

  for (const relativePath of packagedFiles) {
    const lowerPath = relativePath.toLowerCase();
    const segments = lowerPath.split('/');
    const extension = path.extname(lowerPath);

    if (manifest.forbiddenExtensions.includes(extension)) {
      throw new Error(`Authoring Kit contains a forbidden file: ${relativePath}`);
    }

    for (const forbiddenPath of manifest.forbiddenPaths) {
      if (segments.includes(forbiddenPath.toLowerCase())) {
        throw new Error(`Authoring Kit contains a forbidden path: ${relativePath}`);
      }
    }
  }

  const mediaProvenancePath = path.join(
    applicationRoot,
    'distribution',
    'media-provenance.json'
  );
  const mediaProvenance = fs.existsSync(mediaProvenancePath)
    ? verifyMediaProvenance(applicationRoot, { profile: 'authoring-kit' })
    : null;

  if (fs.existsSync(path.join(safeUnpackedRoot, 'resources', 'app.asar'))) {
    throw new Error('Authoring Kit source was packed into app.asar.');
  }

  const editablePaths = [
    path.join(applicationRoot, 'effects', 'registry.json'),
    path.join(applicationRoot, 'transitions', 'registry.json')
  ];
  for (const editablePath of editablePaths) {
    fs.accessSync(editablePath, fs.constants.R_OK | fs.constants.W_OK);
  }

  const executablePath = path.join(safeUnpackedRoot, 'Movement Timeline Studio.exe');
  const readmePath = path.join(safeUnpackedRoot, 'README-FIRST.md');
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Authoring Kit executable is missing: ${executablePath}`);
  }
  if (!fs.existsSync(readmePath)) {
    throw new Error(`Authoring Kit start guide is missing: ${readmePath}`);
  }

  const sourceExampleIds = listExampleProjectIds(path.join(repositoryRoot, 'examples'));
  const packagedExampleIds = listExampleProjectIds(path.join(applicationRoot, 'examples'));
  if (JSON.stringify(packagedExampleIds) !== JSON.stringify(sourceExampleIds)) {
    throw new Error('Authoring Kit does not contain the complete bundled Examples workspace.');
  }

  const workspaceRoot = path.join(safeUnpackedRoot, 'workspace');
  const userWorkspaceNames = fs.existsSync(workspaceRoot)
    ? fs.readdirSync(workspaceRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => fs.existsSync(path.join(
        workspaceRoot,
        entry.name,
        '.movement-workspace.json'
      )))
      .map(entry => entry.name)
    : [];
  if (userWorkspaceNames.length > 0) {
    throw new Error('Authoring Kit must begin without a pre-created user workspace.');
  }

  return {
    applicationRoot,
    executablePath,
    exampleCount: packagedExampleIds.length,
    fileCount: packagedFiles.length,
    mediaFileCount: mediaProvenance ? mediaProvenance.fileCount : 0,
    userWorkspaceCount: userWorkspaceNames.length
  };
}

if (require.main === module) {
  try {
    const result = verifyAuthoringKit(process.argv[2] || defaultUnpackedRoot);
    console.log(
      `AUTHORING_KIT_VERIFY_OK files=${result.fileCount} examples=${result.exampleCount} `
      + `userWorkspaces=${result.userWorkspaceCount} app=${result.applicationRoot}`
    );
  } catch (error) {
    console.error(`AUTHORING_KIT_VERIFY_FAILED ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  defaultUnpackedRoot,
  verifyAuthoringKit
};
