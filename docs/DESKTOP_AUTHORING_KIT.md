# Desktop Authoring Kit

The Desktop Authoring Kit is the editable, no-installer Windows distribution of
Movement Timeline Studio. It is generated from the same repository as the web
platform and installed desktop application; it is not a separately maintained
version.

Movement is the project/medium, Early Formation is the website and umbrella
brand, and Redhead Couple maintains and publishes the application.

**Movement Public Alpha 0.1**, application version `0.1.0-alpha.1`, is available as
[prerelease `v0.1.0-alpha.1`](https://github.com/redhead-couple/movement/releases/tag/v0.1.0-alpha.1).
The kit inherits its version from the root `package.json` in the
[public repository](https://github.com/redhead-couple/movement). Use the
[Windows download page](https://redhead-couple.org/download.php) for the
recommended Authoring Kit ZIP and its SHA-256 checksum.

The current locally prepared Kit is **`0.1.0-alpha.2`**, not yet published. The
public alpha.1 release linked above remains unchanged. See the
[alpha.2 release notes](RELEASE_NOTES_0.1.0-alpha.2.md).

## Start the application

1. Extract the complete ZIP to a writable directory.
2. Run `Movement Timeline Studio.exe` beside `README-FIRST.md`.
3. Keep the runtime files and `resources/` directory together.

No PHP, database, Node.js installation, or internet connection is required for
normal authoring and playback. This no-installer kit keeps projects in the
visible `workspace/` folder beside the executable. It begins with an empty
user-workspace list and the complete bundled Examples workspace opens read-only.
`My Workspace` is only created after the user confirms the first-run action.

The Windows Alpha build is **unsigned**. Windows may show a SmartScreen or
unknown-publisher warning. Back up your workspace and source changes before
replacing an extracted kit.

## Edit the source

The editable application root is `resources/app/`. Open that directory in a
code editor or AI coding environment.

To add an effect, normally create:

```text
effects/<name>-engine.js
effects/<name>-maker.html
```

Then register it in `effects/registry.json`. Transitions use the corresponding
files and registry below `transitions/`.

Read these contracts before making changes:

- `docs/EFFECT_AUTHORING_CONTRACT.md`
- `docs/TRANSITION_AUTHORING_CONTRACT.md`
- `docs/ANIMATION_PERFORMANCE_BUDGET.md`
- `docs/flow-schema.md`

The application registry editor can discover correctly named maker and engine
files. Restart the application after changing source files so every window uses
the updated code.

Component export, inspection and installation are a **desktop pilot for trusted
components** in the development application and the locally prepared alpha.2 Kit.
**The existing public alpha.1 download does not include this feature.** There is
no hosted component installation or overwrite/update workflow.

Follow [Creating and sharing components](COMPONENT_EXPORT.md) for the complete
creation/registration, review/license/hash, export, inspection, installation and
re-export workflows. It uses Soft Glow and Alternating Panels as worked examples,
distinguishes development-source and built-Kit launch instructions, and records
the completed manual checks. Dependency review and matching hashes do not prove
code safety.

## Testing source changes

The kit contains some JavaScript test files for reference, but its packaged
`package.json` does not expose an `npm test` script. It also excludes PHP and
other files needed by the full repository suite. Do not use the extracted kit
as a complete test checkout.

For automated verification, use a full source checkout with Node.js 22.12 or
newer, install its development dependencies with `npm ci`, and follow its
desktop-development instructions. The complete suite also needs PHP. Within
the kit, restart the application and check the edited maker, editor, and player
behavior manually. Normal application use needs neither Node.js nor `npm install`.

## Distribution boundary

The kit contains the Electron desktop host and the shared editor, player,
makers, effects, and transitions. It deliberately excludes PHP endpoints,
database code, web templates, credentials, private projects, dependency folders,
and installer files. The exact allowlist is recorded in
`distribution/desktop-authoring-kit.manifest.json`.
