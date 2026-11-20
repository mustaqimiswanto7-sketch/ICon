/**
 * PORTAL OPERASIONAL — REALTIME SYNC CLIENT
 * Memakai GAS_RPC yang sudah ada di index.html (kontrak RPC tidak diubah).
 */
(function (window, document) {
  'use strict';

  var INTERVAL_MS = 3000;
  var versions = null;
  var timer = null;
  var running = false;
  var refreshLocks = Object.create(null);
  var lastErrorAt = 0;

  function rpc(fn, args) {
    if (typeof window.GAS_RPC === 'function') {
      return window.GAS_RPC(fn, args || []);
    }
    return fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ function: fn, args: args || [] })
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || ('HTTP ' + response.status));
        }
        return payload.data;
      });
    });
  }

  function activeTab() {
    var active = document.querySelector('.nav-tab.active');
    return active && active.id ? active.id.replace(/^tab-/, '') : '';
  }

  function callIfAvailable(name, args) {
    var fn = window[name];
    if (typeof fn !== 'function') return;
    try {
      var result = fn.apply(window, args || []);
      if (result && typeof result.catch === 'function') {
        result.catch(function (e) {
          console.error('[PortalSync] Refresh ' + name + ' gagal:', e);
        });
      }
    } catch (e) {
      console.error('[PortalSync] Refresh ' + name + ' gagal:', e);
    }
  }

  function refreshModule(moduleName) {
    var tab = activeTab();
    var module = String(moduleName || '').toUpperCase();

    if (!tab || refreshLocks[module]) return;
    refreshLocks[module] = true;

    try {
      // Dashboard laporan dan riwayat bergantung pada data Portal.
      if (tab === 'files' && (
        module === 'DASHBOARD' || module === 'HISTORY' ||
        module.indexOf('PORTAL_') === 0
      )) {
        if (module === 'HISTORY' || module.indexOf('PORTAL_') === 0) {
          if (!refreshLocks['files-history']) {
            refreshLocks['files-history'] = true;
            callIfAvailable('loadHistoryLog');
            window.setTimeout(function () { refreshLocks['files-history'] = false; }, 1200);
          }
        }
        if (module === 'DASHBOARD' || module.indexOf('PORTAL_') === 0) {
          if (!refreshLocks['files-dashboard']) {
            refreshLocks['files-dashboard'] = true;
            callIfAvailable('loadDashboardReport', [true]);
            window.setTimeout(function () { refreshLocks['files-dashboard'] = false; }, 1200);
          }
        }
        return;
      }

      if (tab === 'portal' && module.indexOf('PORTAL_') === 0) {
        var select = document.getElementById('portal-sheet-select');
        var selected = select ? String(select.value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '';
        var expected = module.replace(/^PORTAL_/, '');
        if (selected === expected) callIfAvailable('loadPortalData');
        return;
      }

      if (tab === 'so' && (module === 'SO_DATA' || module === 'ADMIN_SO' || module === 'OUTLET')) {
        callIfAvailable('refreshCurrentSoView');
        return;
      }

      if (tab === 'cso' && module === 'CHECK_SO') {
        callIfAvailable('loadCheckResult');
        return;
      }

      if (tab === 'checklist' && module === 'CHECKLIST') {
        callIfAvailable('loadChecklistData');
        return;
      }

      if (tab === 'jadwal' && module === 'JADWAL') {
        callIfAvailable('loadJadwalData', [false]);
        return;
      }

      if (tab === 'outlet' && module === 'OUTLET') {
        callIfAvailable('loadOutletFolders');
        return;
      }

      if (tab === 'schedule' && module === 'JADWAL') {
        callIfAvailable('loadScheduleControl');
        return;
      }

      if (tab.indexOf('ctl-') === 0 && (module === 'MONITORING' || module === 'HEALTH')) {
        if (window.CTL && typeof window.CTL.refreshCurrent === 'function') {
          window.CTL.refreshCurrent();
        }
      }
    } finally {
      window.setTimeout(function () {
        refreshLocks[module] = false;
      }, 1200);
    }
  }

  function applyVersions(next) {
    if (!next || typeof next !== 'object') return;

    if (versions === null) {
      versions = Object.assign({}, next);
      return;
    }

    Object.keys(next).forEach(function (moduleName) {
      var current = Number(next[moduleName]);
      var previous = Number(versions[moduleName]);
      if (Number.isFinite(current) && Number.isFinite(previous) && current !== previous) {
        var detail = {
          moduleName: moduleName,
          version: current,
          previousVersion: previous,
          changedAt: new Date().toISOString()
        };
        document.dispatchEvent(new CustomEvent('portal:data-updated', { detail: detail }));
        refreshModule(moduleName);
      }
    });

    versions = Object.assign({}, next);
  }

  async function checkNow(force) {
    if (running) return;
    if (!force && document.visibilityState !== 'visible') return;

    running = true;
    try {
      var result = await rpc('getPortalVersions', []);
      applyVersions(result);
    } catch (e) {
      var now = Date.now();
      if (now - lastErrorAt > 10000) {
        console.error('[PortalSync] Tidak dapat mengambil versi data:', e);
        lastErrorAt = now;
      }
    } finally {
      running = false;
    }
  }

  function stop() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    stop();
    if (document.visibilityState !== 'visible') return;
    checkNow(true);
    timer = window.setInterval(function () {
      checkNow(false);
    }, INTERVAL_MS);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      checkNow(true);
      start();
    } else {
      stop();
    }
  });

  window.addEventListener('online', function () {
    checkNow(true);
  });

  window.PortalSync = {
    start: start,
    stop: stop,
    checkNow: checkNow,
    getVersions: function () {
      return versions ? Object.assign({}, versions) : null;
    }
  };

  start();
})(window, document);
