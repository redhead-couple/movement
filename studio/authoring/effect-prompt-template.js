(function exposeEffectPromptTemplate(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    Object.defineProperty(root, 'MovementEffectPrompt', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze(api)
    });
  }
})(typeof window !== 'undefined' ? window : null, function createEffectPromptTemplate() {
  'use strict';

  const PARAMETER_GROUPS = Object.freeze([
    {
      id: 'appearance',
      label: 'Appearance',
      description: 'Color, light, texture, and how strongly the effect is seen.',
      parameters: [
        { id: 'primaryColor', label: 'Primary color', hint: 'Main visible color', key: 'primaryColor' },
        { id: 'secondaryColor', label: 'Secondary color', hint: 'Accent or gradient color', key: 'secondaryColor' },
        { id: 'opacity', label: 'Transparency', hint: 'How transparent the effect is', key: 'opacity' },
        { id: 'brightness', label: 'Brightness', hint: 'Lighten or darken the result', key: 'brightness' },
        { id: 'contrast', label: 'Contrast', hint: 'Difference between light and dark', key: 'contrast' },
        { id: 'blur', label: 'Blur', hint: 'Softness or focus', key: 'blur' },
        { id: 'blendMode', label: 'Blend mode', hint: 'How layers combine', key: 'blendMode' }
      ]
    },
    {
      id: 'geometry',
      label: 'Position and shape',
      description: 'Where it appears, how large it is, and how it moves through the frame.',
      parameters: [
        { id: 'position', label: 'Location', hint: 'Horizontal and vertical position', key: 'position' },
        { id: 'origin', label: 'Origin point', hint: 'Where growth or motion begins', key: 'origin' },
        { id: 'size', label: 'Size', hint: 'Overall scale or radius', key: 'size' },
        { id: 'direction', label: 'Direction', hint: 'Left, right, up, down, or angle', key: 'direction' },
        { id: 'spread', label: 'Spread', hint: 'How wide or scattered it becomes', key: 'spread' },
        { id: 'rotation', label: 'Rotation', hint: 'Angle or spin', key: 'rotation' },
        { id: 'count', label: 'Amount', hint: 'Number of particles, copies, or elements', key: 'count' }
      ]
    },
    {
      id: 'timing',
      label: 'Timing',
      description: 'When it starts, how long it lasts, and the rhythm of its movement.',
      parameters: [
        { id: 'startDelay', label: 'Start time', hint: 'Delay before the effect begins', key: 'startDelay' },
        { id: 'duration', label: 'Duration', hint: 'How long one action lasts', key: 'duration' },
        { id: 'speed', label: 'Speed', hint: 'Rate of motion or change', key: 'speed' },
        { id: 'interval', label: 'Interval', hint: 'Pause between repeated actions', key: 'interval' },
        { id: 'repeat', label: 'Repeats', hint: 'How many times it runs or whether it loops', key: 'repeat' },
        { id: 'easing', label: 'Movement style', hint: 'Smooth, sharp, elastic, or natural motion', key: 'easing' },
        { id: 'fade', label: 'Fade in and out', hint: 'How it enters and disappears', key: 'fade' },
        { id: 'randomness', label: 'Randomness', hint: 'Controlled variation between runs', key: 'randomness' }
      ]
    },
    {
      id: 'media',
      label: 'Images and textures',
      description: 'Use slideshow images or optional project media as part of the effect.',
      parameters: [
        { id: 'backgroundImage', label: 'Slide image', hint: 'Use the current background image', key: 'imgSrc' },
        { id: 'additionalImage', label: 'Additional image', hint: 'Let the user select another project image', key: 'additionalImage' },
        { id: 'maskTexture', label: 'Mask or texture', hint: 'Use a project image as a visual mask', key: 'maskTexture' }
      ]
    }
  ]);

  const PARAMETER_INDEX = Object.freeze(PARAMETER_GROUPS
    .flatMap(group => group.parameters)
    .reduce((index, parameter) => {
      index[parameter.id] = parameter;
      return index;
    }, {}));

  const IMPROVEMENT_AREAS = Object.freeze({
    appearance: 'Appearance or movement',
    controls: 'Controls and maker usability',
    performance: 'Performance and reliability',
    repair: 'Fix a visible or functional problem',
    accessibility: 'Accessibility and reduced motion'
  });

  function clean(value, fallback = '') {
    const normalized = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
    return normalized || fallback;
  }

  function slugify(value) {
    return clean(value, 'new-effect')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'new-effect';
  }

  function bulletDetails(selection) {
    const definition = PARAMETER_INDEX[selection.id];
    if (!definition) return '';
    const details = [];
    if (clean(selection.defaultValue)) details.push(`preferred default: ${clean(selection.defaultValue)}`);
    if (clean(selection.range)) details.push(`range or choices: ${clean(selection.range)}`);
    if (clean(selection.notes)) details.push(`behavior: ${clean(selection.notes)}`);
    if (!details.length) details.push('choose a sensible default, control type, range, step, and unit');
    return `- **${definition.label}** (\`${definition.key}\`): ${definition.hint}; ${details.join('; ')}.`;
  }

  function improvementAreaList(input) {
    const requested = Array.isArray(input.improvementAreas) ? input.improvementAreas : [];
    const labels = requested.map(area => IMPROVEMENT_AREAS[area]).filter(Boolean);
    return labels.length ? labels.map(label => `- ${label}`).join('\n') : '- General refinement';
  }

  function hasImprovementArea(input, area) {
    return Array.isArray(input.improvementAreas) && input.improvementAreas.includes(area);
  }

  function improvementControlDetails(input) {
    if (!hasImprovementArea(input, 'controls')) return '';
    const request = input.controlRequest && typeof input.controlRequest === 'object'
      ? input.controlRequest
      : {};
    const details = [
      clean(request.name) ? `- **Control name or change:** ${clean(request.name)}` : '',
      clean(request.behavior) ? `- **Desired behavior:** ${clean(request.behavior)}` : '',
      clean(request.defaultValue) ? `- **Preferred default:** ${clean(request.defaultValue)}` : '',
      clean(request.range) ? `- **Range or choices:** ${clean(request.range)}` : ''
    ].filter(Boolean);
    if (!details.length) {
      return '- **Control details:** Infer the exact control contract from the desired result and established repository conventions.';
    }
    return ['### Requested control change', '', ...details].join('\n');
  }

  function buildEffectPrompt(input = {}) {
    const name = clean(input.name, 'Untitled effect');
    const slug = slugify(input.slug || name);
    const category = clean(input.category, 'Experimental');
    const parameters = Array.isArray(input.parameters)
      ? input.parameters.map(bulletDetails).filter(Boolean)
      : [];
    const customParameters = clean(input.customParameters);
    const reference = clean(input.referenceEffect);
    const accessibility = input.reducedMotion !== false;
    const mediaSelected = Array.isArray(input.parameters) && input.parameters.some(parameter => (
      ['backgroundImage', 'additionalImage', 'maskTexture'].includes(parameter.id)
    ));

    return [
      `# Build a Movement effect: ${name}`,
      '',
      'Work inside this Movement Timeline Studio repository. Implement the complete effect, integrate it, and verify it. Do not return only sample code or a design proposal.',
      '',
      '## Creative brief',
      '',
      `- **Effect name:** ${name}`,
      `- **Suggested engine slug:** \`${slug}\` (change it only if it conflicts with an existing engine or violates the repository naming rules)`,
      `- **Category:** ${category}`,
      '- **Layer compatibility:** The effect must remain available for both background images and foreground image layers.',
      `- **What it should do:** ${clean(input.description, 'Create the visual behavior described by the effect name.')}`,
      `- **What it should express:** ${clean(input.mood, 'Choose a visual tone that supports the described behavior.')}`,
      `- **Visual direction:** ${clean(input.visualStyle, 'Derive a coherent visual style from the brief.')}`,
      '',
      '## User-facing controls',
      '',
      parameters.length
        ? parameters.join('\n')
        : '- Keep the maker intentionally simple. When inventing controls that the designer did not request, choose no more than five primary creative controls. Put a control in Advanced only when it is genuinely optional, rarely used, or technical.',
      customParameters
        ? `- **Additional requested controls:** ${customParameters}`
        : '- Add another control only when it materially improves creative usefulness; avoid technical controls the effect designer should not need to understand.',
      '',
      'For every control, use a clear human label in the maker. Validate values, define stable config keys, preserve them during editing, and keep maker defaults identical to engine fallbacks. If a requested value or range is unspecified, decide it from the visual brief and the nearest existing effects. Treat unrequested engine-tuning values as internal configuration, not visible maker fields. Every explicitly requested control must remain visible in its most logical creative group. Never hide a requested control in Advanced merely because the maker already has many controls or the requested count exceeds five. Reserve Advanced for genuinely optional, rarely used, or technical controls.',
      '',
      '## Required repository discovery',
      '',
      'This task is for a repository-aware coding assistant. Work only after confirming that you can read and edit this project folder. Run local checks when the environment permits them; if a capability is unavailable, state that limitation instead of claiming the work or test succeeded.',
      '',
      'Before editing files:',
      '',
      '1. Read `docs/EFFECT_AUTHORING_CONTRACT.md` completely and treat its current repository-specific rules as authoritative.',
      '2. Read `docs/ANIMATION_PERFORMANCE_BUDGET.md` completely. Its render-surface, scheduling, hot-loop, maker-preview, and stress-test limits are acceptance requirements, not optional advice.',
      '3. Read `effects/registry.json`, `effects/effect-media.js`, the effect loading code in `studio/player/player-runtime.js`, and the shared behavior in `studio/maker/maker-engine.js`.',
      reference
        ? `4. Inspect the complete maker/engine pair for \`${reference}\`, plus one other close effect if useful. Explain briefly why each reference is relevant.`
        : '4. Select and inspect one or two complete existing effect maker/engine pairs that are closest in rendering method, media use, and control design. Explain briefly why they are relevant.',
      '5. Search the editor and Effects Hub integration before deciding file locations or message formats. Follow current code, not assumptions or an older generic guide.',
      '6. Check for an existing engine with the proposed slug or substantially identical behavior. Extend safely or choose a distinct slug instead of overwriting unrelated work.',
      '',
      'Do not make the effect designer choose implementation details that can be learned from the repository. Ask a question only if an unresolved creative choice would materially change the visible result.',
      '',
      '## Implementation requirements',
      '',
      `- Create the effect engine at \`effects/${slug}-engine.js\` and its maker at \`effects/${slug}-maker.html\`, unless repository inspection proves a different current convention.`,
      '- Because the maker now lives in `effects/`, include `<base href="../">` in its `<head>` so existing root-level shared CSS, scripts, and project-relative media URLs retain their established resolution.',
      '- The engine must export `mount(canvas, ctx, config)` and return an idempotent cleanup function.',
      '- Keep all mutable state local to the mounted instance. Support multiple instances and repeated slide visits.',
      '- Cancel every animation frame and timer, detach listeners, release temporary media handlers, and restore canvas state during cleanup.',
      '- The maker must provide a useful live preview and expose the current `MakerAPI` contract used by the Effects Hub, including run, export, and edit/reload behavior.',
      '- Use one reusable definition and configuration contract for both background and foreground placement; do not make separate versions or restrict registration to one layer type.',
      `- The exported definition must use \`engine: "${slug}"\` and a JSON-safe \`config\` object whose keys match the engine.`,
      `- Register \`${slug}\` exactly once under \`${category}\` in \`effects/registry.json\`. Create that category only if it does not exist. Do not reorganize other personal categories or effects.`,
      '- Keep the UI consistent with the existing maker theme and hide implementation details from the maker user.',
      '',
      '## Media, offline use, and portability',
      '',
      mediaSelected
        ? '- This effect uses project media. Reuse the current maker media bridge and project-relative references. Make selected images work in maker preview, desktop editing, playback, and portable export.'
        : '- Do not add media controls unless the visual design truly needs them. If media becomes necessary, use the existing maker media bridge and project-relative references.',
      '- Never store an absolute computer path in effect config.',
      '- Do not use remote scripts, packages, fonts, images, APIs, CDNs, or network access. The effect must work without internet, PHP, MySQL, or a web server.',
      '- Handle missing or failed media gracefully without stopping slideshow playback.',
      '- If the engine uses any image, import `createEffectImage` from `./effect-media.js` and use it for every image source. Never call `new Image()`, create an `<img>` element, or independently fetch/decode configured image media inside an effect engine. Preserve the runtime-only `preloadedImages` value through config normalization, but never export or serialize it in effect JSON.',
      '',
      '## Non-negotiable performance budget and safety',
      '',
      'These requirements are release gates. If the requested look would exceed them, implement a visually similar cheaper technique instead of weakening the limits.',
      '- Define an explicit animated-canvas pixel constant no greater than 2,073,600 pixels (1920 × 1080) unless the repository has a stricter limit. Preserve aspect ratio when scaling. Never copy unchecked image `naturalWidth`/`naturalHeight`, video dimensions, or device-pixel ratio directly into an animated canvas.',
      '- Do not repeatedly decode or rescale media, rebuild static drawing work, or draw from a full natural-resolution source every frame. Keep static media in a separate layer when possible; otherwise rasterize it once into a capped cached surface and reuse it. Include every canvas, offscreen surface, bitmap, and mask in the memory design.',
      '- Ambient animation should target 30 FPS and must be throttled to no more than 45 FPS unless a higher rate has a documented visual need and an actual browser measurement. Maintain exactly one scheduled frame per instance and remain idle during start delays, static holds, hidden/reduced-motion states, and after cleanup.',
      '- Generated particles or repeated objects must default to 72 or fewer and have a hard normal maximum of 120 or fewer; use lower limits for expensive objects. Do not apply live `shadowBlur`, large filters, gradients, text measurement, or complex paths independently to many objects every frame. Pre-render bounded reusable sprites.',
      '- The hot loop must not create objects, arrays, closures, paths, gradients, or changing color/style strings per object per frame. Precompute and reuse values, avoid canvas readback and layout queries, and degrade safely when two instances run simultaneously.',
      '- The maker must not fully remount the engine, decode the same media, resize a large canvas, or start overlapping asynchronous work for every raw slider `input` event. Apply lightweight updates or debounce expensive rebuilds, invalidate stale loads, and retain one live preview loop.',
      '- Normalize malformed config values and fall back to the same defaults shown by the maker.',
      '- Use `ctx.save()` / `ctx.restore()` around drawing-state changes and make resize behavior responsive and sharp.',
      accessibility
        ? '- Respect reduced-motion preferences with a calmer or static rendering when practical, without breaking the effect.'
        : '- Reduced-motion behavior is optional for this effect unless the existing architecture requires it.',
      '- Do not use `eval`, dynamic remote imports, global state, or unrelated file changes.',
      '',
      '## Verification',
      '',
      'Verify all of the following:',
      '',
      '1. The maker opens from the Effects Hub, previews successfully, and presents only understandable creative controls.',
      '2. Its exported definition is valid JSON, uses the registered engine slug, and behaviorally reloads every saved value into edit mode without losing nested or media configuration.',
      '3. The same effect definition runs on both a background and a foreground layer in editor preview and the full player.',
      '4. Cleanup works after changing slides, replaying, reopening the preview, and mounting more than one instance.',
      '5. Missing media and edge values do not crash playback.',
      '6. The portable offline player can load the engine and its media with no network dependency.',
      '7. Automated tests assert the maximum animated-pixel calculation, safe object/control limits, one active frame loop, stale-load invalidation, cleanup, portable inclusion, edit restoration, and both layer placements where the repository architecture permits it. For an image effect, prove that player-supplied decoded media is reused without constructing or requesting a second image.',
      '8. When the environment permits, stress the actual Chromium/Electron renderer with a large source image, maximum supported controls, two simultaneous instances, rapid maker input, repeated replay, and navigation. Confirm bounded internal surfaces, responsive interaction, stable resource use, and no renderer crash.',
      '9. Mock/no-op canvas tests do not prove performance. Never claim a visual, edit-mode, background/foreground, portable, stress, or performance check passed unless it was actually performed. Clearly separate automated checks, manual checks, and checks still needed.',
      '',
      '## Handoff',
      '',
      'When finished, report:',
      '',
      '- files created or changed;',
      '- final slug and category;',
      '- controls, config keys, defaults, ranges, and units;',
      '- declared maximum animated pixels, target FPS, maximum repeated-object count, caching strategy, and maker-update strategy;',
      '- existing effects used as references and why;',
      '- tests and manual checks completed;',
      '- anything the user should visually check in the maker, editor, player, or portable export;',
      '- any known limitation.',
      '',
      `Start by inspecting the repository, then implement **${name}** completely.`
    ].join('\n');
  }

  function buildEffectImprovementPrompt(input = {}) {
    const engine = slugify(input.engine || input.name || 'existing-effect');
    const displayName = clean(input.name, engine.split('-').map(part => (
      part.charAt(0).toUpperCase() + part.slice(1)
    )).join(' '));
    const category = clean(input.category, 'Unknown');
    const makerPath = clean(input.maker, `effects/${engine}-maker.html`);
    const enginePath = clean(input.engineFile, `effects/${engine}-engine.js`);
    const status = clean(input.status, 'available');
    const warnings = Array.isArray(input.warnings)
      ? input.warnings.map(warning => clean(warning)).filter(Boolean)
      : [];
    const accessibility = input.reducedMotion !== false;

    return [
      `# Improve the existing Movement effect: ${displayName}`,
      '',
      'Work inside this Movement Timeline Studio repository. Improve the existing effect in place, integrate the change, and verify it. Do not return only sample code or a design proposal, and do not create a second effect as a shortcut.',
      '',
      '## Existing effect identity',
      '',
      `- **Engine slug:** \`${engine}\``,
      `- **Category:** ${category}`,
      `- **Maker:** \`${makerPath}\``,
      `- **Engine:** \`${enginePath}\``,
      `- **Current registry status:** ${status}`,
      warnings.length
        ? `- **Current warnings:** ${warnings.join('; ')}`
        : '- **Current warnings:** None reported by the registry.',
      '',
      'Preserve this identity, its registry category and order, and its current paths unless repository inspection proves one is already incorrect. If a maker or engine is missing, restore it at the expected existing path instead of inventing a new slug.',
      '',
      '## Requested improvement',
      '',
      improvementAreaList(input),
      '',
      improvementControlDetails(input),
      '',
      `- **Desired result:** ${clean(input.description, 'Refine the effect while preserving its established purpose.')}`,
      `- **What must remain unchanged:** ${clean(input.preserve, 'Preserve the effect identity, its working behavior, and existing saved configurations.')}`,
      hasImprovementArea(input, 'repair')
        ? `- **How to observe the problem:** ${clean(input.reproduction, 'Inspect the maker, editor preview, player, and existing tests to identify the current limitation.')}`
        : '',
      `- **Additional requirements:** ${clean(input.specialRequirements, 'None supplied.')}`,
      '',
      '## Required repository discovery',
      '',
      'This task is for a repository-aware coding assistant. Confirm that you can read and edit the project folder, then inspect before changing anything:',
      '',
      '1. Read `docs/EFFECT_AUTHORING_CONTRACT.md` and `docs/ANIMATION_PERFORMANCE_BUDGET.md` completely.',
      `2. Read the complete current \`${makerPath}\` and \`${enginePath}\` files, including their defaults, config keys, media behavior, preview lifecycle, and cleanup.`,
      '3. Read the target registry entry, `effects/effect-media.js`, effect loading in `studio/player/player-runtime.js`, shared maker behavior in `studio/maker/maker-engine.js`, Effects Hub integration, editor edit/reload integration, and portable engine inlining.',
      `4. Find every existing test and saved-flow fixture that refers to \`${engine}\`. Record the current config shape and behavior before editing.`,
      '5. Inspect Git status and preserve unrelated personal work. Do not rewrite neighboring effects or registry categories.',
      '',
      '## Compatibility requirements',
      '',
      `- Keep the engine slug \`${engine}\`, maker path \`${makerPath}\`, engine path \`${enginePath}\`, and registry placement stable.`,
      '- Existing `flow.json` definitions must continue working without manual repair. Preserve existing config keys and meanings. New keys must be optional and have safe fallbacks.',
      '- If a key truly must be renamed or removed, retain a compatibility alias or normalization path and behaviorally test both the old and new configuration.',
      '- Keep maker defaults identical to engine fallbacks. Edit mode must restore every old and new value, including nested and media configuration.',
      '- Every added control needs a stable config key, validated range, maker export and edit restoration, and a fallback that preserves the previous appearance when older saved definitions omit it.',
      '- Preserve both background and foreground layer compatibility. Do not reduce current offline, desktop, PHP-player, or portable-player support.',
      '- Improve the current implementation in place. Avoid wholesale replacement when a focused change is safer and clearer.',
      '',
      '## Implementation and safety requirements',
      '',
      '- Keep controls understandable and creative. Place every explicitly requested control visibly in its most logical existing group. Never hide it in Advanced merely because the maker already has many controls. Reserve Advanced for genuinely optional, rarely used, or technical controls, and keep the shared maker scrolling behavior intact.',
      '- Keep mutable runtime state local to each mounted instance. Cleanup must be idempotent and cancel every animation frame, timer, listener, pending media callback, and temporary resource.',
      '- Normalize malformed inputs and handle missing media without stopping slideshow playback.',
      '- If the engine uses images, keep every source on the shared `createEffectImage` path from `./effect-media.js`. Never call `new Image()`, create an `<img>` element, or introduce duplicate fetch/decode work in the engine. Preserve runtime-only `preloadedImages` during normalization without serializing it into saved config.',
      '- Do not use remote dependencies, absolute computer paths, `eval`, mutable global state, or unrelated file changes.',
      '- Retain an explicit animated-canvas limit no greater than 2,073,600 pixels. Never animate unchecked natural media dimensions or device-pixel ratio.',
      '- Keep repeated objects at 72 or fewer by default and 120 or fewer at the hard normal maximum. Cache static work, avoid hot-loop allocations and canvas readback, and maintain one scheduled frame per instance.',
      '- Maker input must not repeatedly decode media, resize large surfaces, remount the engine, or create overlapping preview work.',
      accessibility
        ? '- Preserve or add a calmer reduced-motion rendering when practical without breaking the effect.'
        : '- Do not remove reduced-motion behavior that the effect already provides.',
      '',
      '## Verification',
      '',
      '1. Compare the before-and-after maker preview and confirm the requested change is visible without losing established behavior.',
      '2. Export a definition from the maker, reload an older saved definition in edit mode, and verify every value survives.',
      '3. Run the effect on both background and foreground layers in editor preview and the full player.',
      '4. Verify repeated replay, multiple instances, slide changes, missing media, and cleanup.',
      '5. Verify the portable offline player includes and runs the same engine with no network dependency.',
      '6. Update or add focused automated tests for the changed behavior, backward-compatible normalization, lifecycle cleanup, bounded work, edit restoration, and portable inclusion.',
      '7. When possible, stress the real Chromium/Electron renderer with maximum controls, two instances, rapid maker input, replay, and navigation. Mock canvas tests do not prove visual correctness or performance.',
      '8. Clearly separate automated checks, manual visual checks, and checks that could not be performed. Never claim an unavailable check passed.',
      '',
      '## Handoff',
      '',
      'Report the exact files changed, the previous and new behavior, config compatibility decisions, controls affected, performance limits, tests actually run, manual checks still needed, and any known limitation.',
      '',
      `Start by inspecting the existing \`${engine}\` effect, then implement only the requested improvement.`
    ].join('\n');
  }

  return Object.freeze({
    PARAMETER_GROUPS,
    PARAMETER_INDEX,
    IMPROVEMENT_AREAS,
    buildEffectPrompt,
    buildEffectImprovementPrompt,
    slugify
  });
});
