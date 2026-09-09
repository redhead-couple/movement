const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(applicationRoot, relativePath), 'utf8');
}

test('login links to the neutral CSRF-protected password-reset request flow', () => {
  const login = read('login.php');
  const requestPage = read('forgot-password.php');

  assert.match(login, /href="\/forgot-password\.php">Forgot password\?<\/a>/);
  assert.match(requestPage, /validateFormGuard\(/);
  assert.match(requestPage, /name="form_token"/);
  assert.match(requestPage, /name="website"/);
  assert.match(requestPage, /PASSWORD_RESET_PUBLIC_MESSAGE/);
  assert.doesNotMatch(requestPage, /No account|account not found|email does not exist/i);
});

test('reset completion validates CSRF, token state, confirmation, and current password policy', () => {
  const resetPage = read('reset-password.php');

  assert.match(resetPage, /findUsablePasswordResetToken\(/);
  assert.match(resetPage, /validateFormGuard\(/);
  assert.match(resetPage, /passwordResetTokenValidationAllowed\(/);
  assert.match(resetPage, /consumePasswordResetToken\(/);
  assert.match(resetPage, /window\.location\.hash/);
  assert.match(resetPage, /history\.replaceState\(null, '', window\.location\.pathname\)/);
  assert.doesNotMatch(resetPage, /\$_GET\['token'\]/);
  assert.match(resetPage, /strlen\(\$newPassword\) < 6/);
  assert.match(resetPage, /\$newPassword !== \$confirmPassword/);
  assert.match(resetPage, /destroyWebSession\(\)/);
});

test('password-reset tokens are random, hash-only, expiring, one-time, and HTTPS-linked', () => {
  const service = read('server/core/password-reset.php');
  const migration = read('server/migrations/2026-09-01-password-reset.sql.example');

  assert.match(service, /random_bytes\(PASSWORD_RESET_TOKEN_BYTES\)/);
  assert.match(service, /hash\('sha256', \$token\)/);
  assert.match(service, /PASSWORD_RESET_TTL_MINUTES = 60/);
  assert.match(service, /hash_equals\(\$row\['token_hash'\], \$hash\)/);
  assert.match(service, /WHERE id = \? AND used_at IS NULL AND expires_at > \?/);
  assert.match(service, /productionHttpsOrigin\(\)/);
  assert.match(service, /reset-password\.php#token=/);
  assert.doesNotMatch(service, /redhead-couple\.org/);
  assert.doesNotMatch(service, /error_log\([^\n]*\$token/);

  assert.match(migration, /token_hash CHAR\(64\)/);
  assert.match(migration, /expires_at DATETIME NOT NULL/);
  assert.match(migration, /used_at DATETIME NULL/);
  assert.match(migration, /UNIQUE KEY uq_password_reset_token_hash/);
  assert.doesNotMatch(migration, /\btoken\s+(?:CHAR|VARCHAR|TEXT)/i);
});

test('password-reset abuse controls cover both email and IP without plaintext email storage', () => {
  const service = read('server/core/password-reset.php');
  const migration = read('server/migrations/2026-09-01-password-reset.sql.example');

  assert.match(service, /PASSWORD_RESET_EMAIL_LIMIT_PER_HOUR = 3/);
  assert.match(service, /PASSWORD_RESET_IP_LIMIT_PER_HOUR = 5/);
  assert.match(service, /PASSWORD_RESET_TOKEN_VALIDATION_IP_LIMIT_PER_15_MINUTES = 20/);
  assert.match(service, /passwordResetEmailHash\(\$email\)/);
  assert.match(migration, /purpose ENUM\('request', 'token_validation'\)/);
  assert.match(migration, /email_hash CHAR\(64\)/);
  assert.match(migration, /idx_password_reset_attempt_email_time/);
  assert.match(migration, /idx_password_reset_attempt_ip_time/);
  assert.doesNotMatch(migration, /password_reset_attempts[\s\S]*\bemail\s+(?:CHAR|VARCHAR|TEXT)/i);
});
