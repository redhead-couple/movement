/* Shared read-only previews for the online and desktop Media Trash screens. */
(() => {
    'use strict';
    const initialized = new WeakSet();

    function stop(root) {
        root.querySelectorAll('.media-trash-preview audio').forEach(audio => audio.pause());
        root.querySelectorAll('.media-trash-image-dialog[open]').forEach(dialog => dialog.close());
    }

    function enlarge(root, url, filename, trigger) {
        let dialog = root.querySelector('.media-trash-image-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.className = 'media-trash-image-dialog';
            dialog.setAttribute('aria-label', 'Image preview');
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'media-trash-preview-close';
            close.textContent = 'Close';
            close.addEventListener('click', () => dialog.close());
            const image = document.createElement('img');
            const caption = document.createElement('p');
            dialog.append(close, image, caption);
            dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
            (root === document ? document.body : root).appendChild(dialog);
        }
        dialog.querySelector('img').src = url;
        dialog.querySelector('img').alt = filename;
        dialog.querySelector('p').textContent = filename;
        dialog.addEventListener('close', () => trigger.isConnected && trigger.focus(), { once: true });
        dialog.showModal();
    }

    function initialize(root) {
        if (!initialized.has(root)) {
            initialized.add(root);
            root.addEventListener('play', event => {
                if (!event.target.matches('.media-trash-preview audio')) return;
                document.querySelectorAll('.media-trash-preview audio').forEach(audio => {
                    if (audio !== event.target) audio.pause();
                });
            }, true);
        }
        root.querySelectorAll('.media-trash-preview[data-preview-url]').forEach(container => {
            if (container.childElementCount) return;
            const { mediaType, previewUrl, filename } = container.dataset;
            const ext = filename.split('.').pop().toLowerCase();
            const image = mediaType === 'img' && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'].includes(ext);
            const sound = ['audio', 'speech'].includes(mediaType) && ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(ext);
            const unavailable = () => {
                if (container.querySelector('.media-trash-preview-error')) return;
                const message = document.createElement('span');
                message.className = 'media-trash-preview-error';
                message.textContent = 'Preview unavailable. You can still restore this file.';
                container.appendChild(message);
            };
            if (image) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'media-trash-thumbnail';
                button.title = 'Enlarge image';
                button.setAttribute('aria-label', `Enlarge ${filename}`);
                const thumbnail = document.createElement('img');
                thumbnail.alt = filename;
                thumbnail.loading = 'lazy';
                thumbnail.addEventListener('error', () => { button.hidden = true; unavailable(); });
                thumbnail.src = previewUrl;
                button.appendChild(thumbnail);
                button.addEventListener('click', () => enlarge(root, previewUrl, filename, button));
                container.appendChild(button);
            } else if (sound) {
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.preload = 'metadata';
                audio.setAttribute('aria-label', `Play ${filename}`);
                audio.addEventListener('error', unavailable);
                audio.src = previewUrl;
                container.appendChild(audio);
            } else unavailable();
        });
    }
    window.MediaTrashPreview = { initialize, stop };
    window.addEventListener('pagehide', () => stop(document));
})();
