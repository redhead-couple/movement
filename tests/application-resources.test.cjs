const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

function localCssUrls(filename) {
  const css = fs.readFileSync(filename, 'utf8');
  return [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
    .map(match => match[2].trim())
    .filter(url => url && !/^(?:data:|https?:|#)/i.test(url));
}

test('homepage stylesheet local assets exist inside the application', () => {
  const stylesheet = path.join(applicationRoot, 'shared', 'frontend', 'app.css');
  const assets = localCssUrls(stylesheet);
  assert.ok(assets.length > 0, 'homepage stylesheet should reference its hero image');

  for (const asset of assets) {
    const assetPath = path.resolve(path.dirname(stylesheet), asset);
    const relative = path.relative(applicationRoot, assetPath);
    assert.ok(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      `homepage asset escapes the application root: ${asset}`
    );
    assert.ok(fs.existsSync(assetPath), `missing homepage asset: ${relative}`);
  }
});

test('desktop entry pages do not load remote scripts, styles, or images', () => {
  const entryPages = [
    path.join('studio', 'editor', 'json-maker.html'),
    path.join('studio', 'player', 'local-player.html'),
    path.join('studio', 'hubs', 'effects-hub.html'),
    path.join('studio', 'hubs', 'transitions-hub.html'),
    path.join('studio', 'authoring', 'registry-editor.html'),
    path.join('studio', 'authoring', 'effect-prompt-builder.html'),
    path.join('shared', 'frontend', 'index.html')
  ];

  for (const entryPage of entryPages) {
    const html = fs.readFileSync(path.join(applicationRoot, entryPage), 'utf8');
    assert.doesNotMatch(
      html,
      /<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i,
      `${entryPage} loads a remote page dependency`
    );
  }
});
