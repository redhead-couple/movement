(() => {
    const parameters = new URLSearchParams(location.hash.slice(1));
    if (!parameters.has('invite')) return;
    const token = parameters.get('invite') || '';
    // Strip the secret before navigating; fragments never enter server access logs.
    history.replaceState(null, '', location.pathname);
    const form = document.getElementById('invitation-inspect');
    form.elements.invitation.value = /^[a-f0-9]{64}$/.test(token) ? token : '';
    form.submit();
})();
