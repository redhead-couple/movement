# Creating and sharing components (Windows Authoring Kit)

This is the implemented **desktop pilot for trusted components**, using component
package format 1. It supports export, inspection and installation in the editable
Windows Authoring Kit and the desktop development source. There is no hosted
component installation, overwrite option, automatic update or component version
management. Sealed ASAR applications cannot use this workflow.

**The locally prepared alpha.2 Kit includes this feature; the existing public
alpha.1 download does not.** Alpha.2 has not yet been published. Use the development
application or a compatible editable Kit that already includes the pilot.

## Open the right application

All file paths below are relative to the **application root**, unless explicitly
identified as beside the executable. Component source belongs here, not in a
project or workspace folder.

| Environment | Application root | How to open it |
| --- | --- | --- |
| Development source checkout | Repository directory containing `package.json`, `desktop/`, `effects/` and `transitions/` | Open PowerShell here and run `npm.cmd run desktop`. Alternatively, double-click `start-desktop-dev.bat`. |
| Built, editable Authoring Kit with the pilot | `resources/app/` inside the extracted Kit | Run `Movement Timeline Studio.exe` beside `README-FIRST.md`. Keep the extracted runtime and `resources/` together in a writable directory. |

A fresh development checkout needs Node.js 22.12 or newer and `npm.cmd ci` before
its first launch. Those development commands are not instructions for a built
Kit: ordinary Kit use needs neither Node.js nor npm. Built Kit projects live in
`workspace/` beside the executable, separate from `resources/app/`.
Restart after changing application or component source so windows do not keep
old code. Saving registration or installing a new component notifies open Hubs
automatically and does not itself require a restart.

Open the management window through **Creator tools → Registry editor** in the
Library, or **Manage effects** / **Manage transitions** in the corresponding Hub.
Its **Effects** and **Transitions** tabs edit separate registries.

## Terms and boundaries

| Term | Meaning here |
| --- | --- |
| Maker | HTML controls and preview, opened inside a Hub. It exports configuration for a slide. |
| Engine | JavaScript that renders an effect or runs an advanced transition in preview and playback. |
| Registry | `effects/registry.json` or `transitions/registry.json`: categories with comma-separated IDs in `engines`. It makes components available to the Hub and player. |
| Manifest | Generated `component.json` inside the package: identity, entry paths, format, host requirements and license filename. It contains no slideshow configuration. |
| Host contract | A named agreement about interfaces and dependencies supplied by the receiving application. It is not a security sandbox. |
| Review declaration | One manual entry in `desktop/component-export-reviews.json`, tying reviewed source/license bytes to hashes and declared requirements. It gates export, not installation. |

A **component ZIP** shares one reusable maker and engine for another Kit's Hub.
A **slideshow ZIP** shares a particular slideshow for playback, including project
data/media and required player/engine code. Slideshow export does not install a
maker in a receiving Hub and remains a separate workflow.

Dependency/license review and matching hashes **are not a security audit and do
not prove code safety**. A hash only identifies reviewed bytes. The exporter does
not infer arbitrary JavaScript dependencies. Inspection checks structure and
declared requirements; neither inspection nor installation executes or previews
package code. Opening the maker or playing the effect afterward does execute it.
Decide whether you trust its source before doing that.

## Path 1 — Create and export a component

### 1. Choose an unused ID and create the pair

Check the appropriate registry and both destination filenames before creating
anything. IDs use lowercase letters/numbers separated by single hyphens; format 1
accepts up to 100 characters and rejects Windows reserved names such as `con`.
Keep filenames, module imports, exported `engine` ID and exported `maker` path
consistent. Never reuse an existing ID for unrelated work.

Soft Glow and Alternating Panels already exist. These are worked references,
not instructions to overwrite or register them twice.

| File | Purpose / action when creating a new component |
| --- | --- |
| `effects/soft-glow-maker.html` | Create the effect's controls, media selection and preview. |
| `effects/soft-glow-engine.js` | Create its rendering module. |
| `transitions/alternating-panels-maker.html` | Transition equivalent: controls and outgoing/incoming preview. |
| `transitions/alternating-panels-engine.js` | Transition equivalent: choreography module. |
| `effects/registry.json` or `transitions/registry.json` | Modify through Manage to register the ID in a category. |
| `desktop/component-export-reviews.json` | Add one reviewed declaration for export eligibility. |
| `LICENSE`, or a notice under `desktop/component-licenses/` | Read the applicable existing notice, or add a component-specific notice if required. Never assume a custom component uses MIT. |
| Shared helpers/styles and Hub/editor/player files | Read/use supported interfaces; these examples need no shared application edits. |

Read the [effect contract](EFFECT_AUTHORING_CONTRACT.md),
[transition contract](TRANSITION_AUTHORING_CONTRACT.md) and
[performance requirements](ANIMATION_PERFORMANCE_BUDGET.md) before writing a pair.
The actual references are [Soft Glow maker](../effects/soft-glow-maker.html) /
[engine](../effects/soft-glow-engine.js) and
[Alternating Panels maker](../transitions/alternating-panels-maker.html) /
[engine](../transitions/alternating-panels-engine.js).

**Effect conventions, demonstrated by Soft Glow:**

- Maker: `<base href="../">`, stylesheet `studio/maker/maker-theme.css`, script
  `studio/maker/maker-engine.js`, and module import from
  `/effects/soft-glow-engine.js`. The leading `/` is a served application URL;
  registry/manifest paths have no leading slash.
- Expose `window.MakerAPI.run`, `getExportJSON`, `loadEditConfig`, and the image
  callback `onImageLoaded`. Return JSON-safe configuration with `enabled`, `name`,
  `engine`, `maker` and `config`. Soft Glow stores `imgSrc` as `img/<filename>`,
  plus `strength` and `pulseSpeed`. Use the shared project media bridge, not an
  absolute path from the creator's computer. The shared maker handles Apply and
  saved effect restoration, including `effectEditData`.
- Engine: export `mount(canvas, ctx, config)` and return idempotent cleanup that
  stops frames/timers/listeners and late callbacks. Image engines use
  `createEffectImage` imported from `./effect-media.js`; preserve runtime
  `preloadedImages`, `onResize` and `playbackStartDelayMs` when normalizing config.
  Soft Glow's optional `cleanup.update` supports live control changes; it does
  not replace the required cleanup function.

**Advanced transition differences, demonstrated by Alternating Panels:**

- Use `transitions/<id>-maker.html`, `transitions/<id>-engine.js` and the transition
  registry. This concerns advanced transitions, not the built-in Fade/Push dropdown.
- Export `runTransition({root, outgoing, incoming, config, duration, onComplete})`.
  Return an idempotent finish/cleanup function, call `onComplete` exactly once,
  provide a failsafe timer, and restore changed slide styles/elements on finish
  or interruption.
- The maker imports `/transitions/alternating-panels-engine.js`, exports
  `{version: 1, name, engine, maker, config}`, responds to `trigger_apply` by posting
  that definition to its parent, and restores `transitionEditData` from session
  storage. This maker also exposes `MakerAPI` for preview/config editing.
- Its CSS and preview helpers are inline. It draws its own two sample canvases
  and needs no shared file imports or sample assets.

### 2. Register through Manage

1. Restart after adding source files, then open the management window. To refresh
   just its inventory, click **Reload from disk**; first save pending registry
   edits if you want to keep them.
2. Select **Effects** for an effect, or **Transitions** for an advanced transition.
3. Under **Experimental** (or another chosen category), click **Edit**.
4. In **Choose an available item…**, select the component and click **Add effect**
   or **Add transition**. Resolve any **Needs attention** warning, such as a missing
   maker. If needed, **Add category** creates a category in this editor.
5. Click **Done**, then **Save changes to effects** or **Save changes to transitions**.
   With no pending edits, the button reads **Save effects** or **Save transitions**.

Discovery only fills the available-item list. It does **not** register files or
make them visible in the Hub. `desktop/services/registry-service.cjs` scans
`*-engine.js`, checks the matching maker, and saves the chosen registry; it is not
a per-component file to edit. Normal registry-editor saves create managed backups
under `.movement-registry-backups/`. These generated recovery files are not
component dependencies or package contents. Successful saving notifies Hubs.
Registration does not create an export review.

### 3. Verify preview, Apply and saved playback

Use an editable test slideshow. For a bundled read-only example, use the Library's
**Copy to edit**, choose/create a workspace, click **Create local copy**, and open
that copy with **Edit**.

For **Soft Glow**:

1. Select a slide. Under **Background**, click **Hub**, then select **Soft Glow**
   under **Experimental**.
2. Click **Browse project images** and select an image, or use **Choose an image**
   to import one. Adjust **Glow strength** and **Pulse speed**, then **Run Preview**.
   Speed 0 and reduced-motion mode intentionally produce a steady glow.
3. Click **Use Effect**, or the Hub's **Apply Effect to Slide**. Confirm the editor
   receives the effect. Reopen **Edit** to check restored image and control values.
4. Click **Save Slideshow**, then **Play Slideshow** (and **Start** in the player
   when shown). Return to the Library and use the saved slideshow's **Play** to
   verify persisted playback, not just maker preview.

For **Alternating Panels**, select the incoming (second or later) slide and use
**Advanced Transition → Hub**. Select **Alternating Panels** under **Experimental**,
adjust its controls, and use **Play Transition** / **Replay Transition**. Click
**Use Transition** or **Apply Transition to Slide**, then save and play as above.
Let playback advance from the preceding slide into the configured slide. Manual
Next/Previous navigation renders a slide instantly, so it is not a test of the
transition animation. Reopen **Edit** to check restored settings.

### 4. Review dependencies and the applicable license

A component author or maintainer who can inspect its source performs this manual
review. There is no review-management UI or automatic dependency/security audit.
Read both files, including imports, constructed URLs, CSS `url(...)`, helper calls,
media access, inline code and network use. Determine everything needed in preview,
editing, playback and portable slideshow export.

| Contract | Host-provided dependencies permitted in `sharedFiles` |
| --- | --- |
| `movement-effect-host-1` | Only `effects/effect-media.js`, `studio/maker/maker-engine.js`, `studio/maker/maker-theme.css`; list the subset actually used. Soft Glow and Ripple require all three. |
| `movement-transition-host-1` | None: `sharedFiles` must be `[]`. Alternating Panels imports only its own packaged engine. |

Both contracts rely on the existing browser runtime and Hub/editor/player
interfaces. The effect host supplies Canvas 2D, ES modules, image/media services,
timers, animation frames and shared maker message/edit integration. Host media
services include `resolveMakerMediaUrl`, `getMakerMediaList` and
`importDesktopMediaForMaker`. The transition host supplies ES modules, DOM/CSS,
Canvas 2D, timers/animation frames, reduced-motion queries and its message/edit
integration. Inline maker scripts/styles are supported. This is same-origin
execution, not an isolated plugin sandbox.

The portable player supports the existing named function/const export conventions
and special effect `./effect-media.js` import. Additional runtime module imports,
remote libraries/fonts/APIs, npm dependencies, extra component assets or required
application changes are outside these contracts. Format 1 requires `assets: []`.
Do not approve a component that needs omitted files. Project-selected images are
runtime input supplied by each user's slideshow, not bundled dependencies. Soft
Glow and Ripple need no bundled sample; Alternating Panels generates its own.

Identify the actual license and its provenance, including any third-party code.
The declarations below explicitly use the repository's root `LICENSE` (MIT, with
its existing notice) because it applies to these components. Do not invent
attribution or use it as a default for custom work. If another notice applies,
put its complete text in a file such as `desktop/component-licenses/my-effect.txt`.
The exporter accepts only root `LICENSE` or a single filename under
`desktop/component-licenses/` (letters, numbers, dots, underscores and hyphens;
starts with a letter/number). Use `/` in JSON paths. The selected notice is
packaged under the name `LICENSE`.

This review establishes **packaging dependencies and the declared license for a
specific source snapshot**. It does not prove license provenance, legal validity
or executable-code safety. Review declarations and hashes are not signatures.

### 5. Calculate hashes and add the exact review declaration

Open PowerShell at the application root defined above. These read-only commands
work in Windows PowerShell and PowerShell 7, without npm or additional tools:

```powershell
# Soft Glow: makerSha256, engineSha256, then license.sha256.
(Get-FileHash -LiteralPath .\effects\soft-glow-maker.html -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash -LiteralPath .\effects\soft-glow-engine.js -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash -LiteralPath .\LICENSE -Algorithm SHA256).Hash.ToLowerInvariant()
```

```powershell
# Alternating Panels: makerSha256, engineSha256, then license.sha256.
(Get-FileHash -LiteralPath .\transitions\alternating-panels-maker.html -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash -LiteralPath .\transitions\alternating-panels-engine.js -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash -LiteralPath .\LICENSE -Algorithm SHA256).Hash.ToLowerInvariant()
```

For a custom notice, hash the exact file selected in `license.source` instead of
root `LICENSE`. Lowercase matters: the exporter compares lowercase hexadecimal
strings. Hash actual bytes after saving; line-ending/encoding changes count too.

Edit `desktop/component-export-reviews.json`. Keep its existing `formatVersion: 1`
and `components` array. Add exactly one object for the new `(type, id)` pair;
preserve other components. Update an existing entry rather than adding a duplicate.
`type` is singular (`effect` / `transition`), unlike directory names.

These are the **actual current objects**, copied from that catalog. They already
exist, so do not add them again. Their hashes are valid only for matching source
bytes; new or edited components need their own completed review and hashes.

Soft Glow:

```json
{
  "type": "effect",
  "id": "soft-glow",
  "name": "Soft Glow",
  "sharedFiles": [
    "effects/effect-media.js",
    "studio/maker/maker-engine.js",
    "studio/maker/maker-theme.css"
  ],
  "hostContract": "movement-effect-host-1",
  "assets": [],
  "makerSha256": "760df564367ef33fc55e3dbc1253cbab9f27b22da70f56957e47f675ff807919",
  "engineSha256": "43d7bf87c6e537a853eb4addca942f1faf5f2464dd97ab1e715a2092480852d8",
  "license": {
    "source": "LICENSE",
    "sha256": "91a692cad618082b6e1a7f7f078ed01dcd89bb3edd00094b8bd8920e186fc6a3"
  }
}
```

Alternating Panels:

```json
{
  "type": "transition",
  "id": "alternating-panels",
  "name": "Alternating Panels",
  "sharedFiles": [],
  "hostContract": "movement-transition-host-1",
  "assets": [],
  "makerSha256": "109f491f3328301fdee252ae7bb0834ffb0d4b32ed8bde0abf06a64d8af50541",
  "engineSha256": "4cc0ff63e36a7a46e439b075b3676f0325757bd8174a18ae02102a279b8d5ff6",
  "license": {
    "source": "LICENSE",
    "sha256": "91a692cad618082b6e1a7f7f078ed01dcd89bb3edd00094b8bd8920e186fc6a3"
  }
}
```

### 6. Export and share

1. Save the review file, open Manage and **Reload from disk** to refresh eligibility.
   Ensure the component's registration has been saved.
2. Find it in its category and click **Export ZIP…**. Disabled rows show why export
   is unavailable.
3. Choose a destination and retain the `.component.zip` suffix, for example
   `soft-glow.component.zip`. Export does not save pending registry edits.
4. Share that ZIP. The exporter rechecks and snapshots source/notice bytes after
   the Save dialog; it does not execute component code.

A Soft Glow package contains exactly four files, with no enclosing folder:

```text
component.json
LICENSE
effects/soft-glow-maker.html
effects/soft-glow-engine.js
```

Maker, engine and selected license bytes are unchanged. `component.json` is
generated; do not create a separate source manifest to enable export:

```json
{
  "formatVersion": 1,
  "type": "effect",
  "id": "soft-glow",
  "name": "Soft Glow",
  "maker": "effects/soft-glow-maker.html",
  "engine": "effects/soft-glow-engine.js",
  "requires": {
    "hostContract": "movement-effect-host-1",
    "sharedFiles": [
      "effects/effect-media.js",
      "studio/maker/maker-engine.js",
      "studio/maker/maker-theme.css"
    ]
  },
  "license": "LICENSE"
}
```

`alternating-panels.component.zip` instead has
`transitions/alternating-panels-maker.html` and
`transitions/alternating-panels-engine.js`; its manifest uses `type: "transition"`,
ID `alternating-panels`, name `Alternating Panels`, contract
`movement-transition-host-1` and `sharedFiles: []`.

Neither package includes shared application scripts/styles, registries, review
catalog entries, documentation, backups, slideshow data, user media or extra
assets. Format/contract numbers describe interfaces, not component release versions.

### 7. After editing a component

Repeat preview, Apply, edit restoration, save and playback checks. Review changes
for dependencies, host compatibility and licensing; update `sharedFiles`, the
license source/notice and other declarations if required. Recalculate hashes for
each changed maker, engine or license file, then **Reload from disk** before
exporting again. Even comment-only or line-ending edits invalidate the old hash.
Do not refresh hashes blindly to enable export. If new requirements exceed the
contract, the component is no longer eligible.

A newly exported ZIP with the same ID cannot replace an installed copy in this
pilot. There is no update/overwrite workflow.

## Path 2 — Receive, inspect, install and use a component

### 1. Open a compatible receiving Kit and inspect

Use the launch instructions above. Check that the receiving application includes
the pilot; its application version alone does not establish contract support.
Open Manage through the Library or a Hub and click **Inspect component ZIP…**.
Select the ZIP itself; do not manually unzip it into application folders. Either
tab accepts either component type.

The report appears above the category list. Read all of it:

- **Identity and entries:** confirm the name, ID, type, maker and engine.
- **Format and host support:** format 1 and the declared contract/dependency subset
  must be supported. A structural pass alone does not mean installable.
- **Shared files:** each declared host file must already be present and usable.
  The installer does not fetch/install shared dependencies. Presence is not a
  hash/version or behavioral test of those files.
- **Conflicts:** registration, either destination file, or even an existing metadata
  directory blocks installation. Inaccessible destinations also block it. Already
  installed Ripple/Alternating Panels should report conflicts; do not remove
  working components merely to test installation.
- **License notice (plain text):** read it. It is displayed as text, not HTML.
  Its presence does not authenticate the sender or the license claim.
- **Problems:** resolve every blocker before installation.

Inspection reads bounded bytes only. It does not execute/preview code, extract
into application folders or change registries. **Close report** leaves the
package uninstalled. Structural checks do not establish trust.

### 2. Choose a category, decide trust and install

1. Save pending registry edits in either tab, or deliberately discard them with
   **Reload from disk**. Installation is disabled while edits are pending.
2. In **Install into existing category:** choose a saved category from the
   component's own registry, such as **Experimental**. The current tab does not
   change the package type. To use a new category, create/save it in Manage and
   inspect again.
3. Decide whether you trust this executable code and accept using it under the
   displayed license. Only if you do, check **I trust this component’s executable
   code and want to install it.** This is your decision, not a safety certificate.
4. With all checks passing, no conflicts, a category selected and trust checked,
   click **Install component**.

At installation, the application rereads the ZIP and requires its SHA-256 to
match the exact inspected bytes. It repeats package, requirement, category and
destination checks. Approval belongs to that management window, expires after
30 minutes, is replaced by another inspection and allows one installation attempt.
If it expires, the ZIP changes or an attempt fails, inspect again and review the
current report.

| ZIP entry | Installed destination for Soft Glow |
| --- | --- |
| `effects/soft-glow-maker.html` | `effects/soft-glow-maker.html` |
| `effects/soft-glow-engine.js` | `effects/soft-glow-engine.js` |
| `component.json` | `.movement-components/effects/soft-glow/component.json` |
| `LICENSE` | `.movement-components/effects/soft-glow/LICENSE` |

Alternating Panels uses `transitions/alternating-panels-*` and
`.movement-components/transitions/alternating-panels/` instead. Root `LICENSE` is
never replaced. The installer appends only the ID to the selected category's
`engines` string, preserving all other registry bytes and custom data. Files and
registrations are never overwritten. Open Hubs refresh through registry-change
notification; no restart or manual registration is required.

### 3. Configure, apply, save and play

Find the component in its chosen Hub category. Effects use **Background → Hub**;
select a project image where required, adjust controls, preview and **Apply Effect
to Slide**. Advanced transitions use **Advanced Transition → Hub** on the incoming
slide; preview and **Apply Transition to Slide**. Maker-specific **Use Effect** /
**Use Transition** also apply configuration for these worked examples.

Use **Save Slideshow**, then the Library's **Play** on that saved slideshow. For
transitions, allow automatic playback from the preceding slide. The recipient
supplies project media; the creator's image is not in the component ZIP. Check
edit restoration too, using the verification steps in Path 1.

### 4. Can the recipient re-export it?

Yes, if the receiving application has a valid local export review for those exact
installed bytes. **Installation does not require, copy or create a component-specific
review declaration.** An already matching declaration can permit export; otherwise
export stays unavailable even though the installed component works.

The recipient/maintainer follows Path 1's dependency/license review and hash steps
and adds the entry to `desktop/component-export-reviews.json`. Read the installed
notice in `.movement-components/<effects-or-transitions>/<id>/LICENSE`. If a new
notice source is needed, copy its unchanged bytes to an unused filename under
`desktop/component-licenses/`, hash it and declare that source. Use root `LICENSE`
only when that actual notice applies. The metadata directory itself is not an
accepted export `license.source`. The installed manifest is informative; the
exporter uses the local review catalog and generates a fresh manifest.

## Limits, rollback and troubleshooting

Format 1 accepts exactly four expected nonempty regular files, no directory
entries or enclosing folder. Limits: **16 MiB ZIP**, **16 MiB total decompressed**,
**5 MiB per file**, **64 KiB manifest**, at most **four archive entries**. The
receiving registry is limited to 512 KiB. Stored and DEFLATE entries are supported
with bounded decompression, matching headers and CRC checks. Unsafe paths,
case-insensitive duplicate entries, duplicate manifest keys, unexpected files or
manifest fields, links, ZIP64, encryption, multi-disk ZIPs, data descriptors, extra
fields/comments and unexplained/trailing bytes are rejected. These rules match
this exporter, not every general-purpose ZIP utility.

Installation creates files exclusively and commits the registry last using a
no-overwrite hard link. The application filesystem must support hard links, such
as NTFS. On a caught failure it rolls back this operation's unchanged files and
empty directories and restores the captured registry without overwriting a
concurrently created registry. Files changed by someone else are retained and
reported. Cleanup problems report recovery paths rather than silently replacing
unrelated work.

**Process crashes and power loss have no automatic recovery.** A remaining
`.movement-component-install.lock` blocks further installation. Preserve and review
it, component destinations and any `.movement-component-transaction-*` directory
(including captured `original.json` and staged `next.json`) before a maintainer
repairs the interrupted operation. Do not blindly delete the lock or restore an
old registry over newer edits. There is no built-in repair UI or general
uninstall/update workflow.

| Symptom / report | Meaning and next action |
| --- | --- |
| New component absent from available items or marked Needs attention | Check the ID, `*-engine.js`, matching `*-maker.html`, tab and application root; Reload from disk. A maker alone is not discovered. |
| Component in Manage but absent from Hub | Add it to a category and save the correct registry. Discovery is not registration. |
| Export: no reviewed dependency and license declaration | Add one reviewed `(type, id)` entry; a missing or duplicate matching entry fails eligibility. |
| Export: maker/engine changed, or license changed/empty | Review changes and the notice, save files, update the corresponding lowercase hashes, and Reload from disk. |
| Export: requirements outside supported host contract | Check the contract, allowed `sharedFiles` and `assets: []`. Extra dependencies/assets are unsupported; do not omit real requirements. |
| Export: required file missing/linked/invalid, or filename rejected | Fix source/shared/notice paths; symlinks and oversized files fail. Save to a filename ending `.component.zip`. |
| Inspection: unsupported format/contract or missing shared file | Use a receiving Kit implementing the declared contract with its host files. Renaming a contract in JSON does not make code compatible. |
| Unsafe/duplicate/unexpected ZIP entry, malformed manifest, CRC/size/structure failure | Obtain a fresh package from the component exporter. Do not manually repack with extra folders or edit a manifest to bypass checks. |
| Existing registration, maker, engine or metadata conflict | Blocked even for identical bytes. Use an appropriate receiving Kit where the ID is absent; there is no overwrite/update option. |
| Install disabled despite valid structure | Check all report problems, read-only status, pending registry edits, available saved categories, selected category and trust checkbox. |
| ZIP changed / inspect again / category no longer exists | Reinspect the current ZIP/destinations, choose an existing category and decide trust again. Approval may have expired or been consumed. |
| Registry changed during installation | Installation fails without replacing concurrent edits. Review rollback messages and inspect again. |
| Installation failed / filesystem error | Check write access and hard-link support. Read rollback/recovery paths before retrying; do not overwrite unrelated files. |
| Another installation active or lock needs recovery | Wait for an active operation, or have a maintainer review interrupted-operation files as above. |
| Imported component works but Export ZIP is disabled | Installation does not add an export review; follow the re-export review/license steps. |

## Recorded manual verification

These are the user's completed manual checks, not new automated test results:

| Component | Manually verified outcome |
| --- | --- |
| Ripple | Installed into the disposable Kit and used successfully in a saved slideshow played from the Library. |
| Alternating Panels | Installed and verified between slides during saved playback. |
| Soft Glow | Created in the development application, exported, imported into the receiving Kit, and verified during saved playback. |

The user also verified the previous packaged candidate's native Save/Open dialogs:
exporting Soft Glow and selecting its ZIP for inspection worked; structure and
compatibility passed, with the expected existing-component conflicts.

These establish the observed workflows for those components, not a security
audit or proof that arbitrary future components meet the contracts.

Implementation references: [export service](../desktop/services/component-export-service.cjs),
[inspection service](../desktop/services/component-inspection-service.cjs),
[installation service](../desktop/services/component-install-service.cjs),
[registry service](../desktop/services/registry-service.cjs),
[management interface](../studio/authoring/registry-editor.html) and
[review catalog](../desktop/component-export-reviews.json).
