# Movement Timeline Studio 0.1.0-alpha.2

Prepared locally for the Windows x64 Authoring Kit; not yet tagged or published.
The existing public alpha.1 release remains available and unchanged.

## Create and exchange effects and transitions

- Export an eligible effect or advanced transition as a `.component.zip` from
  **Manage effects** / **Manage transitions**. The package contains its unchanged
  maker and engine, a generated manifest and the applicable license notice.
- Use **Inspect component ZIP…** to check structure, host compatibility, required
  shared files and name/file conflicts, and read the license as plain text.
- Choose a category, explicitly acknowledge trust and install a valid,
  non-conflicting package. The Hub refreshes automatically. Installation rechecks
  the approved ZIP and destinations, never overwrites existing components, and
  rolls back its own changes on caught failures.
- Try **Soft Glow** under **Experimental**: select a project image and adjust
  glow strength and pulse speed.
- Follow the [creation-to-sharing guide](COMPONENT_EXPORT.md), including exact
  review declarations, PowerShell hash commands, licensing and recipient re-export.

The Kit now includes the application-root `LICENSE` required by component export,
alongside the executable-level notice. Packaging verification checks its presence.

## Trust and current limits

This is a **desktop feature for trusted component code**. Inspection does not
execute package code, but **does not certify code safety**. Dependency/license
reviews and matching hashes are not a security audit or a signature. Read the
license and decide whether you trust the author before installation and use.

Format 1 supports only the defined host dependencies and four package files;
shared application files and project media do not travel in the package. There
is no hosted component installation, overwrite/update workflow or support for
additional packaged assets. Crash/power-loss recovery is manual. The Windows
Authoring Kit remains unsigned.

Extract the complete Kit into a new writable folder and run
`Movement Timeline Studio.exe`. Keep existing workspaces and custom source backed
up separately; replacing an old Kit folder is not a component update mechanism.
See the [Authoring Kit guide](DESKTOP_AUTHORING_KIT.md) for storage and launch details.
