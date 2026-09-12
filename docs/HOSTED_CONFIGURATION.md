# Separate hosted configuration from website uploads

This is a configuration-only change, not a general website deployment plan.
No database migration, media move, slideshow change, or routing change is needed.

## Locations and behavior

For an application installed directly in `public_html`:

```text
/home/ACCOUNT/
  app-config.php                 private LIVE configuration
  public_html/
    server/core/config-loader.php
    server/core/db.php
    server/core/web-session.php
    admin-messages.php
```

The loader resolves paths from its own filesystem location, not HTTP input or
`DOCUMENT_ROOT`. It prefers `app-config.php` beside the application root, then
falls back to `server/core/app-config.php` when the external file is absent.
The local checkout continues using its existing local file; Electron does not
load PHP configuration. The filename above the root is shared by applications
with the same parent, so verify this is the intended account/site directory.
Do not overwrite an external configuration already belonging to another site.
For symlinked document roots, verify the physical layout before proceeding.

All three former direct callers now use `server/core/config-loader.php`:
`server/core/db.php`, `server/core/web-session.php`, and `admin-messages.php`.
Configuration is included once at file scope, preserving the existing global
DB, admin, mail, and transport settings. An existing invalid/unreadable external
file or a filesystem inspection error produces a generic HTTP 500, without
falling back to the local file or displaying the exception/configuration.
If neither file exists, the previous environment-only session behavior remains;
database setup and the admin page require a configuration file and fail with 500.
Successful loading does not validate every setting or prove database connectivity.

Privately check configuration path expressions before moving the file.
`__DIR__` and `__FILE__` change meaning after a move; bare relative includes depend
on PHP's working directory/include path. Update such references to the intended
absolute server paths if needed. Do not change database/admin credentials, media
paths, or production settings merely to perform this separation.

## Exact configuration-only upload boundary

A configuration-only update involves these four code files, retaining paths:

```text
server/core/config-loader.php    NEW; upload first
server/core/db.php               REPLACE after the new helper is present
server/core/web-session.php      REPLACE after the new helper is present
admin-messages.php               REPLACE after the new helper is present
```

Use the [website build workflow](WEB_DEPLOYMENT.md) to prepare source files, then
select these paths if deploying configuration support separately. Compare the live
versions before full-file replacement. If they differ materially, review the Git
diff against the deployed revision and apply the required changes to copies first.
Preserve host-specific behavior in all three existing callers. Current versions
also contain the [indexing policy](INDEXING.md); deploy compatible helpers and
controllers together.

Never upload the local real `app-config.php`, `.env*`, private data, database dumps,
backups, or the entire checkout. Select upload files explicitly; Git-ignore rules
alone are not a deployment boundary. `app-config.php` is already ignored at every
depth by `.gitignore`; the example file contains placeholders only. An ignore rule
does not protect an already tracked secret: verify with `git ls-files` as well.
Do not force-add real configuration. Keep the real hosting file and its backups
outside both the document root and any source checkout/upload staging directory.

Preserve all other live files, `.htaccess`, local configuration, media, slideshow
data, and databases. The only eventual removal is the old LIVE configuration copy,
after the external copy is proven to work and a private backup exists.

## Configuration migration order

1. In the hosting file manager, identify the actual document root and its parent.
   Confirm the parent is not served by this or another domain/alias. Privately back
   up the three existing caller files and the live `server/core/app-config.php`
   outside every public web root. Record permissions/ownership. Back up an existing
   `config-loader.php` too if present. No database changes are part of this task.
2. Compare the live caller files with the package/patch as described above. Stop
   if the live layout differs; do not apply unrelated local changes to make it fit.
3. COPY the current LIVE configuration to `/home/ACCOUNT/app-config.php`; leave
   `public_html/server/core/app-config.php` working in place. Do not copy local
   development settings to hosting. Use the hosting account's actual parent path.
   Start with mode `0600` when PHP runs as the owning user, or `0640` with the
   appropriate PHP group. Parent directories need traversal permission for PHP.
   Do not make the file world-readable or writable to resolve permission problems.
4. Check read access using the site's actual web PHP worker, not just FTP or CLI.
   Prefer the hosting panel's protected PHP execution facility. Otherwise create
   a temporary, randomly named PHP file directly in `public_html`, protect it using
   the hosting panel's access controls, and run the probe below over HTTPS. It
   prints only `READY` or `FAILED`, verifies PHP can read and parse the external
   copy, and compares it to the still-active configuration without printing either.
   Remove the probe immediately afterward and confirm its URL no longer works.
   If access fails, have the host narrowly allow the external file/directory in
   `open_basedir` and correct ownership/traversal permissions before switching.
   Do not disable all filesystem restrictions. CLI `php -l` alone is insufficient.
5. Privately review any location-dependent expressions in the LIVE configuration.
   If changes are needed, make only the necessary path corrections in the external
   copy, then lint it with hosting PHP and repeat its read/parse check. For that
   repeat only, remove the byte-equality condition in the probe: the intended
   changes make the two files different. Preserve the original private backup.
6. Upload the new `server/core/config-loader.php` FIRST. It is dormant until a
   caller uses it. Then replace `server/core/db.php`, `server/core/web-session.php`,
   and `admin-messages.php`. Use a short maintenance window and the host's atomic
   per-file replace mechanism to prevent requests reading partial PHP uploads.
   Avoid publicly accessible `.txt`/`.bak` copies. Do not change `.htaccess`.
   The first updated caller starts preferring the external file; keeping the old
   copy during this transition supports the still-old callers.
7. Clear/reload PHP OPcache through the hosting panel if it does not automatically
   detect modified files. Check the home and login pages, an existing slideshow,
   normal sign-in/dashboard access, and the admin authentication challenge.
   Check HTTP-to-HTTPS behavior and secure cookies against the previous behavior.
   Review PHP logs privately for configuration or DB errors. Do not submit edits,
   reset passwords, or perform database migrations as part of these checks.
8. After ALL callers are switched and checks pass, remove the old
   `public_html/server/core/app-config.php` from public storage (keep its private
   backup). Never rename it to a public `.bak`. Clear OPcache as needed and repeat
   the same checks: this confirms no code still needs the old location. Keep
   `.htaccess` restrictions on `server/` in place. Verify subsequent upload jobs
   explicitly exclude every real configuration file, regardless of Git status.

### Temporary web-worker read/parse probe

Place at the document root only for the protected check described above. It does
not execute either configuration or connect to the database. No `phpinfo()`,
configuration dump, credentials, hashes, or filesystem paths are returned.

```php
<?php
ini_set('display_errors', '0');
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
$ready = false;
set_error_handler(static function () {
    throw new RuntimeException('Check failed.');
});
try {
    $external = dirname(__DIR__) . '/app-config.php';
    $current = __DIR__ . '/server/core/app-config.php';
    if (is_file($external) && is_readable($external)) {
        $source = file_get_contents($external);
        token_get_all($source, TOKEN_PARSE);
        $ready = hash_equals(hash_file('sha256', $current), hash('sha256', $source));
    }
} catch (Throwable $error) {
    $ready = false;
} finally {
    restore_error_handler();
}
http_response_code($ready ? 200 : 500);
echo $ready ? 'READY' : 'FAILED';
```

## Rollback

Use the same maintenance window/atomic replacement precautions. FIRST restore the
original live configuration to `public_html/server/core/app-config.php` from its
private backup, with its original permissions. THEN restore all three original
caller files. Clear OPcache if required and repeat the page/authentication checks.
Only after every caller is restored may the new loader be removed (or restored
from its backup if one existed). Keep the external file private; do not remove it
while any updated caller still depends on it. Fix a bad external file before
resuming any partially updated state because it takes precedence over the fallback.
There is no database rollback or project/media restoration for this change.

## Local verification

Run `node --test tests/config-loader.test.cjs tests/php-layout.test.cjs
tests/web-session-security.test.cjs tests/not-found-routes.test.cjs` as one command.
The configuration tests use disposable synthetic credentials, test both load
orders, global settings, external precedence, local fallback, external-only admin
access, malformed configuration and `open_basedir` denial. Existing HTTP tests
cover real local public pages, HTTPS redirects, sessions, and project visibility.
Hosting permissions, live path-dependent settings, live code compatibility,
OPcache, and live DB/authentication still require the hosting checks above.
