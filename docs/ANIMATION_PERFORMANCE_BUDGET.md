# Animation Performance Budget

This contract applies to every newly authored Movement effect and transition. Its limits are acceptance requirements, not suggestions. If a requested look conflicts with the budget, preserve the visual character with a cheaper approximation rather than shipping code that can freeze or crash the renderer.

## 1. Render-surface budget

- Define an explicit animated-pixel limit. Unless an existing repository rule is stricter, the total pixels in any continuously animated canvas must not exceed 2,073,600 (1920 × 1080).
- Preserve the source aspect ratio when calculating capped backing dimensions. CSS may scale the result visually.
- Never assign `canvas.width` and `canvas.height` directly from unchecked `naturalWidth`, `naturalHeight`, video dimensions, device-pixel ratio, or another media source.
- Treat every canvas, offscreen canvas, image bitmap, mask, and temporary full-slide surface as memory. Keep their dimensions and count bounded, including during transitions and cleanup overlap.
- Do not repeatedly decode or rescale source media, rebuild static paths/gradients, or draw directly from a full natural-resolution image every frame. Keep static content in a separate DOM layer when possible. When the architecture requires one composited canvas, rasterize static content once into a capped cached surface and reuse it without repeating source scaling or filter work.

## 2. Scheduling budget

- Slow ambient effects should target 30 frames per second and must not exceed 45 without a documented visual reason and an actual browser measurement.
- Short transitions may use compositor-driven 60 Hz animation. A JavaScript or canvas loop may target 60 only when lower rates visibly damage the choreography and the worst case was measured.
- A `requestAnimationFrame` loop must throttle its own work to the selected target rate, use delta time safely, and have exactly one scheduled frame per mounted instance.
- Do not keep repainting during a start delay, static hold, reduced-motion state, hidden document, or completed transition. Draw the required static state once and remain idle.
- Every timer, frame, observer, listener, media callback, and pending preview operation must be cancelled or invalidated by cleanup.

## 3. Per-frame work budget

- For particles or repeated visual objects, use a default of 72 or fewer and a hard normal maximum of 120 or fewer. Expensive objects require lower limits.
- Do not apply live `shadowBlur`, large filters, complex paths, gradients, or text measurement separately to many objects on every frame. Pre-render a bounded sprite or cache reusable work.
- Do not create objects, arrays, closures, paths, gradients, or changing style/color strings per object per frame when values can be precomputed or reused.
- Avoid repeated full-canvas readback, `getImageData`, layout reads, DOM queries, and interleaved read/write cycles inside animation loops.
- Transitions should primarily animate compositor-friendly `transform` and `opacity`. Keep full-slide filters, masks, cloned layers, segments, and temporary DOM strictly bounded.

## 4. Maker-preview budget

- A raw slider `input` event must not repeatedly remount the engine, decode the same media, recreate a large canvas, or start overlapping asynchronous work.
- Apply lightweight values to the active preview when possible. Otherwise debounce expensive rebuilds and ensure only the newest requested rebuild can finish.
- Reuse decoded media and cached preview resources. Invalidate stale load callbacks and retain only one live animation loop per preview.
- Maker defaults and control maxima must stay inside the same safe engine limits; malformed imported configuration must not bypass them.

## 5. Multiple-instance behavior

The player may briefly contain outgoing and incoming slides, background effects, and more than one foreground effect. Defaults must remain responsive with at least two simultaneous instances. Do not assume an effect or transition is the only animation in the document.

## 6. Required verification

Automated coverage must assert every deterministic limit the repository can inspect, including:

- maximum animated pixels and aspect-ratio scaling;
- normalized maximum object/filter/segment values;
- one active frame loop and idempotent cleanup;
- stale image or preview work cannot reactivate a disposed instance;
- maker interaction does not perform an expensive remount for every raw slider event.

Also perform an actual Chromium/Electron stress check when the environment permits it:

1. Use a large source image and maximum supported creative controls.
2. Exercise two simultaneous effect instances or repeated rapid transitions.
3. Drag maker controls rapidly, replay repeatedly, navigate away, and return.
4. Confirm the internal surface stays within its declared pixel limit, the interface remains responsive, memory does not grow without bound, and the renderer does not crash.

Mock canvas tests with no-op drawing methods do not count as performance validation. If the actual browser check cannot be run, report it explicitly as still required and do not claim that performance passed.
