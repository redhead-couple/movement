const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const defaultUnpackedRoot = path.join(
  repositoryRoot,
  'dist',
  'desktop-authoring-kit',
  'win-unpacked'
);
const suppliedRoot = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const unpackedRoot = path.resolve(suppliedRoot || defaultUnpackedRoot);
const executablePath = path.join(unpackedRoot, 'Movement Timeline Studio.exe');

if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
  console.error(
    'AUTHORING_KIT_SMOKE_FAILED The Authoring Kit executable is missing. '
    + 'Run npm.cmd run dist:authoring-kit first.'
  );
  process.exit(1);
}

const environment = {
  ...process.env,
  MOVEMENT_ELECTRON_SMOKE_TEST: '1',
  MOVEMENT_ELECTRON_SMOKE_SURFACE: process.argv.includes('--registry')
    ? 'registry'
    : 'library'
};
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(executablePath, [], {
  cwd: unpackedRoot,
  env: environment,
  stdio: 'inherit',
  windowsHide: true
});

child.once('error', error => {
  console.error(`AUTHORING_KIT_SMOKE_FAILED ${error.message}`);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`AUTHORING_KIT_SMOKE_FAILED signal=${signal}`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
