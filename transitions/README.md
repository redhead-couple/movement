# Advanced Transition Contract

Saved slides keep advanced transitions in `transitionDraft`. The player uses this object only when `enabled` is true; otherwise the existing simple string `transition` is used.

```json
{
  "version": 1,
  "enabled": true,
  "name": "Soft Wipe Transition",
  "engine": "soft-wipe",
  "maker": "transitions/soft-wipe-maker.html",
  "config": {
    "duration": 1,
    "easing": "ease"
  }
}
```

Runtime engines live beside their makers as `transitions/{engine}-engine.js` and export:

```js
export function runTransition({ root, outgoing, incoming, config, duration, onComplete }) {}
```

Every engine must call `onComplete()` exactly once, clean up inline animation styles, and tolerate missing or partial config values. If an engine fails to load or throws, the player falls back to `fade`.
