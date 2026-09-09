<?php
/**
 * Example application configuration.
 * Copy this file to server/core/app-config.php and replace every CHANGE_ME value.
 * Never commit the completed server/core/app-config.php file.
 */

$DB_HOST = '127.0.0.1';
$DB_PORT = 'CHANGE_ME_DATABASE_PORT';
$DB_NAME = 'CHANGE_ME_DATABASE_NAME';
$DB_USER = 'CHANGE_ME_DATABASE_USER';
$DB_PASS = 'CHANGE_ME_DATABASE_PASSWORD';

$ADMIN_USER = 'CHANGE_ME_ADMIN_USER';
$ADMIN_PASS = 'CHANGE_ME_TO_A_LONG_UNIQUE_PASSWORD';

// Hosted transport/session policy. Keep "development" for local HTTP use.
// Production requires a canonical HTTPS origin; trust proxy headers only when
// they are overwritten by a proxy you control.
$APP_ENVIRONMENT = 'development';
$APP_HTTPS_ORIGIN = '';
$APP_TRUST_PROXY = false;

// Required for account-recovery email delivery. The web server/PHP mail
// transport must also be configured to send mail for this address.
$PASSWORD_RESET_FROM_EMAIL = 'CHANGE_ME_NO_REPLY_EMAIL';
