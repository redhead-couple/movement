# Movement: Partial Engine Catalog

This is a legacy parameter reference covering 19 effects and 5 advanced
transitions. It is not the complete inventory or the authoritative authoring
contract. Current Movement registries contain **25 effects and 6 advanced
transitions**, or **31 registered expression tools**.

Use [effects/registry.json](../effects/registry.json) and
[transitions/registry.json](../transitions/registry.json) for the current
inventory. Use the [Effect Authoring Contract](EFFECT_AUTHORING_CONTRACT.md)
and [Transition Authoring Contract](TRANSITION_AUTHORING_CONTRACT.md) for
current requirements. The implementation and maker for an engine determine
its current parameters; the older tables and architecture notes below may lag.

This catalog does not cover color-spread, pulses, focus-formation,
scattered-idea, scattered-orbs, cursor-move-and-click, or alternating-panels.

## Engine Ecosystem Architecture

All runtime effects operate as dynamically imported ES Modules. To add a new effect to the system, it MUST adhere to the following architecture hook and registry definitions.

### 1. The Schema Extractor Contract (Upgrade A)

To achieve automatic, drift-less UI generation in the Effects Hub tools, an engine module MAY proactively export a `schema` constant mapping its parameter bounds.

```javascript
export const schema = {
    // Hidden internal property
    imgSrc: { type: 'string', hidden: true, default: '' },
    // Strict range parameter mapped to a range slider
    zoom: { type: 'number', min: 1, max: 3, step: 0.1, default: 1.5, label: 'Zoom Level' },
    // Type mapping to color picker
    color: { type: 'color', default: '#fbbf24', label: 'Marker Color' },
    // Type mapping to dropdown UI
    shape: { type: 'enum', options: ['star', 'sphere'], default: 'star' }
};
```

When modern Makers import the engine, they dynamically consume this `schema` to render HTML inputs autonomously.

### 2. The Engine Mount Execution Hook

Every module MUST cleanly export a `mount` function (or alias it). Specifically, `studio/player/player-runtime.js` calls `module.mount()`.

```javascript
export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;

    // Initialization Logic -> config overrides defaults

    function loop(timestamp) {
        if (!active) return;
        // Draw frame
        animationId = requestAnimationFrame(loop);
    }
    animationId = requestAnimationFrame(loop);

    // CRUCIAL: Must return a teardown closure
    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
```

- **Teardown Lifecycle:** The closure returned by `mount()` is stored by the runtime and executing during state changes or cleanup. Without it, `requestAnimationFrame` creates severe memory leaks over multiple slides.
- **Resize Lifecycle:** The `config.onResize(canvas)` callback is conditionally passed from the runtime. Engines must safely execute it when image dimensions load to update bounding boxes.

### Registry Synchronization

Creating a new engine requires that its UI endpoint exists in `effects/registry.json` or `transitions/registry.json`. If you neglect to register the engine, the hub GUI cannot load the builder modal that generates the configuration payloads documented below.

---

## Part 1: Visual Effect Entries Covered Here (19)

### 1. Rain
Simulates cascading weather patterns reacting to underlying image luminance.
* `imgSrc` (string): Image Asset
* `count` (number, default: 100): Density of drops
* `speed` (number, default: 15): Velocity magnitude
* `wind` (number, default: 0): Horizontal displacement variable
* `length` (number, default: 20): Stretch of drop vector
* `color` (string, default: '#a3c1e0')
* `opacity` (number, default: 0.6)
* `splashBounce` (number, default: 0.3): Secondary floor impact intensity
* `darknessReact` (number, default: 0.0): Luminance sensitivity modifier
* `blendMode` (string, default: 'source-over'): Paint operator (`screen`, `overlay`)

### 2. Zoom
Smooth Ken Burns scaling with localized target anchors.
* `imgSrc` (string)
* `zoomStart` (number, default: 1.0)
* `zoomEnd` (number, default: 1.2)
* `xStart`, `yStart`, `xEnd`, `yEnd` (number, default: 0.5): Cartesian view anchor
* `brightStart`, `brightEnd` (number, default: 1.0): Brightness modifier
* `duration` (number, default: 5.0)
* `startDelay` (number, default: 0.0)
* `easing` (string, default: 'smooth'): Either `smooth` or `linear`

### 3. Blur
Temporal defocus filters.
* `imgSrc` (string)
* `duration` (number, default: 3.0)
* `startDelay` (number, default: 0.0)
* `blurIntensity` (number, default: 20): Maximum pixel radius threshold
* `mode` (string, default: 'in'): `in` (blurry to sharp), `out` (sharp to blurry)

### 4. Morph
Two-image crossfade interpolation with zoom displacement.
* `imgSrc` (string): Leave Image
* `imgSrc2` (string): Enter Image (Falls back to `imgSrc` for single-image zoom)
* `duration` (number, default: 3.0)
* `startDelay` (number, default: 0.0)
* `zoomAmount` (number, default: 0.1): Scaling variance

### 5. Flash
Aggressive bloom and explosion flashes peaking into whiteouts.
* `imgSrc` (string)
* `intensity` (number, default: 2.0): Maximum brightness cap
* `speed` (number, default: 10): Frame modifier for attack cycle
* `decay` (number, default: 0.95): Falloff fraction
* `tint` (string, default: '#ffffff')
* `bloom` (number, default: 20): Blur overlay
* `triggerAtStart` (boolean, default: true)
* `hold` (number, default: 0): Wait frames before decay

### 6. Darken
Drifting vignette logic and ambient darkening sweeps.
* `imgSrc` (string)
* `startTime` (number, default: 0)
* `duration` (number, default: 5000)
* `yoyo` (boolean, default: false): Reverses animation after climax
* `resetAtEnd` (boolean, default: false): Hard snap to original state
* `zoomStart`, `zoomEnd` (number, default: 1.0, 1.2)
* `driftX`, `driftY` (number, default: 0)
* `darknessStart`, `darknessEnd` (number, default: 0.0, 0.5)
* `vignette` (number, default: 0.5)

### 7. Wipe
Directional hard slice replacements of underlying pixels.
* `imgSrc`, `imgSrc2` (string)
* `startDelay` (number, default: 0.0)
* `duration` (number, default: 2.0)
* `direction` (string, default: 'left'): `left`, `right`, `up`, `down`

### 8. Slide
Camera pan transition overriding old image buffers contextually.
* `imgSrc`, `imgSrc2` (string)
* `startDelay` (number, default: 0.0)
* `duration` (number, default: 2.0)
* `direction` (string, default: 'left'): Pushing direction

### 9. Ripple
Liquid surface displacement mapping.
* `imgSrc` (string)
* `x`, `y` (number, default: 0.5): Drop origin
* `startTime` (number, default: 0)
* `count` (number, default: 1): `-1` is infinite
* `interval` (number, default: 800)
* `freq` (number, default: 0.02): Wave interference thickness
* `speed` (number, default: 15)
* `amp` (number, default: 20): Amplitude variance
* `decay` (number, default: 0.03)

### 10. Wave
Sinusoidal ribbon line art mapping above image spaces.
* `imgSrc` (string)
* `startTime` (number, default: 0)
* `duration` (number, default: 5000)
* `count` (number, default: 5)
* `color` (string, default: '#ffffff')
* `thickness` (number, default: 2)
* `originX` (number, default: 0.5)
* `opacity` (number, default: 1.0)
* `freq` (number, default: 0.02)
* `speed` (number, default: 10)
* `amp` (number, default: 20)
* `spacing` (number, default: 40)

### 11. Affection
Quadratic Bezier particle emitters (classic 'orb/heart' streams).
* `imgSrc` (string)
* `startX`, `startY`, `endX`, `endY` (number, default: 0.2/0.5 -> 0.8/0.5)
* `speed` (number, default: 0.5)
* `flowRate` (number, default: 5)
* `spread` (number, default: 20)
* `curveHeight` (number, default: -100)
* `shape` (string, default: 'orb'): Target path geometries `orb`, `heart`
* `color` (string, default: '#ffb6c1')
* `size` (number, default: 15)

### 12. Diverge
Glow-additive splitting crossbeams out from origin centers.
* `imgSrc` (string)
* `color1`, `color2` (string, default: '#3b82f6', '#ef4444')
* `axis` (string, default: 'horizontal'): Render vectors
* `thickness` (number, default: 200)
* `intensity` (number, default: 0.8)
* `duration` (number, default: 3.0)
* `startDelay` (number, default: 0.0)

### 13. Ghost
Sinusoidal memory-drifting overlays using translation matrices.
* `imgSrc` (string)
* `opacity` (number, default: 0.5)
* `blendMode` (string, default: 'screen'): `screen`, `overlay`, `lighter`
* `driftX`, `driftY` (number, default: 20, 0)
* `scalePulse` (number, default: 0.05)
* `speed` (number, default: 2)
* `mirror` (boolean, default: false)

### 14. Route
Perspective-mapped abstract particle generators over background canvases.
* `imgSrc` (string)
* `symbol` (string, default: '!')
* `color` (string, default: '#ffffff')
* `opacity` (number, default: 0.85)
* `count` (number, default: 90)
* `speed` (number, default: 1.2)
* `size` (number, default: 64)
* `spread` (number, default: 1.0)
* `shape` (string, default: 'tunnel'): `tunnel`, `ring`, `spiral`, `stream`, `cloud`
* `startDelay` (number, default: 0)
* `duration` (number, default: 4)

### 15. Sequencer
Time-delayed glow pips and node sequences along specified coordinate maps.
* `imgSrc` (string)
* `points` (array of maps): Internal node array `[{x,y}]`
* `interval` (number, default: 0.5)
* `startDelay` (number, default: 0.0)
* `color` (string, default: '#ffffff')
* `size` (number, default: 30)
* `intensity` (number, default: 1.0)
* `darken` (number, default: 0.5): Background suppression scale
* `dispersion` (number, default: 0.8)
* `fadeSpeed` (number, default: 0.5)

### 16. Frame-Animation
Sprite image iteration mapping a sequence of separate files.
* `imgSrc` (string)
* `frames` (array of strings)
* `startDelay` (number, default: 0)
* `travelDuration` (number, default: 4)
* `sequenceDuration` (number, default: 1)
* `loops` (number, default: 1)
* `startX`, `startY`, `endX`, `endY` (number, default: 0.5)
* `startSize`, `endSize` (number, default: 0.25)
* `startOpacity`, `endOpacity` (number, default: 1)

### 17. Transform
Affine translation engine mapping precise placement via configuration overrides.
* `imgSrc` (string)
* `stageWidth`, `stageHeight` (number, default: 1920, 1080)
* `x`, `y` (number, default: 50)
* `width`, `height` (number, default: 100)
* `scale` (number, default: 1)
* `opacity` (number, default: 1)
* `rotation` (number, default: 0)
* `anchor` (string, default: 'center')
* `fit` (string, default: 'contain'): `contain`, `cover`, `stretch`
* `flipX`, `flipY` (boolean, default: false)
* `brightness`, `contrast`, `saturation` (number, default: 1)
* `blur` (number, default: 0)

### 18. Slideshow
Inter-image preloaded sequential iteration logic.
* `images` (array of strings)
* `interval` (number, default: 3.0)
* `transDuration` (number, default: 1.0)
* `transition` (string, default: 'fade'): Hardcoded internal switch mapping
* `fit` (string, default: 'cover')

### 19. Highlight
Focused marker expansion using shape drawing logic (Stars, Spheres) and zoom overlays.
* `imgSrc` (string)
* `x`, `y` (number, default: 0.5)
* `shape` (string, default: 'star'): `star`, `sphere`
* `zoom` (number, default: 1.5)
* `duration` (number, default: 1.5)
* `startDelay` (number, default: 0.0)
* `color` (string, default: '#fbbf24')
* `size` (number, default: 50)

---

## Part 2: Advanced Transition Entries Covered Here (5)

> Unlike Visual Effect engines which attach via `mount()`, Transition Engines attach to dual HTML element trees via `runTransition({ outgoing, incoming, config, duration, onComplete })`.

### 1. Split-Wipe
Dual-polygon slicing animations.
* `axis` (string, default: 'vertical'): `horizontal`
* `mode` (string, default: 'open'): `close`
* `gapBlur` (number, default: 8)
* `easing` (string, default: 'ease-in-out')

### 2. Soft-Wipe
Masked directional linear clipping overlays.
* `direction` (string, default: 'left'): `left`, `right`, `up`, `down`
* `blur` (number, default: 10)
* `easing` (string, default: 'ease')

### 3. Light-Sweep
Radiant additive gradients scaling across clipping boundaries.
* `direction` (string, default: 'left'): `left`, `right`, `up`, `down`
* `bandWidth` (number, default: 22)
* `intensity` (number, default: 0.75)
* `blur` (number, default: 8)
* `easing` (string, default: 'ease-in-out')

### 4. Iris-Wipe
Circular expansion scaling mask revealing target layer context.
* `origin` (string, default: 'center'): `top-left`, `top-right`, `bottom-left`, `bottom-right`
* `softness` (number, default: 18)
* `easing` (string, default: 'ease-in-out')

### 5. Blur-Crossfade
Scale interpolation combined with heavy CSS kernel blurring.
* `blur` (number, default: 18)
* `scale` (number, default: 1.04)
* `easing` (string, default: 'ease-in-out')
