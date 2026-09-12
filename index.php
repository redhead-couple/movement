<?php
require_once __DIR__ . '/server/core/web-session.php';
enforceProductionHttps();
setWebPageDiscovery(true);
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Movement — Early Formation</title>
    <meta name="description" content="An open-source medium for timeline-based narrative experiments combining images, silence, movement, sound, text, and timing.">
    <?= webRobotsMeta() ?>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">

    <style>
        :root {
            --bg: #24211f;
            --surface: rgba(47, 42, 38, .86);
            --surface-strong: rgba(37, 33, 30, .96);
            --text: #eee8df;
            --muted: rgba(213, 203, 192, .76);
            --line: rgba(238, 232, 223, .12);
            --line-strong: rgba(238, 232, 223, .22);
            --terracotta: #b9634f;
            --sage: #7d927f;
            --ink: #465766;
            --font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            height: 100%;
        }

        body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: var(--font-family);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            position: relative;
        }

        body::before {
            content: "";
            position: fixed;
            inset: 0;
            z-index: -1;
            pointer-events: none;
            background:
                radial-gradient(56vw 38vw at 78% 6%, rgba(185, 99, 79, .16), transparent 64%),
                radial-gradient(42vw 32vw at 12% 0%, rgba(70, 87, 102, .18), transparent 68%),
                linear-gradient(180deg, #302b27 0%, var(--bg) 58%, #1d1a18 100%);
            background-repeat: no-repeat;
        }

        a {
            color: inherit;
            text-decoration: none;
        }

        a:focus-visible,
        button:focus-visible {
            outline: 2px solid rgba(180, 106, 85, .7);
            outline-offset: 3px;
            border-radius: 10px;
        }

        .grain {
            pointer-events: none;
            position: fixed;
            inset: 0;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E");
            mix-blend-mode: overlay;
            opacity: .18;
            z-index: 9999;
        }

        .wrap {
            width: min(1080px, 92vw);
            margin: 0 auto;
        }

        header.nav {
            position: sticky;
            top: 0;
            z-index: 10;
            backdrop-filter: blur(14px);
            background: linear-gradient(to bottom, rgba(24, 22, 21, .90), rgba(24, 22, 21, .58));
            border-bottom: 1px solid rgba(238, 232, 223, .08);
        }

        .nav-inner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 14px 0;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
            letter-spacing: .14em;
            text-transform: uppercase;
            font-weight: 600;
            font-size: 12px;
            color: rgba(238, 232, 223, .82);
        }

        .brand-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--terracotta);
            box-shadow: 0 0 0 6px rgba(185, 99, 79, .13);
        }

        .nav-links {
            display: flex;
            gap: 22px;
            align-items: center;
            font-size: 13px;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .nav-links a {
            color: rgba(238, 232, 223, .82);
            padding: 8px 10px;
            border-radius: 12px;
            transition: background .25s ease, color .25s ease;
        }

        .nav-links a:hover {
            background: rgba(255, 255, 255, .06);
            color: var(--text);
        }

        .hero {
            min-height: 88vh;
            display: flex;
            align-items: flex-end;
            padding: 48px 0 32px;
            position: relative;
        }

        .hero-media {
            position: relative;
            border-radius: 28px;
            overflow: hidden;
            border: 1px solid var(--line);
            box-shadow: 0 22px 54px rgba(0, 0, 0, .28);
            background: var(--surface);
            min-height: 75vh;
            display: flex;
            align-items: flex-end;
            width: 100%;
        }

        .hero-bg {
            position: absolute;
            inset: -1px;
            border: 0;
            filter: saturate(.82) contrast(.94);
            background-image:
                linear-gradient(180deg, rgba(20, 18, 17, .12), rgba(20, 18, 17, .82)),
                radial-gradient(900px 600px at 30% 20%, rgba(185, 99, 79, .13), transparent 65%),
                var(--hero-img);
            background-size: auto, auto, cover;
            background-position: center;
            background-repeat: no-repeat;
        }

        .hero-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg,
                    rgba(20, 18, 17, .08) 0%,
                    rgba(20, 18, 17, .34) 42%,
                    rgba(20, 18, 17, .82) 100%);
        }

        .hero-content {
            position: relative;
            padding: 52px 54px;
            width: min(820px, 100%);
        }

        .hero-kicker,
        .kicker {
            font-size: 12px;
            letter-spacing: .22em;
            text-transform: uppercase;
            color: rgba(246, 241, 234, .86);
            display: inline-flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 18px;
        }

        .kicker-line {
            width: 34px;
            height: 1px;
            background: rgba(185, 99, 79, .72);
        }

        .hero h1 {
            margin: 0 0 16px;
            font-weight: 500;
            letter-spacing: -0.02em;
            line-height: 1.08;
            font-size: clamp(34px, 4.2vw, 56px);
            color: rgba(255, 252, 246, .96);
        }

        .hero-sub {
            margin: 0 0 26px;
            font-size: 16px;
            line-height: 1.55;
            color: rgba(246, 241, 234, .88);
            max-width: 62ch;
        }

        .btn-primary,
        .btn {
            display: inline-flex;
            align-items: center;
            padding: 12px 18px;
            border-radius: 16px;
            font-size: 14px;
            letter-spacing: .05em;
            text-decoration: none;
            transition: background .25s ease, transform .2s ease, border-color .25s ease;
            cursor: pointer;
            border: 1px solid var(--line);
        }

        .btn {
            background: rgba(255, 255, 255, .05);
            color: var(--text);
        }

        .btn:hover {
            background: rgba(255, 255, 255, .08);
            border-color: var(--line-strong);
            transform: translateY(-1px);
        }

        .btn-primary {
            background: linear-gradient(135deg, #d18a70, var(--terracotta));
            border-color: rgba(185, 99, 79, .34);
            color: #fff8f1;
        }

        .btn-primary:hover {
            transform: translateY(-1px);
            background: linear-gradient(135deg, #d8967f, #c76f5b);
            border-color: rgba(185, 99, 79, .60);
        }

        .hero-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }

        main {
            padding: 56px 0 80px;
        }

        .section-title {
            margin: 0;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: .22em;
            color: rgba(213, 203, 192, .82);
            font-weight: 600;
        }

        .section-note {
            margin: 0;
            font-size: 13px;
            color: var(--muted);
            line-height: 1.5;
            max-width: 52ch;
        }

        .cta-row {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            align-items: center;
        }

        .prototype-note,
        .invite {
            border: 1px solid var(--line);
            background:
                linear-gradient(180deg, rgba(255, 255, 255, .04), rgba(255, 255, 255, .015)),
                var(--surface);
            color: var(--text);
            box-shadow: 0 10px 24px rgba(0, 0, 0, .18);
            border-radius: 18px;
        }

        .prototype-note {
            max-width: 920px;
            margin: 32px auto 0;
            padding: 22px 28px;
            font-size: 16px;
            line-height: 1.6;
        }

        .invite {
            margin-top: 44px;
            padding: 34px 32px;
            border-radius: 28px;
        }

        .invite h2 {
            margin: 0 0 10px;
            font-weight: 500;
            letter-spacing: -0.01em;
            font-size: clamp(22px, 2.2vw, 28px);
            color: var(--text);
        }

        .invite p,
        .prototype-note p {
            margin: 0 0 18px;
            color: var(--muted);
            line-height: 1.6;
            max-width: 74ch;
            font-size: 15px;
        }

        .text-link {
            color: var(--terracotta);
            font-weight: 600;
        }

        footer {
            padding: 40px 0 52px;
            color: var(--muted);
            font-size: 13px;
            border-top: 1px solid var(--line);
            background: radial-gradient(800px 400px at 50% 0%, rgba(125, 146, 127, .12), transparent 60%);
        }

        .footer-inner {
            display: flex;
            justify-content: space-between;
            gap: 20px;
            flex-wrap: wrap;
        }

        .small {
            color: rgba(213, 203, 192, .72);
        }

        .footer-links {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-left: 12px;
        }

        .footer-links a {
            color: rgba(213, 203, 192, .72);
        }

        .footer-links a:hover {
            color: var(--text);
        }

        @media (max-width: 720px) {
            .hero-content {
                padding: 34px 22px;
            }

            .hero-media {
                min-height: 60vh;
            }

            .nav-links {
                display: none;
            }
        }
    </style>
</head>

<body>
    <div class="grain" aria-hidden="true"></div>

    <header class="nav">
        <div class="wrap nav-inner">
            <a class="brand" href="/">
                <span class="brand-dot" aria-hidden="true"></span>
                <span>Early Formation</span>
            </a>

            <nav class="nav-links" aria-label="Primary">
                <a href="/feed.php">Work</a>
                <a href="/dashboard.php">My Library</a>
                <a href="/concept/">Concept</a>
                <a href="/download.php">Download</a>
                <a href="/contact.php">Contact</a>
            </nav>
        </div>
    </header>

    <section class="hero">
        <div class="wrap">
            <div class="hero-media" style="--hero-img: url('img/bg_wanaka.webp');">
                <div class="hero-bg" aria-hidden="true"></div>
                <div class="hero-overlay" aria-hidden="true"></div>

                <div class="hero-content">
                    <p class="hero-kicker">
                        <span class="kicker-line" aria-hidden="true"></span>
                        <span>Timeline-based narrative experiments</span>
                    </p>

                    <h1>
                        Collective expression.<br>Structured through time
                    </h1>

                    <p class="hero-sub">
                        Images, silence, movement, sound, text, and timing become part of one shared language. This prototype is the first step toward an open-source medium that can grow through use.
                    </p>

                    <div class="hero-actions">
                        <a href="/player.php?username=molkho52&project=what-this-project-is" class="btn-primary">▶ Watch the introduction</a>
                        <a href="/download.php" class="btn">Download the desktop app</a>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section class="prototype-note">
        <p style="margin-bottom: 0;">
            Movement is an early working prototype for a new open-source expressive medium — a way of combining images, effects, transitions, narration, sound, silence, timing, text, and movement into a shared visual language that can grow through use.
        </p>
    </section>

    <main class="wrap">
        <div style="margin-top: 24px;">
            <p class="section-title" style="margin-bottom: 8px;">Explore the feed</p>
            <p class="section-note" style="margin: 0 0 16px; text-align: left;">
                All published slideshows appear here as they are created.
            </p>
            <div class="cta-row">
                <a class="btn" href="/feed.php">Explore all slideshows &rarr;</a>
            </div>
        </div>

        <div class="invite" id="invitation">
            <h2>Open Direction</h2>
            <p>
                This project is moving toward an open-source foundation for a new kind of expressive language.
            </p>
            <p>
                The first prototype already exists. It is built through images, spoken words, timing, silence, sound, text, transitions, and symbolic visual movement. The next step is to shape these elements into reusable expressive tools — a growing language that creators, storytellers, educators, artists, and thinkers could eventually use and improve together.
            </p>
            <p>
                This is still early. The purpose now is not to launch a finished platform, but to make the first structure clear enough that others can understand the medium and help it evolve.
            </p>
            <p>
                <a href="/concept/" class="text-link">
                    Read more about the medium &rarr;
                </a>
            </p>
            <p>
                The work begins with simple questions:
            </p>
            <p>
                What can an image express when it is placed in the right rhythm?<br>
                What can silence do after a spoken line?<br>
                How can transitions, effects, and movement become part of meaning?<br>
                How can abstract ideas become easier to feel, see, and share?
            </p>
            <p>
                The long-term vision is an open creative system where expressive patterns can be discovered, named, reused, changed, and expanded over time.
            </p>
            <p style="margin-bottom: 0;">If this direction resonates, there is space to begin a conversation.</p>
        </div>
    </main>

    <footer>
        <div class="wrap footer-inner">
            <div>© <span id="year"></span> Redhead Couple · Early Formation</div>
            <div class="small">Forming deliberately • Evolving over time</div>
            <div class="small footer-links">
                <a href="/concept/">Concept</a>
                <a href="/download.php">Download</a>
                <a href="https://github.com/redhead-couple/movement">GitHub repository</a>
                <a href="/contact.php">Contact</a>
            </div>
        </div>
    </footer>

    <script>
        document.getElementById('year').textContent = new Date().getFullYear();
    </script>
</body>

</html>