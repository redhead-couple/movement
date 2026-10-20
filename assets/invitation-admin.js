(() => {
    const input = document.getElementById('invitation-link');
    if (!input) return;
    input.value = new URL(input.value, location.origin).href;
    document.getElementById('copy-invitation').addEventListener('click', async () => {
        input.focus();
        input.select();
        try {
            await navigator.clipboard.writeText(input.value);
            document.getElementById('copy-status').textContent = 'Link copied.';
        } catch {
            document.getElementById('copy-status').textContent = 'Press Ctrl+C or Command+C to copy the selected link.';
        }
    });
})();
