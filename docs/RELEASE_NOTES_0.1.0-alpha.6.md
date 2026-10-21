# Movement Timeline Studio 0.1.0-alpha.6

Local Windows build candidate; not published to GitHub.

Includes all alpha.5 fixes plus:

- Separate bulk cleanup buttons below the unused Images, Audio and Speech lists.
- Short English confirmations with the actual count, Cancel as the default,
  and a reminder that deleted files can be restored from Media Trash.
- Recovery of each trashed file without overwriting an existing file.
- Conservative usage checks covering images, effects, narration, audio layers,
  global music and unknown media fields. The saved project and media list are
  checked again before cleanup. Unsaved desktop edits block removal.
- Backup restoration into a separate project copy, preserving the original.
- Reviewed Ripple component export in the editable Authoring Kit.

Trash still uses storage space. The equivalent website cleanup is implemented
in source; building the desktop distributions does not deploy the website.

## Files

- `Movement Timeline Studio-Authoring-Kit-0.1.0-alpha.6-x64.zip`
- `Movement Timeline Studio-Setup-0.1.0-alpha.6-x64.exe`

Both builds are unsigned. The Kit stores projects in `workspace/` beside its
executable; the installed application retains its Documents project library.
Preserve the Kit workspace when replacing an extracted Kit. Building does not
install the application or update public download links.

## Verification

Extract each final artifact, then run `tools/verify-desktop-effects.cjs` against
the extracted application directory containing `resources/`. Verification uses
the packaged source and real preload/IPC/editor in isolated Electron profiles.
The media UI checks all three buttons' placement, counts, cancellation, dirty
state, normal save, removal, used-file preservation and restoration. It also
exercises the packaged backup restoration UI and Ripple export in the Kit.

The previous effect/import, save-race, portable-player playback and interrupted
media replacement checks remain part of the verifier. Native packaged startup
is tested separately. All test projects and profiles are temporary.
