const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

test('the main stylesheet owns global navigation, page introductions, and return links', () => {
  const css = read('assets/app.css');

  assert.match(css, /\.app-site-header \{/);
  assert.match(css, /\.app-brand \{/);
  assert.match(css, /\.app-nav \{/);
  assert.match(css, /\.page-intro \{/);
  assert.match(css, /\.page-intro--compact/);
  assert.match(css, /\.app-return-link \{/);
  assert.match(css, /\.app-return-link--back::before/);
  assert.match(css, /\.app-return-link--floating/);
});

test('standard application pages expose the shared home brand', () => {
  const standardPages = [
    'dashboard.php',
    'feed.php',
    'login.php',
    'signup.php',
    'privacy.php',
    'terms.php',
    'contact.php',
    'admin-messages.php',
    'change-password.php',
    'new-project.php',
    'delete-project.php',
    'restore-flow.php',
    'project-media.php'
  ];

  for (const page of standardPages) {
    const source = read(page);
    assert.match(source, /class="app-brand" href="\/"/, `${page} is missing its shared Home brand`);
    assert.match(source, /class="app-site-header"/, `${page} is missing the shared application header`);
  }

  for (const page of ['404.php']) {
    const source = read(page);
    assert.match(source, /class="app-return-link[^"]*" href="\/"/, `${page} is missing its simplified Home link`);
  }

  const login = read('login.php');
  const signup = read('signup.php');
  assert.match(login, /class="app-nav__link" href="\/signup\.php">Create account<\/a>/);
  assert.match(signup, /class="app-nav__link" href="\/login\.php">Log in<\/a>/);
});

test('project tools return to the online library and desktop surfaces retain contextual back controls', () => {
  const projectPages = [
    'change-password.php',
    'new-project.php',
    'delete-project.php',
    'rename-project.php',
    'restore-flow.php',
    'project-media.php',
    'json-maker.php'
  ];

  for (const page of projectPages) {
    const source = read(page);
    assert.match(
      source,
      /class="(?:app-nav__link(?: app-nav__back)?|app-return-link app-return-link--back)[^"]*" href="\/dashboard\.php"/,
      `${page} is missing its My Library link`
    );
  }

  const offlineHome = read('shared/frontend/index.html');
  const desktopEditor = read('studio/editor/json-maker.html');
  const playerTemplate = read('templates/player/player-page-template.php');

  assert.match(offlineHome, /class="app-brand link-button"[^>]*data-route="home"/);
  assert.match(desktopEditor, /class="app-return-link app-return-link--back" id="openProjectDashboardBtn"/);
  assert.match(playerTemplate, /id="backBtn"/);
  assert.match(playerTemplate, /#backBtn \{[\s\S]*position: fixed/);
});

test('desktop Back navigation closes its child and brings the Library to the foreground', () => {
  const desktopMain = read('desktop/main.cjs');

  assert.match(desktopMain, /ipcMain\.on\('runtime:close-window'/);
  assert.match(desktopMain, /target\.once\('closed',[\s\S]*setImmediate\(focusMainWindow\)/);
  assert.match(desktopMain, /if \(mainWindow\.isMinimized\(\)\) mainWindow\.restore\(\)/);
  assert.match(desktopMain, /if \(!mainWindow\.isVisible\(\)\) mainWindow\.show\(\)/);
  assert.match(desktopMain, /mainWindow\.focus\(\)/);
});
