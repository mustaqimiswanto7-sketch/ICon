/**
 * PORTAL OPERASIONAL — REALTIME SYNC TRIGGERS
 *
 * Pasang dengan menjalankan installPortalSyncTriggers() satu kali.
 * Trigger onEdit menangkap perubahan manual pada spreadsheet.
 * Trigger berkala 1 menit menjadi fallback jika perubahan tidak tertangkap.
 *
 * Tidak ada proses Apps Script yang berjalan setiap 3 detik saat browser tutup.
 */
var PORTAL_SYNC_WATCHED_SPREADSHEETS_ = [
  {
    id: '1aKiIXy25lGZpNxdNpimCZOhLfwSC8IgZ3CQ3o0-4Kdo',
    label: 'PORTAL',
    modules: [
      'PORTAL_KONFIRMASI_SO', 'PORTAL_PENGAJUAN_REJECT', 'PORTAL_FINAL_REJECT',
      'PORTAL_KENDALA_PRODUCTION', 'PORTAL_JUAL_BELI', 'PORTAL_BELI_LOKAL',
      'PORTAL_RECEIPT', 'PORTAL_QUESTION', 'PORTAL_EXPIRED'
    ]
  },
  {
    id: '1U_xe8cPTT27SiVnM8h4WVQU2KHbJQOaejeDBcG6N5DU',
    label: 'INVMOVE',
    modules: ['SO_DATA', 'CHECKLIST', 'CHECK_SO', 'JADWAL', 'OUTLET']
  },
  {
    id: '1ujAPtz9yvniAhJW4kR05qSnDqouLV03USrDvTTevPKQ',
    label: 'CONTROL',
    modules: ['MONITORING', 'HEALTH']
  }
];

var PORTAL_SYNC_PORTAL_SHEET_MAP_ = {
  'KONFIRMASI SO': 'PORTAL_KONFIRMASI_SO',
  'PENGAJUAN REJECT': 'PORTAL_PENGAJUAN_REJECT',
  'FINAL REJECT': 'PORTAL_FINAL_REJECT',
  'KENDALA PRODUCTION': 'PORTAL_KENDALA_PRODUCTION',
  'JUAL BELI': 'PORTAL_JUAL_BELI',
  'BELI LOKAL': 'PORTAL_BELI_LOKAL',
  'RECEIPT': 'PORTAL_RECEIPT',
  'QUESTION': 'PORTAL_QUESTION',
  'EXPIRED': 'PORTAL_EXPIRED'
};

function portalSyncFindWatch_(spreadsheetId) {
  for (var i = 0; i < PORTAL_SYNC_WATCHED_SPREADSHEETS_.length; i++) {
    if (PORTAL_SYNC_WATCHED_SPREADSHEETS_[i].id === spreadsheetId) {
      return PORTAL_SYNC_WATCHED_SPREADSHEETS_[i];
    }
  }
  return null;
}

function portalSyncModulesForEdit_(spreadsheetId, sheetName) {
  var name = String(sheetName || '').trim().toUpperCase();

  if (spreadsheetId === '1aKiIXy25lGZpNxdNpimCZOhLfwSC8IgZ3CQ3o0-4Kdo') {
    return PORTAL_SYNC_PORTAL_SHEET_MAP_[String(sheetName || '').trim().toUpperCase()]
      ? [PORTAL_SYNC_PORTAL_SHEET_MAP_[String(sheetName || '').trim().toUpperCase()]]
      : [];
  }

  if (spreadsheetId === '1U_xe8cPTT27SiVnM8h4WVQU2KHbJQOaejeDBcG6N5DU') {
    if (name === 'SO_DATA') return ['SO_DATA'];
    if (name === 'CHECKLIST_PROD') return ['CHECKLIST'];
    if (name.indexOf('CHECK_SO_') === 0) return ['CHECK_SO'];
    if (name.indexOf('JADWAL') >= 0) return ['JADWAL'];
    return [];
  }

  if (spreadsheetId === '1ujAPtz9yvniAhJW4kR05qSnDqouLV03USrDvTTevPKQ') {
    if (name === 'HEALTH_PERIODE' || name === 'HEALTH_DETAIL') return ['HEALTH'];
    if (name === 'MONITORING_DETAIL' || name === 'ALERT_LOG' ||
        name === 'RUN_LOG' || name === 'DASHBOARD' || name === 'CONFIG' ||
        name === 'TOLERANCE' || name === 'OUTLET') return ['MONITORING'];
  }
  return [];
}

function portalSyncStoreFileMtime_(spreadsheetId) {
  try {
    var stamp = DriveApp.getFileById(spreadsheetId).getLastUpdated().getTime();
    PropertiesService.getScriptProperties()
      .setProperty('PORTAL_SYNC_FILE_MTIME_' + spreadsheetId, String(stamp));
  } catch (e) {
    Logger.log('Tidak dapat membaca waktu perubahan file ' + spreadsheetId + ': ' + e.message);
  }
}

function portalSyncOnEdit(e) {
  if (!e || !e.source || !e.range) return;

  var spreadsheetId = e.source.getId();
  var sheetName = e.range.getSheet().getName();
  var modules = portalSyncModulesForEdit_(spreadsheetId, sheetName);

  modules.forEach(function (moduleName) {
    afterDataChanged_(moduleName);
  });

  if (modules.length) portalSyncStoreFileMtime_(spreadsheetId);
}

/**
 * Pasang tiga trigger onEdit (Portal, INVMOVE, CONTROL) dan satu trigger
 * fallback setiap satu menit. Fungsi ini aman dijalankan ulang.
 */
function installPortalSyncTriggers() {
  var handlers = ['portalSyncOnEdit', 'portalSyncScheduledCheck'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var installed = [];
  PORTAL_SYNC_WATCHED_SPREADSHEETS_.forEach(function (watch) {
    var ss = SpreadsheetApp.openById(watch.id);
    var trigger = ScriptApp.newTrigger('portalSyncOnEdit')
      .forSpreadsheet(ss)
      .onEdit()
      .create();
    installed.push({ label: watch.label, triggerId: trigger.getUniqueId() });
    portalSyncStoreFileMtime_(watch.id);
  });

  var minuteTrigger = ScriptApp.newTrigger('portalSyncScheduledCheck')
    .timeBased()
    .everyMinutes(1)
    .create();
  installed.push({ label: 'FALLBACK_1_MINUTE', triggerId: minuteTrigger.getUniqueId() });

  return installed;
}

/**
 * Fallback file-level reconciliation.
 * Jika trigger onEdit gagal, perubahan file tetap terdeteksi dalam ±1 menit.
 */
function portalSyncScheduledCheck() {
  var props = PropertiesService.getScriptProperties();
  var changed = [];

  PORTAL_SYNC_WATCHED_SPREADSHEETS_.forEach(function (watch) {
    try {
      var stamp = DriveApp.getFileById(watch.id).getLastUpdated().getTime();
      var key = 'PORTAL_SYNC_FILE_MTIME_' + watch.id;
      var previous = Number(props.getProperty(key) || 0);

      if (previous && stamp !== previous) {
        watch.modules.forEach(function (moduleName) {
          afterDataChanged_(moduleName);
          changed.push(moduleName);
        });
      }
      props.setProperty(key, String(stamp));
    } catch (e) {
      Logger.log('Fallback sync ' + watch.label + ' gagal: ' + e.message);
    }
  });

  return { changedModules: changed, checkedAt: new Date().toISOString() };
}

function removePortalSyncTriggers() {
  var handlers = ['portalSyncOnEdit', 'portalSyncScheduledCheck'];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}
