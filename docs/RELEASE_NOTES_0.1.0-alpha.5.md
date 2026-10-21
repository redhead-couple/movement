# Movement Timeline Studio 0.1.0-alpha.5

Local Windows build candidate; not published to GitHub.

Includes all four fixes from the focused desktop review:

- Effect-maker settings and media names remain data, including imported projects.
- Edits made during a pending save remain unsaved until the next successful save.
- Portable ZIP players preserve HTML-like titles such as `Caption <!--<script>`
  and initialize normally.
- Media replacement copies the new file before one same-directory rename.
  Process interruption leaves the old or new complete file at the expected name.

The save fix also applies to the shared web editor. The portable export and media
replacement fixes are desktop-specific. Building does not deploy the website.

## Files

- `Movement Timeline Studio-Authoring-Kit-0.1.0-alpha.5-x64.zip`
- `Movement Timeline Studio-Setup-0.1.0-alpha.5-x64.exe`

Both builds are unsigned. The Kit stores projects in `workspace/` beside its
executable; the installed application retains its Documents project library.
Back up the Kit workspace before replacing an extracted Kit. Building does not
install the application or change public downloads.

## Verification

From the full source checkout:

```powershell
node tools/verify-desktop-effects.cjs dist/desktop-authoring-kit/win-unpacked
node tools/verify-desktop-effects.cjs dist/win-unpacked
node tools/smoke-authoring-kit.cjs
node tools/smoke-packaged.cjs
```

The verifier compares packaged source bytes with the checkout and runs the
packaged host, preload, editor and services in isolated Electron windows.
It tests malicious and normal imports, effect editing/preview/playback, all 26
makers, ordinary saving, edits during a delayed IPC reply, and the subsequent
save and backup.

Additional tests use the Kit files directly or files extracted from the installer
ASAR. Actual exported ZIP players are opened in Chromium with normal, script-like
and script-breakout titles, checking preserved data, images, playback controls and
no network requests. Eighteen media tests cover images, speech and music with
normal replacement, process exit during copy/before commit/after commit, copy
failure, rename failure, reopening and retry. Test data is temporary.
These process-interruption tests do not simulate physical disk failure.

Ripple component export remains blocked pending its source/dependency/license
review. A backup restoration UI remains deferred. Neither is changed here.
