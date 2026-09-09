# Operating Modes and Terminology

Use the names in this document when describing where code runs. Avoid using
`online` or `offline` by itself: both words can refer to more than one part of
the project.

## Public identity

- **Movement** is the project and expressive medium.
- **Movement Timeline Studio** is the desktop application; **Movement** may
  also be used as its short name where the context is clear.
- **Early Formation** is the website and umbrella brand.
- **Redhead Couple** is the public maintainer and publisher.

Ezra Platform is a retired project name found in historical records. Media
creator credits identify who actually created the assets and remain separate
from this public naming hierarchy. Internal application IDs, protocols, storage
keys, package identifiers, and existing workspace paths retain their current
names for compatibility.

## Runtime environments

| Name | Meaning | Primary code |
|---|---|---|
| **Web platform** (`web`) | The hosted, multi-user PHP application. It requires PHP, a database, and a web server. | Root PHP entry points, `server/`, and `templates/` |
| **Desktop application** (`desktop`) | The installed Electron authoring application. It runs without PHP, a database, or internet access. | `desktop/` and the desktop entries selected by `package.json` |
| **Portable player** (`portable-player`) | A self-contained exported slideshow opened in a browser. It is for playback, not authoring. | Generated `player.html`, `flow.json`, and project media folders |

## Shared code

`shared` is a code-ownership label, not another runtime environment. Code in
`studio/`, `effects/`, and `transitions/` is reused across multiple environments.
Keep shared behavior in one implementation instead of creating separate
"online" and "offline" copies.

## Writing and naming rules

- Say **web platform**, not "online version."
- Say **desktop application**, not "offline editor."
- Use **Movement Timeline Studio / Windows Authoring Kit** for the supported local Alpha authoring experience.
- Say **portable player** or **portable export**, not "offline version."
- Use **offline** only as a capability statement, such as "the desktop
  application works offline."
- Existing code identifiers, branch names, and visible interface labels may keep
  their current spelling until they are changed in a dedicated migration.

## Deciding where a file belongs

Ask what would fail if the file were removed:

1. If only PHP routes, accounts, publishing, or database features fail, it is
   web-platform code.
2. If only Electron windows, native dialogs, or filesystem bridges fail, it is
   desktop-application code.
3. If only an exported slideshow fails, it is portable-player code.
4. If more than one environment fails, it is shared code or a shared asset.

The desktop distribution allowlist in `package.json` is the source of truth for
files shipped in the installed desktop application. Portable-player contents
are documented in `LOCAL_INSTALLATION.md`.
