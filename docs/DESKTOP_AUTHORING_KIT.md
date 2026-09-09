# Desktop Authoring Kit

The Desktop Authoring Kit is the editable, no-installer Windows distribution of
Movement Timeline Studio. It is generated from the same repository as the web
platform and installed desktop application; it is not a separately maintained
version.

Movement is the project/medium, Early Formation is the website and umbrella
brand, and Redhead Couple maintains and publishes the application.

Current source targets **Movement Public Alpha 0.1**, application version
`0.1.0-alpha.1` and planned tag `v0.1.0-alpha.1`. The kit inherits its version
from the root `package.json`. The [planned repository](https://github.com/redhead-couple/movement)
and GitHub release are not yet public. Check the
[Windows download page](https://redhead-couple.org/download.php) for the version
actually available; an earlier ZIP is not the current source candidate.

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
