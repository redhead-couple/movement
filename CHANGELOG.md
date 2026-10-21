# Changelog

Movement is maintained and published by Redhead Couple. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions and uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with numbered alpha
prereleases.

## Hosted website update — 2026-10-21

- Serve smaller WebP presentation copies after authorizing the original image;
  preserve original files, pixel dimensions and transparency.
- Keep already-lossy WebP and unsupported animation/color/orientation metadata
  unchanged. Fall back to originals if GD/WebP or cache writes are unavailable.
- Store disposable copies outside projects with bounded cache cleanup. Audio,
  desktop playback and portable exports are unchanged.
- Live opening-sequence verification: initial image bytes fell from 5.35 MB to
  3.11 MB; at 400 kbps / 180 ms, startup fell from about 136 to 91 seconds.
  One minute of playback reached slide 9 without narration stalls.

## 0.1.0-alpha.8 — 2026-10-21

### Fixed

- Web audio and speech now play from complete session-local downloads instead of downloading again at playback.
- Slides wait for their audio; narration advances on actual completion. Failed loads can be retried, and stale playback is cancelled after navigation or pause.
- Audio memory is limited to the current preload window. Local file playback remains supported.

Includes all alpha.7 fixes. See [alpha.8 release notes](docs/RELEASE_NOTES_0.1.0-alpha.8.md).

## 0.1.0-alpha.7 — Prepared locally, not yet published

### Added

- Separate Media Trash screen with a compact right-aligned entry and file count.
- Image thumbnails and enlargement, plus Audio/Speech playback with duration
  and seeking directly from trash. Only one preview plays at a time.
- Per-file restoration and confirmed permanent emptying, with snapshot checks
  and recoverable remaining files if an operation partly fails.

Includes all alpha.6 fixes. See [alpha.7 release notes](docs/RELEASE_NOTES_0.1.0-alpha.7.md).

## 0.1.0-alpha.6 — Prepared locally, not yet published

### Added

- Separate cleanup buttons below the unused Images, Audio and Speech lists,
  with English count confirmations and recovery from Media Trash.
- Backup restoration into a separate editable project copy.

### Fixed

- Preserve referenced images, narration, slide audio layers and global music
  during cleanup; recheck saved state before moving files to recoverable trash.
- Enable reviewed Ripple component export in the Authoring Kit.
- Retain all alpha.5 effect, save, portable-player and replacement-recovery fixes.

See [alpha.6 release notes](docs/RELEASE_NOTES_0.1.0-alpha.6.md).

## 0.1.0-alpha.5 — Prepared locally, not yet published

### Fixed

- Preserve HTML-like project titles and text in standalone portable players.
- Replace media with one same-directory rename after copying, keeping a complete
  old or new file available if the process stops during replacement.
- Include the earlier effect-maker and pending-save fixes in both Windows builds.

Verify packaged saving, effects, ZIP playback, and interrupted media replacement.
Ripple component export and backup restoration UI remain deferred.
See [alpha.5 release notes](docs/RELEASE_NOTES_0.1.0-alpha.5.md).

## 0.1.0-alpha.4 — Prepared locally, not yet published

### Fixed

- Package the shared editor's pending-save fix: a successful save acknowledges
  only the submitted snapshot. Newer edits retain their unsaved indicator and
  desktop close warning until a subsequent save succeeds.
- Verify ordinary saving, edits while an IPC reply is pending, subsequent saving
  and backup contents using the packaged editor, preload and storage service.

Includes the alpha.3 effect-maker fixes. Other desktop audit findings remain
unchanged. See [alpha.4 release notes](docs/RELEASE_NOTES_0.1.0-alpha.4.md).

## 0.1.0-alpha.3 — Prepared locally, not yet published

### Fixed

- Include the existing shared effect-maker security fixes in the Windows
  Authoring Kit and NSIS installer: effect settings and media names remain data
  instead of being evaluated as JavaScript or inserted as HTML.
- Verify packaged effect sources and exercise malicious-project import and
  ordinary effect editing against the bundled desktop host.

This build addresses the desktop distribution gap only. Other desktop audit
findings remain unchanged, including the Ripple component-export review mismatch.
See [alpha.3 release notes](docs/RELEASE_NOTES_0.1.0-alpha.3.md).

## 0.1.0-alpha.2 — Public prerelease

### Added

- Windows Authoring Kit component ZIP export with explicit dependency/license
  declarations and matching source hashes.
- Package inspection showing format/host compatibility, required shared files,
  license text and existing-component conflicts without executing package code.
- Installation into a chosen registry category after explicit trust acknowledgement,
  with revalidation, no overwrite, Hub refresh and rollback on caught failures.
- Soft Glow: an image effect with glow-strength and pulse-speed controls.
- A creation-to-sharing guide covering authoring, registration, testing, reviews,
  licenses, hashes, export, inspection, installation and re-export.

### Fixed

- Include the unchanged repository `LICENSE` inside `resources/app/`, as required
  by component export, and reject Kit builds missing that notice.

### Scope and limitations

- This is a desktop pilot for trusted component code. Dependency/license review,
  matching hashes and structural inspection are not a security audit and do not
  certify code safety. The recipient must decide whether to trust executable code.
- No hosted installation, component updates, overwrite options or extra packaged
  assets. Crash/power-loss recovery remains manual. Windows builds remain unsigned.
- The published alpha.1 release and public download links remain unchanged.
  See [alpha.2 release notes](docs/RELEASE_NOTES_0.1.0-alpha.2.md).

## 0.1.0-alpha.1 — Public prerelease

**Movement Public Alpha 0.1** is published as
[GitHub prerelease `v0.1.0-alpha.1`](https://github.com/redhead-couple/movement/releases/tag/v0.1.0-alpha.1).
The public repository is
[redhead-couple/movement](https://github.com/redhead-couple/movement).

### Changed

- Aligned current public identity: Movement is the project/medium, Movement
  Timeline Studio is the desktop application, Early Formation is the website
  and umbrella brand, and Redhead Couple is the maintainer/publisher.
- Put the live experience and Windows x64 Authoring Kit first in the README,
  followed by Electron source development and advanced PHP/MySQL self-hosting.
- Aligned package and lockfile metadata to `0.1.0-alpha.1`; replaced obsolete
  repository destinations with the planned canonical URL.
- Corrected automated-test and dependency claims, documented the unsigned
  Windows Alpha, and clarified that the packaged kit has no `npm test` script.
- Distinguished the current 25 effects and 6 advanced transitions from the
  older catalog's partial coverage.
- Replaced enterprise-security and governance overclaims with Alpha wording.
  Source/documentation remain MIT-licensed; M05 media provenance facts and
  separate media permissions remain intact.
