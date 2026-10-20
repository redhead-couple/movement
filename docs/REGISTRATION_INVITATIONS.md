# Invitation-only registration

The website accepts new accounts only with a personal invitation by default.
Existing users can log in and reset passwords normally. Public pages and published
slideshows retain their existing visibility. All new interface copy is English.

## Configuration and administration

In the active private `app-config.php`:

```php
$INVITE_ONLY_REGISTRATION = true;
```

Only the literal boolean `false` opens public registration. An absent or invalid
setting keeps it closed. This switch is independent of `$ALLOW_SEARCH_INDEXING`.

Open `/admin-invitations.php` and use the same administrator credentials as
`/admin-messages.php` (`$ADMIN_USER` and `$ADMIN_PASS` in private configuration).
These are separate from an ordinary website account. The Messages page now links
to Invitations. The existing administrator attempt limiter also protects this page.

Enter a tester's email and create an invitation. Copy the link immediately and
send it privately yourself; the application does not send an email. The raw link
is shown once. If lost, cancel the old invitation and create another. The list
shows the latest 100 invitations and their status; timestamps are UTC.

Each link expires after seven days and can create one account for its specified
email. Multiple invitations can exist for an address, but the users table's unique
email constraint allows only one account. Cancelling an invitation does not
delete an account. An existing account does not need an invitation.

## Implementation

`server/core/registration-invitations.php` owns the switch, token generation,
creation, lookup, revocation, and transactional account creation. The exact table
schema is saved in `server/migrations/2026-10-20-registration-invitations.sql.example`.
The maintainer has already created this table locally and on hosting; do not
recreate it. No change to the existing users table is required (its username and
email columns must have the existing unique indexes, and both tables use InnoDB).

Tokens use 32 random bytes; only SHA-256 hashes are stored in the table. The link
uses a fragment (`#invite=...`) so ordinary HTTP access logs do not receive the
token. JavaScript clears the fragment and submits it with a session-bound CSRF
token. A validated invitation is kept in the session and rechecked at signup.
JavaScript is required to open an invitation link; a noscript message explains it.
The invite page sends no-store and no-referrer response headers.

Account creation claims the invitation with a conditional UPDATE inside the same
transaction as the users INSERT. Concurrent use and cancellation serialize on
the invitation row. Account-creation failure rolls back the claim. The session
is established only after commit. Missing invitation storage fails closed.

## Upload this change

Back up the live files being replaced. Do not upload the local private config,
database, tests, or the complete website ZIP. The full website build can include
other changes. Select only these ten paths, preserving directories:

```text
server/core/registration-invitations.php
assets/invitation-signup.js
assets/signup-passwords.js
assets/invitation-admin.js
assets/invitations.css
signup.php
login.php
admin-invitations.php
admin-messages.php
.htaccess
```

1. The invitations table is already installed. Confirm the live users table still
   has unique username/email indexes. Do not run the migration a second time.
2. Add `$INVITE_ONLY_REGISTRATION = true;` inside the live private config PHP block.
   Leave the production, database, administrator and indexing settings intact.
3. Upload the shared invitation helper and all four assets first. Then upload
   `signup.php` to enforce closed registration, followed by `login.php` and the
   two admin pages. Once signup is updated, a missing switch also defaults closed.
4. Merge the one changed Apache rule into the live `.htaccess`, preserving any
   hosting-specific differences. It must forward Authorization to both pages:
   ```apache
   RewriteCond %{HTTP:Authorization} ^(.+)$
   RewriteRule ^admin-(?:messages|invitations)\.php$ - [E=HTTP_AUTHORIZATION:%1]
   ```
   Nginx does not use `.htaccess`; its existing PHP Authorization forwarding must
   cover the new admin page as well.
5. Clear OPcache/page caches if the host does not detect changed PHP files.
6. In a private browser window, visit `/signup.php` without an invitation: no
   account form should be shown. Confirm your existing account still logs in.
7. Open `/admin-invitations.php`, create a real tester invitation, and copy the
   full HTTPS link. Check that it contains the live hostname. Ask the tester to
   open it, register using its fixed email address, and confirm the dashboard.
   Check that its status changes to Used. Cancel any unused test invitations.

Restoring the old signup file restores public registration, so do not use that
as a rollback while a closed beta is required. Fix deployment dependencies while
keeping the new signup controller or otherwise disabling registration at the host.

## Verification

### Password confirmation update for an already deployed invitation system

Upload `assets/signup-passwords.js` first, then replace `signup.php`. These are
the only two files needed for this incremental update. No database or private
configuration changes are required. The separate password-confirmation ZIP
contains exactly these two files and preserves their paths.

The form asks for Create password and Confirm password, with independent
Show/Hide buttons. Both inputs start concealed and support password managers.
Without JavaScript the inputs remain concealed and the server still validates
the confirmation. Missing or mismatched confirmation does not create a user or
consume an invitation. Password fields are not repopulated after an error.

With a fresh invitation, submit different passwords and verify the English
error, then enter matching passwords to complete signup using the same link.
Confirm both buttons reveal and conceal only their associated field. Tests
also send requests directly, bypassing browser validation, in both invitation
and public-registration modes.

### Regression tests

Run `node --test tests/registration-invitations.test.cjs` for isolated HTTP tests
using a disposable SQLite database. Set `MOVEMENT_TEST_MYSQL_BIN` to a local
MariaDB bin directory to run the same tests against an isolated InnoDB database
using the exact migration. Neither mode uses real accounts or configuration.

The tests cover closed-by-default behavior, forged/direct signup, CSRF, admin
authentication, link display once, email binding, duplicate-account rollback,
expiry, cancellation after form display, concurrent consumption across two PHP
servers, existing-account login, reopening registration, and unavailable storage.
Also run the affected session, indexing, configuration, and admin tests. Run the
website build before packaging tests so they inspect current generated files.
