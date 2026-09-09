const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

test('desktop application metadata has a Windows-ready product identity', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.productName, 'Movement Timeline Studio');
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.description, 'Offline desktop edition of Movement Timeline Studio.');
});

test('Windows icon contains every Electron-recommended native size', () => {
  const png = fs.readFileSync(
    path.join(applicationRoot, 'desktop', 'assets', 'movement-icon.png')
  );
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);

  const ico = fs.readFileSync(
    path.join(applicationRoot, 'desktop', 'assets', 'movement-icon.ico')
  );
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + (index * 16);
    const size = ico.readUInt8(entryOffset) || 256;
    const dataSize = ico.readUInt32LE(entryOffset + 8);
    const dataOffset = ico.readUInt32LE(entryOffset + 12);
    assert.equal(
      ico.subarray(dataOffset, dataOffset + 8).toString('hex'),
      '89504e470d0a1a0a',
      `${size}x${size} icon entry is not PNG data`
    );
    assert.ok(dataOffset + dataSize <= ico.length, `${size}x${size} icon entry is truncated`);
    sizes.push(size);
  }
  assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
});
