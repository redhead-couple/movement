# Public indexing controls

This policy changes crawler directives only. Publication, authentication, media
access, release files, and tags are unchanged.

## Policy

- In the configured production environment, successful GET/HEAD responses for
  `/`, `/index.php`, `/concept/`, `/concept/index.php`, `/concept/index.html`,
  `/download.php`, `/feed.php` (including public user feeds), `/privacy.php`, and
  `/terms.php` contain no indexing restriction and no explicit `index` directive.
- Players opt in only after normal project resolution/access checks, and only
  for parsed, published schema-v2 slideshows with a slides array. This applies
  to both public examples and user projects, including friendly `/slidedeck/`
  URLs. `isPublished` is the existing publication/feed rule; no new visibility
  setting or query-parameter override was introduced.
- Drafts, owner previews of drafts, unpublished examples, invalid/unsupported
  data, missing projects, errors, and non-GET/HEAD responses remain excluded.
  Owner playback and all existing access-denial responses are preserved.
- Account, login, contact-form, editor, admin, and offline-export pages remain
  excluded. Apache also applies `X-Robots-Tag` to static HTML, temporary-preview
  paths, and error responses. Existing static noindex tags stay in place; the
  highlight maker gains a missing one.
- Non-production PHP pages keep both HTML noindex and an HTTP noindex header.
  The established private `$APP_ENVIRONMENT` setting, with `MOVEMENT_APP_ENV`
  as its existing fallback, controls this. Unset settings default to development;
  request parameters and the Host header do not select production.

`server/core/web-session.php` owns the shared dynamic response policy. Public
controllers opt in before output; a header callback checks the final status.
The shared player template defaults to noindex for offline/unspecified callers.
The concept page is now PHP so the same environment policy applies; its content
and layout are unchanged. Apache and the PHP development router preserve the
former `/concept/index.html` URL. Apache also handles a stale HTML file during
upload, even if the host's DirectoryIndex prefers HTML.

`robots.txt` allows crawling so excluded pages' noindex directives can be read.
Neither robots.txt nor noindex protects data. Existing authentication, private
storage rules, and media checks remain necessary and unchanged.

## Exact indexing upload list

Use the existing `npm.cmd run web:build` workflow from `WEB_DEPLOYMENT.md`.
The full build includes all working local changes, including unrelated work.
For this update, select only these files from `dist/website/upload/` and preserve
their relative paths; do not upload the full website ZIP for an indexing-only
deployment:

```text
.htaccess
robots.txt
server/core/web-session.php
index.php
concept/index.php
download.php
feed.php
privacy.php
terms.php
player.php
templates/player/player-page-template.php
effects/highlight-maker.html
```

The builder's `UPLOAD-LIST.txt` and `manifest.json` describe the full website
package. Select the 12 paths above only when the host already has compatible
configuration support. Compare `.htaccess` and `server/core/web-session.php`
against the deployed revision before replacing them; preserve host-specific
behavior. The helper depends on `server/core/config-loader.php`; deploy the
[configuration loader](HOSTED_CONFIGURATION.md) first if it is not already live.
Do not upload a local configuration file to resolve a missing dependency.

After this review, upload the shared helper/template and new concept PHP entry,
then the public controllers and Apache rules. Remove only the obsolete live
`concept/index.html` file after confirming `/concept/` and its old URL work.
Do not delete the concept directory, any media directory, or any parent holding
preserved data. Upload `robots.txt`. Keep external `app-config.php`, all
`private-data/`, `examples/`, other preserved media, and the database untouched.
Tools, tests, this document, and all temporary fixtures/previews stay local.

## Verification

Local Apache/PHP tests use synthetic external configuration, projects, sessions,
and media; they do not change real credentials, accounts, or project data.
They inspect response status, HTML meta tags, and X-Robots-Tag headers for both
production and development, including a conflicting process environment,
query-parameter spoofing, stale concept HTML, HEAD/POST, published/draft/missing/
invalid players, owner drafts, auth/editor routes, static previews, 403/404/500,
and configuration failures. Offline exports retain their default noindex.

The initial indexing validation passed 50 targeted checks without skips:

```powershell
npm.cmd run web:build
node --test tests/indexing.test.cjs tests/example-player.test.cjs tests/config-loader.test.cjs tests/php-layout.test.cjs tests/not-found-routes.test.cjs tests/web-session-security.test.cjs tests/web-deployment.test.cjs tests/return-navigation.test.cjs
```

The build linted all packaged PHP and verified ZIP entries against its manifest.
GET requests to the actual `http://redhead.local` home, concept, download, feed,
and sharing example also returned HTTP 200 with both HTML noindex and
`X-Robots-Tag: noindex, nofollow` after the update.
It contains no real configuration, private data, examples/media, tests, previews,
or desktop entry pages. The complete build contains 141 website files; the
indexing selection above is only 12 of them.

## Recorded live verification and future deployments

After the maintainer uploaded the changes on 2026-09-12, read-only checks confirmed
that the HTTPS homepage and published introduction were HTTP 200 with no noindex
in HTML or GET/HEAD headers. Login retained HTML and header noindex, robots.txt
allowed crawling, and HTTP redirected to the HTTPS homepage with status 308.
Production session cookies had the Secure attribute. Earlier rollout checks
identified a development configuration, missing HTTPS origin, and stale player
template; the final responses confirmed those issues were resolved.

Before future deployments, privately confirm the external hosting configuration
uses `$APP_ENVIRONMENT = 'production'` and the correct HTTPS origin/proxy policy.
The private live configuration was not inspected. Local development configuration
must remain separate and unchanged by uploads.
If production has not been selected, the new pages intentionally remain noindex.

After the reviewed upload, clear stale OPcache/page/CDN caches as appropriate and
check both GET HTML and HEAD headers on the actual HTTPS host: home, concept
(including the legacy URL), download, feed, a published example, a published user
project, an owner draft, a guest draft, a missing player, login, admin challenge,
editor redirect, and an arbitrary missing file. Public pages must have no
remaining noindex from PHP, Apache, parent configuration, CDN, or hosting tools;
adding `index` would not cancel one. Verify `/robots.txt` has no blocking rule
that prevents reading a noindex page. Keep existing private/media denials intact.

Apache needs `mod_headers` for the static-preview/error header rules (tested
locally with the module enabled). A host without it must provide equivalent
rules. Nginx ignores `.htaccess`: retain all its existing access protections,
route `/concept/` and `/concept/index.html` through `concept/index.php`, and add
equivalent noindex response headers for static HTML, temporary preview paths,
and errors. The inspected Local Nginx configuration prefers index.php and has
no blanket robots header; PHP public/dev behavior works without changing it,
but its static-preview/error header behavior needs the equivalent host rules.
Do not overwrite that external server configuration with the Apache file.

These changes make intended pages eligible for indexing; discovery and indexing
decisions still belong to search engines.
