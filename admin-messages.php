<?php

declare(strict_types=1);

require_once __DIR__ . '/server/core/app-config.php';
require_once __DIR__ . '/server/core/db.php';
require_once __DIR__ . '/server/core/http-basic-auth.php';
require_once __DIR__ . '/server/core/security-helpers.php';

if (
    !isset($ADMIN_USER, $ADMIN_PASS)
    || !is_string($ADMIN_USER)
    || !is_string($ADMIN_PASS)
    || !httpBasicCredentialsMatch($ADMIN_USER, $ADMIN_PASS)
) {
    header('WWW-Authenticate: Basic realm="Messages"');
    header('HTTP/1.0 401 Unauthorized');
    echo 'Unauthorized';
    exit;
}

$pdo = db();
$pdo->exec("
    CREATE TABLE IF NOT EXISTS contact_messages (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ip VARBINARY(16) NOT NULL,
        user_agent VARCHAR(255) NULL,
        status ENUM('new','read','archived') NOT NULL DEFAULT 'new',
        INDEX idx_contact_created_at (created_at),
        INDEX idx_contact_ip_created_at (ip, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

$formId = 'admin_messages';
$guard = ensureFormGuard($formId);
$notice = '';
$error = '';

$allowedStatuses = ['all', 'new', 'read', 'archived'];
$allowedSorts = [
    'newest' => 'created_at DESC',
    'oldest' => 'created_at ASC',
    'name_az' => 'name ASC, created_at DESC',
    'name_za' => 'name DESC, created_at DESC',
    'email_az' => 'email ASC, created_at DESC',
];
$allowedActions = ['mark_new', 'mark_read', 'archive', 'delete', 'mark_filtered_read', 'single_update'];

$statusFilter = (string)($_GET['status'] ?? 'all');
if (!in_array($statusFilter, $allowedStatuses, true)) {
    $statusFilter = 'all';
}

$sort = (string)($_GET['sort'] ?? 'newest');
if (!isset($allowedSorts[$sort])) {
    $sort = 'newest';
}

$query = trim((string)($_GET['q'] ?? ''));
$where = [];
$params = [];

if ($statusFilter !== 'all') {
    $where[] = 'status = ?';
    $params[] = $statusFilter;
}

if ($query !== '') {
    $where[] = '(name LIKE ? OR email LIKE ? OR message LIKE ?)';
    $like = '%' . $query . '%';
    $params[] = $like;
    $params[] = $like;
    $params[] = $like;
}

$whereSql = $where !== [] ? 'WHERE ' . implode(' AND ', $where) : '';
$orderSql = $allowedSorts[$sort];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $guardError = validateFormGuard(
        $formId,
        (string)($_POST['form_token'] ?? ''),
        trim((string)($_POST['website'] ?? '')),
        0
    );

    if ($guardError !== null) {
        $error = $guardError;
    } else {
        $action = (string)($_POST['bulk_action'] ?? '');
        $selectedIds = $_POST['selected_ids'] ?? [];

        if (!in_array($action, $allowedActions, true)) {
            $error = 'Please choose a valid action.';
        } elseif ($action === 'mark_filtered_read') {
            try {
                $updateSql = $whereSql !== '' ? "UPDATE contact_messages SET status = 'read' $whereSql" : "UPDATE contact_messages SET status = 'read'";
                $stmt = $pdo->prepare($updateSql);
                $stmt->execute($params);
                $notice = 'Filtered messages marked as read.';
                $guard = resetFormGuard($formId);
            } catch (Throwable $e) {
                $error = 'Unable to update filtered messages right now.';
            }
        } elseif ($action === 'single_update') {
            $messageId = (int)($_POST['single_update_id'] ?? 0);
            $singleStatuses = $_POST['single_status'] ?? [];
            $newStatus = is_array($singleStatuses) ? (string)($singleStatuses[$messageId] ?? '') : '';

            if ($messageId <= 0 || !in_array($newStatus, ['new', 'read', 'archived'], true)) {
                $error = 'Please choose a valid status for that message.';
            } else {
                try {
                    $stmt = $pdo->prepare('UPDATE contact_messages SET status = ? WHERE id = ? LIMIT 1');
                    $stmt->execute([$newStatus, $messageId]);
                    $notice = 'Message status updated.';
                    $guard = resetFormGuard($formId);
                } catch (Throwable $e) {
                    $error = 'Unable to update that message right now.';
                }
            }
        } elseif (!is_array($selectedIds) || $selectedIds === []) {
            $error = 'Select at least one message first.';
        } else {
            $selectedIds = array_values(array_unique(array_filter(array_map(
                static fn($value): int => (int)$value,
                $selectedIds
            ), static fn(int $value): bool => $value > 0)));

            if ($selectedIds === []) {
                $error = 'Select at least one valid message first.';
            } else {
                $placeholders = implode(',', array_fill(0, count($selectedIds), '?'));

                try {
                    if ($action === 'delete') {
                        $stmt = $pdo->prepare("DELETE FROM contact_messages WHERE id IN ($placeholders)");
                        $stmt->execute($selectedIds);
                        $notice = count($selectedIds) . ' message(s) deleted.';
                    } else {
                        $statusMap = [
                            'mark_new' => 'new',
                            'mark_read' => 'read',
                            'archive' => 'archived',
                        ];
                        $status = $statusMap[$action];

                        $params = array_merge([$status], $selectedIds);
                        $stmt = $pdo->prepare("UPDATE contact_messages SET status = ? WHERE id IN ($placeholders)");
                        $stmt->execute($params);
                        $notice = count($selectedIds) . ' message(s) updated.';
                    }

                    $guard = resetFormGuard($formId);
                } catch (Throwable $e) {
                    $error = 'Unable to update messages right now.';
                }
            }
        }
    }
}
$perPage = 25;
$page = max(1, (int)($_GET['page'] ?? 1));

$countRows = $pdo->query("
    SELECT status, COUNT(*) AS total
    FROM contact_messages
    GROUP BY status
")->fetchAll();

$counts = ['new' => 0, 'read' => 0, 'archived' => 0];
foreach ($countRows as $countRow) {
    $status = (string)$countRow['status'];
    if (isset($counts[$status])) {
        $counts[$status] = (int)$countRow['total'];
    }
}
$totalMessages = array_sum($counts);

$countStmt = $pdo->prepare("
    SELECT COUNT(*)
    FROM contact_messages
    $whereSql
");
$countStmt->execute($params);
$filteredTotal = (int)$countStmt->fetchColumn();
$totalPages = max(1, (int)ceil($filteredTotal / $perPage));

if (($_GET['export'] ?? '') === 'csv') {
    $exportStmt = $pdo->prepare("
        SELECT id, name, email, message, created_at, status
        FROM contact_messages
        $whereSql
        ORDER BY $orderSql
    ");
    $exportStmt->execute($params);

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="contact-messages.csv"');

    $output = fopen('php://output', 'w');
    fputcsv($output, ['id', 'name', 'email', 'message', 'created_at', 'status']);

    while ($row = $exportStmt->fetch()) {
        fputcsv($output, [
            $row['id'],
            $row['name'],
            $row['email'],
            $row['message'],
            $row['created_at'],
            $row['status'],
        ]);
    }

    fclose($output);
    exit;
}

if ($page > $totalPages) {
    $page = $totalPages;
}

$offset = ($page - 1) * $perPage;
$pageStart = max(1, $page - 2);
$pageEnd = min($totalPages, $page + 2);

if (($pageEnd - $pageStart) < 4) {
    if ($pageStart === 1) {
        $pageEnd = min($totalPages, $pageStart + 4);
    } elseif ($pageEnd === $totalPages) {
        $pageStart = max(1, $pageEnd - 4);
    }
}

$stmt = $pdo->prepare("
    SELECT id, name, email, message, created_at, status
    FROM contact_messages
    $whereSql
    ORDER BY $orderSql
    LIMIT $perPage OFFSET $offset
");
$stmt->execute($params);
$rows = $stmt->fetchAll();
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact Messages</title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/assets/app.css">
    <style>
        .messages-shell {
            display: grid;
            padding-top: var(--app-space-6);
            gap: var(--app-space-5);
        }

        .messages-summary {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: var(--app-space-4);
        }

        .messages-card,
        .filter-grid,
        .message-item {
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
        }

        .messages-card {
            padding: 16px 18px;
        }

        .messages-card strong,
        .messages-card span {
            display: block;
        }

        .messages-card strong {
            margin-bottom: 6px;
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--app-text-muted);
        }

        .messages-card span {
            font-size: 22px;
            letter-spacing: -0.03em;
        }

        .messages-status-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .messages-pill {
            display: inline-flex;
            align-items: center;
            min-height: 34px;
            padding: 0 14px;
            border: 1px solid var(--app-line);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.04);
            color: var(--app-text-muted);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }

        .messages-tools,
        .messages-list {
            display: grid;
            gap: var(--app-space-4);
        }

        .filter-grid {
            display: grid;
            grid-template-columns: 1.2fr minmax(180px, 220px) minmax(180px, 220px) auto;
            gap: var(--app-space-3);
            padding: var(--app-space-4);
            align-items: end;
        }

        .filter-grid .field {
            margin-bottom: 0;
        }

        .messages-notice {
            padding: 14px 16px;
            border-radius: var(--app-radius-md);
            border: 1px solid var(--app-line);
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .messages-notice p {
            margin: 0;
        }

        .messages-notice--error {
            border-color: rgba(181, 106, 90, 0.28);
            background:
                linear-gradient(180deg, rgba(181, 106, 90, 0.16), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .messages-notice--success {
            border-color: rgba(114, 179, 138, 0.28);
            background:
                linear-gradient(180deg, rgba(114, 179, 138, 0.14), rgba(255, 255, 255, 0)),
                rgba(255, 255, 255, 0.03);
        }

        .bulk-bar {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto auto;
            gap: var(--app-space-3);
            align-items: end;
            padding: var(--app-space-4);
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
        }

        .bulk-bar .field {
            margin-bottom: 0;
        }

        .messages-list {
            margin: 0;
        }

        .message-item {
            display: grid;
            gap: var(--app-space-4);
            padding: var(--app-space-4);
        }

        .message-row {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            gap: var(--app-space-4);
            align-items: start;
        }

        .message-check {
            padding-top: 4px;
        }

        .message-content {
            display: grid;
            gap: var(--app-space-4);
        }

        .message-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: var(--app-space-4);
            flex-wrap: wrap;
        }

        .message-from {
            display: grid;
            gap: 4px;
        }

        .message-from strong {
            font-size: 18px;
            letter-spacing: -0.02em;
        }

        .message-meta {
            color: var(--app-text-muted);
            font-size: 13px;
            line-height: 1.5;
        }

        .message-body {
            white-space: pre-wrap;
            line-height: 1.7;
            color: var(--app-text-muted);
        }

        .message-status {
            display: inline-flex;
            align-items: center;
            min-height: 30px;
            padding: 0 12px;
            border-radius: 999px;
            border: 1px solid var(--app-line);
            background: rgba(255, 255, 255, 0.04);
            color: var(--app-text-muted);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .message-status--new {
            border-color: rgba(114, 179, 138, 0.28);
            color: #a8ddb8;
        }

        .message-status--read {
            border-color: rgba(203, 139, 115, 0.28);
        }

        .message-status--archived {
            opacity: 0.78;
        }

        .message-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .message-actions button {
            min-height: 38px;
        }

        .message-inline-status {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
        }

        .message-inline-status .input {
            width: auto;
            min-width: 150px;
        }

        .empty-state {
            padding: 18px;
            border: 1px solid var(--app-line);
            border-radius: var(--app-radius-md);
            background: rgba(255, 255, 255, 0.025);
            color: var(--app-text-muted);
        }

        .messages-pagination {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: var(--app-space-3);
            padding-top: var(--app-space-3);
        }

        .messages-pagination .muted {
            margin: 0;
        }

        .messages-page-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .messages-page-list .button,
        .messages-page-list .button-secondary {
            min-width: 42px;
            min-height: 38px;
            padding: 0 12px;
        }

        .messages-page-list .is-current {
            background: linear-gradient(135deg, var(--app-accent-strong), var(--app-accent));
            border-color: transparent;
            color: #160f0c;
        }

        @media (max-width: 980px) {

            .messages-summary,
            .filter-grid,
            .bulk-bar {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body class="messages-page">
    <header class="app-site-header">
        <div class="wrap app-site-header__inner">
            <a class="app-brand" href="/" aria-label="Early Formation home">Early Formation</a>
            <nav class="app-nav" aria-label="Admin navigation">
                <a class="app-nav__link" href="/dashboard.php">My Library</a>
                <a class="app-nav__link" href="/contact.php">Contact Page</a>
                <a class="app-nav__link" href="/privacy.php">Privacy</a>
            </nav>
        </div>
    </header>

    <main class="page page-with-intro">
        <section class="page-intro page-intro--compact" aria-labelledby="messages-title">
            <div class="wrap page-intro__inner">
                <div class="page-intro__copy">
                    <p class="eyebrow">Admin</p>
                    <h1 id="messages-title">Contact Messages</h1>
                    <p class="page-intro__description">Review and manage messages submitted through the contact page.</p>
                </div>
            </div>
        </section>
        <div class="wrap messages-shell">
            <section class="panel">
                <div class="panel-body">
                    <div class="section-head">
                        <div>
                            <h2>Inbox overview</h2>
                            <p class="muted">Protected with HTTP Basic Auth. Change the admin credentials in <code>server/core/app-config.php</code> before using this page anywhere public.</p>
                        </div>
                    </div>

                    <div class="messages-summary">
                        <div class="messages-card">
                            <strong>Total</strong>
                            <span><?= $totalMessages ?></span>
                        </div>
                        <div class="messages-card">
                            <strong>New</strong>
                            <span><?= $counts['new'] ?></span>
                        </div>
                        <div class="messages-card">
                            <strong>Read</strong>
                            <span><?= $counts['read'] ?></span>
                        </div>
                        <div class="messages-card">
                            <strong>Archived</strong>
                            <span><?= $counts['archived'] ?></span>
                        </div>
                    </div>

                    <div class="messages-status-bar">
                        <span class="messages-pill">Showing <?= count($rows) ?> of <?= $filteredTotal ?></span>
                        <span class="messages-pill">Status: <?= htmlspecialchars($statusFilter) ?></span>
                        <span class="messages-pill">Sort: <?= htmlspecialchars(str_replace('_', ' ', $sort)) ?></span>
                        <span class="messages-pill">Page <?= $page ?> of <?= $totalPages ?></span>
                        <?php if ($query !== ''): ?>
                            <span class="messages-pill">Search: <?= htmlspecialchars($query) ?></span>
                        <?php endif; ?>
                    </div>
                </div>
            </section>

            <section class="messages-tools">
                <?php if ($error !== ''): ?>
                    <div class="messages-notice messages-notice--error">
                        <p><?= htmlspecialchars($error) ?></p>
                    </div>
                <?php endif; ?>

                <?php if ($notice !== ''): ?>
                    <div class="messages-notice messages-notice--success">
                        <p><?= htmlspecialchars($notice) ?></p>
                    </div>
                <?php endif; ?>

                <form method="get" action="" class="filter-grid">
                    <div class="field">
                        <label for="q">Search</label>
                        <input class="input" type="text" id="q" name="q" value="<?= htmlspecialchars($query) ?>" placeholder="Search name, email, or message">
                    </div>

                    <div class="field">
                        <label for="status">Status</label>
                        <select class="input" id="status" name="status">
                            <option value="all" <?= $statusFilter === 'all' ? ' selected' : '' ?>>All</option>
                            <option value="new" <?= $statusFilter === 'new' ? ' selected' : '' ?>>New</option>
                            <option value="read" <?= $statusFilter === 'read' ? ' selected' : '' ?>>Read</option>
                            <option value="archived" <?= $statusFilter === 'archived' ? ' selected' : '' ?>>Archived</option>
                        </select>
                    </div>

                    <div class="field">
                        <label for="sort">Sort</label>
                        <select class="input" id="sort" name="sort">
                            <option value="newest" <?= $sort === 'newest' ? ' selected' : '' ?>>Newest first</option>
                            <option value="oldest" <?= $sort === 'oldest' ? ' selected' : '' ?>>Oldest first</option>
                            <option value="name_az" <?= $sort === 'name_az' ? ' selected' : '' ?>>Name A-Z</option>
                            <option value="name_za" <?= $sort === 'name_za' ? ' selected' : '' ?>>Name Z-A</option>
                            <option value="email_az" <?= $sort === 'email_az' ? ' selected' : '' ?>>Email A-Z</option>
                        </select>
                    </div>

                    <div class="actions">
                        <button class="button button-primary" type="submit">Apply</button>
                        <a class="button button-secondary" href="?<?= htmlspecialchars(http_build_query([
                                                                        'status' => $statusFilter,
                                                                        'sort' => $sort,
                                                                        'q' => $query,
                                                                        'export' => 'csv',
                                                                    ])) ?>">Export CSV</a>
                    </div>
                </form>
            </section>

            <section class="panel">
                <div class="panel-body">
                    <div class="section-head">
                        <div>
                            <h2>Manage messages</h2>
                            <p class="muted">Select one or more messages, then update status or delete them.</p>
                        </div>
                    </div>

                    <?php if (empty($rows)): ?>
                        <div class="empty-state">
                            No messages matched the current filters.
                        </div>
                    <?php else: ?>
                        <form method="post" action="?<?= htmlspecialchars(http_build_query([
                                                            'status' => $statusFilter,
                                                            'sort' => $sort,
                                                            'q' => $query,
                                                            'page' => $page,
                                                        ])) ?>">
                            <input type="hidden" name="form_token" value="<?= htmlspecialchars($guard['token']) ?>">
                            <input type="hidden" name="single_update_id" value="">

                            <div class="hp">
                                <label for="website">Website</label>
                                <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                            </div>

                            <div class="bulk-bar">
                                <div class="field">
                                    <label for="bulk_action">Bulk action</label>
                                    <select class="input" id="bulk_action" name="bulk_action">
                                        <option value="">Choose action</option>
                                        <option value="mark_new">Mark as new</option>
                                        <option value="mark_read">Mark as read</option>
                                        <option value="archive">Archive</option>
                                        <option value="delete">Delete</option>
                                    </select>
                                </div>
                                <div class="actions">
                                    <button class="button button-primary" type="submit">Apply to selected</button>
                                    <button class="button button-secondary" type="submit" name="bulk_action" value="mark_filtered_read">Mark filtered as read</button>
                                </div>
                                <div class="muted">Tip: use the checkboxes to select one or many messages.</div>
                            </div>

                            <div class="messages-list">
                                <?php foreach ($rows as $row): ?>
                                    <article class="message-item">
                                        <div class="message-row">
                                            <div class="message-check">
                                                <input type="checkbox" name="selected_ids[]" value="<?= (int)$row['id'] ?>" aria-label="Select message <?= (int)$row['id'] ?>">
                                            </div>

                                            <div class="message-content">
                                                <div class="message-top">
                                                    <div class="message-from">
                                                        <strong><?= htmlspecialchars($row['name']) ?></strong>
                                                        <div class="message-meta"><?= htmlspecialchars($row['email']) ?></div>
                                                        <div class="message-meta"><?= htmlspecialchars($row['created_at']) ?></div>
                                                        <div class="message-meta">Message #<?= (int)$row['id'] ?></div>
                                                    </div>
                                                    <div class="message-status message-status--<?= htmlspecialchars($row['status']) ?>">
                                                        <?= htmlspecialchars($row['status']) ?>
                                                    </div>
                                                </div>

                                                <div class="message-body"><?= htmlspecialchars($row['message']) ?></div>

                                                <div class="message-actions">
                                                    <a class="button button-secondary" href="https://mail.google.com/mail/?view=cm&fs=1&to=<?= rawurlencode($row['email']) ?>&su=<?= rawurlencode('Re: your message on Early Formation') ?>" target="_blank" rel="noopener noreferrer">Reply in Gmail</a>
                                                    <a class="button button-secondary" href="https://mail.google.com/mail/?view=cm&fs=1&to=<?= rawurlencode($row['email']) ?>" target="_blank" rel="noopener noreferrer">Open in Gmail</a>
                                                    <div class="message-inline-status">
                                                        <select class="input" name="single_status[<?= (int)$row['id'] ?>]">
                                                            <option value="new" <?= $row['status'] === 'new' ? ' selected' : '' ?>>New</option>
                                                            <option value="read" <?= $row['status'] === 'read' ? ' selected' : '' ?>>Read</option>
                                                            <option value="archived" <?= $row['status'] === 'archived' ? ' selected' : '' ?>>Archived</option>
                                                        </select>
                                                        <button class="button button-secondary" type="submit" name="bulk_action" value="single_update" onclick="this.form.querySelectorAll('input[name=&quot;selected_ids[]&quot;]').forEach(function(box){ box.checked = false; }); this.form.single_update_id.value='<?= (int)$row['id'] ?>';">Update Status</button>
                                                    </div>
                                                    <button class="button button-secondary" type="submit" name="bulk_action" value="mark_new" onclick="this.form.querySelectorAll('input[name=&quot;selected_ids[]&quot;]').forEach(function(box){ if (box.value !== '<?= (int)$row['id'] ?>') { box.checked = false; } }); this.form.querySelector('input[name=&quot;selected_ids[]&quot;][value=&quot;<?= (int)$row['id'] ?>&quot;]').checked = true;">Mark New</button>
                                                    <button class="button button-secondary" type="submit" name="bulk_action" value="mark_read" onclick="this.form.querySelectorAll('input[name=&quot;selected_ids[]&quot;]').forEach(function(box){ if (box.value !== '<?= (int)$row['id'] ?>') { box.checked = false; } }); this.form.querySelector('input[name=&quot;selected_ids[]&quot;][value=&quot;<?= (int)$row['id'] ?>&quot;]').checked = true;">Mark Read</button>
                                                    <button class="button button-secondary" type="submit" name="bulk_action" value="archive" onclick="this.form.querySelectorAll('input[name=&quot;selected_ids[]&quot;]').forEach(function(box){ if (box.value !== '<?= (int)$row['id'] ?>') { box.checked = false; } }); this.form.querySelector('input[name=&quot;selected_ids[]&quot;][value=&quot;<?= (int)$row['id'] ?>&quot;]').checked = true;">Archive</button>
                                                    <button class="button button-secondary" type="submit" name="bulk_action" value="delete" onclick="this.form.querySelectorAll('input[name=&quot;selected_ids[]&quot;]').forEach(function(box){ if (box.value !== '<?= (int)$row['id'] ?>') { box.checked = false; } }); this.form.querySelector('input[name=&quot;selected_ids[]&quot;][value=&quot;<?= (int)$row['id'] ?>&quot;]').checked = true; return confirm('Delete this message?');">Delete</button>
                                                </div>
                                            </div>
                                        </div>
                                    </article>
                                <?php endforeach; ?>
                            </div>

                            <?php if ($totalPages > 1): ?>
                                <div class="messages-pagination">
                                    <p class="muted">Page <?= $page ?> of <?= $totalPages ?>. Showing <?= count($rows) ?> message(s) on this page.</p>
                                    <div class="messages-page-list">
                                        <?php if ($page > 1): ?>
                                            <a class="button button-secondary" href="?<?= htmlspecialchars(http_build_query([
                                                                                            'status' => $statusFilter,
                                                                                            'sort' => $sort,
                                                                                            'q' => $query,
                                                                                            'page' => 1,
                                                                                        ])) ?>">First</a>
                                        <?php endif; ?>
                                        <?php if ($page > 1): ?>
                                            <a class="button button-secondary" href="?<?= htmlspecialchars(http_build_query([
                                                                                            'status' => $statusFilter,
                                                                                            'sort' => $sort,
                                                                                            'q' => $query,
                                                                                            'page' => $page - 1,
                                                                                        ])) ?>">Previous</a>
                                        <?php endif; ?>
                                        <?php for ($pageNumber = $pageStart; $pageNumber <= $pageEnd; $pageNumber++): ?>
                                            <a class="button button-secondary<?= $pageNumber === $page ? ' is-current' : '' ?>" href="?<?= htmlspecialchars(http_build_query([
                                                                                                                                            'status' => $statusFilter,
                                                                                                                                            'sort' => $sort,
                                                                                                                                            'q' => $query,
                                                                                                                                            'page' => $pageNumber,
                                                                                                                                        ])) ?>"><?= $pageNumber ?></a>
                                        <?php endfor; ?>
                                        <?php if ($page < $totalPages): ?>
                                            <a class="button button-secondary" href="?<?= htmlspecialchars(http_build_query([
                                                                                            'status' => $statusFilter,
                                                                                            'sort' => $sort,
                                                                                            'q' => $query,
                                                                                            'page' => $page + 1,
                                                                                        ])) ?>">Next</a>
                                        <?php endif; ?>
                                        <?php if ($page < $totalPages): ?>
                                            <a class="button button-secondary" href="?<?= htmlspecialchars(http_build_query([
                                                                                            'status' => $statusFilter,
                                                                                            'sort' => $sort,
                                                                                            'q' => $query,
                                                                                            'page' => $totalPages,
                                                                                        ])) ?>">Last</a>
                                        <?php endif; ?>
                                    </div>
                                </div>
                            <?php endif; ?>
                        </form>
                    <?php endif; ?>
                </div>
            </section>
        </div>
    </main>
</body>

</html>
