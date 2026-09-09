# Contributing

Thank you for your interest in helping develop Movement, maintained by Redhead Couple.

This project explores a new expressive medium built from images, narration, sound, silence, text, timing, visual effects, transitions, and layered movement. The goal is to allow creators to develop and share reusable Expression Tools that communicate ideas, emotions, relationships, and abstract meaning.

## Contents

- [Quick Start for Contributors](#quick-start-for-contributors)
- [What You Can Contribute](#what-you-can-contribute)
- [Before You Begin](#before-you-begin)
- [Expression Tool Proposals](#expression-tool-proposals)
- [Contribution Lifecycle](#contribution-lifecycle)
- [Review Criteria](#review-criteria)
- [Testing Requirements](#testing-requirements)
- [Pull Request Expectations](#pull-request-expectations)
- [Review and Acceptance](#review-and-acceptance)
- [Proposing Removal or Deprecation](#proposing-removal-or-deprecation)
- [Conduct](#conduct)

---

## Quick Start for Contributors

The canonical destination is [redhead-couple/movement](https://github.com/redhead-couple/movement).
The public repository is not yet available. Once it is published, fork it and
use the following workflow. Existing source checkouts can start at step 2.

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/movement.git
cd movement

# 2. Set up Electron development with Node.js 22.12 or newer
npm ci
npm run desktop

# 3. Create a feature branch from the upstream default branch
git checkout -b feat/your-feature-name

# 4. Make your changes and run tests (the full suite also requires PHP)
npm test
# Review and stage only your intended public files before committing
git commit -m "feat: add new expression tool — ripple-fade"

# 5. Push and open a Pull Request against the upstream default branch
git push origin feat/your-feature-name
```

On Windows PowerShell, use `npm.cmd`. See [Desktop Development](docs/DESKTOP_DEVELOPMENT.md)
for source setup and verification. [Local Installation](docs/LOCAL_INSTALLATION.md)
remains the advanced PHP/MySQL self-hosting guide. Movement Timeline Studio /
Windows Authoring Kit is the supported local Alpha experience.

### Branching Convention

| Branch Pattern | Purpose |
|----------------|---------|
| `feat/<name>` | New features, effects, transitions |
| `fix/<name>` | Bug fixes |
| `docs/<name>` | Documentation changes |
| `refactor/<name>` | Code restructuring without behavior change |

### Commit Convention

Use concise, imperative-mood commit messages prefixed with a type:

```
feat: add iris-wipe transition engine
fix: correct rain-engine cleanup on resize
docs: update ENGINE_CATALOG with highlight params
refactor: extract CSRF validation into security-helpers
```

---

## What You Can Contribute

- **Visual effects** — new engines under `effects/` following the [Effect Authoring Contract](docs/EFFECT_AUTHORING_CONTRACT.md)
- **Transitions** — new engines under `transitions/` following the [Transition Authoring Contract](docs/TRANSITION_AUTHORING_CONTRACT.md)
- **Effect or transition makers** — browser-based configuration UIs stored beside their engines (for example, `effects/rain-maker.html`)
- **Documentation** — improvements to docs, README, inline comments
- **Bug fixes** — correctness, performance, or security repairs
- **Accessibility improvements** — keyboard navigation, screen reader support, contrast
- **Sample projects** — example slideshows demonstrating Expression Tools
- **Educational examples** — standalone runtime demonstrations (see `examples/`)
- **Editor or player improvements** — enhancements to `json-maker.php`, `studio/player/player-runtime.js`
- **Proposals for new forms of expression** — new categories of tools beyond effects and transitions

---

## Before You Begin

1. Read the project documentation, especially:
   - [docs/flow-schema.md](docs/flow-schema.md) — the `flow.json` schema specification
   - [Effect Authoring Contract](docs/EFFECT_AUTHORING_CONTRACT.md) and [Transition Authoring Contract](docs/TRANSITION_AUTHORING_CONTRACT.md) — current requirements
   - [effects registry](effects/registry.json) and [transitions registry](transitions/registry.json) — current inventory
   - [docs/ENGINE_CATALOG.md](docs/ENGINE_CATALOG.md) — partial parameter reference for older engines
   - [docs/EFFECTS_AND_TRANSITIONS.md](docs/EFFECTS_AND_TRANSITIONS.md) — documentation strategy
2. Search existing issues and pull requests to avoid duplicate work.
3. For small bug fixes or documentation corrections, a pull request may be opened directly.
4. For new effects, transitions, major features, or architectural changes, **open a proposal issue first.** This allows the idea to be discussed before significant development time is invested.

### Current State of Automated Testing

The full source checkout has a Node test suite (`npm test`) and PHP test scripts
under `tests/php/`. Some Node tests invoke PHP. Use PHP 8.0 or newer and the
extensions in the [installation guide](docs/LOCAL_INSTALLATION.md) for the
complete checks. [Desktop Development](docs/DESKTOP_DEVELOPMENT.md#validation)
records the commands and dated results. Automated checks complement the
[manual testing checklist](#testing-requirements); they do not replace visual
and playback verification.

---

## Expression Tool Proposals

A proposed effect or transition should explain:

- what the tool does
- what idea, feeling, relationship, or change it is intended to express
- why existing tools are insufficient
- whether it is an effect, transition, standalone tool, or another kind of contribution
- how a creator would control it (what parameters appear in the maker UI)
- a simple visual example or demonstration
- possible accessibility or performance concerns
- whether it uses external assets, code, fonts, or libraries

A contribution should have an expressive purpose beyond visual decoration.

For example:

- fading may express disappearance or weakening memory
- separation may be expressed by a visual barrier
- gradual illumination may express recognition
- unstable focus may express uncertainty

These meanings are examples rather than fixed definitions. Creators may discover other uses.

---

## Contribution Lifecycle

New Expression Tools pass through several stages. These stages are tracked via GitHub issue labels.

### `status: proposed`

The idea is being discussed. No code has been accepted.

### `status: experimental`

The tool works well enough to test, but it is not yet part of the official library. Experimental tools may change significantly and may contain limitations.

### `status: candidate`

The tool has been reviewed, documented, tested in real projects, and is being considered for the official library.

### `status: official`

The tool has been accepted into the maintained library and follows the project's technical, documentation, quality, and licensing requirements.

### `status: deprecated`

A tool may be deprecated or archived when it is no longer maintained, duplicates another tool, causes technical problems, or is no longer compatible with the current project.

Archived tools should remain accessible when practical so earlier projects can still be understood.

---

## Review Criteria

### Expressive value

- Does it help communicate a recognizable idea, emotion, relationship, or transformation?
- Does it offer something meaningfully different from the current 25 registered effects and 6 registered advanced transitions?
- Can creators use it in more than one narrow situation?

### Technical quality

- Does it follow the current [Effect Authoring Contract](docs/EFFECT_AUTHORING_CONTRACT.md) or [Transition Authoring Contract](docs/TRANSITION_AUTHORING_CONTRACT.md), as applicable?
- Does it clean up animation loops, timers, event listeners, and temporary styles?
- Does it behave correctly when resized, interrupted, or replayed?
- Does it fail safely (no uncaught exceptions that break the player)?
- Does it work in the web platform, desktop application, and portable player where applicable?
- Does it avoid unnecessary performance costs?

### Creator experience

- Is the maker UI understandable?
- Are controls clearly named with descriptive labels?
- Are default values useful and produce a visible result?
- Can a creator preview the result before adding it?
- Is the generated configuration valid `flow.json`?

### Documentation

The contribution should include:

- a description of its expressive purpose
- registration in `effects/registry.json` or `transitions/registry.json`
- configuration parameters with types and ranges
- default values
- a working example
- known limitations
- screenshots or a short demonstration when useful

### Safety and licensing

- The contribution must not include secrets, personal data, or private project content.
- Code and assets must be legally reusable under the project's license.
- Third-party material must be clearly identified with license information.
- Discuss new dependencies before adding them. The root package currently has
  zero direct runtime npm dependencies and two direct development dependencies:
  Electron 43.2.0 and electron-builder 26.15.3. Electron is bundled for desktop users.

---

## Testing Requirements

Before an effect or transition can become an official library tool, it should be tested across the following checklist:

- [ ] Simple technical test — does the engine start, run, and stop without errors?
- [ ] Use in a real slideshow with at least 3 slides
- [ ] Repeated playback — play the slideshow 3+ times without degradation
- [ ] Interruption — fast-forward, rewind, and skip slides during the effect
- [ ] Different slide durations (1s, 5s, 15s)
- [ ] Different screen sizes (mobile, tablet, desktop)
- [ ] Web playback via `player.php`
- [ ] Local playback via the Node.js editor
- [ ] Portable export via `export-project.php` — verify the engine is embedded in `player.html`
- [ ] Fallback behavior when the engine file cannot load

Reviewers may request changes before acceptance.

---

## Pull Request Expectations

A pull request should:

- explain what changed and why
- link to the related proposal issue (if applicable)
- include a testing checklist showing which items above were verified
- include documentation changes (registry, catalog, inline comments)
- avoid unrelated changes in the same PR
- preserve backward compatibility when practical — do not break existing `flow.json` files
- state any known limitations
- confirm that no private data, credentials, or user-created content is included

Maintainers may ask for revisions, additional testing, or a smaller scope.

---

## Proposing Removal or Deprecation

Before removing an official tool, open a public issue explaining:

- why removal is being considered
- whether the tool is broken, duplicated, unsafe, or unmaintained
- whether existing projects depend on it (check example slideshows)
- whether migration to an alternative tool is possible
- whether archiving is safer than deletion

Removal should be rare and should avoid breaking existing projects whenever practical.

---

## Review and Acceptance

Contributions are reviewed by project maintainers and, when helpful, by creators or technical reviewers familiar with the affected area.

A contribution may be:

- accepted
- accepted as experimental
- returned for changes
- postponed
- declined with an explanation

Declining a contribution does not mean the idea has no value. It may need more testing, clearer purpose, a different implementation, or a better place outside the official library.

---

## Conduct

All contributors must follow the project's [Code of Conduct](CODE_OF_CONDUCT.md).

Discussion should remain respectful, practical, and focused on improving the medium.
