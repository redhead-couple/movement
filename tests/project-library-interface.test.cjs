const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const applicationRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

test('offline, dashboard, and feed libraries use the shared external card stylesheet', () => {
  const offlinePage = read('shared/frontend/index.html');
  const dashboard = read('dashboard.php');
  const feed = read('feed.php');
  const offlineCss = read('shared/frontend/app.css');
  const sharedCss = read('shared/frontend/project-library.css');
  const desktopMain = read('desktop/main.cjs');

  assert.match(offlinePage, /href="\.\/project-library\.css"/);
  assert.match(dashboard, /href="\/shared\/frontend\/project-library\.css"/);
  assert.match(feed, /href="\/shared\/frontend\/project-library\.css"/);

  for (const page of [offlinePage, dashboard, feed]) {
    assert.match(page, /class="[^"]*project-library[^"]*project-grid/);
    assert.match(page, /class="project-card"/);
  }

  assert.doesNotMatch(offlineCss, /\.project-card\b/);
  assert.match(sharedCss, /\.project-library \.project-card/);
  assert.match(sharedCss, /@media \(max-width: 680px\)/);
  assert.match(desktopMain, /project-library\)\\\.css/);
});

test('online library pages keep page CSS external and expose appropriate card actions', () => {
  const dashboard = read('dashboard.php');
  const feed = read('feed.php');

  assert.doesNotMatch(dashboard, /<style\b|\sstyle=/i);
  assert.doesNotMatch(feed, /<style\b|\sstyle=/i);
  assert.match(dashboard, /href="\/assets\/dashboard\.css"/);
  assert.match(feed, /href="\/assets\/feed\.css"/);

  for (const action of ['Edit', 'Play', 'Media', 'Export ZIP', 'Duplicate', 'Rename', 'Restore', 'Delete']) {
    assert.match(dashboard, new RegExp(`>${action}(?:<|')`), `dashboard card is missing ${action}`);
  }
  assert.match(dashboard, /action="\/publish-project\.php"/);
  assert.match(dashboard, /action="\/import-project\.php"[\s\S]*name="portable_zip"/);
  assert.match(dashboard, /id="import-project-button"[^>]*>Import slideshow<\/button>/);
  assert.doesNotMatch(dashboard, /id="import-project-button"[^>]*disabled/);
  assert.match(dashboard, /src="\/assets\/dashboard\.js"/);
  assert.match(dashboard, /<details class="creator-tools">[\s\S]*<summary[^>]*>Creator tools<\/summary>/);
  assert.match(dashboard, /effect-prompt-builder\.html\?kind=effect/);
  assert.match(dashboard, /effect-prompt-builder\.html\?kind=transition/);

  assert.match(feed, />Play Slideshow</);
  assert.match(feed, />More by Creator</);
  assert.doesNotMatch(feed, /data-href=|querySelectorAll\('\.feed-card'/);
});

test('online and offline libraries share the same navigation and introduction hierarchy', () => {
  const dashboard = read('dashboard.php');
  const feed = read('feed.php');
  const offlinePage = read('shared/frontend/index.html');
  const appCss = read('assets/app.css');
  const dashboardCss = read('assets/dashboard.css');
  const feedCss = read('assets/feed.css');

  for (const page of [dashboard, feed, offlinePage]) {
    assert.match(page, /class="app-site-header"/);
    assert.match(page, /class="[^"]*app-brand[^"]*"/);
    assert.match(page, /class="[^"]*page-intro[^"]*"/);
    assert.match(page, />Your slideshows<|>The public gallery</);
  }

  assert.match(dashboard, /class="page-intro__actions"[\s\S]*>New Slideshow</);
  assert.doesNotMatch(dashboard, /My slide collection/);
  assert.match(appCss, /\.app-site-header \{/);
  assert.match(appCss, /\.page-intro \{/);
  assert.doesNotMatch(dashboardCss, /\.app-site-header|\.page-intro \{/);
  assert.doesNotMatch(feedCss, /\.app-site-header|\.page-intro \{/);
});

test('the offline library prioritizes creation and groups advanced creator tools', () => {
  const offlinePage = read('shared/frontend/index.html');
  const offlineCss = read('shared/frontend/app.css');
  const offlineScript = read('shared/frontend/app.js');

  assert.match(
    offlinePage,
    /class="page-intro__actions"[\s\S]*id="new-project-button"[\s\S]*<\/div>\s*<\/div>/
  );
  assert.match(offlinePage, /id="import-project-button"[^>]*>[\s\S]*Import slideshow/);
  assert.match(offlinePage, /<details class="creator-tools">[\s\S]*<summary[^>]*>Creator tools<\/summary>/);

  for (const id of [
    'open-storage-button',
    'registry-editor-button',
    'effect-prompt-button',
    'transition-prompt-button'
  ]) {
    assert.match(
      offlinePage,
      new RegExp(`<details class="creator-tools">[\\s\\S]*id="${id}"`),
      `${id} should be grouped under Creator tools`
    );
  }

  assert.match(offlineCss, /\.library-toolbar \{/);
  assert.match(offlineCss, /\.creator-tools__menu \{/);
  assert.match(offlineScript, /button\.closest\('\.app-nav'\)/);
  assert.doesNotMatch(offlineScript, /button\.closest\('\.nav-links'\)/);
  assert.match(offlineScript, /addEventListener\('pointerup', \(\) => button\.blur\(\)\)/);
});

test('the first-run library presents examples and continues creation after workspace setup', () => {
  const offlinePage = read('shared/frontend/index.html');
  const offlineCss = read('shared/frontend/app.css');
  const offlineScript = read('shared/frontend/app.js');

  assert.match(offlinePage, /id="first-run-welcome"[\s\S]*Create your workspace/);
  assert.match(offlinePage, /id="play-welcome-example-button"[\s\S]*Play an example/);
  assert.match(offlinePage, /name="name"[^>]*value="My Workspace"/);
  assert.match(offlineCss, /\.first-run-welcome \{/);
  assert.match(offlineScript, /const firstRun = userWorkspaces\(\)\.length === 0/);
  assert.match(offlineScript, /openWorkspaceDialog\('new-project'\)/);
  assert.match(offlineScript, /continuation === 'new-project'[\s\S]*openDialog\(elements\.projectDialog\)/);
  assert.match(offlineScript, /openWorkspaceDialog\('copy-example'\)/);
  assert.match(offlineScript, /continuation === 'copy-example'[\s\S]*prepareCopyDialog/);
});

test('Creator tools closes on outside click and Escape in both libraries', () => {
  const dashboard = read('dashboard.php');
  const offlinePage = read('shared/frontend/index.html');
  const behavior = read('shared/frontend/creator-tools.js');
  const listeners = {};
  let summaryFocused = false;
  const insideTarget = {};
  const menu = {
    open: true,
    contains: target => target === insideTarget,
    querySelector: selector => selector === 'summary'
      ? { focus: () => { summaryFocused = true; } }
      : null
  };
  const document = {
    querySelectorAll: selector => selector === 'details.creator-tools' ? [menu] : [],
    addEventListener: (type, listener) => { listeners[type] = listener; }
  };

  vm.runInNewContext(behavior, { document });

  assert.match(offlinePage, /src="\.\/creator-tools\.js"/);
  assert.match(dashboard, /src="\/shared\/frontend\/creator-tools\.js"/);

  listeners.click({ target: insideTarget });
  assert.equal(menu.open, true, 'clicking inside the menu should keep it open');

  listeners.click({ target: {} });
  assert.equal(menu.open, false, 'clicking outside the menu should close it');

  menu.open = true;
  listeners.keydown({ key: 'Escape' });
  assert.equal(menu.open, false, 'Escape should close the menu');
  assert.equal(summaryFocused, true, 'Escape should restore focus to the trigger');
});

test('the offline trash presents compact recovery actions and confirms permanent deletion', () => {
  const offlinePage = read('shared/frontend/index.html');
  const offlineCss = read('shared/frontend/app.css');
  const offlineScript = read('shared/frontend/app.js');
  const platformAdapter = read('shared/frontend/platform-adapter.js');
  const preload = read('desktop/preload.cjs');
  const desktopMain = read('desktop/main.cjs');

  assert.match(offlinePage, /class="recovery-item-actions"[\s\S]*data-recovery-action="restore"/);
  assert.match(offlinePage, /data-recovery-action="delete"[\s\S]*Delete forever/);
  assert.match(offlinePage, /Delete forever cannot be undone\./);
  assert.match(offlineCss, /\.recovery-item-actions \.button \{/);
  assert.match(offlineCss, /\.recovery-list::\-webkit-scrollbar-thumb/);
  assert.match(offlineScript, /api\.deleteTrashedProject\(/);
  assert.match(platformAdapter, /deleteTrashedProject:/);
  assert.match(preload, /ipcRenderer\.invoke\('project:delete-trash'/);
  assert.match(desktopMain, /ipcMain\.handle\('project:delete-trash'/);
  assert.match(desktopMain, /buttons: \['Cancel', 'Delete Forever'\]/);
  assert.match(desktopMain, /cannot be recovered/);
});
