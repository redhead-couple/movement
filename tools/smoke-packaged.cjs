const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const applicationRoot = path.resolve(__dirname, '..');
const executablePath = path.join(
  applicationRoot,
  'dist',
  'win-unpacked',
  'Movement Timeline Studio.exe'
);

if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
  console.error(
    'PACKAGED_SMOKE_TEST_FAILED The unpacked Windows application is missing. '
    + 'Run npm.cmd run dist:windows first.'
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
  cwd: path.dirname(executablePath),
  env: environment,
  stdio: 'inherit',
  windowsHide: true
});

child.once('error', error => {
  console.error(`PACKAGED_SMOKE_TEST_FAILED ${error.message}`);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`PACKAGED_SMOKE_TEST_FAILED signal=${signal}`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
