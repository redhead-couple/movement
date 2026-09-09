<?php

declare(strict_types=1);

/**
 * Read HTTP Basic credentials across mod_php, CGI, and FastCGI SAPIs.
 *
 * @return array{0:string,1:string}|null
 */
function httpBasicCredentials(?array $server = null): ?array
{
    $server = $server ?? $_SERVER;
    if (
        isset($server['PHP_AUTH_USER'], $server['PHP_AUTH_PW'])
        && is_string($server['PHP_AUTH_USER'])
        && is_string($server['PHP_AUTH_PW'])
    ) {
        return [$server['PHP_AUTH_USER'], $server['PHP_AUTH_PW']];
    }

    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
        $authorization = $server[$key] ?? null;
        if (
            !is_string($authorization)
            || !preg_match('/^Basic[ \t]+([A-Za-z0-9+\/=]+)$/i', trim($authorization), $matches)
        ) {
            continue;
        }

        $decoded = base64_decode($matches[1], true);
        if (!is_string($decoded) || !str_contains($decoded, ':')) {
            continue;
        }

        return explode(':', $decoded, 2);
    }

    return null;
}

function httpBasicCredentialsMatch(
    string $expectedUser,
    string $expectedPassword,
    ?array $server = null
): bool {
    $credentials = httpBasicCredentials($server);
    if ($credentials === null) {
        return false;
    }

    $userMatches = hash_equals($expectedUser, $credentials[0]);
    $passwordMatches = hash_equals($expectedPassword, $credentials[1]);
    return $userMatches && $passwordMatches;
}
