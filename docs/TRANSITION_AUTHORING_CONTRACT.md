# Movement Transition Authoring Contract

This is the repository-specific contract for creating advanced transitions shared by the desktop application and portable player. When an older guide or generic example disagrees with the running code, follow this document and verify the behavior in the files named below. Runtime names follow `docs/OPERATING_MODES.md`.

## 1. Inspect before implementing

Before changing files:

1. Read `docs/ANIMATION_PERFORMANCE_BUDGET.md` and treat every limit as an acceptance requirement.
2. Read `transitions/registry.json`.
3. Read advanced transition loading and invocation in `studio/player/player-runtime.js`.
4. Read creation and edit integration in `studio/hubs/transitions-hub.html` and `studio/editor/json-maker-logic.js`.
5. Inspect one or two complete registered transition maker/engine pairs that are close to the proposed choreography.
6. Check portable-player engine inlining in `desktop/services/portable-project-service.cjs`.

Choose references that match the requested motion, DOM/CSS technique, timing, interruption behavior, and maker controls. State briefly why each reference is relevant.

## 2. Files and registration

For a transition slug named `sample-transition`, the current registry expects:

- engine: `transitions/sample-transition-engine.js`
- maker: `transitions/sample-transition-maker.html`
- registry entry: `sample-transition` exactly once in `transitions/registry.json`

Slugs use lowercase letters and numbers separated by single hyphens. Never overwrite an existing maker or engine with unrelated behavior.

Add the slug to the requested existing category, or create the requested personal category if it does not exist. Do not reorganize other categories as part of creating one transition.

## 3. Engine contract

Every transition engine exports:

```js
export function runTransition({
  root,
  outgoing,
  incoming,
  config = {},
  duration = 1,
  onComplete
}) {
  // Prepare and run the choreography.
  return () => {
    // Abort or finish safely and clean up.
  };
}
```

The engine must:

- normalize malformed configuration and duration values;
- invoke `onComplete` exactly once;
- install a failsafe timer slightly longer than the visual duration;
- filter completion events by target and relevant property or animation;
- remove every event listener and cancel every timer or animation frame it creates;
- restore every inline style, class, CSS custom property, temporary element, and accessibility attribute it changes;
- make the returned finish/abort function idempotent;
- avoid leaving either slide hidden or transformed after completion;
- behave safely if a transition is finished early or more than one invocation occurs.

The current player provides `root`, `outgoing`, `incoming`, normalized `config`, a duration, and a guarded `onComplete`. Do not depend on undocumented outer DOM or global mutable state.

## 4. Maker contract

The maker is a visual transition designer, not a developer configuration screen. It should:

- show distinguishable outgoing and incoming sample slides;
- provide a clear Play/Replay control;
- expose only understandable creative controls;
- keep primary controls to approximately five or fewer unless the effect designer explicitly requested more;
- place less frequent options in a collapsed Advanced section;
- export JSON-safe configuration;
- restore every saved value during edit mode;
- work inside the Transitions Hub iframe.

The current maker output has this shape:

```js
{
  version: 1,
  name: 'Human-readable transition name',
  engine: 'sample-transition',
  maker: 'transitions/sample-transition-maker.html',
  config: {}
}
```

The maker must respond to the parent message `trigger_apply` by posting this definition to its parent. In edit mode, read `transitionEditData` from `sessionStorage`, restore the name and configuration, update the visible controls, and make replay use the restored values.

## 5. Runtime behavior

`incoming` and `outgoing` are sibling slide layers inside `root`. A transition may manipulate them temporarily, but the player must receive clean layers after completion.

Prefer transforms, opacity, clip paths, masks, and composited properties. Avoid layout-heavy animation. Use duration and easing values from normalized configuration. Ensure the final incoming slide is visible before calling `onComplete`.

Rapid navigation, replay, a missing transition event, a backgrounded window, or an early finish must not leave the player stuck. The failsafe timer and idempotent finish path are mandatory.

## 6. Desktop and portable-player behavior

Transitions must work:

- in maker preview;
- when created and edited in the desktop editor;
- in editor playback preview;
- in the full desktop player;
- in the exported portable player.

Do not add remote scripts, packages, fonts, media, APIs, CDNs, or network calls. Do not require PHP, MySQL, Node.js, or internet access at playback time.

## 7. Performance and accessibility

- Follow `docs/ANIMATION_PERFORMANCE_BUDGET.md`; visual ambition never overrides its renderer-safety gates.
- Prefer compositor-friendly properties such as `transform` and `opacity`.
- Keep animated filters, masks, temporary surfaces, cloned layers, segments, and large blur radii strictly bounded.
- Cap any required animated canvas or bitmap at 2,073,600 pixels or less; never use unchecked natural media dimensions as its backing size.
- Avoid per-frame DOM queries, layout reads, and large allocations.
- Use `requestAnimationFrame` only when CSS transitions or the Web Animations API cannot express the choreography cleanly.
- Do not rebuild, decode media, or start overlapping animation work on every raw maker slider event.
- Keep rapid replay and navigation responsive while other slide effects are active.
- Respect reduced-motion preferences with a shorter, calmer fade or near-instant completion when practical.
- Preserve unrelated user changes in the working tree and registries.

## 8. Verification

At minimum, check:

1. The maker opens from its registered category.
2. Preview, Replay, and every visible control work.
3. Exported transition JSON has the correct slug, maker path, and config.
4. Edit mode behaviorally restores every value.
5. Editor preview and full player complete the transition exactly once.
6. A missing completion event still finishes through the failsafe.
7. Early finish/abort is idempotent and removes listeners, timers, frames, styles, and temporary elements.
8. Repeated and rapid navigation does not leave either slide corrupted.
9. Portable-player playback includes and runs the engine without network access.
10. Automated tests enforce deterministic surface/element, scheduling, stale-work, exact-once, and cleanup limits.
11. An actual Chromium/Electron worst-case stress check is performed when available; otherwise it is reported as still required rather than claimed as passed.
12. Registry integrity, automated tests, and relevant Electron smoke checks pass.

Never claim a visual, edit-mode, interruption, portable, reduced-motion, or performance check passed unless it was actually performed. Clearly separate automated checks, manual checks, and checks still needed.

The implementation handoff should name changed files, final slug/category, controls and defaults, reference transitions, checks performed, visual checks still needed, and known limitations.
