const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { websiteFiles } = require('./web-files.cjs');

const root = path.resolve(__dirname, '..');
const version = '0.1.0-alpha.8';
const baseline = '9f48b7a';
const files = [
  'assets/app.css', 'download.php', 'media.php', 'project-media.php',
  'server/core/media-trash.php', 'shared/frontend/platform-adapter.js',
  'studio/editor/json-maker-logic.js', 'studio/editor/media-trash-preview.js',
  'studio/player/player-runtime.js', 'templates/media-trash-view.php'
];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const run = (exe, args, options = {}) => execFileSync(exe, args, {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options
});
assert.equal(require('../package.json').version, version);
// Fixed baseline and explicit inventory prevent unrelated website assets from
// slipping into this targeted update and prevent silently missing later edits.
const allowed = new Set(websiteFiles(root));
const changed = run('git', ['diff', '--name-only', baseline]).trim().split(/\r?\n/);
const untracked = run('git', ['ls-files', '--others', '--exclude-standard']).trim().split(/\r?\n/);
assert.deepEqual([...new Set([...changed, ...untracked])].filter(file => allowed.has(file)).sort(), [...files].sort());
for (const file of files.filter(file => file.endsWith('.php'))) run('php', ['-l', path.join(root, file)]);

const output = path.join(root, 'dist', 'website-update-alpha.8');
assert.equal(path.dirname(output), path.join(root, 'dist'));
assert.ok(!fs.existsSync(output), 'Update output already exists; keep the previous verified package.');
assert.ok(!fs.lstatSync(path.join(root, 'dist')).isSymbolicLink());
const upload = path.join(output, 'upload');
fs.mkdirSync(upload, { recursive: true });
const manifest = { version, baselineCommit: run('git', ['rev-parse', baseline]).trim(),
  createdAt: new Date().toISOString(), websiteFiles: files, files: {} };
function put(relative, bytes) {
  assert.ok(!relative.split('/').some(part => part === '..' || part === '.'));
  const target = path.join(upload, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  manifest.files[relative] = { bytes: bytes.length, sha256: hash(bytes) };
}
for (const file of files) put(file, fs.readFileSync(path.join(root, file)));
for (const [kind, relative] of [
  ['kit', `desktop-authoring-kit/Movement Timeline Studio-Authoring-Kit-${version}-x64.zip`],
  ['installer', `Movement Timeline Studio-Setup-${version}-x64.exe`]
]) {
  const report = JSON.parse(fs.readFileSync(path.join(root, `dist/verification-${version}/${kind}.json`)));
  assert.equal(report.verifiedFromFinalArtifact, true);
  assert.equal(report.audioPreloadVerified, true);
  const bytes = fs.readFileSync(path.join(root, 'dist', relative));
  assert.equal(hash(bytes), report.sha256, 'Desktop download differs from verified release');
  const name = path.basename(relative);
  put(`downloads/${version}/${name}`, bytes);
  put(`downloads/${version}/${name}.sha256`, Buffer.from(`${report.sha256}  ${name}\n`));
}
put(`downloads/${version}/release-notes.txt`, Buffer.from(`Movement Timeline Studio ${version}\n\nWindows 10 / 11 x64\n\nWhat's new\n- More reliable audio and speech preloading, with retry after a failed load.\n- Media Trash with image previews, audio playback, restoration and confirmed emptying.\n- Includes earlier saving, media recovery, effects and export fixes.\n\nAuthoring Kit: extract the entire ZIP into a new folder and run Movement Timeline Studio.exe. Preserve your existing workspace and custom engines when updating.\nInstaller: run the EXE to install or update Movement.\n\nBoth downloads are unsigned alpha builds. Normal local authoring and playback work without an internet connection.\n`));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
fs.writeFileSync(path.join(output, 'UPLOAD-LIST.txt'), Object.keys(manifest.files).sort().join('\n')+'\n');
fs.writeFileSync(path.join(output, 'READ-ME-FIRST.txt'), `Movement website update ${version}\n\nThis package includes only the 10 website files changed for this update and the verified alpha.8 desktop downloads. There are no concept/ or effects/ files.\n\nFileZilla: upload the CONTENTS of upload/ into the existing website root. Upload downloads/ first, then the other files, and download.php last. Merge folders and replace matching files.\n\ncPanel: upload Movement-website-update-alpha.8.zip into the website root, extract there and allow replacement of matching files. The ZIP has no wrapper directory. After successful extraction, delete only this outer update ZIP from the server; keep downloads/ and its ZIP/EXE files.\n\nDo not delete existing folders. Do not replace app-config.php, private-data/ or examples/. They are not included. No database changes are needed.\n\nAfter upload, open /download.php, confirm version alpha.8 and test both download buttons. Check Media Trash and slideshow playback. Nothing has been uploaded automatically.\n`);
const archive = path.join(output, 'Movement-website-update-alpha.8.zip');
run('C:/Program Files/7-Zip/7z.exe', ['a', '-tzip', '-mx=0', archive, ...Object.keys(manifest.files)], { cwd: upload });
fs.writeFileSync(archive+'.sha256', `${hash(fs.readFileSync(archive))}  ${path.basename(archive)}\n`);
console.log(`WEB_UPDATE_BUILT ${archive}\nWebsite files: ${files.length}; total entries: ${Object.keys(manifest.files).length}`);
