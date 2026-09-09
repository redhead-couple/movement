const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

if (typeof electron === 'string') {
  const { spawnSync } = require('node:child_process');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [__filename, ...process.argv.slice(2)], {
    env: environment,
    stdio: 'inherit',
    windowsHide: true
  });
  process.exit(result.status === null ? 1 : result.status);
}

const { app, nativeImage } = electron;

const applicationRoot = path.resolve(__dirname, '..');
const sourcePath = path.resolve(
  process.argv[2] || path.join(applicationRoot, 'desktop', 'assets', 'movement-icon-source.png')
);
const outputDirectory = path.join(applicationRoot, 'desktop', 'assets');
const pngPath = path.join(outputDirectory, 'movement-icon.png');
const icoPath = path.join(outputDirectory, 'movement-icon.ico');
const iconSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function buildIcon() {
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) {
    throw new Error(`Could not read icon source: ${sourcePath}`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    pngPath,
    source.resize({ width: 512, height: 512, quality: 'best' }).toPNG()
  );

  const images = iconSizes.map(size => ({
    size,
    data: source.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }));
  const headerSize = 6 + (images.length * 16);
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = headerSize;
  images.forEach((image, index) => {
    const entryOffset = 6 + (index * 16);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.data.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.data.length;
  });

  fs.writeFileSync(icoPath, Buffer.concat([header, ...images.map(image => image.data)]));
  console.log(
    `WINDOWS_ICON_OK sizes=${iconSizes.join(',')} png=${path.relative(applicationRoot, pngPath)} ico=${
      path.relative(applicationRoot, icoPath)
    }`
  );
}

app.disableHardwareAcceleration();
app.whenReady()
  .then(buildIcon)
  .then(() => app.exit(0))
  .catch(error => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
