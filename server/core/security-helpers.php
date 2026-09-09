<?php

require_once __DIR__ . '/web-session.php';
startWebSession();

function ensureFormGuard(string $formId): array
{
    if (!isset($_SESSION['form_guards']) || !is_array($_SESSION['form_guards'])) {
        $_SESSION['form_guards'] = [];
    }

    if (
        !isset($_SESSION['form_guards'][$formId]['token'], $_SESSION['form_guards'][$formId]['started_at']) ||
        !is_string($_SESSION['form_guards'][$formId]['token'])
    ) {
        $_SESSION['form_guards'][$formId] = [
            'token' => bin2hex(random_bytes(32)),
            'started_at' => time(),
        ];
    }

    return $_SESSION['form_guards'][$formId];
}

function resetFormGuard(string $formId): array
{
    unset($_SESSION['form_guards'][$formId]);
    return ensureFormGuard($formId);
}

function validateFormGuard(string $formId, string $token, string $honeypot, int $minSeconds = 3): ?string
{
    $guard = $_SESSION['form_guards'][$formId] ?? null;

    if (!is_array($guard) || empty($guard['token']) || !is_string($guard['token'])) {
        return 'Your session expired. Please refresh and try again.';
    }

    if (!hash_equals($guard['token'], $token)) {
        return 'Your session expired. Please refresh and try again.';
    }

    if ($honeypot !== '') {
        return 'We could not verify your submission.';
    }

    $startedAt = (int)($guard['started_at'] ?? 0);
    if ($startedAt <= 0 || (time() - $startedAt) < $minSeconds) {
        return 'Please wait a moment and try again.';
    }

    if ((time() - $startedAt) > 28800) {
        return 'Your session expired due to inactivity. Please refresh the page.';
    }

    return null;
}

function clientIpBinary(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        $ip = '0.0.0.0';
    }

    $packed = @inet_pton($ip);
    return $packed !== false ? $packed : inet_pton('0.0.0.0');
}

function currentUserAgent(): string
{
    return substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
}
