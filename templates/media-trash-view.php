<?php
// Included only after project ownership and request validation in project-media.php.
if (!isset($trashSnapshot, $guard)) { http_response_code(404); exit; }
?>
<section aria-labelledby="trashHeading">
    <h2 id="trashHeading">Media Trash (<?php echo count($trashSnapshot['files']); ?>)</h2>
    <p>Existing files will not be overwritten when restored. Trash still uses storage space.</p>
    <?php if ($trashNotice !== ''): ?><p role="status"><?php echo htmlspecialchars($trashNotice, ENT_QUOTES, 'UTF-8'); ?></p><?php endif; ?>
    <?php if ($trashError !== ''): ?><p role="alert"><?php echo htmlspecialchars($trashError, ENT_QUOTES, 'UTF-8'); ?></p><?php endif; ?>
    <form id="emptyMediaTrashForm" method="post" onsubmit="document.getElementById('emptyMediaTrashConfirmation').showModal(); return false;">
        <?php renderProjectMediaCsrfFields($guard); ?>
        <input type="hidden" name="action" value="empty_media_trash">
        <input type="hidden" name="trash_token" value="<?php echo htmlspecialchars($trashSnapshot['token'], ENT_QUOTES, 'UTF-8'); ?>">
        <button class="button button-secondary" type="submit" <?php echo !$trashSnapshot['files'] || $trashError !== '' ? 'disabled' : ''; ?>>Empty Trash…</button>
    </form>
    <dialog id="emptyMediaTrashConfirmation" aria-labelledby="emptyMediaTrashQuestion" aria-describedby="emptyMediaTrashWarning" style="max-width: min(440px, 90vw); border: 1px solid #ccc; border-radius: 12px; padding: 24px;">
        <form method="dialog">
            <h2 id="emptyMediaTrashQuestion">Permanently delete <?php echo count($trashSnapshot['files']); ?> <?php echo count($trashSnapshot['files']) === 1 ? 'file' : 'files'; ?> from Media Trash?</h2>
            <p id="emptyMediaTrashWarning">This cannot be undone.</p>
            <div class="actions">
                <button class="button button-secondary" type="submit" autofocus>Cancel</button>
                <button class="button button-primary" type="button" id="confirmEmptyMediaTrash" onclick="this.disabled = true; document.getElementById('emptyMediaTrashForm').submit();">Empty Trash</button>
            </div>
        </form>
    </dialog>
    <?php if (!$trashSnapshot['files'] && $trashError === ''): ?><p class="empty-state">Media Trash is empty.</p><?php endif; ?>
    <div class="file-list" style="margin-top: 16px;">
        <?php foreach ($trashSnapshot['files'] as $item): ?>
            <form method="post" class="file-item media-trash-item" data-trash-type="<?php echo $item['type']; ?>">
                <?php renderProjectMediaCsrfFields($guard); ?>
                <input type="hidden" name="action" value="restore_media">
                <input type="hidden" name="folder" value="<?php echo $item['type']; ?>">
                <input type="hidden" name="trash_id" value="<?php echo htmlspecialchars($item['trashId'], ENT_QUOTES, 'UTF-8'); ?>">
                <input type="hidden" name="filename" value="<?php echo htmlspecialchars($item['filename'], ENT_QUOTES, 'UTF-8'); ?>">
                <?php $previewUrl = $projectMediaWebDir . '.movement-media-trash/' . rawurlencode($item['trashId']) . '/' . $item['type'] . '/' . rawurlencode($item['filename']) . '&trash_preview=1'; ?>
                <div class="media-trash-preview" data-media-type="<?php echo $item['type']; ?>" data-filename="<?php echo htmlspecialchars($item['filename'], ENT_QUOTES, 'UTF-8'); ?>" data-preview-url="<?php echo htmlspecialchars($previewUrl, ENT_QUOTES, 'UTF-8'); ?>"></div>
                <div style="overflow-wrap: anywhere;">
                    <strong><?php echo htmlspecialchars($item['filename'], ENT_QUOTES, 'UTF-8'); ?></strong>
                    <p><?php echo ['img' => 'Image', 'audio' => 'Audio', 'speech' => 'Speech'][$item['type']]; ?> · <?php echo htmlspecialchars(explode('--', $item['trashId'])[0], ENT_QUOTES, 'UTF-8'); ?></p>
                </div>
                <button type="submit" class="button button-secondary">Restore</button>
            </form>
        <?php endforeach; ?>
    </div>
</section>
<script src="/studio/editor/media-trash-preview.js"></script>
<script>MediaTrashPreview.initialize(document);</script>
