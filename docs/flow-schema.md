# Movement: `flow.json` Schema V2

This document describes the `flow.json` schema v2 used to serialize and load slideshow content across Movement.

## Architectural Duality: Builder Export vs Runtime Hydration

The `flow.json` schema operates under strict normalization principles. The authoring environment (`studio/editor/json-maker-logic.js`) builds the payload, and the shared runtime (`studio/player/player-runtime.js`) normalizes it upon parsing.

### Asset Pathing Rule
- **Builder Export:** Must use strictly relative paths or localized absolute paths. Media assets generated specifically for a project should assume an `img/`, `audio/`, or `speech/` prefix structure whenever possible, but this is conventionally mapped dynamically.
- **Runtime Hydration:** The runtime normalizer intercept checks if paths are fully qualified (`http://`, `data:`, `blob:`, or root `/`). If a path is localized (e.g., `img/bg.jpg`), it automatically prepends `PROJECT_BASE` or structural offsets defined in `PLAYER_BOOTSTRAP`.

---

## Schema V2 Specification

The following TypeScript syntax defines the strictly enforced data structures of the V2 schema.

```typescript
interface FlowSchemaV2 {
    /** Reserved identifier enforcing the version parser. Must be `2` for V2 runtime. */
    schemaVersion: 2;

    /** Global slideshow title */
    title: string;

    /** Optional short summary of the presentation */
    description?: string;

    /** Universal visibility boolean flag for global feed routing */
    isPublished?: boolean;

    /** Default duration in seconds to assign unconfigured slides */
    defaultBeatSeconds?: number;

    /** Optional opening splash screen image path */
    openingImage?: string;

    /** Array of ambient global audio loops to play beneath the presentation */
    globalAudioLayers: GlobalAudioLayer[];

    /** Array of sequential slide configurations */
    slides: Slide[];
}
```

### Slides

```typescript
interface Slide {
    /** The rich-text or plaintext body for the slide's caption/content */
    text: string;

    /** The duration of the slide in seconds */
    seconds: number;

    /** Fallback string identifier for the transition type */
    transition: string;

    /** The definitive Advanced Transition configuration object */
    transitionDraft: TransitionDraft | null;

    /** Background rendering plane */
    background: BackgroundPlane;

    /** Stacked layers for visual effects and static overlays */
    foregroundLayers: ForegroundPlane[];

    /** Slide-specific audio clips triggered when the slide becomes active */
    audioLayers: AudioLayer[];
}
```

### Visual Rendering Planes

```typescript
interface BackgroundPlane {
    /** URI for the background image asset. */
    src: string | null;

    /** Base effect engine applied to the background */
    effect: EngineConfiguration | null;
}

interface ForegroundPlane {
    /** Developer-defined name of the foreground layer */
    name: string;

    /** Overlay or effect image asset */
    src: string | null;

    /** Dedicated effect engine attached to this foreground canvas */
    effect: EngineConfiguration | null;
}
```

### Engine Configuration API

```typescript
interface EngineConfiguration {
    /** File-base name of the engine executing this effect (e.g., "zoom") */
    engine: string;

    /** An arbitrary dictionary of parameters mapped to the specific engine */
    config: Record<string, any>;
}
```

### Audio Layers

```typescript
interface AudioLayer {
    /** Reference name for the clip */
    name: string;

    /** The URI of the audio file */
    src: string | null;

    /** Volume intensity mapping from `0.0` to `1.0` */
    volume: number;
}

interface GlobalAudioLayer extends AudioLayer {
    /** If true, the loop applies to all slides. Automatically injected */
    allSlides?: boolean;

    /** Index (1-based) slide to begin playing this audio. Default 1 */
    startSlide?: number;

    /** Optional index to truncate playback. */
    endSlide?: number;

    /** True to loop endlessly, false to play once. Default true */
    loop?: boolean;
}
```

### Transition Drafts

The V2 schema abstracts advanced custom transitions off the legacy `transition` string variable into a robust schema format.

```typescript
interface TransitionDraft {
    /** Draft schema version */
    version: number;

    /** Whether the draft is active, or the system should use the fallback string */
    enabled: boolean;

    name: string;

    /** Target path string routing to transitions/ (e.g. "soft-wipe") */
    engine: string;

    direction: 'left' | 'right' | 'up' | 'down' | string;
    duration: number;
    easing: string;
    intensity: number;

    /** Additional dynamic configurations per engine */
    [key: string]: any;
}
```

---

## Migration Matrix: Schema V1 → Schema V2

If maintaining legacy systems or writing converters, observe these property transformations:

| Legacy Field (v1) | Shared Runtime Field (v2) | Migration Note |
|---|---|---|
| `slide.bgEffect` | `slide.background.effect` | Map engine configs directly. |
| `slide.background` (string) | `slide.background.src` (string) | Convert root string properties into object properties. |
| `slide.fgEffect` | `slide.foregroundLayers[0].effect` | Array hydration required. |
| `slide.foreground` (string) | `slide.foregroundLayers[0].src` (string) | Array hydration required. |
| `slide.speech` (string) | `slide.audioLayers[0].src` (string) | Audio is now an array structure. |
| N/A | `slide.transitionDraft` | Advanced configs replace raw strings. |
