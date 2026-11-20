/* Static-hosting bridge.
   There is no Electron preload here: PDF is produced by the browser print
   dialog (the fallback already built into app.js). This file only marks the
   web build and surfaces unexpected fetch failures in the existing toast. */
(function () {
  'use strict';

  window.ANALIZA_DZIALKI_WEB = true;

  window.addEventListener('unhandledrejection', function (e) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    var reason = e && e.reason;
    var msg = (reason && reason.message) ? reason.message : String(reason || 'Nieznany błąd');
    toast.textContent = 'Błąd pobrania danych: ' + msg;
    toast.hidden = false;
    clearTimeout(window.__analizaWebToastTimer);
    window.__analizaWebToastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  });

  window.addEventListener('load', function () {
    var app = document.getElementById('app');
    if (app) app.dataset.mode = 'web';
  });
})();
