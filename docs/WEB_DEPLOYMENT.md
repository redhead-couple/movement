# Upload the website yourself

## Build

Double-click **`MAKE-WEBSITE-UPLOAD.bat`** in the local project folder.
It rebuilds the website files and opens `dist/website` when successful.
Run it again after making changes you want to upload. It never connects to hosting.

Alternatively, from the local Movement project directory, run:

```powershell
npm.cmd run web:build
```

- **FileZilla:** upload the **contents** of `dist/website/upload/`.
- **cPanel:** upload `dist/website/website.zip` and extract directly into the website root.
- `dist/website/UPLOAD-LIST.txt` gives the exact upload list.
- `dist/website/manifest.json` records sizes and SHA-256 hashes for your reference.

The build reports its file count and size. It includes working local changes,
even before committing them; review these before selecting files to upload.
The builder recreates only the generated local folder, lints PHP and verifies
every ZIP entry. Both `.htaccess` files are explicitly included in the ZIP.

Included: PHP pages, required server helpers, templates, shared web editor/player/
maker code, effects/transitions/registries, website styles, concept page, interface
background, favicon, and robots.txt. Excluded: real configuration, private-data, examples and
their media, desktop-only entry pages/Electron files, development files, tests,
tools, temporary files, database scripts and npm dependencies.
Never upload the source project directory or your local app-config.php.

## Confirm the locations before first cleanup

These exact live paths are **not yet verified**:

| Item | Identify in FileZilla/cPanel |
|---|---|
| Website root | Actual document root for redhead-couple.org |
| Private data | Existing private-data directory, with every descendant |
| Examples | Existing example directory, with every descendant |
| Configuration | Existing app-config.php above the document root |

Current PHP expects `private-data/slidedeck/` and plural `examples/` under its
document root, and `app-config.php` one level above. These are code expectations,
not confirmed hosting paths. If the real layout differs, report the paths before
cleanup; do not move preserved media to make it fit.

FileZilla's Remote site path can differ from cPanel's physical path. Record both
if different. Show hidden files so `.htaccess` is visible. Identify any additional
hosting-managed directory such as `.well-known` that must be retained. Only paths
or folder listings are needed, never configuration contents or passwords.

## First replacement

After the actual root and preservation paths are confirmed:

1. Optionally take a hosting snapshot for code rollback, outside the public root.
   Pause public access/authoring at the hosting level during replacement if
   available. Downtime is acceptable; local code replaces the old website code.
2. Work **only inside the confirmed website root**. Delete obsolete code using a
   reviewed list. Leave every protected directory and all contents untouched.
   **If protected data is nested, retain every parent on the path to it and delete
   only unprotected siblings. Never recursively delete that parent.** The external
   configuration is outside the cleanup boundary; the database is unchanged.
3. Upload with either method below, replacing code files. Merge into existing
   directories; never first delete a parent containing protected data.
4. Check the site, then restore public access.

Until those paths are known, there is no confirmed blanket deletion list. ZIP
extraction replaces included code but leaves obsolete files behind. No automatic
live deletion or upload script is included; you control hosting.

### FileZilla

1. Connect to `redhead` and open the confirmed website root on the remote side.
2. Open `dist/website/upload` on the local side.
3. Select **everything inside it**, including `.htaccess`, and upload.
4. First replacement: select **Overwrite** for conflicting code files.
5. Check failed transfers and retry any failures.

Do not upload the enclosing `upload` folder. Neither private-data nor examples is
present in the generated folder, so neither belongs in the transfer queue.

### cPanel ZIP

1. Upload `dist/website/website.zip` using File Manager.
2. Extract **directly into the confirmed document root**, allowing code overwrites.
   The ZIP has no wrapper folder and includes both `.htaccess` files.
3. Remove the uploaded ZIP afterward if placed in public_html.

There are no private-data, examples or real configuration entries to extract.

## Routine updates

1. Run `npm.cmd run web:build`.
2. Upload the contents of `dist/website/upload` in FileZilla. Choose **Overwrite if
   different size or source newer** to skip unchanged code. The builder preserves
   source timestamps. Check failed transfers. Alternatively, use the ZIP again.
3. Remove retired code files by comparing the previous and new `UPLOAD-LIST.txt`;
   retain the previous list outside the website root. Apply the same root and
   nested-preservation rules to every deletion.
4. Check the website.

FileZilla compares size/time, not content hashes. After a Git revert, uncertain
timestamps or suspected live edits, choose **Overwrite** for all code so local
source wins. Do not enable synchronization deletion of excluded files. ZIP upload
transfers all code; FileZilla supports incremental upload.

## Checks and rollback

For production/development crawler policy and the concept page's PHP entry,
see [Public indexing controls](INDEXING.md).

- Confirm hosting PHP can read the external app-config.php, including `open_basedir`.
  The protected read/parse probe in `HOSTED_CONFIGURATION.md` is available; omit
  comparison to the old config if that file is already absent.
- Check home, login, feed, an existing example and published slideshow, images/audio,
  and `/edit/<project>/`. Refresh OPcache through cPanel if required.

- Direct `/private-data/...`, `/server/...` and example backup requests must be
  denied. Unpublished projects/media must remain private.
- Hosting needs Apache-compatible `.htaccess`, `mod_rewrite`, PHP 8+ and documented
  PHP extensions. Nginx needs equivalent host rules. Do not remove deny rules to
  fix an HTTP 500; inspect the hosting error log.
- Keep the database. No migration/reset scripts are included. Account recovery
  depends on existing `password_reset_tokens` and `password_reset_attempts` tables;
  check feature/schema compatibility separately, without resetting anything.

To validate the generated package locally, run `npm.cmd run web:test` after
`npm.cmd run web:build`. The generated-output checks report a skip if there is
no build yet; Apache integration checks require Apache with its PHP module.

The generated package passed local Apache/PHP tests with synthetic external
configuration and preserved data: external configuration loading, data paths,
playback, editor routing and private-access restrictions. Live paths, permissions,
database compatibility and hosting behavior remain to be checked.

Rollback: upload a previous code build using the same preservation rules, removing
only obsolete unprotected code. No database/media restoration is required for
this filesystem-only update.
