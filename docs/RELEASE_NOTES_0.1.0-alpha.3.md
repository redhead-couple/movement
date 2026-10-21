# Movement Timeline Studio 0.1.0-alpha.3

Local Windows build candidate; not published to GitHub.

This build brings the existing shared effect-maker security fixes into both the
source-visible Authoring Kit ZIP and the NSIS installer. Earlier desktop packages
still contained effect exporters that evaluated media filenames or settings as
JavaScript. The updated makers construct data objects directly and render media
names as text.

The desktop runtime and project format are unchanged. This build does not address
the other desktop audit findings: edits made during a pending save, unusual HTML
text in portable exports, crash recovery during media replacement, or the stale
Ripple component-export review. Ripple remains usable as an effect; exporting it
as a standalone component remains blocked by that review.

## Files

- `Movement Timeline Studio-Authoring-Kit-0.1.0-alpha.3-x64.zip`
- `Movement Timeline Studio-Setup-0.1.0-alpha.3-x64.exe`

Both builds are unsigned. The Authoring Kit keeps projects in `workspace/`
beside its executable; the installed application uses its existing Documents
project library. Back up the Kit's workspace before replacing an extracted Kit.
Creating these files does not install them or update the public download.

## Verification

From a full source checkout, run:

```powershell
node --test tests/effect-maker-security.test.cjs
node tools/verify-desktop-effects.cjs dist/desktop-authoring-kit/win-unpacked
node tools/verify-desktop-effects.cjs dist/win-unpacked
```

The distribution check compares the packaged effect makers and shared maker code
with the checkout, exercises the fixed exporters with normal and hostile values,
and launches an isolated Electron host using the packaged application code.
Native file selections are supplied by the test harness; real preload, IPC,
ZIP import, editor, maker, save and playback paths remain in use. Network requests
are blocked and project storage is redirected to a temporary test directory.
