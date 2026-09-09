<?php

function respondJson(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');

    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function respondErrorJson(string $message, int $status = 400): void
{
    respondJson([
        'success' => false,
        'error'   => $message
    ], $status);
}

function respondNotFoundPage(): void
{
    http_response_code(404);
    require $_SERVER['DOCUMENT_ROOT'] . '/not-found.php';
    exit;
}
