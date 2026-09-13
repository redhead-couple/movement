(() => {
    const settings = document.getElementById('password-settings');
    const success = document.getElementById('password-success');
    const error = document.getElementById('password-error');

    // Focus the result after the POST reload, outside the collapsed form.
    (error || success)?.focus();
    if (!settings) return;

    const passwordFields = settings.querySelectorAll('input[type="password"]');
    const clearPasswords = () => {
        passwordFields.forEach(input => { input.value = ''; });
    };
    if (success) clearPasswords();

    let wasOpen = settings.open;
    settings.addEventListener('toggle', () => {
        if (settings.open && !wasOpen) {
            if (success) clearPasswords();
            passwordFields[0]?.focus();
        } else if (!settings.open && settings.contains(document.activeElement)) {
            settings.querySelector('summary').focus();
        }
        wasOpen = settings.open;
    });
})();
