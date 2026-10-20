(() => {
    const toggles = [];
    document.querySelectorAll('[data-password-toggle]').forEach(button => {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) return;
        const name = input.id === 'confirm_password' ? 'confirmation' : 'password';
        const conceal = () => {
            input.type = 'password';
            button.textContent = `Show ${name}`;
        };
        conceal();
        button.hidden = false;
        button.style.removeProperty('display');
        button.addEventListener('click', () => {
            const reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            button.textContent = `${reveal ? 'Hide' : 'Show'} ${name}`;
        });
        toggles.push(conceal);
    });
    // Conceal the fields again when returning through browser history.
    window.addEventListener('pageshow', () => toggles.forEach(conceal => conceal()));
})();
