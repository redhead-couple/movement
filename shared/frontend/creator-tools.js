(() => {
  const menus = Array.from(document.querySelectorAll('details.creator-tools'));
  if (menus.length === 0) return;

  document.addEventListener('click', event => {
    for (const menu of menus) {
      if (menu.open && !menu.contains(event.target)) {
        menu.open = false;
      }
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;

    for (const menu of menus) {
      if (!menu.open) continue;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
})();
