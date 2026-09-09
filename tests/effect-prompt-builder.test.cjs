const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PARAMETER_GROUPS,
  PARAMETER_INDEX,
  IMPROVEMENT_AREAS,
  buildEffectPrompt,
  buildEffectImprovementPrompt,
  slugify
} = require('../studio/authoring/effect-prompt-template.js');

const applicationRoot = path.resolve(__dirname, '..');

function read(filename) {
  return fs.readFileSync(path.join(applicationRoot, filename), 'utf8');
}

test('effect prompt template exposes broad creative controls without technical fields', () => {
  assert.ok(PARAMETER_GROUPS.length >= 4);
  assert.ok(Object.keys(PARAMETER_INDEX).length >= 20);
  assert.equal(PARAMETER_INDEX.opacity.label, 'Transparency');
  assert.equal(PARAMETER_INDEX.backgroundImage.key, 'imgSrc');
  assert.equal(slugify('  Floating Embers!  '), 'floating-embers');
});

test('effect improvement prompt preserves identity and saved configurations', () => {
  const prompt = buildEffectImprovementPrompt({
    name: 'Scattered Idea',
    engine: 'scattered-idea',
    maker: 'effects/scattered-idea-maker.html',
    engineFile: 'effects/scattered-idea-engine.js',
    category: 'Experimental',
    status: 'needs-attention',
    warnings: ['Maker preview needs repair.'],
    improvementAreas: ['appearance', 'repair', 'performance'],
    description: 'Make the pieces leave more naturally and prevent replay from slowing down.',
    preserve: 'Keep the existing controls and outward-scatter character.',
    reproduction: 'Replay five times in the maker.',
    reducedMotion: true
  });

  assert.equal(IMPROVEMENT_AREAS.repair, 'Fix a visible or functional problem');
  assert.match(prompt, /Improve the existing Movement effect: Scattered Idea/);
  assert.match(prompt, /effects\/scattered-idea-maker\.html/);
  assert.match(prompt, /Current registry status:\*\* needs-attention/);
  assert.match(prompt, /do not create a second effect/i);
  assert.match(prompt, /Existing `flow\.json` definitions must continue working/);
  assert.match(prompt, /compatibility alias or normalization path/);
  assert.match(prompt, /both background and foreground/);
  assert.match(prompt, /one scheduled frame per instance/);
  assert.match(prompt, /Replay five times in the maker/);
  assert.match(prompt, /portable offline player/);
  assert.match(prompt, /createEffectImage/);
  assert.match(prompt, /Never call `new Image\(\)`/);
  assert.match(prompt, /runtime-only `preloadedImages`/);
  assert.doesNotMatch(prompt, /Create the effect engine at/);
  assert.doesNotMatch(prompt, /\bCodex\b/i);
});

test('control-only effect improvement includes control details without repair language', () => {
  const prompt = buildEffectImprovementPrompt({
    name: 'Zoom',
    engine: 'zoom',
    category: 'Cinematics',
    improvementAreas: ['controls'],
    description: 'Add one overall opacity control.',
    controlRequest: {
      name: 'Opacity',
      behavior: 'Change the transparency of the whole zoomed image.',
      defaultValue: '100%',
      range: '0-100%'
    },
    reducedMotion: true
  });

  assert.match(prompt, /Requested control change/);
  assert.match(prompt, /Control name or change:\*\* Opacity/);
  assert.match(prompt, /Desired behavior:\*\* Change the transparency/);
  assert.match(prompt, /Preferred default:\*\* 100%/);
  assert.match(prompt, /Range or choices:\*\* 0-100%/);
  assert.match(prompt, /fallback that preserves the previous appearance/);
  assert.match(prompt, /Place every explicitly requested control visibly in its most logical existing group/);
  assert.match(prompt, /Never hide it in Advanced merely because the maker already has many controls/);
  assert.doesNotMatch(prompt, /How to observe the problem/);
});

test('effect prompt combines a creative brief with the hidden repository contract', () => {
  const prompt = buildEffectPrompt({
    name: 'Floating Embers',
    description: 'Warm particles rise from the bottom and slowly disappear.',
    mood: 'Quiet warmth and memory.',
    visualStyle: 'Soft cinematic glow.',
    category: 'Experimental',
    parameters: [
      {
        id: 'primaryColor',
        defaultValue: '#ff9b63',
        range: '',
        notes: 'Allow warm colors'
      },
      {
        id: 'duration',
        defaultValue: '4 seconds',
        range: '1–12 seconds',
        notes: ''
      }
    ],
    reducedMotion: true
  });

  assert.match(prompt, /Build a Movement effect: Floating Embers/);
  assert.match(prompt, /effects\/floating-embers-engine\.js/);
  assert.match(prompt, /effects\/floating-embers-maker\.html/);
  assert.match(prompt, /<base href="\.\.\/">/);
  assert.match(prompt, /effects\/registry\.json/);
  assert.match(prompt, /both background images and foreground image layers/);
  assert.match(prompt, /docs\/EFFECT_AUTHORING_CONTRACT\.md/);
  assert.match(prompt, /export `mount\(canvas, ctx, config\)`/);
  assert.match(prompt, /MakerAPI/);
  assert.match(prompt, /Primary color.*#ff9b63/);
  assert.match(prompt, /Duration.*1–12 seconds/);
  assert.match(prompt, /portable offline player/);
  assert.match(prompt, /reduced-motion/);
  assert.match(prompt, /docs\/ANIMATION_PERFORMANCE_BUDGET\.md/);
  assert.match(prompt, /2,073,600 pixels/);
  assert.match(prompt, /Never copy unchecked image `naturalWidth`\/`naturalHeight`/);
  assert.match(prompt, /rasterize it once into a capped cached surface/);
  assert.match(prompt, /target 30 FPS/);
  assert.match(prompt, /hard normal maximum of 120 or fewer/);
  assert.match(prompt, /must not fully remount the engine.*every raw slider `input` event/);
  assert.match(prompt, /two simultaneous instances/);
  assert.match(prompt, /Mock\/no-op canvas tests do not prove performance/);
  assert.match(prompt, /Every explicitly requested control must remain visible in its most logical creative group/);
  assert.match(prompt, /Reserve Advanced for genuinely optional, rarely used, or technical controls/);
  assert.doesNotMatch(prompt, /requested count exceeds five.*remainder in a collapsed Advanced section/);
  assert.match(prompt, /repository-aware coding assistant/);
  assert.match(prompt, /Do not make the effect designer choose implementation details/);
  assert.doesNotMatch(prompt, /\bCodex\b/i);
});

test('prompt builder integrates with the desktop bridge and progressive interface', () => {
  const page = read(path.join('studio', 'authoring', 'effect-prompt-builder.html'));
  const preload = read('desktop/preload.cjs');
  const main = read('desktop/main.cjs');
  const library = read(path.join('shared', 'frontend', 'index.html'));
  const effectsHub = read(path.join('studio', 'hubs', 'effects-hub.html'));

  assert.match(page, /id="parameterGroups"/);
  assert.match(page, /href="\.\.\/\.\.\/assets\/app\.css"/);
  assert.match(page, /class="app-site-header"/);
  assert.match(page, /class="app-brand" id="builderHomeLink" href="\.\.\/\.\.\/"/);
  assert.match(page, /id="builderLibraryLink" href="\.\.\/\.\.\/dashboard\.php">My Library<\/a>/);
  assert.match(page, /class="app-nav__button app-nav__button--quiet" id="closeBtn"[^>]*hidden/);
  assert.match(page, /elements\.libraryLink\.hidden = Boolean\(api\)/);
  assert.match(page, /elements\.closeBtn\.hidden = !api/);
  assert.match(page, /id="selectedControls"/);
  assert.match(page, /transition-prompt-template\.js/);
  assert.doesNotMatch(page, /name="target"/);
  assert.doesNotMatch(page, /Where should it work\?/);
  assert.equal((page.match(/data-step-panel="/g) || []).length, 3);
  assert.match(page, /Imagine a new effect/);
  assert.match(page, /name="controlMode" value="automatic" checked/);
  assert.match(page, /name="taskMode" value="create" checked/);
  assert.match(page, /name="taskMode" value="improve"/);
  assert.match(page, /id="targetEngine"/);
  assert.match(page, /id="improvementAreas"/);
  assert.match(page, /id="controlRequestFields"[^>]*hidden/);
  assert.match(page, /id="controlRequestName"/);
  assert.match(page, /id="controlRequestBehavior"/);
  assert.match(page, /id="controlRequestDefault"/);
  assert.match(page, /id="controlRequestRange"/);
  assert.match(page, /id="reproductionField"[^>]*hidden/);
  assert.match(page, /areas\.includes\('controls'\)/);
  assert.match(page, /areas\.includes\('repair'\)/);
  assert.match(page, /buildEffectImprovementPrompt/);
  assert.match(page, /improvementInterface/);
  assert.match(page, /View technical details/);
  assert.match(page, /repository-aware coding assistant/);
  assert.doesNotMatch(page, /\bCodex\b/i);
  assert.match(page, /api\.listRegistries\(\)/);
  assert.match(page, /api\.copyGeneratedPrompt\(/);
  assert.match(page, /function copyPromptWithLegacyCommand\(prompt\)/);
  assert.match(page, /document\.execCommand\('copy'\)/);
  assert.match(page, /function preparePromptForManualCopy\(\)/);
  assert.match(page, /elements\.promptReveal\.open = true/);
  assert.match(page, /complete prompt is selected—press Ctrl\+C/);
  assert.doesNotMatch(page, /Clipboard access is unavailable\./);
  assert.match(page, /api\.saveGeneratedPrompt\(/);
  assert.match(preload, /runtime:open-effect-prompt-builder/);
  assert.match(preload, /prompt:copy/);
  assert.match(preload, /prompt:save/);
  assert.match(main, /EFFECT_PROMPT_BUILDER_PATH/);
  assert.match(main, /details\.improvementInterface/);
  assert.match(library, /id="effect-prompt-button"/);
  assert.match(library, /Design or improve effect/);
  assert.match(effectsHub, /id="createEffectPromptBtn"/);
  assert.match(effectsHub, /Create or improve effect/);
  assert.match(effectsHub, /movement-open-effect-prompt-builder/);
});

test('the canonical effect authoring contract documents lifecycle and portability', () => {
  const contract = read(path.join('docs', 'EFFECT_AUTHORING_CONTRACT.md'));
  assert.match(contract, /effects\/sample-effect-engine\.js/);
  assert.match(contract, /effects\/sample-effect-maker\.html/);
  assert.match(contract, /<base href="\.\.\/">/);
  assert.match(contract, /return \(\) =>/);
  assert.match(contract, /loadEditConfig/);
  assert.match(contract, /exported portable player/);
  assert.match(contract, /Never store an absolute path/);
  assert.match(contract, /ANIMATION_PERFORMANCE_BUDGET\.md/);
  assert.match(contract, /2,073,600 pixels/);
  assert.match(contract, /actual Chromium\/Electron worst-case stress check/);
  assert.match(contract, /effects\/effect-media\.js/);
  assert.match(contract, /createEffectImage/);
  assert.match(contract, /Do not call `new Image\(\)`/);
});
