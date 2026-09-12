const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { websiteFiles } = require('./web-files.cjs');

const sourceRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(sourceRoot, 'dist', 'website');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

function buildWeb(root = sourceRoot, destination = outputRoot) {
  // Destructive local cleanup is restricted to this one generated directory.
  if (destination !== path.join(root, 'dist', 'website')) throw new Error('Unexpected build directory');
  for (const candidate of [path.join(root, 'dist'), destination]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Build destination must not be a link');
  }
  const files = websiteFiles(root);
  // Lint before touching the previous build. Never load the real configuration.
  for (const relative of files.filter(name => name.endsWith('.php'))) {
    const check = spawnSync('php', ['-l', path.join(root, relative)], { encoding: 'utf8', windowsHide: true });
    if (check.error || check.status !== 0) throw new Error(`PHP lint failed: ${relative}. Check the file privately.`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  const upload = path.join(destination, 'upload');
  const manifest = { format: 1, files: {}, expectations: {
    config: '../app-config.php', privateData: 'private-data', examples: 'examples',
  } };
  for (const relative of files) {
    const data = fs.readFileSync(path.join(root, relative));
    const target = path.join(upload, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    // Preserve source timestamps for optional manual SFTP synchronization.
    const stat = fs.statSync(path.join(root, relative));
    fs.utimesSync(target, stat.atime, stat.mtime);
    manifest.files[relative] = { sha256: hash(data), bytes: data.length };
  }
  const bytes = Object.values(manifest.files).reduce((total, file) => total + file.bytes, 0);
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'UPLOAD-LIST.txt'), files.join('\n') + '\n');
  fs.writeFileSync(path.join(destination, 'PRESERVE.txt'),
    'LIVE PATHS NOT YET CONFIRMED. Confirm the website root and preserved paths before deleting anything.\n' +
    'Preserve external app-config.php, private-data/ and examples/ recursively.\n' +
    'No local copies of these files/directories are included or transferred.\n' +
    'No database operations. See docs/WEB_DEPLOYMENT.md.\n');
  const zip = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(sourceRoot, 'tools/Zip-WebBuild.ps1'), '-BuildRoot', destination], { encoding: 'utf8', windowsHide: true });
  if (zip.error || zip.status !== 0) throw new Error('ZIP creation/verification failed: ' + (zip.stderr || zip.error?.message));
  console.log(zip.stdout.trim());
  console.log(`Website build: ${files.length} files, ${(bytes / 1048576).toFixed(2)} MiB\n${upload}`);
  return { upload, manifest };
}

if (require.main === module) {
  try { buildWeb(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildWeb, hash };
