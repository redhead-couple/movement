const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8')
);

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.once('error', reject);
  });
}

async function startPhpRouterFixture(fixtureRoot) {
  const port = await reservePort();
  const child = spawn('php', [
    '-S', `127.0.0.1:${port}`,
    '-t', fixtureRoot,
    path.join(fixtureRoot, 'router.php'),
  ], {
    cwd: applicationRoot,
    env: {
      ...process.env,
      MOVEMENT_APP_ENV: 'development',
      MOVEMENT_HTTPS_ORIGIN: '',
      MOVEMENT_TRUST_PROXY: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`PHP test server exited early (${child.exitCode}): ${errors}`);
    }
    try {
      await request(port, '/private-data/');
      return {
        port,
        stop() {
          child.kill();
        },
      };
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  child.kill();
  throw new Error(`PHP test server did not become ready: ${errors}`);
}

test('Windows distribution builds a branded per-user NSIS installer', () => {
  assert.equal(manifest.build.appId, 'org.movement.timelinestudio');
  assert.equal(manifest.build.productName, manifest.productName);
  assert.equal(manifest.build.asar, true);
  assert.equal(manifest.build.win.icon, 'desktop/assets/movement-icon.ico');
  assert.deepEqual(manifest.build.win.target, [{
    target: 'nsis',
    arch: ['x64']
  }]);
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false);
});

test('distribution includes desktop runtime assets but excludes private projects', () => {
  const packagedFiles = new Set(manifest.build.files);
  const requiredFiles = [
    'package.json',
    'desktop/**/*',
    'shared/frontend/**/*',
    'assets/app.css',
    'img/bg_wanaka.webp',
    'examples/**/*',
    'effects/*-engine.js',
    'effects/effect-media.js',
    'effects/*-maker.html',
    'transitions/*-engine.js',
    'transitions/*-maker.html',
    'studio/editor/**/*',
    'studio/hubs/**/*',
    'studio/player/**/*',
    'studio/authoring/**/*',
    'docs/EFFECT_AUTHORING_CONTRACT.md',
    'docs/ANIMATION_PERFORMANCE_BUDGET.md',
    'docs/TRANSITION_AUTHORING_CONTRACT.md',
    'studio/maker/**/*',
    'effects/registry.json',
    'transitions/registry.json'
  ];

  for (const filename of requiredFiles) {
    assert.equal(packagedFiles.has(filename), true, `${filename} must be packaged`);
  }
  assert.equal(
    [...packagedFiles].some(filename => filename.includes('private-data')),
    false
  );
  assert.match(manifest.scripts['dist:windows'], /electron-builder --win nsis --x64/);
});

test('clean checkout carries tracked private-storage boundaries without tracking storage data', () => {
  const requiredTrackedPaths = [
    '.gitignore',
    '.htaccess',
    'docs/LOCAL_INSTALLATION.md',
    'router.php',
    'tests/distribution-config.test.cjs',
  ];
  const trackedPaths = new Set(execFileSync(
    'git',
    ['ls-files', '--', ...requiredTrackedPaths],
    { cwd: applicationRoot, encoding: 'utf8' }
  ).trim().split(/\r?\n/));

  for (const trackedPath of requiredTrackedPaths) {
    assert.ok(trackedPaths.has(trackedPath), `${trackedPath} must survive a clean checkout`);
  }

  const trackedPrivateData = execFileSync(
    'git',
    ['ls-files', '--', 'private-data'],
    { cwd: applicationRoot, encoding: 'utf8' }
  ).trim();
  assert.equal(trackedPrivateData, '', 'private project data must remain untracked');

  const ignoreRules = read('.gitignore');
  const apacheRules = read('.htaccess');
  const router = read('router.php');
  const installation = read('docs/LOCAL_INSTALLATION.md');
  assert.match(ignoreRules, /^\/private-data\/$/m);
  assert.ok(apacheRules.includes('RewriteRule ^private-data(?:/|$) - [F,L,NC]'));
  assert.ok(router.includes("preg_match('#^/private-data(?:/|$)#i', $accessPath)"));
  assert.ok(installation.includes('location = /private-data { return 403; }'));
  assert.ok(installation.includes('location ^~ /private-data/ { return 403; }'));
});

test('the PHP development router denies private storage and generated example state', async t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-private-storage-'));
  const coreDirectory = path.join(fixtureRoot, 'server', 'core');
  const projectDirectory = path.join(
    fixtureRoot,
    'private-data',
    'slidedeck',
    'security-test-owner',
    'security-test-project'
  );
  fs.mkdirSync(coreDirectory, { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'img'), { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'speech'), { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'backups'), { recursive: true });
  fs.copyFileSync(path.join(applicationRoot, 'router.php'), path.join(fixtureRoot, 'router.php'));
  fs.copyFileSync(
    path.join(applicationRoot, 'server', 'core', 'web-session.php'),
    path.join(coreDirectory, 'web-session.php')
  );
  fs.copyFileSync(
    path.join(applicationRoot, 'server', 'core', 'config-loader.php'),
    path.join(coreDirectory, 'config-loader.php')
  );
  fs.writeFileSync(path.join(projectDirectory, 'flow.json'), '{"private":true}\n');
  fs.writeFileSync(path.join(projectDirectory, 'img', 'private.png'), 'synthetic-image');
  fs.writeFileSync(path.join(projectDirectory, 'speech', 'private.mp3'), 'synthetic-speech');
  fs.writeFileSync(path.join(projectDirectory, 'audio', 'private.mp3'), 'synthetic-audio');
  fs.writeFileSync(path.join(projectDirectory, 'backups', 'flow-backup.json'), '{"private":true}\n');
  const exampleDirectory = path.join(fixtureRoot, 'examples', 'security-test-example');
  fs.mkdirSync(path.join(exampleDirectory, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(exampleDirectory, '.movement-media-trash', 'discarded'), { recursive: true });
  fs.writeFileSync(path.join(exampleDirectory, 'backups', 'flow-old.json'), '{"backup":true}\n');
  fs.writeFileSync(path.join(exampleDirectory, '.save.lock'), 'locked');
  fs.writeFileSync(
    path.join(exampleDirectory, '.movement-media-trash', 'discarded', 'metadata.json'),
    '{"discarded":true}\n'
  );

  const server = await startPhpRouterFixture(fixtureRoot);
  t.after(() => {
    server.stop();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  const privatePaths = [
    '/private-data',
    '/private-data/',
    '/private-data/slidedeck/',
    '/private-data/slidedeck/security-test-owner/security-test-project/',
    '/private-data/slidedeck/security-test-owner/security-test-project/flow.json',
    '/private-data/slidedeck/security-test-owner/security-test-project/img/private.png',
    '/private-data/slidedeck/security-test-owner/security-test-project/speech/private.mp3',
    '/private-data/slidedeck/security-test-owner/security-test-project/audio/private.mp3',
    '/private-data/slidedeck/security-test-owner/security-test-project/backups/flow-backup.json',
    '/PRIVATE-DATA/slidedeck/security-test-owner/security-test-project/flow.json',
    '/private%2Ddata/slidedeck/security-test-owner/security-test-project/flow.json',
  ];

  for (const requestPath of privatePaths) {
    const response = await request(server.port, requestPath);
    assert.equal(response.statusCode, 403, requestPath);
    assert.equal(response.body, 'Forbidden', requestPath);
  }

  const generatedExamplePaths = [
    '/examples/security-test-example/backups/',
    '/examples/security-test-example/backups/flow-old.json',
    '/examples/security-test-example/.save.lock',
    '/examples/security-test-example/.movement-media-trash/',
    '/examples/security-test-example/.movement-media-trash/discarded/metadata.json',
    '/EXAMPLES/security-test-example/.MOVEMENT-MEDIA-TRASH/discarded/metadata.json',
    '/examples/security-test-example/%2Emovement-media-trash/discarded/metadata.json',
  ];

  for (const requestPath of generatedExamplePaths) {
    const response = await request(server.port, requestPath);
    assert.equal(response.statusCode, 403, requestPath);
    assert.equal(response.body, 'Forbidden', requestPath);
  }
});
