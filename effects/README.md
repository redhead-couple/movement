# Movement Visual Effect Engines

This directory contains the highly decoupled, performance-critical raw javascript engines responsible for the rendering of persistent visual overlays and image manipulation algorithms on HTML5 Canvas planes.

The current inventory is **25 registered effects** in [registry.json](registry.json).
The [Effect Authoring Contract](../docs/EFFECT_AUTHORING_CONTRACT.md) is the
current authoring authority. The examples below are a legacy overview; consult
the current contract and the engine/maker pair before implementing changes.

For existing parameters, inspect the engine and its maker rather than inventing
new ones. The [partial Engine Catalog](../docs/ENGINE_CATALOG.md) describes an
older subset and is not an exhaustive current reference.

## 1. JSON Routing Matrix

Effect engines do not execute themselves. During `studio/player/player-runtime.js` normalization, they are dynamically evaluated through the `flow.json` V2 schemas via two primary nodes:

- **Background Planes:** `slide.background.effect`
- **Foreground Planes:** `slide.foregroundLayers[x].effect`

Both instances utilize the identical internal Engine Node configuration schema:
```json
{
  "name": "developer-friendly-alias",
  "engine": "zoom",
  "config": {
     "zoomStart": 1.0,
     "duration": 5.0
  }
}
```

## 2. The Elite Engine Execution API

Every `.js` file in this directory MUST export a `mount` function. This function constructs your localized state and triggers your infinite draw cycle.

```javascript
/* zoom-engine.js */

export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;

    // RULE 1: Resiliency object spread mapping. NEVER destructure directly from `config`
    const cfg = {
        zoomStart: 1.0,
        xStart: 0.5,
        yStart: 0.5,
        ...config
    };

    // RULE 2: Async Guard Flags
    let img = new Image();
    let imgReady = false;

    if (cfg.imgSrc) {
        img.src = cfg.imgSrc;
        // MUST declare CORS to prevent canvas taint algorithms restricting pixel-data extracts
        img.crossOrigin = "Anonymous";
        img.onload = () => { imgReady = true; };
    }

    function loop(timestamp) {
        // Halt if unmounted
        if (!active) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Avoid IndexSizeErr exceptions by checking the async guard flag
        if (imgReady && img.width) {

            // RULE 3: Canvas Context Purity. Wrap visual distortions in state boundaries!
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            // ... mutate matrices or paint operations ...
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.restore();

        }

        animationId = requestAnimationFrame(loop);
    }

    // Launch pipeline
    animationId = requestAnimationFrame(loop);

    // RULE 4: The Teardown Pipeline
    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
```

## 3. Mandatory Extractor Validation (Upgrade A)

You MUST export a local `schema` object. This schema defines the parameters for Maker UIs (like the Effects Hub) allowing them to instantly procedurally generate sliders instead of being hand-coded over time.

```javascript
export const schema = {
    // Hidden means the Maker won't generate a GUI control for it, but accepts the config
    imgSrc: { type: 'string', hidden: true, default: '' },
    // A strict numerical slider
    duration: { type: 'number', min: 0.1, max: 10, step: 0.1, default: 1.5, label: 'Duration (s)' }
};
```

## 4. The GUI Hub Registry (Upgrade B)

If you author a new `something-engine.js` and a corresponding `something-maker.html`, the system **will not know it exists**.

You MUST register your effect in `effects/registry.json`. This registry creates the category tiles in the Hub natively. Failure to update this JSON manifest results in "ghost" configurations that external contributors can never find.
