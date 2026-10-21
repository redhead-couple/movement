# Movement Timeline Studio 0.1.0-alpha.4

Local Windows build candidate; not published to GitHub.

Includes the alpha.3 effect-maker security fixes and the shared editor's fix for
edits made during a pending save. A successful response acknowledges the snapshot
that was submitted. Later edits retain the unsaved indicator and desktop close
warning. A subsequent successful save stores those edits and clears the warning.
The project format and storage locations are unchanged.

The shared editor fix also applies to the web application. Building these desktop
packages does not deploy the public website.

## Files

- `Movement Timeline Studio-Authoring-Kit-0.1.0-alpha.4-x64.zip`
- `Movement Timeline Studio-Setup-0.1.0-alpha.4-x64.exe`

Both builds are unsigned. The Authoring Kit keeps projects in `workspace/`
beside its executable; the installed application uses its existing Documents
project library. Back up the Kit's workspace before replacing an extracted Kit.
Creating these files does not install them or change public downloads.

## Verification

From a full source checkout:

```powershell
node --test tests/editor-save-state.test.cjs tests/editor-layout.test.cjs tests/workspace-service.test.cjs
node tools/verify-desktop-effects.cjs dist/desktop-authoring-kit/win-unpacked
node tools/verify-desktop-effects.cjs dist/win-unpacked
```

The distribution verifier compares packaged source bytes with the checkout and
uses the packaged host, preload, editor and storage service in isolated Electron
windows. To reproduce the save race deterministically, the harness holds an IPC
reply after the real disk write, makes another edit through the title input,
then releases the reply. It checks the saved content, dirty controls and close
warning, then saves again and checks the updated file, revision and backup.
Ordinary saving and the earlier malicious-project/effect regressions are also
checked. Test storage is temporary and network requests are blocked.

Other audit findings remain unchanged: unusual HTML text in portable exports,
crash recovery during media replacement, and the stale Ripple component-export
review.
