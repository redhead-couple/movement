<?php
require_once __DIR__ . '/server/core/web-session.php';
enforceProductionHttps();

http_response_code(404);
$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$requestLabel = htmlspecialchars($requestPath, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page Not Found</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        :root {
            --bg: #191512;
            --panel: rgba(44, 36, 33, 0.82);
            --text: #f5efe8;
            --muted: rgba(245, 239, 232, 0.68);
            --line: rgba(245, 239, 232, 0.14);
            --accent: #d28d68;
            --accent-strong: #f2b38d;
            --shadow: rgba(0, 0, 0, 0.28);
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            min-height: 100%;
        }

        body {
            margin: 0;
            display: grid;
            place-items: center;
            row-gap: 24px;
            padding: 32px;
            color: var(--text);
            background:
                radial-gradient(55vw 40vw at 15% 10%, rgba(210, 141, 104, 0.16), transparent 60%),
                radial-gradient(45vw 35vw at 85% 0%, rgba(120, 76, 61, 0.22), transparent 60%),
                linear-gradient(180deg, #201916 0%, var(--bg) 100%);
            font-family: Georgia, "Times New Roman", serif;
        }

        body::before {
            content: "";
            position: fixed;
            inset: 0;
            pointer-events: none;
            opacity: 0.18;
            background-image:
                linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
            background-size: 24px 24px;
        }

        .not-found-header {
            width: min(1120px, 100%);
        }

        main {
            width: min(860px, 100%);
            border: 1px solid var(--line);
            border-radius: 28px;
            overflow: hidden;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
                var(--panel);
            box-shadow: 0 26px 70px var(--shadow);
            backdrop-filter: blur(14px);
        }

        .inner {
            display: grid;
            gap: 28px;
            padding: 40px;
        }

        .eyebrow {
            margin: 0;
            color: var(--accent-strong);
            font: 600 12px/1.2 "Segoe UI", Arial, sans-serif;
            letter-spacing: 0.22em;
            text-transform: uppercase;
        }

        h1 {
            margin: 0;
            font-size: clamp(44px, 8vw, 88px);
            line-height: 0.92;
            letter-spacing: -0.04em;
        }

        p {
            margin: 0;
            max-width: 34rem;
            color: var(--muted);
            font-size: 18px;
            line-height: 1.6;
        }

        code {
            display: inline-block;
            margin-top: 10px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.22);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: var(--text);
            font: 500 14px/1.4 Consolas, Monaco, monospace;
            word-break: break-all;
        }

        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
            padding-top: 8px;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 180px;
            padding: 14px 18px;
            border-radius: 999px;
            border: 1px solid transparent;
            color: #1a120e;
            background: linear-gradient(135deg, var(--accent-strong), var(--accent));
            text-decoration: none;
            font: 600 14px/1.2 "Segoe UI", Arial, sans-serif;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .btn.secondary {
            color: var(--text);
            background: transparent;
            border-color: var(--line);
        }

        .guide {
            display: grid;
            gap: 12px;
            padding-top: 10px;
            border-top: 1px solid var(--line);
            color: var(--muted);
            font: 500 14px/1.6 "Segoe UI", Arial, sans-serif;
        }

        .guide strong {
            color: var(--text);
        }

        @media (max-width: 640px) {
            body {
                padding: 18px;
            }

            .inner {
                padding: 26px;
            }

            p {
                font-size: 16px;
            }

            .btn {
                width: 100%;
            }
        }
    </style>
</head>

<body>
    <header class="not-found-header">
        <a class="app-return-link" href="/" aria-label="Early Formation home">Early Formation</a>
    </header>
    <main>
        <div class="inner">
            <p class="eyebrow">404 / Not Found</p>
            <h1>Wrong turn.</h1>
            <p>The page or project you requested could not be found.</p>
            <div>
                <p>Requested path</p>
                <code><?php echo $requestLabel; ?></code>
            </div>
            <div class="actions">
                <a class="btn" href="/feed.php">Browse Public Feed</a>
                <a class="btn secondary" href="/edit/there">Open Editor Example</a>
            </div>
            <div class="guide">
                <div><strong>Player route:</strong> <code>/there</code></div>
                <div><strong>Editor route:</strong> <code>/edit/there</code></div>
            </div>
        </div>
    </main>
</body>

</html>
