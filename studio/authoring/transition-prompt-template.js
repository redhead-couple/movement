(function exposeTransitionPromptTemplate(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    Object.defineProperty(root, 'MovementTransitionPrompt', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze(api)
    });
  }
})(typeof window !== 'undefined' ? window : null, function createTransitionPromptTemplate() {
  'use strict';

  const PARAMETER_GROUPS = Object.freeze([
    {
      id: 'motion',
      label: 'Motion',
      description: 'How the outgoing and incoming slides move through the frame.',
      parameters: [
        { id: 'direction', label: 'Direction', hint: 'Left, right, up, down, inward, or outward', key: 'direction' },
        { id: 'movementStyle', label: 'Movement style', hint: 'Slide, sweep, fold, drift, or another motion', key: 'movementStyle' },
        { id: 'distance', label: 'Distance', hint: 'How far a layer travels', key: 'distance' },
        { id: 'rotation', label: 'Rotation', hint: 'Angle or spin during the change', key: 'rotation' },
        { id: 'scale', label: 'Zoom', hint: 'How much a layer grows or shrinks', key: 'scale' }
      ]
    },
    {
      id: 'timing',
      label: 'Timing and rhythm',
      description: 'The speed, overlap, and character of the transition.',
      parameters: [
        { id: 'duration', label: 'Duration', hint: 'How long the complete transition takes', key: 'duration' },
        { id: 'easing', label: 'Movement character', hint: 'Smooth, sharp, elastic, or natural timing', key: 'easing' },
        { id: 'overlap', label: 'Slide overlap', hint: 'How long outgoing and incoming slides coexist', key: 'overlap' },
        { id: 'hold', label: 'Pause or hold', hint: 'A short pause at a meaningful moment', key: 'hold' },
        { id: 'stagger', label: 'Stagger', hint: 'Delay between segments or layers', key: 'stagger' }
      ]
    },
    {
      id: 'appearance',
      label: 'Appearance',
      description: 'Light, focus, color, and how softly the slides blend.',
      parameters: [
        { id: 'fade', label: 'Fade', hint: 'Opacity change between slides', key: 'fade' },
        { id: 'blur', label: 'Blur', hint: 'Soft focus during movement', key: 'blur' },
        { id: 'brightness', label: 'Brightness', hint: 'Lighten or darken during the change', key: 'brightness' },
        { id: 'color', label: 'Accent color', hint: 'Optional color used by the transition', key: 'color' },
        { id: 'shadow', label: 'Shadow', hint: 'Depth between moving slide layers', key: 'shadow' },
        { id: 'edgeSoftness', label: 'Edge softness', hint: 'How sharp or feathered a reveal edge looks', key: 'edgeSoftness' }
      ]
    },
    {
      id: 'reveal',
      label: 'Reveal shape',
      description: 'The geometry and structure used to uncover the next slide.',
      parameters: [
        { id: 'shape', label: 'Shape', hint: 'Circle, line, panel, diagonal, or custom geometry', key: 'shape' },
        { id: 'angle', label: 'Angle', hint: 'Orientation of a wipe or sweep', key: 'angle' },
        { id: 'segments', label: 'Segments', hint: 'Number of panels, strips, or pieces', key: 'segments' },
        { id: 'intensity', label: 'Intensity', hint: 'Overall strength of the choreography', key: 'intensity' },
        { id: 'sweepWidth', label: 'Sweep width', hint: 'Width of a moving edge or highlight', key: 'sweepWidth' },
        { id: 'reverse', label: 'Reverse', hint: 'Allow the motion to run in the opposite form', key: 'reverse' }
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
    appearance: 'Choreography or appearance',
    controls: 'Controls and maker usability',
    performance: 'Performance and interruption safety',
    repair: 'Fix a visible or functional problem',
    accessibility: 'Accessibility and reduced motion'
  });

  function clean(value, fallback = '') {
    const normalized = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
    return normalized || fallback;
  }

  function slugify(value) {
    return clean(value, 'new-transition')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'new-transition';
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

  function buildTransitionPrompt(input = {}) {
    const name = clean(input.name, 'Untitled transition');
    const slug = slugify(input.slug || name);
    const category = clean(input.category, 'Experimental');
    const parameters = Array.isArray(input.parameters)
      ? input.parameters.map(bulletDetails).filter(Boolean)
      : [];
    const customParameters = clean(input.customParameters);
    const reference = clean(input.referenceEffect);
    const accessibility = input.reducedMotion !== false;

    return [
      `# Build a Movement transition: ${name}`,
      '',
      'Work inside this Movement Timeline Studio repository. Implement the complete transition, integrate it, and verify it. Do not return only sample code or a design proposal.',
      '',
      '## Creative brief',
      '',
      `- **Transition name:** ${name}`,
      `- **Suggested engine slug:** \`${slug}\` (change it only if it conflicts with an existing engine or violates repository naming rules)`,
      `- **Category:** ${category}`,
      `- **What should happen between slides:** ${clean(input.description, 'Create the slide change described by the transition name.')}`,
      `- **What it should express:** ${clean(input.mood, 'Choose a motion character that supports the described choreography.')}`,
      `- **Visual direction:** ${clean(input.visualStyle, 'Derive a coherent visual style from the brief.')}`,
      '',
      '## User-facing controls',
      '',
      parameters.length
        ? parameters.join('\n')
        : '- Keep the maker intentionally simple. When inventing controls that the designer did not request, choose no more than five primary creative controls. Put a control in Advanced only when it is genuinely optional, rarely used, or technical.',
      customParameters
        ? `- **Additional requested controls:** ${customParameters}`
        : '- Add another control only when it materially improves creative usefulness; keep engine-tuning details internal.',
      '',
      'For every control, use a clear human label in the maker. Validate values, define stable config keys, preserve them during editing, and keep maker defaults identical to engine fallbacks. Every explicitly requested control must remain visible in its most logical creative group. Never hide a requested control in Advanced merely because the maker already has many controls or the requested count exceeds five. Reserve Advanced for genuinely optional, rarely used, or technical controls.',
      '',
      '## Required repository discovery',
      '',
      'This task is for a repository-aware coding assistant. Work only after confirming that you can read and edit this project folder. Run local checks when the environment permits them; if a capability is unavailable, state that limitation instead of claiming the work or test succeeded.',
      '',
      'Before editing files:',
      '',
      '1. Read `docs/TRANSITION_AUTHORING_CONTRACT.md` completely and treat its current repository-specific rules as authoritative.',
      '2. Read `docs/ANIMATION_PERFORMANCE_BUDGET.md` completely. Its render-surface, scheduling, hot-loop, maker-preview, and stress-test limits are acceptance requirements, not optional advice.',
      '3. Read `transitions/registry.json`, advanced transition loading/invocation in `studio/player/player-runtime.js`, and creation/edit integration in `studio/hubs/transitions-hub.html` and `studio/editor/json-maker-logic.js`.',
      reference
        ? `4. Inspect the complete maker/engine pair for \`${reference}\`, plus one other close transition if useful. Explain briefly why each reference is relevant.`
        : '4. Select and inspect one or two complete transition maker/engine pairs closest in choreography, DOM/CSS technique, timing, and control design. Explain briefly why they are relevant.',
      '5. Inspect portable engine inlining in `desktop/services/portable-project-service.cjs` and the relevant tests before deciding implementation or test structure.',
      '6. Check for an existing engine with the proposed slug or substantially identical behavior. Extend safely or choose a distinct slug instead of overwriting unrelated work.',
      '',
      'Do not make the transition designer choose implementation details that can be learned from the repository. Ask a question only if an unresolved creative choice would materially change the visible result.',
      '',
      '## Implementation requirements',
      '',
      `- Create the engine at \`transitions/${slug}-engine.js\` and the maker at \`transitions/${slug}-maker.html\`.`,
      '- The engine must export `runTransition({ root, outgoing, incoming, config, duration, onComplete })` and return an idempotent finish/abort function.',
      '- Normalize malformed configuration and duration values. Keep mutable state local to each invocation.',
      '- Call `onComplete` exactly once through one guarded finish path, even if multiple events or the failsafe timer fire.',
      '- Install a failsafe timer slightly longer than the visual duration. Remove every listener, timer, animation frame, temporary element, class, CSS custom property, and inline style created by the transition.',
      '- Leave the incoming slide visible and both slide layers clean after normal completion or early finish.',
      '- The maker must show distinct outgoing and incoming sample slides, provide Play/Replay, export the current transition definition, and behaviorally restore saved name/configuration from `transitionEditData`.',
      `- The exported definition must use \`engine: "${slug}"\`, \`maker: "transitions/${slug}-maker.html"\`, and a JSON-safe \`config\` object matching the engine.`,
      `- Register \`${slug}\` exactly once under \`${category}\` in \`transitions/registry.json\`. Create that category only if it does not exist. Do not reorganize other personal categories or transitions.`,
      '- Keep the maker consistent with nearby transition makers and hide implementation details from its user.',
      '',
      '## Offline use and portability',
      '',
      '- Do not use remote scripts, packages, fonts, images, APIs, CDNs, or network access. The transition must work without internet, PHP, MySQL, or a web server.',
      '- Do not store absolute computer paths or depend on files outside the application.',
      '- Ensure portable-player engine inlining includes the transition and removes module export syntax correctly.',
      '',
      '## Non-negotiable performance, interruption, and accessibility budget',
      '',
      'These requirements are release gates. If the requested look would exceed them, implement a visually similar cheaper technique instead of weakening the limits.',
      '- Prefer compositor-friendly `transform` and `opacity`, using CSS transitions or the Web Animations API. Avoid animating layout properties, interleaved layout reads/writes, per-frame DOM queries, and unnecessary full-slide clones.',
      '- Keep full-slide blur, filters, shadows, masks, segments, and temporary layers strictly bounded. Do not apply expensive live filters independently to many elements. Pre-render or approximate repeated detail when necessary.',
      '- If a canvas or bitmap is genuinely required, define an explicit animated-pixel limit no greater than 2,073,600 pixels (1920 × 1080), preserve aspect ratio, and never copy unchecked media dimensions or device-pixel ratio into it. Rasterize unchanged full-slide content once into a capped cached surface rather than repeatedly decoding, rescaling, or filtering the source.',
      '- A JavaScript frame loop is allowed only when compositor animation cannot express the choreography. It must have one scheduled frame per invocation, avoid per-frame allocations and DOM/layout queries, and use 60 FPS only when lower rates visibly fail and the actual worst case was measured.',
      '- The maker must not rebuild the transition, decode media, recreate large surfaces, or start overlapping work for every raw slider `input` event. Apply lightweight updates or debounce replay/rebuild and invalidate stale operations.',
      '- Ensure rapid navigation, replay, a missing completion event, or a backgrounded window cannot leave animation work running or the player stuck. Defaults must remain responsive during repeated transitions and overlap with other slide effects.',
      accessibility
        ? '- Respect reduced-motion preferences with a shorter, calmer fade or near-instant completion when practical, while still completing exactly once.'
        : '- Reduced-motion behavior is optional unless the existing architecture requires it.',
      '- Do not use `eval`, remote dynamic imports, mutable global state, or unrelated file changes.',
      '',
      '## Verification',
      '',
      'Verify all of the following:',
      '',
      '1. The maker opens from the Transitions Hub, previews/replays successfully, and presents only understandable creative controls.',
      '2. Its exported definition is valid JSON, uses the registered engine and maker paths, and behaviorally restores every saved value in edit mode.',
      '3. Editor preview and the full player complete the transition exactly once and leave clean incoming/outgoing layers.',
      '4. A missing completion event still finishes through the failsafe; early finish/abort is idempotent and clears every resource and style.',
      '5. Repeated and rapid navigation does not leave a slide hidden, transformed, filtered, or stuck.',
      '6. The portable offline player includes and runs the engine with no network dependency.',
      '7. Automated tests assert normalization, bounded surfaces/elements/filters, exact-once completion, one active animation, failsafe, cleanup, stale-work invalidation, edit restoration, and portable inclusion where the repository architecture permits it.',
      '8. When the environment permits, stress the actual Chromium/Electron renderer at maximum supported controls with rapid Replay and navigation while other slide effects are active. Confirm bounded surfaces and temporary DOM, responsive interaction, stable resource use, and no renderer crash.',
      '9. Mock animation or no-op drawing tests do not prove performance. Never claim a visual, edit-mode, interruption, portable, reduced-motion, stress, or performance check passed unless it was actually performed. Clearly separate automated checks, manual checks, and checks still needed.',
      '',
      '## Handoff',
      '',
      'When finished, report:',
      '',
      '- files created or changed;',
      '- final slug and category;',
      '- controls, config keys, defaults, ranges, and units;',
      '- rendering technique, maximum animated pixels/elements, frame scheduling, caching strategy, and maker-update strategy;',
      '- reference transitions and why they were selected;',
      '- automated tests and manual checks actually completed;',
      '- anything the user should visually check in maker preview, editor preview, player, rapid navigation, or portable export;',
      '- known limitations.',
      '',
      `Start by inspecting the repository, then implement **${name}** completely.`
    ].join('\n');
  }

  function buildTransitionImprovementPrompt(input = {}) {
    const engine = slugify(input.engine || input.name || 'existing-transition');
    const displayName = clean(input.name, engine.split('-').map(part => (
      part.charAt(0).toUpperCase() + part.slice(1)
    )).join(' '));
    const category = clean(input.category, 'Unknown');
    const makerPath = clean(input.maker, `transitions/${engine}-maker.html`);
    const enginePath = clean(input.engineFile, `transitions/${engine}-engine.js`);
    const status = clean(input.status, 'available');
    const warnings = Array.isArray(input.warnings)
      ? input.warnings.map(warning => clean(warning)).filter(Boolean)
      : [];
    const accessibility = input.reducedMotion !== false;

    return [
      `# Improve the existing Movement transition: ${displayName}`,
      '',
      'Work inside this Movement Timeline Studio repository. Improve the existing transition in place, integrate the change, and verify it. Do not return only sample code or a design proposal, and do not create a second transition as a shortcut.',
      '',
      '## Existing transition identity',
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
      `- **Desired result:** ${clean(input.description, 'Refine the transition while preserving its established purpose.')}`,
      `- **What must remain unchanged:** ${clean(input.preserve, 'Preserve the transition identity, its working choreography, and existing saved configurations.')}`,
      hasImprovementArea(input, 'repair')
        ? `- **How to observe the problem:** ${clean(input.reproduction, 'Inspect the maker, editor preview, player, rapid navigation, and existing tests to identify the current limitation.')}`
        : '',
      `- **Additional requirements:** ${clean(input.specialRequirements, 'None supplied.')}`,
      '',
      '## Required repository discovery',
      '',
      'This task is for a repository-aware coding assistant. Confirm that you can read and edit the project folder, then inspect before changing anything:',
      '',
      '1. Read `docs/TRANSITION_AUTHORING_CONTRACT.md` and `docs/ANIMATION_PERFORMANCE_BUDGET.md` completely.',
      `2. Read the complete current \`${makerPath}\` and \`${enginePath}\` files, including defaults, config keys, preview/replay behavior, exact-once completion, failsafe, and cleanup.`,
      '3. Read the target registry entry, transition invocation in `studio/player/player-runtime.js`, Transitions Hub and editor integration, and portable engine inlining.',
      `4. Find every existing test and saved-flow fixture that refers to \`${engine}\`. Record the current config shape and behavior before editing.`,
      '5. Inspect Git status and preserve unrelated personal work. Do not rewrite neighboring transitions or registry categories.',
      '',
      '## Compatibility requirements',
      '',
      `- Keep the engine slug \`${engine}\`, maker path \`${makerPath}\`, engine path \`${enginePath}\`, and registry placement stable.`,
      '- Existing `flow.json` definitions must continue working without manual repair. Preserve existing config keys and meanings. New keys must be optional and have safe fallbacks.',
      '- If a key truly must be renamed or removed, retain a compatibility alias or normalization path and behaviorally test both the old and new configuration.',
      '- Keep maker defaults identical to engine fallbacks. Edit mode must restore every old and new value.',
      '- Every added control needs a stable config key, validated range, maker export and edit restoration, and a fallback that preserves the previous choreography when older saved definitions omit it.',
      '- Preserve the existing `runTransition({ root, outgoing, incoming, config, duration, onComplete })` integration and portable-player support.',
      '- Improve the current implementation in place. Avoid wholesale replacement when a focused change is safer and clearer.',
      '',
      '## Implementation and safety requirements',
      '',
      '- Keep controls understandable and creative. Place every explicitly requested control visibly in its most logical existing group. Never hide it in Advanced merely because the maker already has many controls. Reserve Advanced for genuinely optional, rarely used, or technical controls, and keep the shared maker scrolling behavior intact.',
      '- Route every normal completion, failsafe, interruption, and early abort through one guarded finish path. Call `onComplete` exactly once.',
      '- Return an idempotent finish/abort function and remove every listener, timer, animation frame, temporary element, class, CSS property, and inline style created by the transition.',
      '- Leave the incoming slide visible and outgoing/incoming layers clean after completion or interruption.',
      '- Prefer compositor-friendly `transform` and `opacity`. Keep clones, panels, masks, filters, shadows, and temporary layers strictly bounded; avoid layout animation and interleaved layout reads/writes.',
      '- If canvas is required, cap animated pixels at 2,073,600, cache unchanged media, and never copy unchecked natural dimensions or device-pixel ratio.',
      '- Maker input must not create overlapping replay work or rebuild expensive surfaces for every raw slider event.',
      '- Do not use remote dependencies, absolute computer paths, `eval`, mutable global state, or unrelated file changes.',
      accessibility
        ? '- Preserve or add a shorter, calmer reduced-motion form that still completes exactly once.'
        : '- Do not remove reduced-motion behavior that the transition already provides.',
      '',
      '## Verification',
      '',
      '1. Compare the before-and-after maker preview and confirm the requested change is visible without losing established choreography.',
      '2. Export a definition from the maker, reload an older saved definition in edit mode, and verify every value survives.',
      '3. Verify editor preview and the full player complete exactly once and leave clean slide layers.',
      '4. Verify failsafe completion, early abort, rapid Replay, rapid navigation, and repeated use do not leave hidden or transformed slides or leaked work.',
      '5. Verify the portable offline player includes and runs the same engine with no network dependency.',
      '6. Update or add focused automated tests for changed behavior, backward-compatible normalization, exact-once completion, failsafe, cleanup, bounded temporary work, edit restoration, and portable inclusion.',
      '7. When possible, stress the real Chromium/Electron renderer at maximum controls with rapid replay and navigation while other effects are active. Mock animation tests do not prove visual correctness or performance.',
      '8. Clearly separate automated checks, manual visual checks, and checks that could not be performed. Never claim an unavailable check passed.',
      '',
      '## Handoff',
      '',
      'Report the exact files changed, the previous and new behavior, config compatibility decisions, controls affected, completion and cleanup strategy, performance limits, tests actually run, manual checks still needed, and any known limitation.',
      '',
      `Start by inspecting the existing \`${engine}\` transition, then implement only the requested improvement.`
    ].join('\n');
  }

  return Object.freeze({
    PARAMETER_GROUPS,
    PARAMETER_INDEX,
    IMPROVEMENT_AREAS,
    buildTransitionPrompt,
    buildTransitionImprovementPrompt,
    slugify
  });
});
