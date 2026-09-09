<?php

declare(strict_types=1);

require_once __DIR__ . '/../../server/core/http-basic-auth.php';

function basicAuthAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

$expectedUser = 'admin-user';
$expectedPassword = 'password:with:colons';
$encoded = base64_encode($expectedUser . ':' . $expectedPassword);

basicAuthAssert(httpBasicCredentialsMatch($expectedUser, $expectedPassword, [
    'PHP_AUTH_USER' => $expectedUser,
    'PHP_AUTH_PW' => $expectedPassword,
]), 'Direct SAPI credentials were rejected.');

basicAuthAssert(httpBasicCredentialsMatch($expectedUser, $expectedPassword, [
    'HTTP_AUTHORIZATION' => 'Basic ' . $encoded,
]), 'Authorization header credentials were rejected.');

basicAuthAssert(httpBasicCredentialsMatch($expectedUser, $expectedPassword, [
    'REDIRECT_HTTP_AUTHORIZATION' => 'basic ' . $encoded,
]), 'Redirected Authorization credentials were rejected.');

foreach ([
    [],
    ['HTTP_AUTHORIZATION' => 'Bearer token'],
    ['HTTP_AUTHORIZATION' => 'Basic invalid%%%'],
    ['HTTP_AUTHORIZATION' => 'Basic ' . base64_encode('missing-separator')],
    ['HTTP_AUTHORIZATION' => 'Basic ' . base64_encode($expectedUser . ':wrong-password')],
] as $server) {
    basicAuthAssert(
        !httpBasicCredentialsMatch($expectedUser, $expectedPassword, $server),
        'Malformed or incorrect credentials were accepted.'
    );
}

$apacheRules = file_get_contents(__DIR__ . '/../../.htaccess');
$adminEndpoint = file_get_contents(__DIR__ . '/../../admin-messages.php');
basicAuthAssert(is_string($apacheRules), 'Could not read Apache rules.');
basicAuthAssert(is_string($adminEndpoint), 'Could not read the admin endpoint.');
basicAuthAssert(
    str_contains($apacheRules, 'RewriteCond %{HTTP:Authorization} ^(.+)$')
        && str_contains($apacheRules, 'RewriteRule ^admin-messages\.php$ - [E=HTTP_AUTHORIZATION:%1]'),
    'Apache does not forward the admin Authorization header.'
);
basicAuthAssert(
    str_contains($adminEndpoint, "require_once __DIR__ . '/server/core/http-basic-auth.php';")
        && str_contains($adminEndpoint, 'httpBasicCredentialsMatch($ADMIN_USER, $ADMIN_PASS)'),
    'The admin endpoint does not use the portable Basic Auth reader.'
);

echo "HTTP_BASIC_AUTH_TEST_OK\n";
