# PHP Web Installation

## Project Overview

This project is a PHP and JavaScript authoring platform for structured visual works. A project can combine background images, multiple foreground layers, text, narration, audio, timing, silence, effects, and transitions, then play the result in the web platform, desktop application, or an exported portable player.

Use the terminology defined in [Operating Modes and Terminology](OPERATING_MODES.md). There are three runtime environments:

1. **Web platform (`web`)** — the complete hosted workflow, including accounts, project management, uploads, browser editing, publishing, playback, restore tools, and portable ZIP export. This environment requires PHP, MySQL or MariaDB, and a web server.
2. **Desktop application (`desktop`)** — the installed Electron authoring application using local workspaces. It does not require PHP, a database, or internet access.
3. **Portable player (`portable-player`)** — a self-contained project ZIP produced by the web platform or desktop application. After extraction, playback requires only a modern browser.

Use the web platform for hosted, multi-user features. **Movement Timeline Studio / Windows Authoring Kit is the supported local Alpha authoring experience**; see the [Authoring Kit guide](DESKTOP_AUTHORING_KIT.md) or [desktop source-development guide](DESKTOP_DEVELOPMENT.md). This guide covers advanced PHP/MySQL self-hosting and portable playback. Use the portable player only to view an export.

## Requirements

### PHP web application

- **PHP 8.0 or later.** The application uses PHP 8 functions such as `str_starts_with()`.
- **PHP extensions:** `pdo_mysql`, `mbstring`, `zip` (for portable export), `fileinfo` (mandatory for upload MIME validation), and `gd` (for uploaded image re-encoding).
- **MySQL or MariaDB.** The schema uses InnoDB and `utf8mb4`.
- **A web server.** Apache with `mod_rewrite` is the most directly supported option. Nginx requires equivalent application routes and must include the private-path deny rules supplied below. Alternatively, the PHP built-in development server (`php -S`) can be used with the included `router.php` (see below).
- **A modern browser.**

### Desktop application

- **Node.js 22.12 or later** and npm are required for development and installer builds.
- The installed application bundles its runtime and does not require Node.js on the end user's computer.
- See [Desktop Development](DESKTOP_DEVELOPMENT.md) for setup, packaging, and validation commands.

### Optional tools

- **Git** is recommended for source management. Do not use it to track local credentials or private project content.
- A database client such as the MySQL command-line client, phpMyAdmin, or Adminer can make initial database setup easier.

### Verify your tools

```bash
php -v
node -v
mysql --version
git --version
```

Check PHP extensions:

```bash
php -m
```

Look for `pdo_mysql`, `mbstring`, and `zip`. The PHP used by a web server can have a different configuration from command-line PHP, so confirm extensions through the server as well if the application reports that one is missing.

## PHP Web Application Setup

### 1. Place the project under the web document root

Configure the project directory as the site's document root. The application builds project paths from `$_SERVER['DOCUMENT_ROOT']` and uses root-relative URLs such as `/login.php` and `/edit/<project>/`, so installing it in a URL subdirectory is not currently supported.

You have three options for local development:

**Option A — Apache (recommended for full production parity):**
Configure an Apache virtual host whose document root is this directory, enable `mod_rewrite`, and allow `.htaccess` overrides. Or use a local stack such as XAMPP, MAMP, Local, or another Apache/PHP environment and point the site root at this directory.

**Option B — PHP built-in server with `router.php`:**
The repository includes `router.php`, which dispatches clean URLs for the built-in PHP development server:

```bash
php -S 127.0.0.1:8000 router.php
```

`router.php` handles these routes:
- `/slidedeck/<username>/<project>/` → `player.php`
- `/edit/<project>/` → `json-maker.php`
- Blocks access to `/private-data/`, `/server/`, `/users/`, and `/login_attempts/` paths

For all other requests, the built-in server serves physical files directly.

> **Note:** The built-in server is single-threaded and intended for development only. Do not use it for production deployments.

**Option C — Nginx:**
Write equivalent `location` blocks for the application routes handled by `router.php`. Before any general static-file or PHP locations, include these required private-path boundaries:

```nginx
location = /private-data { return 403; }
location ^~ /private-data/ { return 403; }
location = /server { return 403; }
location ^~ /server/ { return 403; }
location ~* ^/examples/[^/]+/(?:backups(?:/|$)|\.movement-media-trash(?:/|$)|.*\.save\.lock$) { return 403; }
```

`private-data/` contains user projects and media. `server/` contains application configuration and internal PHP helpers. Neither tree may be served directly. Example backup directories, `.save.lock`, and `.movement-media-trash` are generated authoring state and must also be denied. Keep the PHP built-in server development-only; production Nginx configuration must also supply the application's clean-URL routing and HTTPS policy.

Start both the web server and MySQL/MariaDB using the controls or service commands provided by your chosen local stack.

### 2. Create the database

Create a database and the three tables used by the application. The following schema matches the current PHP files. `ezra_platform` is the recommended database name; change it to match whatever you configure in `server/core/app-config.php`.

```sql
CREATE DATABASE ezra_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ezra_platform;

CREATE TABLE users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE login_attempts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    login_identifier VARCHAR(190) NOT NULL,
    ip VARBINARY(16) NOT NULL,
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_attempts_ip_time (ip, attempted_at),
    INDEX idx_login_attempts_login_time (login_identifier, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE contact_messages (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip VARBINARY(16) NOT NULL,
    user_agent VARCHAR(255) NULL,
    status ENUM('new', 'read', 'archived') NOT NULL DEFAULT 'new',
    INDEX idx_contact_created_at (created_at),
    INDEX idx_contact_ip_created_at (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

The `users` table must exist before signup can work. Creating all tables up front makes setup predictable. Account recovery also requires the two tables in `server/migrations/2026-09-01-password-reset.sql.example`. Apply that SQL template once after creating `users`; it stores only reset-token hashes and hashed email identifiers used for rate limiting.

Use a dedicated database account when possible, with access limited to this application database. Do not reuse a production or administrator password in a development configuration.

### 3. Create the application configuration

The repository includes `server/core/app-config.example.php` as the configuration template.

If `server/core/app-config.php` already exists, do not overwrite it. For a clean checkout where it is absent, copy the template:

**PowerShell:**

```powershell
if (-not (Test-Path -LiteralPath .\server\core\app-config.php)) {
    Copy-Item -LiteralPath .\server\core\app-config.example.php -Destination .\server\core\app-config.php
}
```

**macOS or Linux:**

```bash
test -e server/core/app-config.php || cp server/core/app-config.example.php server/core/app-config.php
```

Open the newly created `server/core/app-config.php` and replace every `CHANGE_ME` placeholder. The template contains:

```php
<?php
$DB_HOST = '127.0.0.1';
$DB_PORT = 'CHANGE_ME_DATABASE_PORT';       // e.g. '3306'
$DB_NAME = 'CHANGE_ME_DATABASE_NAME';       // e.g. 'ezra_platform'
$DB_USER = 'CHANGE_ME_DATABASE_USER';       // e.g. 'root'
$DB_PASS = 'CHANGE_ME_DATABASE_PASSWORD';   // e.g. '' for XAMPP default

$ADMIN_USER = 'CHANGE_ME_ADMIN_USER';
$ADMIN_PASS = 'CHANGE_ME_TO_A_LONG_UNIQUE_PASSWORD';

$APP_ENVIRONMENT = 'development';
$APP_HTTPS_ORIGIN = '';
$APP_TRUST_PROXY = false;

$PASSWORD_RESET_FROM_EMAIL = 'CHANGE_ME_NO_REPLY_EMAIL';
```

The database values are consumed by `server/core/db.php`, which creates a lazy-initialized PDO singleton. `$ADMIN_USER` and `$ADMIN_PASS` protect the `admin-messages.php` dashboard; they are separate from normal application accounts.

The final three values define the hosted transport boundary. Local PHP development should keep the safe defaults shown above: HTTP remains usable, session cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` is omitted. A production deployment must explicitly set:

```php
$APP_ENVIRONMENT = 'production';
$APP_HTTPS_ORIGIN = 'https://your-canonical-host.example';
$APP_TRUST_PROXY = false;
```

Set `$APP_TRUST_PROXY = true` only when PHP is behind a reverse proxy you control and that proxy replaces (rather than merely forwards) the client-supplied `X-Forwarded-Proto` header. The same settings may instead be supplied as `MOVEMENT_APP_ENV`, `MOVEMENT_HTTPS_ORIGIN`, and `MOVEMENT_TRUST_PROXY` process environment variables when the corresponding PHP variables are absent.

In production, every PHP entry point redirects an insecure request to the configured canonical HTTPS origin before starting a session. Production session cookies use `Secure`, `HttpOnly`, `SameSite=Lax`, and path `/`. Apache, a reverse proxy, or the hosting control panel must also redirect non-PHP/static HTTP requests at the virtual-host level; application PHP cannot intercept a file served directly by the web server. Do not enable HSTS until the deployed redirect and every required HTTPS host/subdomain have been verified.

Account recovery uses PHP's configured `mail()` transport. Set `$PASSWORD_RESET_FROM_EMAIL` (or `MOVEMENT_PASSWORD_RESET_FROM_EMAIL` when the PHP variable is absent) to a validated sender address on the application domain, configure the server's SMTP/sendmail delivery and SPF/DKIM records as appropriate, and apply the password-reset migration before exposing `forgot-password.php`. Reset links use `$APP_HTTPS_ORIGIN`, expire after 60 minutes, and carry their secret in a URL fragment so ordinary HTTP access logs do not receive it.

`server/core/db.php` is already present in the repository and normally should not be edited. It reads `server/core/app-config.php` and provides the `db()` function used by all database operations.

### Application bootstrap

The application bootstrap is `server/core/app-init.php`, which loads:

| File | Purpose |
|------|---------|
| `server/core/auth-check.php` | Session-based authentication guard |
| `server/core/current-user.php` | Extracts the current session username |
| `server/core/project-paths.php` | Resolves `private-data/...` paths from the application root |
| `server/core/response.php` | HTTP response helpers |
| `server/core/db.php` | PDO database connection (reads `server/core/app-config.php`) |
| `server/core/current-user-record.php` | Loads the full user record from the database |

Additionally, `server/core/security-helpers.php` provides CSRF protection (`ensureFormGuard()`, `validateFormGuard()`, `resetFormGuard()`), IP extraction, and user-agent helpers. It is required independently by endpoints that process forms.

### 4. Prepare writable storage

The web-server process must be able to create and update directories below:

```text
private-data/slidedeck/
```

The tracked root Apache rules and `router.php` deny direct HTTP access to the entire `private-data/` tree before and after PHP creates it. Do not rely on a local `private-data/.htaccess`: that directory is intentionally ignored so private projects cannot enter Git. Nginx deployments must install the deny locations shown above.

It also needs access to the operating system's temporary directory while building a portable ZIP export. Apply permissions appropriate to your operating system and local web-server account. Avoid making the whole application directory broadly writable.

PHP uploads must be enabled. Recommended development limits:

```text
upload_max_filesize = 32M
post_max_size = 32M
memory_limit = 256M
```

Your local PHP or hosting configuration may override or reject these values. Set them in `php.ini` or your web server's PHP configuration.

### 5. Verify `.gitignore` coverage

The repository includes a `.gitignore` that already covers:

```gitignore
# Config
app-config.php
.env

# Content
/private-data/
sitemap.xml

# IDE / System
.claude/
.agents/
desktop.ini
.save.lock
.DS_Store
Thumbs.db
```

Before making a public commit, verify your private files are excluded:

```bash
git status --short
git check-ignore -v server/core/app-config.php
git check-ignore -v private-data/
```

If `git check-ignore` prints nothing, the path is not covered by an ignore rule.

### 6. Create the first account and project

After starting the web server and database, use your local site URL for the following checks:

1. Open `/` and confirm the homepage loads.
2. Open `/signup.php`.
3. Create a local account. Successful signup signs the account in and redirects to `/dashboard.php`.
4. From the dashboard, create a project. Project slugs accept letters, numbers, hyphens, and underscores.
5. Confirm that the application opens `/edit/<project>/`.

A new web project is created at:

```text
private-data/slidedeck/<username>/<project>/
├── flow.json
├── img/
├── speech/
└── audio/
```

The editor creates `backups/` when it saves versions of `flow.json`.

### 7. Verify editing, playback, and export

Use a test project and non-sensitive media:

1. Set a project title and add at least one slide.
2. Add text and, if desired, a test image or audio file.
3. Save the slideshow and confirm that `flow.json` was updated under the project directory.
4. Confirm uploaded files appear in the appropriate `img/`, `speech/`, or `audio/` directory.
5. Use **Play** while signed in and confirm that `player.php` and `studio/player/player-runtime.js` load the timeline.
6. Return to the dashboard and confirm that the project appears there.
7. If the PHP `zip` extension is enabled, choose **Export Offline Player**, extract the downloaded ZIP, and test its `player.html`.

Publishing controls whether `player.php` allows non-owners to open a project through the player route. Review the security policy and your web-server static-file rules before treating unpublished media as private on a public deployment.

## Portable Export and Playback

Portable ZIP export is generated by `export-project.php` in the authenticated web platform. It requires PHP's `ZipArchive` class.

The export contains a project directory with:

```text
<project>/
├── player.html
├── flow.json
├── img/
├── speech/
└── audio/
```

Required effect and transition engine code is embedded into `player.html` (sourced from `effects/*-engine.js` and `transitions/*-engine.js`). Project backups, hidden files, and project `index.php` files are excluded by the exporter.

To play an export:

1. Extract the ZIP completely; do not run the player from inside the compressed archive.
2. Keep `player.html`, `flow.json`, and the media directories together.
3. Open `player.html` in a modern browser.

No PHP, database, Node.js server, or internet connection is required for the exported player itself, although externally referenced resources in project content will still depend on their original locations.

Treat an export as a copy of its project data and media. Review it before sharing it publicly.

## Project Data and Backups

The PHP application stores account and contact records in the database. It stores authored project content on disk:

```text
private-data/slidedeck/<username>/<project>/
```

Important contents include:

| Path | Contents |
|------|----------|
| `flow.json` | Timeline, text, timing, publishing state, and media/effect references |
| `img/` | Background and foreground images and effect assets |
| `speech/` | Narration and speech files |
| `audio/` | Other project audio |
| `backups/` | Prior `flow.json` versions created by editor and restore workflows |

Back up both the database and `private-data/` if you need to preserve a PHP installation. Database backups alone do not include authored media or timelines.

## Troubleshooting

### Clean editor or player URLs return 404

- Confirm the project directory is the web document root.
- **Apache:** Enable `mod_rewrite` and allow `.htaccess` overrides.
- **PHP built-in server:** Use `php -S 127.0.0.1:8000 router.php` (not just `php -S`).
- **Nginx:** Add equivalent routes and access restrictions.

### Signup or login reports a generic error

- Confirm MySQL/MariaDB is running.
- Recheck the host, port, database name, username, and password in `server/core/app-config.php`.
- Confirm the `users` table exists.
- Confirm the database account can read and write the application database.
- Review the local PHP/web-server error log without exposing credentials publicly.

### `could not find driver`

Enable `pdo_mysql` for the PHP configuration used by the web server, then restart the web server.

### An `mb_*` function is undefined

Enable the PHP `mbstring` extension and restart the web server.

### `str_starts_with()` is undefined

The application is running on PHP older than 8.0. Upgrade the PHP runtime used by the web server.

### `ZipArchive is not available on this server`

Enable the PHP `zip` extension and restart the web server. Editing and web playback can still work without it, but portable ZIP export cannot.

### Projects cannot be created or saved

- Confirm the web-server account can create and modify `private-data/` and its child directories.
- Confirm the configured document root matches the project root.
- Check available disk space.
- Review the PHP error log.

### Media uploads fail

- Confirm PHP file uploads are enabled.
- Check `upload_max_filesize` and `post_max_size` in the active web PHP configuration.
- Confirm the project media directories are writable.
- Try a small supported test image or audio file.

### Portable-player media is missing

- Extract the complete ZIP before opening `player.html`.
- Keep the generated directory structure unchanged.
- Confirm the source project's referenced files existed under `img/`, `speech/`, or `audio/` when the export was created.
