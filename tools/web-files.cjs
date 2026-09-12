const fs = require('node:fs');
const path = require('node:path');

// Only these runtime locations may enter a website build. New source files in
// these locations are included even before committing; source values win.
const roots = ['assets', 'concept', 'effects', 'transitions', 'server/core',
  'templates', 'studio/authoring', 'studio/editor', 'studio/hubs', 'studio/maker', 'studio/player'];
const explicit = ['.htaccess', 'server/.htaccess', 'robots.txt', 'favicon.ico', 'img/bg_wanaka.webp',
  'LICENSE', 'MEDIA_ATTRIBUTION.md', 'shared/frontend/project-library.css',
  'shared/frontend/creator-tools.js', 'shared/frontend/platform-adapter.js'];
const desktopEntries = new Set(['studio/editor/json-maker.html', 'studio/player/local-player.html',
  'studio/authoring/registry-editor.html']);

function forbidden(relative) {
  return relative.split('/').some(part => /^(?:app-config(?:\..*)?\.php|\.env.*|private-data|examples|example|desktop|node_modules|backups|tmp|logs|workspace|\.git|\.movement.*)$/i.test(part))
    || /(?:\.local\.|\.save\.lock$|\.(?:bak|orig|tmp|log|sql|zip|sqlite|map)$)/i.test(relative);
}

function websiteFiles(root) {
  const result = [...explicit];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.php') && entry.name !== 'router.php' && !forbidden(entry.name)) result.push(entry.name);
  }
  function visit(relative) {
    if (forbidden(relative) || desktopEntries.has(relative)) return;
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed in website source: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
    } else if (/\.(?:php|js|css|html|json|svg|png|webp|ico|woff2?)$/i.test(relative)) result.push(relative);
  }
  roots.forEach(visit);
  for (const relative of result) {
    if (forbidden(relative) || !fs.lstatSync(path.join(root, relative)).isFile()) throw new Error(`Invalid website file: ${relative}`);
    // Reject symlinked ancestors as well as files.
    let cursor = root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${relative}`);
    }
  }
  return [...new Set(result)].sort();
}

module.exports = { websiteFiles, forbidden };
