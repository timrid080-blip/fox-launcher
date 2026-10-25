/* Independent startup-overlay watchdog. Must load before app.js. */
(() => {
  'use strict';
  let finished = false;
  const removeOverlay = (message = '') => {
    if (finished) return;
    debug('removing overlay: ' + message);
    finished = true;
    const overlay = document.getElementById('startupOverlay');
    const status = document.getElementById('startupStatus');
    const stage = document.getElementById('startupStage');
    const percent = document.getElementById('startupPercent');
    const fill = document.getElementById('startupProgressFill');
    if (message && status) status.textContent = message;
    if (stage) stage.textContent = 'Готово';
    if (percent) percent.textContent = '100%';
    if (fill) fill.style.width = '100%';
    if (overlay) {
      overlay.classList.add('is-leaving');
      // Hard removal is intentional: CSS/animation failures must not block the UI.
      setTimeout(() => overlay.remove(), 600);
    }
  };
  const debug = (message) => { try { console.error('[FOX STARTUP]', message); } catch {} };
  debug('startup.js loaded');
  window.__foxFinishStartup = removeOverlay;
  // This timer is independent of app.js initialization and API calls.
  // Keep the splash purely visual and brief; updater and app initialization continue independently.
  setTimeout(() => removeOverlay(''), 1100);
  window.addEventListener('error', () => {
    setTimeout(() => removeOverlay(''), 500);
  });
  window.addEventListener('unhandledrejection', () => {
    setTimeout(() => removeOverlay(''), 500);
  });
})();
