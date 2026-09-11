# Desktop development

Movement Timeline Studio is Movement's desktop application, maintained and
published by Redhead Couple under the Early Formation umbrella. Its host and
shared frontend live in `desktop/` and `shared/frontend/`; the PHP web platform
remains a supported separate runtime.

## Start the application

Requirements:

- Node.js 22.12 or newer
- npm

Install the pinned development dependencies from the full source checkout:

```powershell
npm.cmd ci
```

Then start the desktop app:

```powershell
npm.cmd run desktop
```

On Windows, `start-desktop-dev.bat` runs the same command. The starter removes
an inherited `ELECTRON_RUN_AS_NODE` variable before launching Electron.

## Application identity

The desktop product name and version come from `package.json`:

- product name: **Movement Timeline Studio**
- current development version: **0.1.0-alpha.1**
- human-facing release label: **Movement Public Alpha 0.1**
- published Git tag: `v0.1.0-alpha.1`
- publisher: **Redhead Couple**
- Windows application ID: `org.movement.timelinestudio`

The [public repository](https://github.com/redhead-couple/movement) and
[Public Alpha prerelease](https://github.com/redhead-couple/movement/releases/tag/v0.1.0-alpha.1)
are available on GitHub. Package/internal names, application IDs, protocols,
and existing storage paths are retained for compatibility.

Electron exposes that version through the runtime context and the Library shows
it in the top navigation. The main window, editor, player, taskbar grouping, and
native About information use the same application identity.

Windows icon assets live in `desktop/assets`:

- `movement-icon-source.png` is the high-resolution source artwork;
- `movement-icon.png` is the 512px application image;
- `movement-icon.ico` contains 16, 20, 24, 32, 40, 48, 64, 128, and 256px
  entries for Windows DPI scaling.

Regenerate the derived PNG and ICO after replacing the source artwork:

```powershell
npm.cmd run build:windows-icon
```

Update the `package.json` version before producing each distributable build.
Keep the root and root-package versions in `package-lock.json` in agreement.
The Windows download helper can rebuild the current version or increment the
numbered alpha prerelease; it does not create Git tags or publish releases.
The Windows packager reads `productName`, `version`, and
`desktop/assets/movement-icon.ico` from that manifest rather than duplicating
those values.

## Project storage

Development and distributed builds deliberately use different project-library
locations:

- development uses the repository's `private-data/slidedeck` folder, so the
  current slideshows continue to work without being moved;
- a packaged Windows build uses
  **Documents / Movement Timeline Studio / private-data / slidedeck**.

The packaged location comes from Windows' registered Documents folder, so it
also works when Documents is redirected to another drive or a managed folder.
The application creates the complete directory on first launch and verifies
that it can create and remove a temporary file before opening the Library. If
Windows denies access, startup stops with a clear project-library error instead
of allowing later saves to fail.

The Library displays the active location and its **Open project files** button
opens the real folder in Windows Explorer. Renderer pages receive only the
friendly location label; the absolute path remains in the protected desktop
process.

This separation keeps writable projects outside the installed application
files, including when the application is installed under `Program Files`.
Replacing, upgrading, or uninstalling the application therefore does not
target the Documents project library. A first packaged run does not
automatically copy development projects. Transfer one with **Export portable
ZIP** and **Import portable ZIP**, or copy a complete workspace folder while
the application is closed.

## Windows installer

The pinned `electron-builder` development dependency produces a 64-bit,
assisted NSIS installer:

```powershell
npm.cmd run dist:windows
```

The distributable is written to:

`dist/Movement Timeline Studio-Setup-0.1.0-alpha.1-x64.exe`

The build also leaves `dist/win-unpacked` for packaged-runtime validation. The
installer is per-user by default, does not require administrator access for its
normal destination, lets the user choose a different installation directory,
and creates Start menu and desktop shortcuts.

The package contains only the Electron desktop runtime, shared frontend,
examples, effects, transitions, and their required application media. It does
not contain PHP pages, development tests, Node.js tooling, or anything from
`private-data`. Electron itself is bundled, so the installed application does
not require PHP, MySQL, Node.js, or internet access.

## Build the Desktop Authoring Kit

The source-visible, no-installer Windows ZIP is a separate distribution from
the NSIS installer. Build it with:

```powershell
npm.cmd run dist:authoring-kit
```

This uses `distribution/desktop-authoring-kit.manifest.json` as an explicit
allowlist and keeps the application source unpacked. The normal installer still
uses ASAR. The build verifies required source, rejects PHP and private-data
paths, writes the ZIP below `dist/desktop-authoring-kit/`, and creates a SHA-256
checksum beside it. See `docs/DESKTOP_AUTHORING_KIT.md` for the end-user and AI
authoring workflow.

The current source would produce
`Movement Timeline Studio-Authoring-Kit-0.1.0-alpha.1-x64.zip`. The kit derives
its application version from `package.json`; the distribution manifest does
not define a separate version. An existing `0.1.0` artifact is an earlier
build, not the `0.1.0-alpha.1` candidate. Updating metadata does not rebuild or
publish a ZIP. The website download page links directly to the published GitHub
release assets, independently of local build output. GitHub's published filename
is `Movement.Timeline.Studio-Authoring-Kit-0.1.0-alpha.1-x64.zip`, with a matching
`.zip.sha256` asset.

Run the packaged library and writable-registry smoke checks with:

```powershell
npm.cmd run desktop:smoke:authoring-kit
npm.cmd run desktop:smoke:authoring-kit:registry
```

Validate the unpacked packaged application after every installer build:

```powershell
npm.cmd run desktop:smoke:packaged
```

Unlike the development smoke test, this starts the built executable with
`app.isPackaged` enabled and verifies the bundled homepage plus writable
Documents storage.

The Windows Alpha installer and Authoring Kit are unsigned. Windows may display
a SmartScreen or unknown-publisher warning. Signing is separate from application
functionality and is not claimed for Movement Public Alpha 0.1.

## Implemented vertical slices

The desktop foundation provides:

- a sandboxed Electron window with context isolation and no renderer Node.js;
- the shared Movement homepage and project-library interface;
- discovery of valid workspaces under the active project-library location;
- automatic selection when exactly one user workspace exists;
- a separate, read-only Examples workspace;
- read-only project summaries and opening-image thumbnails.

The safe-write slice adds:

- creation of named workspaces and schema-v2 starter projects;
- copy-before-edit for bundled Examples;
- project rename and duplication with media preserved;
- recoverable removal to a workspace-local `.movement-trash` folder;
- revision-checked `flow.json` saves;
- an automatic backup before every flow replacement;
- retention of the newest 20 backups, matching the PHP application.

The recovery slice completes project-level recoverable deletion:

- the Library shows the selected workspace's recoverable project count;
- the **Trash** screen lists removed slideshows with their slide count and
  removal time;
- **Restore** moves the complete project folder back, including `flow.json`,
  media, backups, and other project files;
- a project-name conflict offers **Restore as Copy** or Cancel and never
  overwrites the active project;
- workspace metadata is preserved before removing the final active project, so
  an empty workspace with recoverable trash remains discoverable;
- permanent deletion is deliberately not exposed yet.

The editor/player integration adds:

- Edit and Play actions on desktop project cards;
- the existing shared timeline editor running in an isolated desktop window;
- direct editor loading from the selected project’s `flow.json`;
- revision-checked editor saves through the protected persistence service;
- the existing shared player running in an isolated desktop window;
- project images and audio delivered through the restricted
  `movement-project://` protocol;
- browsing of the project’s existing media library.

The media-management slice adds:

- native image and audio pickers for the opening image, slide backgrounds,
  foreground layers, narration, additional audio layers, and global audio;
- imports into the active project’s `img`, `speech`, or `audio` folder without
  exposing source filesystem paths to renderer code;
- extension and file-signature validation for supported image and audio types;
- safe filename normalization and atomic project-folder writes;
- explicit **Use Existing**, **Replace**, and **Cancel** choices for conflicts;
- immediate `Browse Lib` refresh, including maker pages in the Effects Hub;
- cache-versioned project media URLs so replacements appear immediately.

The editor’s top-level **Media** manager completes the project-wide workflow:

- scans the saved `flow.json` and groups opening, global, and slide-linked media
  in presentation order;
- identifies background, foreground, effect image/frame, speech, and additional
  audio references;
- separates unused images, speech, and audio from referenced files;
- reports missing referenced files without exposing project filesystem paths;
- imports into any of the three project media folders using the same protected
  native picker;
- moves only verified-unused files to hidden, recoverable project media trash;
- rejects removal when the slideshow revision changed or a file is still used.

The portable-project slice uses one ZIP for publishing and backup:

- **Export portable ZIP** is available from both the library and editor;
- the ZIP contains one project folder with `player.html`, `flow.json`, and all
  safe files from `img`, `speech`, and `audio`;
- `player.html` contains the player CSS, JavaScript, and only the effect and
  transition engines used by that slideshow, so it runs directly from the
  extracted folder without PHP, Electron, Node.js, or internet access;
- **Import portable ZIP** restores the editable `flow.json` and media into the
  selected workspace;
- an existing project is never overwritten: the desktop asks whether to import
  a separately named copy or cancel;
- ZIP paths, expansion sizes, file counts, media extensions, and media file
  signatures are validated before a project is installed;
- an imported `player.html` is treated as untrusted and is not installed or
  executed. A fresh trusted player is generated the next time the project is
  exported.

To share a slideshow, extract the ZIP and keep `player.html`, `flow.json`, and
the three media folders together. Open `player.html` in a modern browser and
press **Start** when the browser requires a user gesture before playing audio.

Desktop pages and their allowlisted static dependencies are served from the
secure `movement-app://ui/` protocol. This lets the Effects Hub load its JSON
registry, maker pages, and ES-module engines without weakening Electron
web-security or exposing private project files. Project media continues to use
the separate restricted `movement-project://` protocol.

The Effects Hub smoke test opens the real editor, loads every registered effect
maker, confirms that each maker API initializes, and verifies project-media
delivery. Registry-integrity tests also require every registered effect and
transition to have both a maker and an engine file.

The integrated **Registry Editor** manages effects and transitions within the
desktop application:

- open it globally from the Library, from **Manage effects** in the Effects
  Hub, or from **Manage transitions** in the Transitions Hub;
- both registries are read through the protected preload bridge rather than a
  local HTTP server;
- the default view is a clean category-and-item list; rename, add, remove, and
  delete controls appear only after choosing **Edit** on one category;
- both registries always offer an **Experimental** category for new personal
  work without rewriting either JSON file merely by opening the editor;
- effects and transitions with both expected files appear normally, while
  incomplete work remains usable and receives a **Needs attention** warning;
- unconventional maker code is allowed; only duplicate categories, duplicate
  engines, unsafe names, and stale saves are rejected before replacing a
  registry;
- every successful save creates a timestamped backup under
  `.movement-registry-backups`, with the newest 20 retained;
- writes are atomic and the open Hub refreshes immediately after a save;
- **Open developer files** opens the application source folder in Windows
  Explorer without exposing its absolute path to renderer code.

Development mode is writable. The current sealed ASAR installer can inspect
the registries but intentionally shows a read-only explanation. The source-visible
Windows Authoring Kit provides the same registry editor with writes enabled.
Use Movement Timeline Studio / Windows Authoring Kit for normal local authoring,
`npm run desktop` for source development, and PHP/MySQL for advanced web hosting
or self-hosting.

The effect and transition prompt designers share one progressive interface.
The first choice is **Create something new** or **Improve something existing**.
Creation collects a visual brief and optional creative controls. Improvement
loads complete and incomplete entries from the matching registry, then asks
only for the desired result, improvement focus, behavior to preserve, and
optional reproduction details for a repair. Choosing **Controls** reveals
optional fields for the control name, behavior, default, and range; choosing
**Fix a problem** alone reveals reproduction details. Its generated repository-aware
prompt keeps the existing slug, paths, category, registry order, and saved
`flow.json` configuration compatible while requiring maker, editor, player,
portable-export, cleanup, and performance verification.
Explicitly requested controls remain visible in their most logical maker group;
the generated prompt reserves Advanced sections for optional, rarely used, or
technical controls rather than using the existing control count as the reason.

Folders are treated as workspaces only when they contain
`.movement-workspace.json` or at least one direct child project containing
`flow.json`. This deliberately excludes utility folders such as the legacy
`transitions` directory.

The renderer talks only to `shared/frontend/platform-adapter.js`. In the
desktop application that adapter delegates to the narrow preload bridge. A future
PHP adapter can implement the same frontend-facing methods without maintaining
a second interface.

Desktop project data is never stored in browser local storage. Media imports
are copied into the project before `flow.json` references them. The PHP web
application retains its save and media behavior because desktop integration
is gated by an explicit bootstrap flag.

## Validation

Run these commands from the full source checkout, not the extracted Authoring
Kit. Node.js 22.12 or newer and the installed development dependencies are
needed; the full suite also invokes PHP. Install PHP 8.0 or newer with the
extensions listed in [Local Installation](LOCAL_INSTALLATION.md).

Verification snapshot after public-source cleanup, 2026-09-10: the Node runner
reports **211 tests passing, zero failures, and zero skipped tests** across
35 test files. All **10 PHP test scripts** pass. Media provenance verification
maps all **387 public media files** with no unmapped files or hash discrepancies.
Re-run the checks for each candidate rather than treating this dated result
as a permanent guarantee.

Run the service tests:

```powershell
npm.cmd test
```

Run the PHP scripts and lint changed PHP files:

```powershell
Get-ChildItem tests/php/*.test.php | ForEach-Object { php $_.FullName }
php -l player.php
```

Run an end-to-end Electron smoke test:

```powershell
npm.cmd run desktop:smoke
```

Smoke-test each connected surface:

```powershell
npm.cmd run desktop:smoke
npm.cmd run desktop:smoke:editor
npm.cmd run desktop:smoke:player
npm.cmd run desktop:smoke:preview
npm.cmd run desktop:smoke:effects
npm.cmd run desktop:smoke:registry
npm.cmd run desktop:smoke:packaged
npm.cmd run desktop:smoke:packaged:registry
```

The smoke tests launch the real renderers, read the local library through the
preload bridge, print an `ELECTRON_SMOKE_TEST_OK` line, and exit without showing
a window or saving project data.
