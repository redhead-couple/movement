# Movement Timeline Studio 0.1.0-alpha.7

Local Windows build candidate; not published to GitHub.

Includes all alpha.6 fixes, backup restoration and reviewed Ripple export, plus:

- A compact Media Trash button on the right, with a current file count.
- A separate trash screen with image thumbnails and click-to-enlarge previews.
- Audio and Speech players with duration and seeking, directly from trash.
  Starting another preview or leaving the screen stops playback.
- Per-file Restore without overwriting existing media.
- Empty Trash with a file-count confirmation and permanent-deletion warning.
  A changed trash snapshot requires a fresh review; partial failures keep the
  remaining files recoverable. Live media and saved flow data are preserved.

## Files

- `Movement Timeline Studio-Authoring-Kit-0.1.0-alpha.7-x64.zip`
- `Movement Timeline Studio-Setup-0.1.0-alpha.7-x64.exe`

Both Windows builds are unsigned. Keep the existing Kit's `workspace/` folder
and custom engines when replacing it. Building does not install the application,
deploy the website, or change public download links.

## Verification

Extract the final ZIP and NSIS installer payload, compare packaged source hashes,
and exercise the actual packaged main/preload/editor and services in isolated
Electron profiles. Check thumbnails, enlargement, Audio/Speech playback and
seeking, switching players, stopping on exit, restoration, cancellation and
permanent emptying. Verify that referenced media and saved flow remain intact.

The package verifier also covers previous effects/import, pending-save,
portable-player, interrupted replacement and backup restoration regressions,
plus Ripple component export in the Kit. Native executable startup is checked
from each extracted final artifact. Test projects and profiles are temporary.
