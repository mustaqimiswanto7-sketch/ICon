/**
 * PORTAL OPERASIONAL — CACHE & VERSION MANAGER
 * Tambahkan sebagai file baru: CacheManager.gs
 */
var PORTAL_SYNC_MODULES_ = [
  'PORTAL_KONFIRMASI_SO',
  'PORTAL_PENGAJUAN_REJECT',
  'PORTAL_FINAL_REJECT',
  'PORTAL_KENDALA_PRODUCTION',
  'PORTAL_JUAL_BELI',
  'PORTAL_BELI_LOKAL',
  'PORTAL_RECEIPT',
  'PORTAL_QUESTION',
  'PORTAL_EXPIRED',
  'SO_DATA',
  'ADMIN_SO',
  'CHECKLIST',
  'CHECK_SO',
  'JADWAL',
  'OUTLET',
  'DASHBOARD',
  'HISTORY',
  'MONITORING',
  'HEALTH'
];

var PORTAL_SYNC_DEPENDENCIES_ = {
  PORTAL_KONFIRMASI_SO: ['DASHBOARD', 'HISTORY'],
  PORTAL_PENGAJUAN_REJECT: ['DASHBOARD', 'HISTORY'],
  PORTAL_FINAL_REJECT: ['DASHBOARD', 'HISTORY'],
  PORTAL_KENDALA_PRODUCTION: ['DASHBOARD', 'HISTORY'],
  PORTAL_JUAL_BELI: ['DASHBOARD', 'HISTORY'],
  PORTAL_BELI_LOKAL: ['DASHBOARD', 'HISTORY'],
  PORTAL_RECEIPT: ['DASHBOARD', 'HISTORY'],
  PORTAL_QUESTION: ['DASHBOARD', 'HISTORY'],
  PORTAL_EXPIRED: ['DASHBOARD', 'HISTORY'],
  OUTLET: ['SO_DATA', 'ADMIN_SO']
};

function portalSyncVersionKey_(moduleName) {
  return 'PORTAL_VERSION_' + String(moduleName).toUpperCase();
}

/**
 * Menandai satu atau beberapa modul berubah.
 * Pemanggilan hanya dilakukan setelah penulisan data berhasil.
 */
function afterDataChanged_(moduleName) {
  var module = String(moduleName || '').trim().toUpperCase();
  if (PORTAL_SYNC_MODULES_.indexOf(module) === -1) {
    throw new Error('Modul sinkronisasi tidak dikenal: ' + module);
  }

  var targets = [module].concat(PORTAL_SYNC_DEPENDENCIES_[module] || []);
  var unique = {};
  targets = targets.filter(function (name) {
    if (unique[name]) return false;
    unique[name] = true;
    return true;
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var versions = {};

    targets.forEach(function (name) {
      var key = portalSyncVersionKey_(name);
      var next = Number(props.getProperty(key) || 0) + 1;
      props.setProperty(key, String(next));
      versions[name] = next;
    });

    // Invalidasi cache lama yang sudah digunakan backend INVMOVE.
    targets.forEach(function (name) { portalSyncInvalidateLegacyCache_(name); });

    return versions;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Jaga kompatibilitas dengan cache version lama di Code.gs.
 * cacheBump_() adalah fungsi yang sudah ada di backend utama.
 */
function portalSyncInvalidateLegacyCache_(moduleName) {
  if (typeof cacheBump_ !== 'function') return;

  var keys = [];
  if (moduleName.indexOf('PORTAL_') === 0) keys = ['PD', 'HL'];
  else if (moduleName === 'SO_DATA' || moduleName === 'ADMIN_SO') keys = ['SOD'];
  else if (moduleName === 'CHECKLIST') keys = ['CL'];
  else if (moduleName === 'CHECK_SO') keys = ['CSO'];
  else if (moduleName === 'HISTORY') keys = ['HL'];

  keys.forEach(function (key) {
    try { cacheBump_(key); } catch (e) { Logger.log('Cache bump ' + key + ': ' + e.message); }
  });

  if (moduleName === 'MONITORING' || moduleName === 'HEALTH') {
    try {
      if (typeof invalidateTableCache_ === 'function') invalidateTableCache_();
    } catch (e) {
      Logger.log('Invalidasi cache Monitoring gagal: ' + e.message);
    }
  }
}

/** Endpoint ringan: hanya membaca Script Properties, tidak membaca Spreadsheet. */
function getPortalVersions() {
  var props = PropertiesService.getScriptProperties();
  var out = {};
  PORTAL_SYNC_MODULES_.forEach(function (name) {
    out[name] = Number(props.getProperty(portalSyncVersionKey_(name)) || 0);
  });
  return out;
}

/** Jalankan satu kali setelah memasang semua file sinkronisasi. */
function initializePortalSyncVersions() {
  var props = PropertiesService.getScriptProperties();
  var out = {};
  PORTAL_SYNC_MODULES_.forEach(function (name) {
    var key = portalSyncVersionKey_(name);
    if (props.getProperty(key) === null) props.setProperty(key, '1');
    out[name] = Number(props.getProperty(key) || 1);
  });
  return out;
}

function portalSyncPortalModule_(sheetName) {
  var key = String(sheetName || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  var map = {
    'KONFIRMASI_SO': 'PORTAL_KONFIRMASI_SO',
    'PENGAJUAN_REJECT': 'PORTAL_PENGAJUAN_REJECT',
    'FINAL_REJECT': 'PORTAL_FINAL_REJECT',
    'KENDALA_PRODUCTION': 'PORTAL_KENDALA_PRODUCTION',
    'JUAL_BELI': 'PORTAL_JUAL_BELI',
    'BELI_LOKAL': 'PORTAL_BELI_LOKAL',
    'RECEIPT': 'PORTAL_RECEIPT',
    'QUESTION': 'PORTAL_QUESTION',
    'EXPIRED': 'PORTAL_EXPIRED'
  };
  return map[key] || '';
}

/**
 * Dipanggil dari doPost setelah RPC write berhasil.
 * Ini menangani penulisan melalui Cloudflare RPC tanpa mengubah semua fungsi lama.
 */
function portalSyncAfterRpcWrite_(functionName, args, result) {
  if (result === false || (result && (result.success === false || result.ok === false))) return;

  var fn = String(functionName || '');
  var a = Array.isArray(args) ? args : [];
  var module = '';

  if (fn === 'updatePortalStatusCode' || fn === 'updatePortalKeterangan' || fn === 'deletePortalKeterangan') {
    module = portalSyncPortalModule_(a[0]);
  } else {
    var map = {
      createRow: 'SO_DATA',
      updateRow: 'SO_DATA',
      deleteRow: 'SO_DATA',
      adminSaveItem: 'ADMIN_SO',
      adminDeleteItem: 'ADMIN_SO',
      adminClearSO: 'ADMIN_SO',
      adminSaveMaster: 'ADMIN_SO',
      adminDeleteMaster: 'ADMIN_SO',
      adminSyncAll: 'ADMIN_SO',
      submitSO: 'ADMIN_SO',
      soSubmit: 'ADMIN_SO',
      createOutletFromTemplate: 'OUTLET',
      renameOutletSheets: 'OUTLET',
      jadwalGenerate: 'JADWAL',
      jadwalSimpanTanggal: 'JADWAL',
      setChecklistCell: 'CHECKLIST',
      setChecklistKeterangan: 'CHECKLIST',
      startCheckSoJob: 'CHECK_SO',
      runFullAnalysis: 'MONITORING',
      runAnalysisForOutlets: 'MONITORING',
      runAnalysis: 'MONITORING',
      runFromPanel: 'MONITORING',
      resumeAnalysis: 'MONITORING',
      closeAlert: 'MONITORING',
      runPeriodHealthFromPanel: 'HEALTH'
    };
    module = map[fn] || '';
  }

  if (module) afterDataChanged_(module);
}
