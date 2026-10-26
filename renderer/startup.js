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
  // Seven-second cinematic splash; application initialization runs in parallel.
  const timeline = [
    [0, 'Подготовка к большому обновлению…', 'Версия 1.0'],
    [1400, 'Вспоминаем путь Fox Launcher', 'Версия 2.0'],
    [3000, 'Чаты, звонки и обновлённая команда', 'Версия 3.0'],
    [4700, 'Новые режимы, звуки и возможности', 'Почти готово'],
    [6100, 'Встречайте Fox Launcher 4.0!', '4.0 · НОВАЯ ЭРА']
  ];
  const status = document.getElementById('startupStatus');
  const stage = document.getElementById('startupStage');
  const kicker = document.querySelector('.startup-kicker');
  const heading = document.querySelector('.startup-heading');
  const cinematic = document.getElementById('startupCinematic');
  if (cinematic) cinematic.textContent = '1.0';
  const startedAt = Date.now();
  const tick = () => {
    const elapsed = Date.now() - startedAt;
    let current = timeline[0];
    for (const item of timeline) if (elapsed >= item[0]) current = item;
    if (status) status.textContent = current[1];
    if (stage) stage.textContent = current[2];
    if (cinematic) {
      const n = Math.min(4, 1 + Math.floor(elapsed / 1650));
      cinematic.textContent = elapsed > 6000 ? '4.0' : n.toFixed(1);
      cinematic.classList.toggle('is-final', elapsed > 5900);
    }
    const fill = document.getElementById('startupProgressFill');
    const percent = document.getElementById('startupPercent');
    const pct = Math.min(100, Math.round(elapsed / 7000 * 100));
    if (fill) fill.style.width = pct + '%';
    if (percent) percent.textContent = pct + '%';
  };
  tick();
  const ticker = setInterval(tick, 80);
  setTimeout(() => { clearInterval(ticker); removeOverlay(''); }, 7000);
  window.addEventListener('error', () => { if (status) status.textContent = 'Завершаем подготовку интерфейса…'; });
  window.addEventListener('unhandledrejection', () => { if (status) status.textContent = 'Завершаем подготовку интерфейса…'; });
})();
