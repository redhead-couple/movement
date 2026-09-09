# Movement Effect Authoring Contract

This is the repository-specific contract for creating effects shared by the desktop application and portable player. When older guides or generic examples disagree with the running code, follow this document and verify the behavior in the files named below. Runtime names follow `docs/OPERATING_MODES.md`.

## 1. Inspect before implementing

Before changing files:

1. Read `docs/ANIMATION_PERFORMANCE_BUDGET.md` and treat every limit as an acceptance requirement.
2. Read `effects/registry.json`.
3. Read shared image acquisition in `effects/effect-media.js`.
4. Read effect loading and cleanup in `studio/player/player-runtime.js`.
5. Read the shared maker behavior in `studio/maker/maker-engine.js`.
6. Inspect one or two complete, registered effect pairs that are close to the proposed behavior.
7. Search `studio/editor/json-maker-logic.js` and `studio/hubs/effects-hub.html` when the new effect needs editor or hub behavior that is not demonstrated by the selected references.

Do not blindly copy an effect based only on its name. Choose references that match the rendering method, media needs, lifecycle, and maker controls, and state briefly why they are relevant.

## 2. Files and registration

For an effect slug named `sample-effect`, the current desktop registry expects:

- engine: `effects/sample-effect-engine.js`
- maker: `effects/sample-effect-maker.html`
- registry entry: `sample-effect` exactly once in `effects/registry.json`

Slugs use lowercase letters and numbers separated by single hyphens. Never overwrite an existing maker or engine with unrelated behavior.

The Effects Hub builds maker filenames from registry slugs inside `effects/`. Add the slug to the requested existing category, or create the requested personal category if it does not exist. Do not reorganize other categories as part of creating one effect.

Effect makers use `<base href="../">` in `<head>` so `studio/maker/maker-theme.css`, `studio/maker/maker-engine.js`, and project-relative media resolve from the application root.

## 3. Engine contract

Every effect engine exports:

```js
export function mount(canvas, ctx, config) {
  // Create instance-local state and render.
  return () => {
    // Completely stop and release this instance.
  };
}
```

The returned cleanup function must be safe to call more than once. It must:

- cancel animation frames and timers;
- remove listeners created by the instance;
- prevent late image callbacks from restarting work;
- release unnecessary temporary references;
- leave shared canvas state usable by the next slide.

Keep all mutable state inside `mount`. More than one effect instance may exist, and a slide may be revisited. Do not use mutable module globals or attach engine state to `window`.

Normalize `config` values and use safe fallbacks. The engine fallbacks and maker defaults must match. Use `ctx.save()` and `ctx.restore()` around drawing-state changes. Handle canvas resize without permanently stretching or blurring the output.

### Shared image acquisition

Every engine that uses an image must import and call the shared helper. Do not call `new Image()`, create an `<img>` element, or fetch/decode the same configured image independently inside an effect engine.

```js
import { createEffectImage } from './effect-media.js';

export function mount(canvas, ctx, config) {
  const imageResource = createEffectImage(config, config.imgSrc);
  const image = imageResource.image;

  if (imageResource.isPreloaded) {
    startWithImage(image);
  } else if (image && config.imgSrc) {
    image.onload = () => startWithImage(image);
    image.onerror = () => handleMissingImage();
    image.src = config.imgSrc;
  }

  return () => {
    if (image) image.onload = image.onerror = null;
  };
}
```

During player playback, `config.preloadedImages` contains independent decoded image nodes prepared for that effect instance. `createEffectImage` consumes those nodes without starting another request. In maker preview or a standalone mount, it safely falls back to a new browser image. If the engine has a `normalizeConfig` function, it must preserve `preloadedImages` as a map-like runtime value; never serialize it into exported effect JSON. The web player imports the helper normally, and both portable exporters inline it automatically.

## 4. Maker contract

The maker is a small visual editor, not a developer configuration screen. It should:

- show a useful live preview;
- expose only understandable creative controls;
- use clear labels, helpful units, sensible ranges, and stable defaults;
- export JSON-safe configuration;
- restore saved configuration during edit mode;
- work inside the Effects Hub iframe.

Use the shared `studio/maker/maker-engine.js` behavior where the closest current makers use it. The maker API expected by current hub and edit flows is:

```js
window.MakerAPI = {
  run() {},
  getExportJSON() {
    return {
      enabled: true,
      name: 'Human-readable name',
      engine: 'sample-effect',
      config: {}
    };
  },
  loadEditConfig(config) {}
};
```

`loadEditConfig` is required when automatic control hydration is not enough. After reloading an existing effect, its controls, preview, and exported configuration must agree.

When media is involved, follow current working maker examples and `studio/maker/maker-engine.js`. Use the desktop project media bridge and project-relative references. Never store an absolute path from one computer.

## 5. Runtime targets

The same `mount(canvas, ctx, config)` contract is used for effects assigned to:

- `slide.background.effect`
- `slide.foregroundLayers[index].effect`

An effect described as supporting both targets must not depend on a specific outer DOM structure. Render only through the canvas and context supplied to `mount`, using configuration and the supplied media source.

## 6. Desktop and portable-player behavior

Effects must work:

- in maker preview;
- when created and edited in the desktop editor;
- in editor playback preview;
- in the full desktop player;
- in the exported portable player.

Do not add remote scripts, packages, fonts, media, APIs, CDNs, or network calls. Do not require PHP, MySQL, Node.js, or internet access at playback time. Missing or failed optional media must degrade gracefully without stopping the slideshow.

## 7. Performance and safety

- Follow `docs/ANIMATION_PERFORMANCE_BUDGET.md`; visual ambition never overrides its renderer-safety gates.
- Cap every animated canvas at 2,073,600 pixels or less, preserving aspect ratio. Never use unchecked natural media dimensions as the backing size.
- Target 30 FPS for ambient work and throttle it to 45 FPS or less unless a measured visual need justifies more. Do not repaint unchanged content or delayed/static states continuously.
- Keep repeated objects at 72 or fewer by default and 120 or fewer at the hard normal maximum. Cache repeated glows, filters, paths, and other expensive raster work.
- Avoid hot-loop allocations and remain responsive with at least two simultaneous instances.
- Do not remount, resize, or decode media on every raw maker slider event; update cheaply or debounce and invalidate stale work.
- Do not use `eval`, remote dynamic imports, or unrelated global state.
- Where practical, provide a calmer or static rendering for reduced-motion preferences.
- Preserve unrelated user changes in the working tree and registry.

## 8. Verification

At minimum, check:

1. The maker opens from its registered category.
2. Preview and every visible control work.
3. Exported effect JSON has the correct slug and config.
4. Edit mode restores all values.
5. Background and/or foreground targets work as requested.
6. Slide changes and repeated previews fully clean up the effect.
7. Multiple instances do not share mutable state.
8. Missing media and edge values do not crash the player.
9. Portable-player playback can load the engine and media without network access.
10. Image effects use `createEffectImage` and do not issue a second request when the player supplies decoded media.
11. Automated tests enforce deterministic pixel, object, scheduling, stale-work, and cleanup limits.
12. An actual Chromium/Electron worst-case stress check is performed when available; otherwise it is reported as still required rather than claimed as passed.
13. Registry integrity, automated tests, and relevant Electron smoke checks pass.

The implementation handoff should name changed files, final slug/category, controls and defaults, reference effects, checks performed, visual checks still needed, and known limitations.
