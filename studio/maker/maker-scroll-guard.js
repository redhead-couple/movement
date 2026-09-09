(function exposeMakerScrollGuard(global) {
  'use strict';

  const PANEL_SELECTOR = [
    '.sidebar',
    '#controls',
    '[data-maker-controls]',
    '.maker-controls',
    '.controls-panel',
    '.control-panel',
    'body > aside'
  ].join(', ');

  function addPanelClass(panel) {
    if (panel && panel.classList) {
      panel.classList.add('movement-maker-scroll-panel');
    }
  }

  function install(frame) {
    const doc = frame && frame.contentDocument;
    if (!doc || !doc.head || !doc.body) return false;

    let stylesheet = doc.querySelector('link[data-movement-maker-scroll-guard]');
    if (!stylesheet) {
      stylesheet = doc.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = new URL('/studio/maker/maker-scroll-guard.css', frame.ownerDocument.baseURI).href;
      stylesheet.dataset.movementMakerScrollGuard = 'true';
      doc.head.appendChild(stylesheet);
    }

    doc.querySelectorAll(PANEL_SELECTOR).forEach(addPanelClass);

    doc.querySelectorAll('input, select, textarea, button').forEach(control => {
      const knownPanel = control.closest(PANEL_SELECTOR);
      if (knownPanel) {
        addPanelClass(knownPanel);
        return;
      }

      let topLevel = control;
      while (topLevel.parentElement && topLevel.parentElement !== doc.body) {
        topLevel = topLevel.parentElement;
      }
      if (topLevel.parentElement === doc.body) addPanelClass(topLevel);
    });

    return true;
  }

  global.MovementMakerScrollGuard = Object.freeze({ install });
})(window);
