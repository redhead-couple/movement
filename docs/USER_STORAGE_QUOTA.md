# Online user storage quota

The PHP website defaults to **1 GiB (1,073,741,824 bytes) per user**.
To change it, add this setting to the existing private `app-config.php`:

```php
$USER_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;
```

Use a positive integer number of bytes. Invalid values fail closed. The example
configuration documents the setting; do not replace a live configuration with
the example. No database migration is needed.

The limit counts actual file lengths throughout the user's project directory,
including media, JSON, backups and abandoned temporary files. It also reserves
room for the peak additional project-storage bytes needed by the pending
operation: staged media, rollback copies, safety backups and replacement JSON.
Bounds are conservative; an operation may need more headroom than its final
size. Directory metadata and PHP's incoming HTTP upload spool outside project
storage are not part of this accounting. This is not a server-wide disk quota.

All growing web operations use the same account lock before inspecting usage:
editor saves/uploads, media-library uploads, project creation, duplication,
portable ZIP import, restore/flow import and publication updates. Project locks
are acquired after the account lock. Requests for different projects belonging
to the same user cannot spend the same free bytes. Different accounts use
independent locks. Usage is rescanned under the lock, so deletions and previous
failed writes do not leave a stale quota counter.

Quota rejection happens before copying project content or creating a safety
backup. Existing content is not deleted to satisfy the limit. An account already
over quota can still read/play projects and delete files/projects to free space.
Updates requiring additional temporary space may be blocked until space is freed
or the configured quota is raised. Import uses the dashboard's existing flash
error; other endpoints report a storage-limit error (HTTP 507). Busy writers
retry; unreadable usage or invalid configuration fails closed.

## Files to deploy for this change

Upload the helpers first, then the endpoints (ideally in one release):

1. `server/core/storage-quota.php` (new)
2. `server/core/project-storage.php`
3. `server/core/portable-project-import.php`
4. `json-maker.php`
5. `project-media.php`
6. `create-project.php`
7. `duplicate-project.php`
8. `restore-flow.php`
9. `publish-project.php`

No upload of test files, this document, or `app-config.example.php` is needed.
The default takes effect without editing private configuration. Existing desktop
storage is not changed by this PHP feature.

Regression coverage: `tests/storage-quota.test.cjs` exercises ordinary writes,
safe quota rejection, temporary/backup accounting, deletion above quota,
independent accounts, and concurrent requests in separate PHP processes/sessions.
Existing media, publication and portable-import tests cover compatibility.
