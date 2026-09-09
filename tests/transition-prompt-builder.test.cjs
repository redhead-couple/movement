const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PARAMETER_GROUPS,
  PARAMETER_INDEX,
  IMPROVEMENT_AREAS,
  buildTransitionPrompt,
  buildTransitionImprovementPrompt,
  slugify
} = require('../studio/authoring/transition-prompt-template.js');

const applicationRoot = path.resolve(__dirname, '..');

function read(filename) {
  return fs.readFileSync(path.join(applicationRoot, filename), 'utf8');
}

test('transition prompt template exposes transition-specific creative controls', () => {
  assert.ok(PARAMETER_GROUPS.length >= 4);
  assert.ok(Object.keys(PARAMETER_INDEX).length >= 20);
  assert.equal(PARAMETER_INDEX.duration.key, 'duration');
  assert.equal(PARAMETER_INDEX.edgeSoftness.label, 'Edge softness');
  assert.equal(slugify('  Paper Fold Reveal!  '), 'paper-fold-reveal');
});

test('transition improvement prompt preserves identity, completion, and old configs', () => {
  const prompt = buildTransitionImprovementPrompt({
    name: 'Alternating Panels',
    engine: 'alternating-panels',
    maker: 'transitions/alternating-panels-maker.html',
    engineFile: 'transitions/alternating-panels-engine.js',
    category: 'Experimental',
    status: 'available',
    improvementAreas: ['appearance', 'controls', 'repair'],
    controlRequest: {
      name: 'Panel opacity',
      behavior: 'Fade panels as they leave.',
      defaultValue: '100%',
      range: '0-100%'
    },
    description: 'Make panel timing feel smoother and repair rapid replay.',
    preserve: 'Keep eight alternating panels as the default.',
    reproduction: 'Press Replay quickly three times.',
    reducedMotion: true
  });

  assert.equal(IMPROVEMENT_AREAS.appearance, 'Choreography or appearance');
  assert.match(prompt, /Improve the existing Movement transition: Alternating Panels/);
  assert.match(prompt, /transitions\/alternating-panels-engine\.js/);
  assert.match(prompt, /do not create a second transition/i);
  assert.match(prompt, /Existing `flow\.json` definitions must continue working/);
  assert.match(prompt, /runTransition\(\{ root, outgoing, incoming, config, duration, onComplete \}\)/);
  assert.match(prompt, /Call `onComplete` exactly once/);
  assert.match(prompt, /failsafe completion/);
  assert.match(prompt, /Control name or change:\*\* Panel opacity/);
  assert.match(prompt, /fallback that preserves the previous choreography/);
  assert.match(prompt, /Place every explicitly requested control visibly in its most logical existing group/);
  assert.match(prompt, /Never hide it in Advanced merely because the maker already has many controls/);
  assert.match(prompt, /portable offline player/);
  assert.doesNotMatch(prompt, /Create the engine at/);
  assert.doesNotMatch(prompt, /\bCodex\b/i);
});

test('non-repair transition improvement omits problem reproduction instructions', () => {
  const prompt = buildTransitionImprovementPrompt({
    name: 'Soft Wipe',
    engine: 'soft-wipe',
    improvementAreas: ['performance'],
    description: 'Make rapid navigation cleaner.'
  });
  assert.doesNotMatch(prompt, /How to observe the problem/);
  assert.doesNotMatch(prompt, /Requested control change/);
});

test('transition prompt combines the creative brief with the runtime contract', () => {
  const prompt = buildTransitionPrompt({
    name: 'Paper Fold Reveal',
    description: 'The outgoing slide folds left and reveals the incoming slide behind it.',
    mood: 'Tactile and calm.',
    visualStyle: 'Clean paper geometry.',
    category: 'Experimental',
    parameters: [{
      id: 'duration',
      defaultValue: '0.9 seconds',
      range: '0.3–2 seconds',
      notes: ''
    }],
    reducedMotion: true
  });

  assert.match(prompt, /Build a Movement transition: Paper Fold Reveal/);
  assert.match(prompt, /transitions\/paper-fold-reveal-engine\.js/);
  assert.match(prompt, /transitions\/paper-fold-reveal-maker\.html/);
  assert.match(prompt, /transitions\/registry\.json/);
  assert.match(prompt, /docs\/TRANSITION_AUTHORING_CONTRACT\.md/);
  assert.match(prompt, /runTransition\(\{ root, outgoing, incoming, config, duration, onComplete \}\)/);
  assert.match(prompt, /onComplete` exactly once/);
  assert.match(prompt, /failsafe timer/);
  assert.match(prompt, /docs\/ANIMATION_PERFORMANCE_BUDGET\.md/);
  assert.match(prompt, /2,073,600 pixels/);
  assert.match(prompt, /never copy unchecked media dimensions/);
  assert.match(prompt, /Rasterize unchanged full-slide content once into a capped cached surface/);
  assert.match(prompt, /must not rebuild the transition.*every raw slider `input` event/);
  assert.match(prompt, /actual worst case was measured/);
  assert.match(prompt, /Mock animation or no-op drawing tests do not prove performance/);
  assert.match(prompt, /Every explicitly requested control must remain visible in its most logical creative group/);
  assert.match(prompt, /Reserve Advanced for genuinely optional, rarely used, or technical controls/);
  assert.doesNotMatch(prompt, /requested count exceeds five.*remainder in a collapsed Advanced section/);
  assert.match(prompt, /repository-aware coding assistant/);
  assert.match(prompt, /portable offline player/);
  assert.doesNotMatch(prompt, /\bCodex\b/i);
});

test('shared guided designer switches to transition registries and language', () => {
  const page = read(path.join('studio', 'authoring', 'effect-prompt-builder.html'));
  assert.match(page, /transition-prompt-template\.js/);
  assert.match(page, /builderKind.*transition/s);
  assert.match(page, /MovementTransitionPrompt/);
  assert.match(page, /buildTransitionPrompt/);
  assert.match(page, /buildTransitionImprovementPrompt/);
  assert.match(page, /Improve something existing/);
  assert.match(page, /registryType:\s*'transitions'/);
  assert.match(page, /Imagine a new transition/);
  assert.match(page, /transition-prompt-builder/);
});

test('desktop and Transitions Hub expose the transition designer', () => {
  const main = read(path.join('desktop', 'main.cjs'));
  const preload = read(path.join('desktop', 'preload.cjs'));
  const adapter = read(path.join('shared', 'frontend', 'platform-adapter.js'));
  const library = read(path.join('shared', 'frontend', 'index.html'));
  const hub = read(path.join('studio', 'hubs', 'transitions-hub.html'));
  const editorLogic = read(path.join('studio', 'editor', 'json-maker-logic.js'));

  assert.match(main, /runtime:open-transition-prompt-builder/);
  assert.match(main, /createTransitionPromptBuilderWindow/);
  assert.match(preload, /openTransitionPromptBuilder/);
  assert.match(adapter, /openTransitionPromptBuilder/);
  assert.match(library, /id="transition-prompt-button"[^>]*>[\s\S]*Design or improve transition/);
  assert.match(hub, /id="createTransitionPromptBtn"[^>]*>Create or improve transition</);
  assert.match(hub, /movement-open-transition-prompt-builder/);
  assert.match(editorLogic, /event\.data\.type !== 'movement-open-transition-prompt-builder'/);
  assert.match(editorLogic, /DESKTOP_BRIDGE\.openTransitionPromptBuilder\(\)/);
});

test('canonical transition contract documents exact completion and cleanup', () => {
  const contract = read(path.join('docs', 'TRANSITION_AUTHORING_CONTRACT.md'));
  assert.match(contract, /transitions\/sample-transition-engine\.js/);
  assert.match(contract, /runTransition/);
  assert.match(contract, /onComplete` exactly once/);
  assert.match(contract, /failsafe timer/);
  assert.match(contract, /restore every inline style/);
  assert.match(contract, /exported portable player/);
  assert.match(contract, /ANIMATION_PERFORMANCE_BUDGET\.md/);
  assert.match(contract, /2,073,600 pixels/);
  assert.match(contract, /actual Chromium\/Electron worst-case stress check/);
});
