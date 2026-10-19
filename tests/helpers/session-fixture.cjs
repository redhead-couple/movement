const { createHash } = require('node:crypto');

// Synthetic identities for route/media fixtures; never use application accounts.
const passwordHash = 'synthetic-password-hash-for-route-fixtures';
const version = createHash('sha256').update(passwordHash).digest('hex');
function sessionData(username, id) {
  return `username|s:${Buffer.byteLength(username)}:"${username}";user_id|i:${id};credential_version|s:64:"${version}";`;
}
function databaseSource(users) {
  const data = Buffer.from(JSON.stringify(users)).toString('base64');
  return `<?php
function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, email TEXT, created_at TEXT)');
    $stmt = $pdo->prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)');
    foreach (json_decode(base64_decode('${data}'), true) as $id => $username) {
        $stmt->execute([$id, $username, '${passwordHash}']);
    }
    return $pdo;
}
`;
}
module.exports = { passwordHash, version, sessionData, databaseSource };
