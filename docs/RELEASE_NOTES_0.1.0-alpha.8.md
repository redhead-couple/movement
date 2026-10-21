# Movement Timeline Studio 0.1.0-alpha.8

Published as a Windows prerelease on 2026-10-21. Includes all alpha.7 fixes.
The release reuses the verified Authoring Kit and installer; no rebuild was
needed for the subsequent hosted image optimization.

## Included improvements since alpha.2

- Packaged effect security fixes and malicious-project import checks.
- Edits made during an in-flight save remain marked as unsaved.
- Portable exports preserve HTML-like titles without breaking playback.
- Media replacement keeps a complete old or new file if the process stops.
- Reviewed Ripple component export in the Authoring Kit and backup restoration
  into a separate editable project copy.
- Bulk cleanup for unused Images, Audio and Speech with recoverable Media Trash,
  a separate trash screen, image enlargement, audio previews and confirmed emptying.

## Audio and speech preloading

Web project audio is downloaded completely into session-local memory and reused
for playback. It no longer depends on HTTP caching of private media. The player
waits for audio before showing the incoming slide and advances on actual speech
completion rather than a timer started from metadata. Failed downloads can be
retried. Pause and navigation cancel stale playback requests. Old audio outside
the preload window is released. External audio without CORS retains native
playback compatibility; that fallback does not promise a complete buffered file.

The runtime is shared by the website, desktop player and exported offline
players. Local file playback remains supported. Slow connections may still
require an initial loading wait or a wait when jumping outside the prepared window.

## Downloads

- `Movement.Timeline.Studio-Authoring-Kit-0.1.0-alpha.8-x64.zip`
- `Movement.Timeline.Studio-Setup-0.1.0-alpha.8-x64.exe`
- Matching SHA-256 files accompany both downloads on the GitHub release.

The website download page also serves these same verified binaries. GitHub asset
names use dots instead of spaces; the application bytes are unchanged. Embedded
documentation in the existing binaries may still describe their local preparation
status; these online release notes record publication.

Windows builds are unsigned. Extract the Kit into a new folder and preserve
the existing Kit's `workspace/` and custom engines. Building does not install
the app, upload the website or update public download links.

## Verification

The final ZIP and installer were extracted and their packaged code tested,
including native startup, hostile/normal project import, saving, export, media
replacement recovery, trash previews/restoration/emptying and audio playback.
The installed alpha.8 application also passed its startup check.

## Hosted website images (separate from the desktop binaries)

The source also includes an online-only image optimization deployed and checked
on the live site. Originals remain intact; the hosted player receives smaller
presentation copies when PHP GD/WebP and cache writes are available. The shared
audio runtime is unchanged. See [web deployment](WEB_DEPLOYMENT.md).
The image-only website patch applies after the earlier alpha.8 website update;
it is not a full website distribution or an application update.

## Repeating verification

Extract final deliverables and compare their player runtime with the source.
Run normal and slow HTTP playback against their packaged runtime, including
downloads longer than 15 seconds, audio/speech/background music, pause/resume,
automatic completion, navigation during loading, failed-load retry and local
file playback. Check for duplicate downloads and buffering during playback.
Desktop verification also checks native executable startup and previous
effects, saving, export, media replacement, backup and Media Trash regressions.
