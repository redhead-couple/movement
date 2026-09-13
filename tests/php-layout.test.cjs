const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');
const coreRoot = path.join(applicationRoot, 'server', 'core');

const internalPhpFiles = [
  'app-config.example.php',
  'config-loader.php',
  'app-init.php',
  'auth-check.php',
  'current-user-record.php',
  'current-user.php',
  'db.php',
  'http-basic-auth.php',
  'project-paths.php',
  'published-projects.php',
  'portable-project-import.php',
  'require-guest.php',
  'response.php',
  'security-helpers.php'
];

const publicPhpEndpoints = [
  'account-settings.php',
  'admin-messages.php',
  'contact.php',
  'create-project.php',
  'dashboard.php',
  'delete-project.php',
  'duplicate-project.php',
  'export-project.php',
  'feed.php',
  'index.php',
  'import-project.php',
  'json-maker.php',
  'login.php',
  'logout.php',
  'media.php',
  'new-project.php',
  'player.php',
  'project-media.php',
  'publish-project.php',
  'rename-project.php',
  'restore-flow.php',
  'router.php',
  'signup.php'
];

test('internal PHP helpers live under server/core while public endpoints stay at root', () => {
  for (const filename of internalPhpFiles) {
    assert.equal(
      fs.existsSync(path.join(applicationRoot, filename)),
      false,
      `${filename} must not remain at the public root`
    );
    assert.equal(
      fs.existsSync(path.join(coreRoot, filename)),
      true,
      `server/core/${filename} is missing`
    );
  }

  for (const filename of publicPhpEndpoints) {
    assert.equal(
      fs.existsSync(path.join(applicationRoot, filename)),
      true,
      `${filename} must remain a public root endpoint`
    );
  }
});

test('web-server entry points deny direct access to server internals', () => {
  const apacheRules = fs.readFileSync(path.join(applicationRoot, '.htaccess'), 'utf8');
  const serverRules = fs.readFileSync(path.join(applicationRoot, 'server', '.htaccess'), 'utf8');
  const router = fs.readFileSync(path.join(applicationRoot, 'router.php'), 'utf8');

  assert.match(apacheRules, /RewriteRule \^server\(\?:\/\|\$\) - \[F,L\]/);
  assert.match(serverRules, /Require all denied/);
  assert.match(router, /preg_match\('#\^\/server\(\?:\/\|\$\)#', \$path\)/);
  assert.match(router, /http_response_code\(403\)/);
});
