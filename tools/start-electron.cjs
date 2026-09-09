const path = require('node:path');
const { spawn } = require('node:child_process');

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error('Electron is not installed. Run "npm install" in this folder first.');
  process.exitCode = 1;
  return;
}

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

if (process.argv.includes('--smoke')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
}
if (process.argv.includes('--smoke-editor')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'editor';
}
if (process.argv.includes('--smoke-player')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'player';
}
if (process.argv.includes('--smoke-preview')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'preview';
}
if (process.argv.includes('--smoke-effects')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'effects';
}
if (process.argv.includes('--smoke-registry')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'registry';
}
if (process.argv.includes('--smoke-prompt-builder')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'prompt-builder';
}
if (process.argv.includes('--smoke-transition-prompt-builder')) {
  environment.MOVEMENT_ELECTRON_SMOKE_TEST = '1';
  environment.MOVEMENT_ELECTRON_SMOKE_SURFACE = 'transition-prompt-builder';
}

const child = spawn(electronPath, [path.resolve(__dirname, '..')], {
  env: environment,
  stdio: 'inherit',
  windowsHide: false
});

child.once('error', error => {
  console.error(`Unable to start Electron: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron stopped after receiving ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code === null ? 1 : code;
});
