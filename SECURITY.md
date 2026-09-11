# Security Policy

Thank you for helping improve the security of Movement, maintained by Redhead Couple. This is an early-stage open-source alpha: the PHP web application and its browser editor, Movement Timeline Studio desktop application, and exported portable player are all still evolving. Please report suspected security problems privately so they can be investigated without putting users or their projects at additional risk.

## Supported Versions

| Version | Supported |
| --- | --- |
| Current development source / latest published alpha | ✅ Yes |
| Older releases or tags | ❌ No |

Security updates target current development source and the latest published
alpha. Maintainers may ask reporters to confirm an issue against that
version before investigating further.

The application version is recorded in `package.json`. Movement Public Alpha 0.1,
version `0.1.0-alpha.1`, is available as
[prerelease `v0.1.0-alpha.1`](https://github.com/redhead-couple/movement/releases/tag/v0.1.0-alpha.1).
See [CHANGELOG.md](CHANGELOG.md) for the release notes.

## Reporting a Vulnerability

Report suspected vulnerabilities through
[GitHub Private Vulnerability Reporting](https://github.com/redhead-couple/movement/security/advisories/new),
which is enabled for the public repository and is the preferred reporting route.

For private reporting by email or if GitHub reporting is unavailable, contact:

**[contact@redhead-couple.org](mailto:contact@redhead-couple.org)**

This mailbox remains the private fallback. Redhead Couple is
currently a single-maintainer project; the maintainer actively monitors this
mailbox and reviews security reports. There is no separate security team.

Do not disclose suspected vulnerabilities in public GitHub issues, public
discussions, public contact threads, public pull requests, social media, or
other public channels. Use GitHub's private reporting form or the private
email channel above.

Please include, when available:

- A clear description of the issue.
- The affected files, endpoints, operating mode (PHP web app / Movement Timeline Studio / portable player), and the commit SHA or version.
- The minimum steps needed to reproduce it safely.
- The potential impact and the security boundary that is crossed.
- Proof-of-concept material, when it can be shared safely.
- A suggested mitigation, if available.
- Whether the issue has already been disclosed elsewhere or reported to another party.

Do not include credentials, private user data, copyrighted media, or unrelated personal information. Redact secrets from logs, screenshots, exported ZIP files, `flow.json` files, and configuration samples.

## What Happens After a Report

The maintainer aims to meet the following response targets; these are not
guarantees:

- Acknowledge receipt within **3 business days**.
- Provide an initial assessment within **7 business days**.
- Send periodic updates while the issue is being investigated.
- After a repair or mitigation is available, discuss a coordinated public disclosure date with the reporter.

Actual timing may vary with severity, complexity, maintainer availability, and the need to coordinate with dependencies or hosting providers. An initial assessment is not a promise that a report will be accepted or repaired within seven days.

## Security Scope

Security reports are welcome for code and project-controlled behavior in all three operating modes: the authenticated PHP web application, Movement Timeline Studio / Windows Authoring Kit, and the exported portable player.

Relevant areas include:

### Authentication & Authorization
- Password handling (`password_hash()`/`password_verify()` in `signup.php`, `login.php`)
- Login throttling (`login_attempts` table, rate-limiting logic)
- Session management and access control (`server/core/auth-check.php`, `server/core/current-user.php`)
- Project ownership boundaries under `private-data/slidedeck/<username>/<project>/`

### CSRF & Request Integrity
- CSRF protection via `validateFormGuard()` in `server/core/security-helpers.php`
- State-changing endpoints: `create-project.php`, `delete-project.php`, `rename-project.php`, `duplicate-project.php`, `publish-project.php`, `contact.php`, `change-password.php`

### File System & Uploads
- Image, foreground, speech, narration, and audio upload validation (`project-media.php`)
- Path traversal protection in `export-project.php`, `restore-flow.php`, `server/core/project-paths.php`
- User-created project files under `private-data/slidedeck/`, including `flow.json`, backups, and media paths

### Editor & Player
- `json-maker.php`, `studio/editor/json-maker-logic.js`, and the browser editor's save and media operations
- Publishing state, public/private access decisions, `player.php`, `studio/player/player-runtime.js`
- Dynamic effect and transition engine loading, execution, and offline export embedding

### Desktop Application
- Electron IPC/preload boundaries and the protected platform adapter
- Workspace, registry, project-media, save, and export operations

### Offline Export
- ZIP creation (`export-project.php`), bundled project data, embedded player code
- Offline playback in extracted `player.html`

### Configuration & Secrets
- `server/core/app-config.php` (database and admin credentials — must never be committed)
- `server/core/db.php` (PDO connection singleton)
- `server/core/app-init.php` (error display suppression: `display_errors=0`)
- Error handling and secret exposure in production

## Known Remediated Vulnerabilities

The following security issues were identified and remediated during the open-source readiness assessment:

| ID | Description | Status |
|----|-------------|--------|
| S-01 | Production error display was enabled, potentially exposing credentials and stack traces | ✅ Fixed — `display_errors` set to `0` in `server/core/app-init.php` |
| S-02 | State-changing actions (logout, delete, rename, publish) used GET requests without CSRF protection | ✅ Fixed — converted to POST with `validateFormGuard()` |
| S-03 | Contact form lacked CSRF token validation | ✅ Fixed — added `validateFormGuard()` with honeypot and timing checks |

## Examples of Relevant Reports

Examples include, but are not limited to:

- Authentication bypass
- Unauthorized access to or modification of another user's projects
- Cross-site request forgery on a state-changing action
- SQL injection
- Cross-site scripting in the editor, player, dashboard, or project metadata
- Path traversal or access outside an intended project or application directory
- Unsafe file upload or media-serving behavior
- Remote code execution
- Exposure of credentials, private project data, `flow.json` content, backups, or private media
- Privilege escalation
- Public/private publishing behavior that does not enforce the intended access decision
- Unsafe loading or bundling of effect or transition engine code

These examples describe report categories; they do not state that any particular vulnerability currently exists.

## Out of Scope

Unless the maintainers give prior written permission, the following are out of scope:

- Social engineering or phishing
- Denial-of-service testing that could disrupt a site or other users
- Automated high-volume scanning
- Physical attacks
- Attacks requiring access to a maintainer's private computer or already-compromised development environment
- Reports that affect only outdated, unsupported releases and cannot be reproduced on `main`
- Purely theoretical concerns without meaningful security impact or a plausible security boundary
- Spam, content disputes, copyright disputes, feature requests, and general product bugs without security impact
- Vulnerabilities entirely within third-party services or dependencies outside this repository, unless this project's integration creates the risk

Movement Timeline Studio / Windows Authoring Kit is the supported local Alpha experience. A standalone Node/browser authoring server is not distributed or supported.

## Responsible Testing

When researching this project:

- Use your own test accounts, test projects, and non-sensitive media.
- Do not access or modify another person's account, projects, backups, or data.
- Do not download private media or retain data that is not yours.
- Avoid destructive testing and do not delete or corrupt data.
- Do not disrupt a public website or degrade service for others.
- Stop testing if you encounter credentials, private information, or unexpected personal data.
- Delete any data collected unintentionally and explain the encounter in your private report without reproducing the data.
- Provide enough redacted information for maintainers to reproduce the issue safely.

If a test could affect a live deployment, other users, or data you do not own, contact the maintainers and obtain permission before continuing.

## Coordinated Disclosure

The reporter and maintainer should agree on public disclosure after:

- The issue has been confirmed.
- A repair or reasonable mitigation is available.
- Users have had a reasonable opportunity to update or apply the mitigation.

The disclosure date may change if investigation reveals additional affected areas or if releasing details would create disproportionate risk. Credit will be discussed with the reporter and will not be given when anonymity is requested. This project does not currently promise monetary rewards or operate a bug bounty program.

## Safe Harbor

The maintainers intend not to pursue action against researchers who follow this policy, act in good faith, avoid harm and disruption, respect privacy, report issues promptly, and allow a reasonable time for repair before disclosure.

This is a statement of project intent, not formal legal advice or an unconditional legal guarantee. It does not authorize activity against third-party systems or excuse violations of applicable law, contracts, or the rights of others. If you are uncertain whether planned testing is safe and permitted, contact the maintainers before proceeding.

## Deployment Responsibilities

This project is self-hosted software, and each operator is responsible for reviewing and securing their deployment. At a minimum, operators should:

- Use HTTPS for any non-local deployment.
- Keep `server/core/app-config.php` private and outside public source control (already covered by `.gitignore`).
- Use strong, unique, least-privilege database credentials in `server/core/app-config.php`.
- Verify that `display_errors` remains `0` in production (enforced by `server/core/app-init.php`).
- Apply restrictive filesystem ownership and permissions, granting write access only to `private-data/` and the system temp directory.
- Keep PHP, Node.js, the web server, the database server, and the operating system updated.
- Prevent `private-data/`, project backups, `flow.json` files, and user media from entering the public Git repository.
- Review session cookie settings, web-server routing, static-file access, and upload limits before exposing the application publicly.
- Treat offline exports as copies of the project's content and media; review them before sharing.

The configuration template (`server/core/app-config.example.php`) contains example values, not production security defaults.

## Security Updates

Security-related releases and notices will be published at:

- **Repository:** [github.com/redhead-couple/movement](https://github.com/redhead-couple/movement)
- **Advisories:** [GitHub Security Advisories](https://github.com/redhead-couple/movement/security/advisories) or release notes in [CHANGELOG.md](CHANGELOG.md)

Security fixes may be described at a high level until users have had a reasonable opportunity to update. Older releases are not expected to receive backported fixes during the alpha stage.

## Contact

For private security reports and questions about permitted testing, contact:

**[contact@redhead-couple.org](mailto:contact@redhead-couple.org)**

For ordinary project questions, use the
[website contact form](https://redhead-couple.org/contact.php). The general
contact form is not the primary security-reporting channel.
