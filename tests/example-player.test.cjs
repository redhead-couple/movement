const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { scanProjects } = require('../desktop/services/workspace-service.cjs');

const applicationRoot = path.resolve(__dirname, '..');
const examplesRoot = path.join(applicationRoot, 'examples');

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

test('example projects contain data and media without embedded player pages', () => {
  const projects = fs.readdirSync(examplesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

  assert.ok(projects.length > 0);
  for (const project of projects) {
    const projectRoot = path.join(examplesRoot, project.name);
    assert.ok(fs.existsSync(path.join(projectRoot, 'flow.json')), `${project.name} is missing flow.json`);
    assert.equal(fs.existsSync(path.join(projectRoot, 'index.html')), false, `${project.name} still embeds index.html`);
    assert.equal(fs.existsSync(path.join(projectRoot, 'player.html')), false, `${project.name} still embeds player.html`);
  }
});

test('the shared PHP player resolves validated example projects', () => {
  const player = read('player.php');
  const paths = read('server/core/project-paths.php');

  assert.match(player, /\$_GET\['example'\]/);
  assert.match(player, /getExampleProjectPaths\(\$example\)/);
  assert.match(player, /'flowUrl' => \$mediaBase \. 'flow\.json'/);
  assert.match(paths, /function getExampleProjectPaths\(string \$example\): \?array/);
  assert.match(paths, /\^\[a-zA-Z0-9\]\[a-zA-Z0-9_-\]/);
  assert.match(paths, /realpath\(\$examplesRoot \. DIRECTORY_SEPARATOR \. \$example\)/);
});

test('generated example state is absent and excluded from Git, routing, and desktop packages', () => {
  const router = read('router.php');
  const apache = read('.htaccess');
  const packageConfig = JSON.parse(read('package.json'));
  const authoringKit = JSON.parse(read('distribution/desktop-authoring-kit.manifest.json'));
  const nginxExample = read('docs/LOCAL_INSTALLATION.md');

  assert.match(router, /examples\/\[\^\/\]\+\/\(\?:backups/);
  assert.match(router, /\\\.movement-media-trash/);
  assert.match(router, /save\\\.lock/);
  assert.match(apache, /examples\/\[\^\/\]\+\/\(\?:backups/);
  assert.match(apache, /\\\.movement-media-trash/);
  assert.match(apache, /save\\\.lock/);
  assert.match(nginxExample, /location ~\* \^\/examples\/\[\^\/\]\+\//);
  assert.match(nginxExample, /backups/);
  assert.match(nginxExample, /\\\.movement-media-trash/);
  assert.match(nginxExample, /save\\\.lock/);

  const exclusions = [
    '!examples/**/backups/**/*',
    '!examples/**/*.save.lock',
    '!examples/**/.movement-media-trash/**/*'
  ];
  for (const exclusion of exclusions) {
    assert.ok(packageConfig.build.files.includes(exclusion), `${exclusion} missing from desktop package`);
    assert.ok(authoringKit.files.includes(exclusion), `${exclusion} missing from Authoring Kit`);
  }

  for (const project of fs.readdirSync(examplesRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectRoot = path.join(examplesRoot, project.name);
    for (const generatedName of ['backups', '.save.lock', '.movement-media-trash']) {
      assert.equal(
        fs.existsSync(path.join(projectRoot, generatedName)),
        false,
        `${project.name}/${generatedName} must not be present`
      );
    }
  }

  const ignoredPaths = [
    'examples/m04-fixture/backups/backup.json',
    'examples/m04-fixture/.save.lock',
    'examples/m04-fixture/.movement-media-trash/item/metadata.json'
  ];
  const ignored = execFileSync(
    'git',
    ['check-ignore', '--no-index', '--', ...ignoredPaths],
    { cwd: applicationRoot, encoding: 'utf8' }
  ).trim().split(/\r?\n/);
  assert.deepEqual(ignored, ignoredPaths);
});

test('the desktop example workspace discovers the three concept slideshows', () => {
  const projects = scanProjects(examplesRoot, true);
  const expected = [
    ['what-this-project-is', 48, 'room7.webp'],
    ['creating-new-forms-of-expression', 37, 'media3.webp'],
    ['sharing', 21, 'sharing3.webp']
  ];

  for (const [projectId, slideCount, openingImage] of expected) {
    const concept = projects.find(project => project.id === projectId);
    assert.ok(concept, `Desktop example discovery is missing ${projectId}`);
    assert.equal(concept.readOnly, true);
    assert.equal(concept.valid, true);
    assert.equal(concept.slideCount, slideCount);
    assert.equal(concept.openingImage, openingImage);
  }
});

test('the online and desktop concept pages present the same three-part series', () => {
  const concept = read('concept/index.php');
  const desktopConcept = read('shared/frontend/index.html');
  const desktopScript = read('shared/frontend/app.js');
  const home = read('index.php');

  for (const [projectId, openingImage] of [
    ['what-this-project-is', 'room7.webp'],
    ['creating-new-forms-of-expression', 'media3.webp'],
    ['sharing', 'sharing3.webp']
  ]) {
    assert.match(concept, new RegExp(`href="/player\\.php\\?example=${projectId}"`));
    assert.match(
      concept,
      new RegExp(`src="/examples/${projectId}/img/${openingImage.replace('.', '\\.')}"`)
    );
    assert.match(desktopConcept, new RegExp(`data-concept-project="${projectId}"`));
  }
  assert.match(desktopConcept, /id="concept-series-title">Three perspectives on the medium/);
  assert.match(desktopScript, /api\.openProjectPlayer\('examples', projectId\)/);
  assert.match(concept, /href="\/assets\/app\.css"/);
  assert.match(concept, /href="\/assets\/concept\.css"/);
  assert.doesNotMatch(home, /the-medium\.html/);
  assert.match(home, /href="\/concept\/"/);
  assert.equal(fs.existsSync(path.join(applicationRoot, 'the-medium.html')), false);
});

test('the concept example has every referenced image and audio asset', () => {
  const projectRoot = path.join(examplesRoot, 'what-this-project-is');
  const flow = JSON.parse(fs.readFileSync(path.join(projectRoot, 'flow.json'), 'utf8'));
  const references = new Set();

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
      return;
    }
    if (typeof value !== 'string' || !/\.(?:png|jpe?g|webp|gif|avif|svg|mp3|wav|ogg|m4a|aac|flac)$/i.test(value)) {
      return;
    }
    references.add(value);
  }

  visit(flow);
  assert.equal(flow.schemaVersion, 2);
  assert.equal(flow.openingImage, 'room7.webp');

  for (const reference of references) {
    let relativePath = reference;
    if (!/^(?:img|speech|audio)\//.test(relativePath)) {
      relativePath = /\.(?:mp3|wav|ogg|m4a|aac|flac)$/i.test(relativePath)
        ? `audio/${relativePath}`
        : `img/${relativePath}`;
    }
    assert.ok(fs.existsSync(path.join(projectRoot, relativePath)), `Missing example asset: ${reference}`);
  }
});
