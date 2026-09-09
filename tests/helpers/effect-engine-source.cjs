const fs = require('node:fs');
const path = require('node:path');

function transformModuleSource(source) {
  return source
    .replace(/^\s*import\s+\{[^}]+\}\s+from\s+["']\.\/effect-media\.js["'];?\s*$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, '');
}

function loadEffectEngineSource(enginePath) {
  const helperPath = path.join(path.dirname(enginePath), 'effect-media.js');
  return [helperPath, enginePath]
    .map(filename => transformModuleSource(fs.readFileSync(filename, 'utf8')))
    .join('\n\n');
}

module.exports = { loadEffectEngineSource };
