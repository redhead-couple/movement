# Building Engines: Movement Expression Tools

Welcome to the **Effects & Transitions** contributor guide.

Movement is built to be a canvas for creative coding. Instead of hardcoding every visual flourish into a monolithic player, Movement uses a **Plugin Engine Architecture**.

There are two types of plugins you can build:
1. **Effect Engines (HTML Canvas)** — Persistent visual filters or generative art applied over the duration of a slide.
2. **Transition Engines (CSS/DOM)** — Specialized choreographies for moving from one slide to the next.

Both systems are completely decoupled from the PHP backend. You only need to know standard JavaScript to contribute.

---

## 1. The Effect Engine Standard (Canvas)

An effect engine takes over a `<canvas>` element for the duration of a slide. It is responsible for its own rendering loop and must clean up after itself when the slide ends.

### The Contract
Create a file at `effects/your-effect-engine.js`. It must `export function mount(canvas, ctx, config)`. It must return a **cleanup function**.

### The Skeleton Template
```javascript
export function mount(canvas, ctx, config) {
    let active = true;
    let animationId = null;

    // 1. Merge default config with user config
    const cfg = {
        speed: 1,
        color: '#ffffff',
        ...config
    };

    // 2. Setup (Load images, set canvas size)
    canvas.width = 800; // Or dynamically size
    canvas.height = 600;

    // 3. The Animation Loop
    function loop() {
        if (!active) return;

        // Draw to the ctx here...

        animationId = requestAnimationFrame(loop);
    }

    // 4. Start the loop
    animationId = requestAnimationFrame(loop);

    // 5. The Return Promise (The Cleanup Function)
    // The player will call this when the slide ends. You MUST halt your loop.
    return () => {
        active = false;
        cancelAnimationFrame(animationId);
    };
}
```

### Golden Rules for Effect Engines:
- **Never mutate global state.** Only mutate what is given to you on the `ctx` or `canvas`.
- **Preload assets safely.** If your effect requires an external image, wait for it to load before drawing.
- **Fail gracefully.** If a user provides invalid config data (e.g. `speed: "fast"` instead of `1`), fallback to a sane default.

---

## 2. The Transition Engine Standard (DOM)

A transition engine manipulates the `outgoing` (previous) and `incoming` (next) slide DOM elements. It uses CSS transitions or Web Animations API to choreograph their movement.

### The Contract
Create a file at `transitions/your-transition-engine.js`. It must `export function runTransition({ ... })`. It must call the provided **onComplete** callback exactly once.

### The Skeleton Template
```javascript
export function runTransition({ root, outgoing, incoming, config = {}, duration = 1, onComplete }) {
    let done = false;
    let fallbackTimer = null;

    // 1. Merge defaults
    const cfg = {
        direction: 'left',
        ...config
    };

    // Ensure duration has a sane minimum
    const seconds = Math.max(0.1, Number(duration) || 1);

    // 2. Setup initial DOM state
    incoming.style.zIndex = '2';
    outgoing.style.zIndex = '1';
    incoming.style.opacity = '1';

    // Set your starting CSS (e.g. clip paths, transforms)
    incoming.style.transform = `translateX(100%)`;

    // 3. The Cleanup & Callback function
    const finish = () => {
        if (done) return;
        done = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);

        // Always strip the inline styles you added so the player stays clean
        incoming.style.transform = '';
        incoming.style.transition = '';
        outgoing.style.transition = '';

        // You MUST call onComplete exactly once to yield control back to the player
        if (typeof onComplete === 'function') onComplete();
    };

    // 4. Trigger the transition
    void incoming.offsetWidth; // Force DOM reflow

    // Add event listeners for natural completion
    incoming.addEventListener('transitionend', (e) => {
        if (e.target === incoming) finish();
    }, { once: true });

    // Failsafe timer (always set a timer slightly longer than the duration)
    fallbackTimer = setTimeout(finish, (seconds * 1000) + 150);

    // Start the CSS animation
    requestAnimationFrame(() => {
        incoming.style.transition = `transform ${seconds}s ease`;
        incoming.style.transform = `translateX(0)`;
    });

    // Return the finish function so the player can abort early if needed
    return finish;
}
```

### Golden Rules for Transition Engines:
- **Always clean up your inline styles.** If you set `transform` or `opacity`, wipe it in the `finish()` block.
- **Always set a failsafe timer.** `transitionend` events occasionally drop in modern browsers if tabs are backgrounded. A `setTimeout` guarantees the transition won't hang the player infinitely.
- **You are manipulating siblings.** `incoming` and `outgoing` are DOM siblings inside `root`. Use `zIndex` to control which is on top.

---

## 3. Registering Your Plugin in the Editor

Once your JS engine works, you need to expose a GUI for the user so they can configure it in the editor.

1. **Build a Maker HTML:** Create `effects/my-engine-maker.html` (see any existing `effects/*-maker.html` for reference). Include `<base href="../">` so shared maker resources and project-relative media resolve from the application root. This is a simple form that constructs the JSON config block your engine requires.
2. **Register it in the Hub:** Add the engine slug to `effects/registry.json` or `transitions/registry.json`; the matching Hub constructs the maker path from that registry entry.

The JSON you generate in your maker will automatically be passed into your engine's `config` argument during playback!
