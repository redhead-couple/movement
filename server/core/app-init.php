<?php
// S-01: Production-safe error configuration.
// Errors are logged to the server log (log_errors=On in php.ini) but NEVER
// disclosed to the browser regardless of the host php.ini defaults.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL); // Keep full reporting so logs remain useful.

require_once __DIR__ . '/auth-check.php';
require_once __DIR__ . '/current-user.php';
require_once __DIR__ . '/project-paths.php';
require_once __DIR__ . '/response.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/current-user-record.php';
