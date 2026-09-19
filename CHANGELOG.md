# Changelog

Movement is maintained and published by Redhead Couple. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions and uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with numbered alpha
prereleases.

## 0.1.0-alpha.2 — Prepared locally, not yet published

### Added

- Windows Authoring Kit component ZIP export with explicit dependency/license
  declarations and matching source hashes.
- Package inspection showing format/host compatibility, required shared files,
  license text and existing-component conflicts without executing package code.
- Installation into a chosen registry category after explicit trust acknowledgement,
  with revalidation, no overwrite, Hub refresh and rollback on caught failures.
- Soft Glow: an image effect with glow-strength and pulse-speed controls.
- A creation-to-sharing guide covering authoring, registration, testing, reviews,
  licenses, hashes, export, inspection, installation and re-export.

### Fixed

- Include the unchanged repository `LICENSE` inside `resources/app/`, as required
  by component export, and reject Kit builds missing that notice.

### Scope and limitations

- This is a desktop pilot for trusted component code. Dependency/license review,
  matching hashes and structural inspection are not a security audit and do not
  certify code safety. The recipient must decide whether to trust executable code.
- No hosted installation, component updates, overwrite options or extra packaged
  assets. Crash/power-loss recovery remains manual. Windows builds remain unsigned.
- The published alpha.1 release and public download links remain unchanged.
  See [alpha.2 release notes](docs/RELEASE_NOTES_0.1.0-alpha.2.md).

## 0.1.0-alpha.1 — Public prerelease

**Movement Public Alpha 0.1** is published as
[GitHub prerelease `v0.1.0-alpha.1`](https://github.com/redhead-couple/movement/releases/tag/v0.1.0-alpha.1).
The public repository is
[redhead-couple/movement](https://github.com/redhead-couple/movement).

### Changed

- Aligned current public identity: Movement is the project/medium, Movement
  Timeline Studio is the desktop application, Early Formation is the website
  and umbrella brand, and Redhead Couple is the maintainer/publisher.
- Put the live experience and Windows x64 Authoring Kit first in the README,
  followed by Electron source development and advanced PHP/MySQL self-hosting.
- Aligned package and lockfile metadata to `0.1.0-alpha.1`; replaced obsolete
  repository destinations with the planned canonical URL.
- Corrected automated-test and dependency claims, documented the unsigned
  Windows Alpha, and clarified that the packaged kit has no `npm test` script.
- Distinguished the current 25 effects and 6 advanced transitions from the
  older catalog's partial coverage.
- Replaced enterprise-security and governance overclaims with Alpha wording.
  Source/documentation remain MIT-licensed; M05 media provenance facts and
  separate media permissions remain intact.
