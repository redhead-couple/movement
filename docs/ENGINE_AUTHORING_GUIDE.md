# Movement Engine Authoring Guide (Legacy Overview)

Welcome to the **Effects & Transitions Plugin Standard**.

Movement uses reusable visual engines. This guide preserves an older overview,
not the current authoritative contracts. For implementation requirements use
the [Effect Authoring Contract](EFFECT_AUTHORING_CONTRACT.md) and
[Transition Authoring Contract](TRANSITION_AUTHORING_CONTRACT.md). Current
inventory is **25 effects and 6 advanced transitions**, as recorded in the
[effects registry](../effects/registry.json) and
[transitions registry](../transitions/registry.json).

This document serves as the **Authoring Guide**. If you are looking for a complete list of existing engines, parameters, and live demos, please consult the **Engine Catalog** (rendered dynamically at `studio/hubs/effects-hub.html` and `studio/hubs/transitions-hub.html`).

---

## 1. The Verified Contracts

All existing engines inside the repository conform to one of two runtime signatures. The `studio/player/player-runtime.js` expects these exact exports and will dynamically `import()` them during playback.

### A. Effect Engines (HTML Canvas)

**Role:** Persistent visual generators applied over the duration of a slide.
**Historical scope:** This overview was written for 19 effect engines
(e.g., `rain-engine.js`, `blur-engine.js`); it does not verify all current engines.
**Runtime execution:** `studio/player/player-runtime.js`.

**The Signature:**
```javascript
// At the bottom of effects/your-engine.js
export function mount(canvas, ctx, config) {
    // 1. Setup loop and mutate given canvas/ctx
    // 2. Return cleanup function
    return () => {
        // teardown logic
    };
}
```

**Lifecycle Rules (Observed in codebase):**
1. **The Canvas Boundary:** The engine is exclusively given access to a `canvas` and its `2d` context. Do not mutate the global `window` or external DOM.
2. **Animation Loop Cleanup:** The engine must store its `requestAnimationFrame` ID and halt it inside the returned cleanup function (e.g., `cancelAnimationFrame(animationId)`). `studio/player/player-runtime.js` invokes cleanup on slide changes.
3. **Blend Mode Safety:** If mutating `ctx.globalCompositeOperation` (as seen in `rain-engine.js`), always restore it to `'source-over'` on cleanup or before yielding.

### B. Transition Engines (DOM / CSS)

**Role:** Specialized choreographies for moving between `outgoing` and `incoming` slides.
**Historical scope:** This overview was written for 5 advanced transition
engines (e.g., `soft-wipe-engine.js`); it does not verify all current transitions.
**Runtime execution:** `studio/player/player-runtime.js`.

**The Signature:**
```javascript
// At the bottom of transitions/your-engine.js
export function runTransition({ root, outgoing, incoming, config, duration, onComplete }) {
    // 1. Set DOM styling on incoming/outgoing siblings
    // 2. Invoke onComplete() exactly once when finished
    return abortFunction; // (Optional: return abort closure)
}
```
*Note: Some transitions choose to omit destructured arguments they do not need (such as `root`), but the player always provides all six.*

**Lifecycle Rules (Observed in codebase):**
1. **Sibling Hierarchy:** `incoming` and `outgoing` are DOM siblings inside the `root` wrapper. Control stacking order using `zIndex` (as in `soft-wipe-engine.js` line 23).
2. **The Failsafe Timer:** `transitionend` events occasionally drop in backgrounded tabs. You must implement a `setTimeout` failsafe (e.g., `timer = window.setTimeout(finish, (seconds * 1000) + 120);`) to ensure `onComplete` is always called.
3. **Purity of State:** The player expects a clean DOM post-transition. Inside your `onComplete` closure, wipe any inline `style.transform`, `style.clipPath`, or `style.transition` properties you injected.

---

## 2. Advanced Upgrades & Best Practices

The following older proposals describe possible structural patterns. Consult
the current authoring contracts before treating these proposals as requirements.

### Upgrade A: Schema as the Single Source of Truth
Currently, maker HTML files hardcode forms, and engines hardcode default fallback configs.

**The Standard:** Engines should begin exporting a `schema` object alongside their primary function. This acts as the definitive contract for what parameters they accept.
```javascript
export const schema = {
    speed: { type: 'number', default: 15, description: 'Falling velocity' },
    blendMode: { type: 'enum', options: ['source-over', 'screen'], default: 'source-over' }
};
```
By exporting this, future `maker.html` pages can dynamically generate their inputs based purely on reading the engine's schema!

### Upgrade B: Manifest-Driven Hub Registration
The hubs read their available makers from `effects/registry.json` and `transitions/registry.json`, avoiding hand-edited catalog tiles and unnecessary merge conflicts.

**The Standard:** The project uses JSON manifests such as `effects/registry.json` and `transitions/registry.json`:
```json
[
  {
    "id": "rain",
    "name": "Heavy Rain",
    "enginePath": "effects/rain-engine.js",
    "makerPath": "effects/rain-maker.html",
    "category": "Weather"
  }
]
```
The hubs should fetch this JSON file and dynamically render the catalog tiles. Contributing will then simply require adding your JS file, HTML file, and one line to the JSON manifesto.
