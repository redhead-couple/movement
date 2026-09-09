(() => {
  const form = document.getElementById('dashboard-import-form');
  const input = document.getElementById('portable-project-input');
  const button = document.getElementById('import-project-button');
  if (!form || !input || !button) return;

  const maximumBytes = 40 * 1024 * 1024;

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      window.alert('Choose a portable slideshow .zip file.');
      input.value = '';
      return;
    }
    if (file.size <= 0 || file.size > maximumBytes) {
      window.alert('Choose a non-empty ZIP file no larger than 40 MB.');
      input.value = '';
      return;
    }

    button.disabled = true;
    button.textContent = 'Importing…';
    form.requestSubmit();
  });
})();
