// ============================================================
//  Inventory Control — Google Apps Script Backend (v2: gabungan + performa)
//  - Modul Stock Opname ada di SO.gs (namespace SO) + SoPanel.html + SoForm.html
//  - Cache berlapis (CacheService berversi) + pembacaan sheet Portal 1x per proses
//  - Semua fungsi lama dipertahankan agar file .gs lain (Control, AI, Jadwal) tetap jalan
// ============================================================

const INVMOVE_SS_ID = "1U_xe8cPTT27SiVnM8h4WVQU2KHbJQOaejeDBcG6N5DU";
let _invSS = null;
function getInvSS_() {
  if (!_invSS) _invSS = SpreadsheetApp.openById(INVMOVE_SS_ID);
  return _invSS;
}

const SHEET_NAME = "SO_DATA";
const HEADERS    = ["NAMA OUTLET", "DAY SO", "MENGISI LINK SO", "Adjustment Number", "Release", "Keterangan", "File URL", "Tanggal SO"];

const FOLDER_MAP = {
  "SENIN"  : "16kjcv-3Latnqsf3NGxgKR0KGJy_NMDsG",
  "SELASA" : "1Dei_JkxSJut0QW7bOALYDxHa3WjZeqVL",
  "RABU"   : "1B8QCsLsQIrnU8M-zSxj-K7UiCp_K2Ew4",
  "KAMIS"  : "12HTRR8HIm9RU08GGNirzR-6hkD3J0Fmj",
  "JUMAT"  : "18xB_eV-icdZ1XrQtdqWgLWupCQgbHOVu",
  "SABTU"  : "1sF_mYGW4LEK6GT4wi-dC2GjzC-_lXIKi",
  "MINGGU" : "1p4h5XWfRJ0VmTxlv_0HT3pYmnlvSfnxJ",
};

const PENGIRIMAN_FOLDER_MAP = {
  "KAMIS"  : "1v4pCo_gi8JjPg_0xEh4cLl5MCZVJ59id",
  "JUMAT" : "1o2-7y1RFs8vJgnQLYSFlDeG243qgX_1q",
  "SENIN"   : "1VDKdSD50DbBl2venaMOKj-wOyixpII_t",
  "SELASA"  : "1YN1GQbUhIGrEEH-VFBnStnzS64InX0XK",
  "RABU"  : "1Zsi-biwAm1ppXXq9grwSUMSrZbuKz1jQ",
};

// ============================================================
//  CACHE BERLAPIS (CacheService, dipecah per 30 ribu karakter, berversi)
//  cacheVer_/cacheBump_: ganti versi = semua cache lama otomatis tidak terpakai.
// ============================================================
var CC_CHUNK = 30000, CC_MAXPARTS = 60;
function cacheGetBig_(key) {
  try {
    var c = CacheService.getScriptCache(), n = parseInt(c.get(key + '#n') || '0', 10);
    if (!n) return null;
    var keys = []; for (var i = 0; i < n; i++) keys.push(key + '#' + i);
    var parts = c.getAll(keys), s = '';
    for (i = 0; i < n; i++) { var p = parts[key + '#' + i]; if (p == null) return null; s += p; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function cachePutBig_(key, obj, ttl) {
  try {
    var s = JSON.stringify(obj), n = Math.ceil(s.length / CC_CHUNK);
    if (n > CC_MAXPARTS) return;
    var o = {}; o[key + '#n'] = String(n);
    for (var i = 0; i < n; i++) o[key + '#' + i] = s.substr(i * CC_CHUNK, CC_CHUNK);
    CacheService.getScriptCache().putAll(o, ttl || 60);
  } catch (e) { }
}
function cacheVer_(name) { try { return CacheService.getScriptCache().get('VER_' + name) || '0'; } catch (e) { return '0'; } }
function cacheBump_(name) { try { CacheService.getScriptCache().put('VER_' + name, String(Date.now()), 21600); } catch (e) { } }

// ============================================================
//  OUTLET BARU — Buat Spreadsheet Outlet dari Template
// ============================================================
const OUTLET_TEMPLATE_ID = "12OKIn70vRgY_aFsv5eLQLajQa4bFQho34g1MlgQnWfM";

const OUTLET_FOLDER_MAP = {
  "SENIN"   : "1VDKdSD50DbBl2venaMOKj-wOyixpII_t",
  "SELASA"  : "1YN1GQbUhIGrEEH-VFBnStnzS64InX0XK",
  "RABU"  : "1Zsi-biwAm1ppXXq9grwSUMSrZbuKz1jQ",
  "KAMIS"  : "1v4pCo_gi8JjPg_0xEh4cLl5MCZVJ59id",
  "JUMAT" : "1o2-7y1RFs8vJgnQLYSFlDeG243qgX_1q"
};

function getOutletFolderList() { return Object.keys(OUTLET_FOLDER_MAP); }

const OUTLET_NAME_PREFIX = "Link SO / ";

// Konfigurasi "Tutup Outlet": template 1 sheet + folder tetap "Close Outlet"
const CLOSE_OUTLET_TEMPLATE_ID  = "1EU7GcSU646cOEzvT9NlywGYESigoBdVpwCzJkBz2R94";
const CLOSE_OUTLET_FOLDER_ID    = "1H_w-USsliEhXWBUr3GG4LBq1X2cFi1Sv";
const CLOSE_OUTLET_NAME_PREFIX  = "Close Outlet / ";
const CLOSE_OUTLET_FOLDER_LABEL = "Close Outlet";

function createOutletFromTemplate(namaOutlet, namaFolder, tipe) {
  namaOutlet = (namaOutlet || "").trim();
  if (!namaOutlet) throw new Error("Nama outlet tidak boleh kosong.");
  const isTutup = String(tipe || "baru").toLowerCase() === "tutup";
  let templateId, folder, finalName, folderLabel;
  if (isTutup) {
    if (CLOSE_OUTLET_TEMPLATE_ID.indexOf("PASTE_ID") === 0) throw new Error("CLOSE_OUTLET_TEMPLATE_ID belum diisi di Code.gs.");
    templateId  = CLOSE_OUTLET_TEMPLATE_ID;
    folder      = DriveApp.getFolderById(CLOSE_OUTLET_FOLDER_ID);
    finalName   = CLOSE_OUTLET_NAME_PREFIX + namaOutlet;
    folderLabel = CLOSE_OUTLET_FOLDER_LABEL;
  } else {
    if (!OUTLET_FOLDER_MAP[namaFolder]) throw new Error("Folder tujuan tidak valid.");
    if (OUTLET_TEMPLATE_ID.indexOf("PASTE_ID") === 0) throw new Error("OUTLET_TEMPLATE_ID belum diisi di Code.gs.");
    templateId  = OUTLET_TEMPLATE_ID;
    folder      = DriveApp.getFolderById(OUTLET_FOLDER_MAP[namaFolder]);
    finalName   = OUTLET_NAME_PREFIX + namaOutlet;
    folderLabel = namaFolder;
  }
  const templateFile = DriveApp.getFileById(templateId);
  const existing = folder.getFilesByName(finalName);
  if (existing.hasNext()) throw new Error('Sudah ada spreadsheet bernama "' + finalName + '" di folder "' + folderLabel + '".');
  const newFile = templateFile.makeCopy(finalName, folder);
  return { fileId: newFile.getId(), fileUrl: newFile.getUrl(), fileName: finalName, folderName: folderLabel, tipe: isTutup ? "tutup" : "baru", createdAt: new Date().toISOString() };
}

const HARI_ID_LIST  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const BULAN_ID_LIST = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function _formatTanggalIndo(dateObj) {
  return HARI_ID_LIST[dateObj.getDay()] + ', ' + dateObj.getDate() + ' ' + BULAN_ID_LIST[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
}

function getOutletSheetNames(fileId) {
  const ss = SpreadsheetApp.openById(fileId);
  return ss.getSheets().map(function(s, i) { return { index: i, currentName: s.getName() }; });
}

function renameOutletSheets(fileId, dates) {
  const ss = SpreadsheetApp.openById(fileId);
  const sheets = ss.getSheets();
  if (!dates || dates.length !== sheets.length) throw new Error('Jumlah tanggal (' + (dates ? dates.length : 0) + ') tidak sesuai jumlah sheet (' + sheets.length + ').');
  const results = [];
  sheets.forEach(function(sheet, i) {
    const dateStr = dates[i];
    if (!dateStr) { results.push({ index: i, skipped: true, name: sheet.getName() }); return; }
    const isLast = (i === sheets.length - 1);
    const label  = isLast ? 'BLN' : ('MG ' + (i + 1));
    const newName = label + ' : ' + _formatTanggalIndo(new Date(dateStr + 'T00:00:00'));
    sheet.setName(newName);
    results.push({ index: i, skipped: false, name: newName });
  });
  return results;
}

const CHECK_SO_SHEET_PREFIX = "CEK_SO_";
const PORTAL_SS_ID = "1aKiIXy25lGZpNxdNpimCZOhLfwSC8IgZ3CQ3o0-4Kdo";

const SCHEDULE_CONTROL_URL = "https://script.google.com/macros/s/AKfycbwTMbmUFMlJKbX_tTVGvQHzZ8d4zRmfH-69eM7UwPTxxBb8efIxuYg5pOPMgEN14-G9Hg/exec";
function getScheduleControlUrl() { return SCHEDULE_CONTROL_URL; }

const HISTORY_LOG_SHEET_NAME = "HISTORY_LOG";
const HISTORY_LOG_HEADERS = ["Timestamp", "Jenis Pengajuan", "Nama Outlet", "Detail Item / Jumlah", "Kode", "Status", "Baris Sumber"];
const STATUS_TRACK_SHEET_NAME = "STATUS_TRACK";
const STATUS_TRACK_HEADERS = ["Sheet Sumber", "Baris", "Status Terakhir Terekam", "Waktu Terakhir Dicek"];

// Logo cetak diambil di server → base64 (dipakai juga oleh modul SO)
const PRINT_LOGO_FILE_ID = "1Q4IZzDLEN7riG1pUfIAJjhzo9TVNleud";
function getPrintLogoBase64() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "PRINT_LOGO_B64_V1";
  try { const cached = cache.get(cacheKey); if (cached) return cached; } catch (e) { }
  try {
    const blob = DriveApp.getFileById(PRINT_LOGO_FILE_ID).getBlob();
    const b64  = "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
    try { cache.put(cacheKey, b64, 21600); } catch (e2) { }
    return b64;
  } catch (e) { return ""; }
}

// ── Helpers ──────────────────────────────────────────────────
function getSheet() {
  const ss = getInvSS_();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else { _ensureTanggalSoColumn(sheet); }
  return sheet;
}

function _ensureTanggalSoColumn(sheet) {
  const lastCol = sheet.getLastColumn();
  const headerRow = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (!headerRow.some(h => String(h).trim().toLowerCase() === "tanggal so")) {
    const targetCol = Math.max(lastCol + 1, HEADERS.length);
    sheet.getRange(1, targetCol).setValue("Tanggal SO").setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
  }
}

// ── Web App entry points ──────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  // Form Stock Opname untuk outlet:  <url web app>?page=so
  if (p.page === 'so') {
    return HtmlService.createHtmlOutputFromFile("SoForm").setTitle("Stock Opname")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  const action = p.action || "ui";
  if (action === "ui") return serveUI();
  return result(false, null, "Gunakan POST/google.script.run untuk keamanan data.");
}

function serveUI() {
  const template = HtmlService.createTemplateFromFile("index");
  return template.evaluate()
    .setTitle("Inventory Control")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/** Dipakai index.html: <?!= include('SoPanel') ?>. Bila file tidak ada, halaman tetap jalan. */
function include(name) {
  try { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
  catch (e) { return '<!-- include ' + name + ' gagal: ' + String(e.message).replace(/-->/g, '') + ' -->'; }
}
function getSoFormUrl() { return ScriptApp.getService().getUrl() + '?page=so'; }

// ── CRUD Operations (SO_DATA — dipertahankan untuk file lain / AI) ──
function getAllRows() {
  const ck = 'SOD|' + cacheVer_('SOD'), hit = cacheGetBig_(ck);
  if (hit) return hit;
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const tz = Session.getScriptTimeZone();
  const rows = data.slice(1).map((row, i) => ({
    rowIndex: i + 2, namaOutlet: row[0] || "", daySo: row[1] || "", mengisiLinkSo: row[2] || "", adjustmentNumber: row[3] || "",
    release: row[4] || "", keterangan: row[5] || "", fileUrl: row[6] || "",
    tanggalSo: row[7] ? Utilities.formatDate(new Date(row[7]), tz, "yyyy-MM-dd") : ""
  }));
  cachePutBig_(ck, rows, 120);
  return rows;
}

function getStats() {
  const rows = getAllRows();
  return {
    total: rows.length,
    sudah: rows.filter(r => r.mengisiLinkSo === "Sudah").length,
    belumInput: rows.filter(r => r.mengisiLinkSo === "Belum Input").length,
    done: rows.filter(r => r.release === "Done").length,
    pending: rows.filter(r => r.release === "Pending").length,
    kosong: rows.filter(r => !r.mengisiLinkSo).length
  };
}

function createRow(data) {
  const sheet = getSheet();
  if (data.adjustmentNumber && data.adjustmentNumber.trim() !== "") {
    if (!checkAdjustmentNumber(data.adjustmentNumber.trim(), null).available) throw new Error("Adjustment Number sudah digunakan.");
  }
  sheet.appendRow([data.namaOutlet || "", data.daySo || "", data.mengisiLinkSo || "", data.adjustmentNumber || "", data.release || "", data.keterangan || "", data.fileUrl || "", data.tanggalSo ? new Date(data.tanggalSo) : ""]);
  cacheBump_('SOD');
  return { rowIndex: sheet.getLastRow() };
}

function updateRow(rowIndex, data) {
  const sheet = getSheet();
  if (data.adjustmentNumber && data.adjustmentNumber.trim() !== "") {
    if (!checkAdjustmentNumber(data.adjustmentNumber.trim(), rowIndex).available) throw new Error("Adjustment Number sudah digunakan.");
  }
  const row = [data.namaOutlet || "", data.daySo || "", data.mengisiLinkSo || "", data.adjustmentNumber || "", data.release || "", data.keterangan || "", data.fileUrl || "", data.tanggalSo ? new Date(data.tanggalSo) : ""];
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  cacheBump_('SOD');
  return { rowIndex: rowIndex };
}

function deleteRow(rowIndex) { getSheet().deleteRow(rowIndex); cacheBump_('SOD'); return { deleted: rowIndex }; }

function checkAdjustmentNumber(adjNumber, excludeRowIndex) {
  if (!adjNumber || adjNumber.trim() === "") return { available: true, usedBy: null };
  const rows = getAllRows(), trimmed = adjNumber.trim().toUpperCase();
  const conflict = rows.find(r => {
    if (!r.adjustmentNumber) return false;
    if (excludeRowIndex && r.rowIndex === excludeRowIndex) return false;
    return r.adjustmentNumber.trim().toUpperCase() === trimmed;
  });
  return { available: !conflict, usedBy: conflict ? conflict.namaOutlet : null };
}

function uploadFileToDrive(data) {
  const { daySo, adjustmentNumber, mimeType, base64Data, originalName } = data;
  if (!daySo || !adjustmentNumber) throw new Error("Hari SO dan Adjustment Number wajib diisi.");
  const folderId = FOLDER_MAP[daySo.toUpperCase()];
  if (!folderId) throw new Error("Folder untuk hari " + daySo + " belum dikonfigurasi.");
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (e) { throw new Error("Folder ID tidak valid."); }
  const ext = getExtension(originalName, mimeType), fileName = adjustmentNumber.trim() + ext;
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { fileId: file.getId(), fileUrl: file.getUrl(), fileName: fileName };
}

function getExtension(originalName, mimeType) {
  if (originalName && originalName.includes(".")) return "." + originalName.split(".").pop().toLowerCase();
  const mimeMap = { "application/pdf":".pdf","image/jpeg":".jpg","image/png":".png","image/webp":".webp" };
  return mimeMap[mimeType] || "";
}

// ── CHECK SO — ENGINE (bertahap / resumable) ─────────────────
var CSO_BATAS_WAKTU_MS = 4.5 * 60 * 1000;
var CSO_JEDA_MENIT     = 1;
var CSO_FLUSH_EVERY    = 10;
var CSO_HEADERS        = ["Outlet", "Sheet", "Tipe", "Terisi", "Kosong", "Total", "Persentase", "Status", "FileTag"];
var CSO_FULL_SCAN_MS   = 60 * 60 * 1000;

function csoBlok_(isBulanan, lastRow) {
  if (isBulanan) {
    return lastRow >= 126
      ? [[3,9],[11,19],[21,30],[32,41],[43,44],[46,59],[61,100],[102,126]]
      : [[3,9],[11,19],[21,30],[32,41],[43,44],[46,59],[61,Math.min(lastRow,100)]];
  }
  return [[3,9],[11,19],[21,30],[32,41],[43,44],[46,49],[51,75]];
}

function csoHitungFile_(file) {
  var out = [];
  var sheets = SpreadsheetApp.openById(file.getId()).getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i], shNm = sh.getName(), lastRow = sh.getLastRow();
    var low = shNm.toLowerCase();
    var isBulanan = (low.indexOf("bln") !== -1 || low.indexOf("bulan") !== -1 || lastRow > 75);
    var blok = csoBlok_(isBulanan, lastRow);
    var maxRow = Math.min(blok[blok.length - 1][1], lastRow);
    var data = maxRow >= 3 ? sh.getRange(1, 3, maxRow, 1).getValues() : [];
    var total = 0, isi = 0, kosong = 0;
    for (var b = 0; b < blok.length; b++) {
      var start = blok[b][0];
      if (start > lastRow) continue;
      var end = Math.min(blok[b][1], lastRow);
      for (var r = start; r <= end; r++) {
        var v = data[r - 1][0];
        total++;
        if (v === "" || v === null || v === undefined) kosong++; else isi++;
      }
    }
    var p = total > 0 ? parseFloat(((isi / total) * 100).toFixed(1)) : 0;
    var status = p === 100 ? "Lengkap" : p >= 80 ? "Hampir Selesai" : p >= 50 ? "Setengah" : p > 0 ? "Sebagian" : "Belum Diisi";
    out.push([file.getName(), shNm, isBulanan ? "Bulanan" : "Mingguan", isi, kosong, total, p.toFixed(1) + "%", status]);
  }
  return out;
}

function csoTulis_(output, buffer) {
  if (!buffer.length) return;
  output.getRange(output.getLastRow() + 1, 1, buffer.length, CSO_HEADERS.length).setValues(buffer);
  SpreadsheetApp.flush();
}

function csoProsesBatch_(day, job) {
  var mulai    = Date.now();
  var folderId = PENGIRIMAN_FOLDER_MAP[day];
  if (!folderId) throw new Error("Folder untuk hari '" + day + "' tidak dikonfigurasi.");

  var ss      = getInvSS_();
  var main    = ss.getSheetByName(CHECK_SO_SHEET_PREFIX + day);
  var tmpName = CHECK_SO_SHEET_PREFIX + day + "_TMP";
  var output  = ss.getSheetByName(tmpName);

  if (job.files === undefined) {
    if (!output) output = ss.insertSheet(tmpName); else output.clear();
    output.getRange(1, 1, 1, CSO_HEADERS.length).setValues([CSO_HEADERS]).setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
    output.getRange("G:G").setNumberFormat("@");
    output.setFrozenRows(1);
    try { output.hideSheet(); } catch (e) {}
    job.files = 0; job.rows = 0; job.reused = 0;
  }
  if (!output) output = ss.insertSheet(tmpName);

  var oldMap = {};
  if (!job.full && main && main.getLastRow() > 1 && main.getMaxColumns() >= CSO_HEADERS.length) {
    main.getRange(2, 1, main.getLastRow() - 1, CSO_HEADERS.length).getValues().forEach(function (r) {
      var tag = String(r[8] || "");
      if (!tag) return;
      var id = tag.split("|")[0];
      if (!oldMap[id]) oldMap[id] = { tag: tag, rows: [] };
      oldMap[id].rows.push(r);
    });
  }

  var folder = DriveApp.getFolderById(folderId);
  var it = job.token ? DriveApp.continueFileIterator(job.token) : folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  var buffer = [], selesai = true;

  while (it.hasNext()) {
    if (Date.now() - mulai > CSO_BATAS_WAKTU_MS) { selesai = false; break; }
    var file = it.next();
    job.files++;
    var tag = file.getId() + "|" + file.getLastUpdated().getTime();
    var cache = oldMap[file.getId()];
    if (cache && cache.tag === tag) {
      for (var c = 0; c < cache.rows.length; c++) buffer.push(cache.rows[c]);
      job.reused++;
    } else {
      try {
        var rows = csoHitungFile_(file);
        for (var i = 0; i < rows.length; i++) { rows[i].push(tag); buffer.push(rows[i]); }
      } catch (e) {
        buffer.push([file.getName(), "ERROR", "-", "-", "-", "-", "-", String(e.message || e), ""]);
      }
    }
    if (buffer.length >= CSO_FLUSH_EVERY) {
      job.rows += buffer.length;
      csoTulis_(output, buffer); buffer = [];
      job.updatedAt = Date.now();
      job.token = it.getContinuationToken();
      job.msg = "Memeriksa… " + job.files + " file";
      csoSaveJob_(day, job);
    }
  }
  job.rows += buffer.length;
  csoTulis_(output, buffer);
  job.updatedAt = Date.now();
  if (!selesai) job.token = it.getContinuationToken(); else delete job.token;
  return selesai;
}

function runCheckSo(hari) {
  if (!hari) throw new Error("Parameter 'hari' harus diisi.");
  var day = hari.toUpperCase();
  startCheckSoJob(day);
  csoJobWorker();
  var job = csoGetJob_(day) || {};
  return { hari: day, total: job.rows || 0, rows: [], updatedAt: new Date().toISOString(), sheetName: CHECK_SO_SHEET_PREFIX + day, state: job.state };
}

function getCheckSoResult(hari) {
  var day = String(hari || '').toUpperCase();
  var ck = 'CSOR|' + cacheVer_('CSO') + '|' + day, hit = cacheGetBig_(ck);
  if (hit) return hit;
  var sheet  = getInvSS_().getSheetByName(CHECK_SO_SHEET_PREFIX + day);
  if (!sheet || sheet.getLastRow() <= 1) return { hari: day, rows: [], updatedAt: null };
  var data = sheet.getRange(1, 1, sheet.getLastRow(), 8).getValues();
  var rows = data.slice(1).map(function(r) {
    return { outlet: r[0]||"", sheet: r[1]||"", tipe: r[2]||"", terisi: r[3]||0, kosong: r[4]||0, total: r[5]||0, persentase: r[6]||"0%", status: r[7]||"" };
  });
  var res = { hari: day, rows: rows, updatedAt: PropertiesService.getScriptProperties().getProperty("LAST_CHECK_" + day) || null };
  cachePutBig_(ck, res, 180);
  return res;
}

// ── CHECKLIST PRODUCTION ──────────────────────────────────────
const CHECKLIST_SHEET_NAME = "CHECKLIST_PROD";

function getChecklistData() {
  const ck = 'CLD|' + cacheVer_('CL'), hit = cacheGetBig_(ck);
  if (hit) return hit;
  const sheet = getInvSS_().getSheetByName(CHECKLIST_SHEET_NAME);
  if (!sheet) return { days: [], rows: [] };
  const raw = sheet.getDataRange().getValues();
  if (raw.length < 2) return { days: [], rows: [] };

  const hariRow = raw[0], dateRow = raw[1], tz = Session.getScriptTimeZone();
  var ketColIndex = -1, days = [];
  for (var c = 1; c < hariRow.length; c++) {
    var dayName = hariRow[c] ? String(hariRow[c]).trim() : '';
    if (dayName.toUpperCase() === 'KETERANGAN') { ketColIndex = c; continue; }
    var dateVal = dateRow[c], dateStr = '';
    if (dateVal instanceof Date) dateStr = Utilities.formatDate(dateVal, tz, "d MMM");
    else if (dateVal) dateStr = String(dateVal).trim();
    if (dayName) days.push({ dayName: dayName, date: dateStr, colIndex: c });
  }
  var rows = [];
  for (var r = 2; r < raw.length; r++) {
    var namaOutlet = String(raw[r][0] || '').trim();
    if (!namaOutlet) continue;
    var checks = days.map(function(d) { var v = raw[r][d.colIndex]; return (v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1'); });
    rows.push({ rowIndex: r + 1, namaOutlet: namaOutlet, checks: checks, keterangan: (ketColIndex >= 0) ? String(raw[r][ketColIndex] || '') : '' });
  }
  var res = { days: days, rows: rows };
  cachePutBig_(ck, res, 120);
  return res;
}

function setChecklistCell(rowIndex, colIndexInDays, newVal) {
  const sheet = getInvSS_().getSheetByName(CHECKLIST_SHEET_NAME);
  if (!sheet) throw new Error("Sheet CHECKLIST_PROD tidak ditemukan.");
  const hariRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var dayCount = -1, sheetCol = -1;
  for (var c = 1; c < hariRow.length; c++) {
    var h = String(hariRow[c]).trim().toUpperCase();
    if (h && h !== 'KETERANGAN') { dayCount++; if (dayCount === colIndexInDays) { sheetCol = c + 1; break; } }
  }
  if (sheetCol === -1) throw new Error("Kolom hari tidak ditemukan.");
  sheet.getRange(rowIndex, sheetCol).setValue(newVal ? true : false);
  cacheBump_('CL');
  return { rowIndex: rowIndex, sheetCol: sheetCol, val: newVal };
}

function setChecklistKeterangan(rowIndex, keteranganText) {
  const sheet = getInvSS_().getSheetByName(CHECKLIST_SHEET_NAME);
  if (!sheet) throw new Error("Sheet CHECKLIST_PROD tidak ditemukan.");
  const hariRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ketCol = -1;
  for (var c = 1; c < hariRow.length; c++) {
    if (String(hariRow[c]).trim().toUpperCase() === 'KETERANGAN') { ketCol = c + 1; break; }
  }
  if (ketCol === -1) {
    var lastDayCol = 1;
    for (var c2 = 1; c2 < hariRow.length; c2++) {
      var h2 = String(hariRow[c2]).trim().toUpperCase();
      if (h2 && h2 !== 'KETERANGAN') lastDayCol = c2 + 1;
    }
    ketCol = lastDayCol + 1;
    sheet.getRange(1, ketCol).setValue('KETERANGAN').setBackground("#475569").setFontColor("#ffffff").setFontWeight("bold");
    sheet.getRange(2, ketCol).setValue('KETERANGAN').setBackground("#475569").setFontColor("#ffffff").setFontWeight("bold");
  }
  var text = String(keteranganText || '');
  sheet.getRange(rowIndex, ketCol).setValue(text);
  cacheBump_('CL');
  return { rowIndex: rowIndex, ketCol: ketCol, val: text };
}

// ── PORTAL: pembacaan sheet 1x per proses (memo) ─────────────
var _PSS = null, _PM = {};
function pSS_() { return _PSS || (_PSS = SpreadsheetApp.openById(PORTAL_SS_ID)); }
function pRead_(name) {
  if (_PM[name]) return _PM[name];
  var sh = pSS_().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ditemukan.');
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  var data = (lr >= 1 && lc >= 1) ? sh.getRange(1, 1, lr, lc).getValues() : [];
  var headers = data.length ? data[0] : [];
  return (_PM[name] = { sh: sh, lr: lr, lc: lc, data: data, headers: headers, cm: _detectPortalColumns(headers) });
}
function _colFrom_(headers, keywords) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").toLowerCase();
    for (var k = 0; k < keywords.length; k++) if (h.indexOf(keywords[k]) !== -1) return i + 1;
  }
  return -1;
}

function _openPortalDataSheet(sheetName) {
  let sheet;
  try { sheet = pSS_().getSheetByName(sheetName); } catch (e) {}
  if (!sheet) { try { sheet = getInvSS_().getSheetByName(sheetName); } catch (e) {} }
  return sheet;
}

function _detectPortalColumns(headers) {
  var map = { tsIdx: -1, outletIdx: -1, itemIdx: -1, statusIdx: -1, codeIdx: -1, waIdxs: [], jenisIdx: -1, pelaporIdx: -1, emailIdx: -1, ketIdx: -1 };
  headers.forEach(function(h, i) {
    var ht = String(h || "").toUpperCase().trim();
    if (map.tsIdx === -1 && ht.indexOf("TIMESTAMP") !== -1) map.tsIdx = i;
    if (map.outletIdx === -1 && (ht.indexOf("NAMA OUTLET") !== -1 || ht === "OUTLET")) map.outletIdx = i;
    if (map.statusIdx === -1 && ht.indexOf("STATUS") !== -1) map.statusIdx = i;
    if (map.codeIdx === -1 && (ht.indexOf("CODE") !== -1 || ht.indexOf("KODE") !== -1)) map.codeIdx = i;
    if (ht.indexOf("WHATSAPP") !== -1 || ht.indexOf("NOMOR WA") !== -1 || ht === "WA") map.waIdxs.push(i);
    if (map.jenisIdx === -1 && ht.indexOf("JENIS PENGAJUAN") !== -1) map.jenisIdx = i;
    if (map.pelaporIdx === -1 && ht.indexOf("NAMA PELAPOR") !== -1) map.pelaporIdx = i;
    if (map.emailIdx === -1 && ht.indexOf("EMAIL") !== -1) map.emailIdx = i;
    if (map.ketIdx === -1 && ht.indexOf("KETERANGAN") !== -1) map.ketIdx = i;
  });
  var itemPriority = ["ITEM DAN JUMLAH", "JUMLAH DAN ITEM", "NAMA ITEM", "ITEM YANG", "BARANG DAN JUMLAH", "JENIS BARANG", "NAMA BARANG", "DESKRIPSI"];
  for (var p = 0; p < itemPriority.length && map.itemIdx === -1; p++) {
    headers.forEach(function(h, i) {
      if (map.itemIdx === -1 && String(h || "").toUpperCase().indexOf(itemPriority[p]) !== -1) map.itemIdx = i;
    });
  }
  if (map.itemIdx === -1) headers.forEach(function(h, i) {
    var ht = String(h || "").toUpperCase();
    if (map.itemIdx === -1 && (ht.indexOf("ITEM") !== -1 || ht.indexOf("BARANG") !== -1)) map.itemIdx = i;
  });
  if (map.itemIdx === -1) headers.forEach(function(h, i) {
    if (map.itemIdx === -1 && String(h || "").toUpperCase().indexOf("JUMLAH") !== -1) map.itemIdx = i;
  });
  return map;
}

// Hyperlink dikirim jarang (hanya sel yang punya link) → payload jauh lebih kecil; hasil di-cache 2 menit.
function getPortalData(sheetName) {
  const ck = 'PD|' + cacheVer_('PD') + '|' + sheetName, hit = cacheGetBig_(ck);
  if (hit) return hit;
  const sheet = _openPortalDataSheet(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' tidak ditemukan di database Portal (link ID: " + PORTAL_SS_ID + ").");
  const range = sheet.getDataRange();
  const data  = range.getDisplayValues();
  if (data.length === 0) return { headers: [], rows: [], colMap: {} };
  var richValues = [];
  try { richValues = range.getRichTextValues(); } catch (e) { richValues = []; }
  const headers = data[0], colMap = _detectPortalColumns(headers);
  const rows = data.slice(1).map((r, i) => {
    var links = null, runsMap = null;
    if (richValues.length > i + 1) {
      var rv = richValues[i + 1];
      for (var c = 0; c < rv.length; c++) {
        var txt = r[c];
        if (!txt) continue;
        var rt = rv[c], url = null;
        try {
          url = rt ? rt.getLinkUrl() : null;
          if (url) { (links = links || {})[c] = url; }
          else if (rt && txt.length > 3 && txt.indexOf(' ') !== -1) {
            var linked = rt.getRuns().map(function(run) { return { text: run.getText(), url: run.getLinkUrl() }; });
            if (linked.some(function(x) { return x.url; })) (runsMap = runsMap || {})[c] = linked;
          }
        } catch (e2) {}
      }
    }
    return { rowIndex: i + 2, rowData: r, rowLinks: links, rowRuns: runsMap };
  });
  const res = { headers: headers, rows: rows, colMap: colMap };
  cachePutBig_(ck, res, 120);
  return res;
}

function updatePortalStatusCode(sheetName, rowIndex, status, code) {
  const sheet = _openPortalDataSheet(sheetName);
  if (!sheet) throw new Error("Sheet tidak ditemukan di database Portal.");
  let lastCol = sheet.getLastColumn();
  if (lastCol < 1) lastCol = 1;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colMap  = _detectPortalColumns(headers);
  const statusCol = colMap.statusIdx >= 0 ? colMap.statusIdx + 1 : -1;
  const codeCol   = colMap.codeIdx   >= 0 ? colMap.codeIdx   + 1 : -1;
  let tglCol      = _findHeaderCol(sheet, ["tanggal selesai", "updated at"]);
  if (statusCol === -1) return false;

  const oldStatus   = sheet.getRange(rowIndex, statusCol).getValue();
  const wasResolved = _isResolvedStatus(oldStatus);

  if (status !== undefined) {
    sheet.getRange(rowIndex, statusCol).setValue(status);
    if (_isResolvedStatus(status)) {
      if (tglCol === -1) {
        tglCol = lastCol + 1;
        sheet.getRange(1, tglCol).setValue("Tanggal Selesai").setBackground("#0f766e").setFontColor("#ffffff").setFontWeight("bold");
      }
      sheet.getRange(rowIndex, tglCol).setValue(new Date());
    }
  }
  if (codeCol !== -1 && code !== undefined) sheet.getRange(rowIndex, codeCol).setValue(code);

  if (!wasResolved && _isResolvedStatus(status)) {
    try {
      const rowVals   = sheet.getRange(rowIndex, 1, 1, Math.max(lastCol, tglCol)).getValues()[0];
      const outletVal = colMap.outletIdx >= 0 ? String(rowVals[colMap.outletIdx] || "-") : "-";
      let itemVal = "-";
      if (sheetName === "Jual Beli") {
        const jCol = DASH_CONFIG.jualBeli.colJual - 1, bCol = DASH_CONFIG.jualBeli.colBeli - 1;
        const j = (jCol >= 0 && jCol < rowVals.length) ? rowVals[jCol] : "";
        const b = (bCol >= 0 && bCol < rowVals.length) ? rowVals[bCol] : "";
        itemVal = (j && b) ? (j + " ↔ " + b) : (j || b || "-");
      } else {
        itemVal = colMap.itemIdx >= 0 ? String(rowVals[colMap.itemIdx] || "-") : "-";
      }
      const kodeVal = code !== undefined && code !== "" ? code : (codeCol !== -1 ? rowVals[codeCol - 1] : "");
      _logHistoryChange(sheetName, outletVal, itemVal, kodeVal, status, rowIndex);
    } catch (e) { }
  }
  cacheBump_('PD');
  return true;
}

function _findOrCreateKeteranganCol(sheet) {
  var lastCol = sheet.getLastColumn();
  var keteranganCol = _findHeaderCol(sheet, ["keterangan"]);
  if (keteranganCol !== -1) return keteranganCol;
  var tglCol = _findHeaderCol(sheet, ["tanggal selesai", "updated at"]);
  var targetCol;
  if (tglCol === -1) {
    tglCol = lastCol + 1;
    sheet.getRange(1, tglCol).setValue("Tanggal Selesai").setBackground("#0f766e").setFontColor("#ffffff").setFontWeight("bold");
    targetCol = tglCol + 1;
  } else {
    targetCol = tglCol + 1;
    var existingHeader = targetCol <= sheet.getLastColumn() ? sheet.getRange(1, targetCol).getValue() : "";
    var norm = String(existingHeader || "").trim().toLowerCase();
    if (norm && norm !== "keterangan") targetCol = Math.max(sheet.getLastColumn() + 1, targetCol);
  }
  sheet.getRange(1, targetCol).setValue("Keterangan").setBackground("#7c3aed").setFontColor("#ffffff").setFontWeight("bold");
  return targetCol;
}

function getPortalKeterangan(sheetName, rowIndex) {
  const sheet = _openPortalDataSheet(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' tidak ditemukan di database Portal.");
  const col = _findHeaderCol(sheet, ["keterangan"]);
  if (col === -1) return "";
  return String(sheet.getRange(rowIndex, col).getValue() || "");
}

function updatePortalKeterangan(sheetName, rowIndex, keteranganText) {
  const sheet = _openPortalDataSheet(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' tidak ditemukan di database Portal.");
  const col = _findOrCreateKeteranganCol(sheet);
  const text = String(keteranganText || "");
  sheet.getRange(rowIndex, col).setValue(text);
  cacheBump_('PD');
  return { rowIndex: rowIndex, col: col, val: text };
}

function deletePortalKeterangan(sheetName, rowIndex) { return updatePortalKeterangan(sheetName, rowIndex, ""); }

// ── HISTORY LOG ──────────────────────────────────────────────
function _getHistoryLogSheet() {
  const ss = getInvSS_();
  let sheet = ss.getSheetByName(HISTORY_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(HISTORY_LOG_SHEET_NAME);
    sheet.appendRow(HISTORY_LOG_HEADERS);
    sheet.getRange(1, 1, 1, HISTORY_LOG_HEADERS.length).setBackground("#0f766e").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _logHistoryChange(jenis, outlet, detail, kode, status, sourceRow) {
  _getHistoryLogSheet().appendRow([new Date(), jenis || "-", outlet || "-", detail || "-", kode || "-", status || "-", sourceRow || ""]);
  cacheBump_('HL');
}
function _flushHistory_(buf) {
  if (!buf.length) return;
  const sheet = _getHistoryLogSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, buf.length, HISTORY_LOG_HEADERS.length).setValues(buf);
  cacheBump_('HL');
}

function _getStatusTrackSheet() {
  const ss = getInvSS_();
  let sheet = ss.getSheetByName(STATUS_TRACK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATUS_TRACK_SHEET_NAME);
    sheet.appendRow(STATUS_TRACK_HEADERS);
    sheet.getRange(1, 1, 1, STATUS_TRACK_HEADERS.length).setBackground("#334155").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (e) {}
  }
  return sheet;
}

function _loadStatusTrackMap() {
  const sheet = _getStatusTrackSheet(), lastRow = sheet.getLastRow(), map = {};
  if (lastRow < 2) return map;
  sheet.getRange(2, 1, lastRow - 1, STATUS_TRACK_HEADERS.length).getValues().forEach(function(r, i) {
    map[String(r[0]) + "|" + String(r[1])] = { status: String(r[2] || ""), trackRow: i + 2 };
  });
  return map;
}

function _saveStatusTrack(map, key, sheetName, rowIndex, status) {
  const sheet = _getStatusTrackSheet(), now = new Date();
  if (map[key]) { sheet.getRange(map[key].trackRow, 3, 1, 2).setValues([[status, now]]); map[key].status = status; }
  else { sheet.appendRow([sheetName, rowIndex, status, now]); map[key] = { status: status, trackRow: sheet.getLastRow() }; }
}

function getHistoryLog(options) {
  options = options || {};
  const jenis = options.jenis || "ALL";
  const days  = options.days ? parseInt(options.days, 10) : 30;
  const ck = 'HLG|' + cacheVer_('HL') + '|' + jenis + '|' + days, hit = cacheGetBig_(ck);
  if (hit) return hit;

  const sheet   = _getHistoryLogSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rows: [], summary: [] };
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  const rows = [], counter = {};
  sheet.getRange(2, 1, lastRow - 1, HISTORY_LOG_HEADERS.length).getValues().forEach(function(r) {
    const ts = r[0];
    if (!(ts instanceof Date) || isNaN(ts.getTime()) || ts < cutoff) return;
    const jenisVal = String(r[1] || "-");
    if (jenis !== "ALL" && jenisVal !== jenis) return;
    counter[jenisVal] = (counter[jenisVal] || 0) + 1;
    rows.push({ timestamp: ts.toISOString(), jenis: jenisVal, outlet: String(r[2] || "-"), detail: String(r[3] || "-"), kode: String(r[4] || "-"), status: String(r[5] || "-") });
  });
  rows.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
  const summary = Object.keys(counter).map(function(k) { return { jenis: k, count: counter[k] }; }).sort(function(a, b) { return b.count - a.count; });
  const res = { rows: rows, summary: summary };
  cachePutBig_(ck, res, 120);
  return res;
}

// ── DASHBOARD REPORT ──────────────────────────────────────────
const DASH_CONFIG = {
  pengajuanReject:   { sheetName: "Pengajuan Reject",   colTimestamp: 1, colQueueStatus: 12, colClearStatus: 11 },
  finalReject:       { sheetName: "Final Reject",       colTimestamp: 1, colOutlet: 4, colJenis: 6, colStatus: 11 },
  kendalaProduction: { sheetName: "Kendala Production", colTimestamp: 1, colStatus: 10 },
  jualBeli:          { sheetName: "Jual Beli",          colTimestamp: 1, colJual: 5, colBeli: 7, colStatus: 14 },
  beliLokal:         { sheetName: "Beli Lokal",         colTimestamp: 1, colOutlet: 6 },
  receipt:           { sheetName: "Receipt" },
  konfirmasiSO:      { sheetName: "Konfirmasi SO" },
  question:          { sheetName: "Question" },
  expired:           { sheetName: "Expired" }
};

function _openPortalSheet(sheetName) {
  const sh = pSS_().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  return sh;
}

function _findHeaderCol(sheet, keywords) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  return _colFrom_(sheet.getRange(1, 1, 1, lastCol).getValues()[0], keywords);
}

function _getStatusCol(sh, fallbackCol) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return fallbackCol;
  const colMap = _detectPortalColumns(sh.getRange(1, 1, 1, lastCol).getValues()[0]);
  return colMap.statusIdx >= 0 ? colMap.statusIdx + 1 : fallbackCol;
}

function _isToday(dateVal) {
  if (!(dateVal instanceof Date) || isNaN(dateVal.getTime())) return false;
  const now = new Date();
  return dateVal.getFullYear() === now.getFullYear() && dateVal.getMonth() === now.getMonth() && dateVal.getDate() === now.getDate();
}

function _isQueueClear(statusVal) { return String(statusVal || "").trim().toUpperCase() === "CLEAR"; }

const RESOLVED_STATUS_WORDS = ["clear", "ganti rugi", "dibuang", "di buang", "duplikat", "selesai", "done"];
const ANTRE_STATUS_WORDS    = ["belum", "proses", "diproses", "pending"];

function _isResolvedStatus(statusVal) {
  var s = String(statusVal || "").trim().toLowerCase();
  if (s === "") return false;
  return RESOLVED_STATUS_WORDS.indexOf(s) !== -1;
}

function _topCounts(countObj, limit) {
  return Object.keys(countObj).map(function(k) { return { name: k, count: countObj[k] }; }).sort(function(a, b) { return b.count - a.count; }).slice(0, limit || 8);
}

const FINAL_REJECT_CATEGORIES = { butter:'Ropi Butter', coklat:'Ropi Coklat', keju:'Ropi Keju', croissant:'Roti Croissant', gempi:'Roti Gempi' };

function _parseFinalRejectText(text) {
  const s = String(text || '');
  const re = /(butter|coklat|keju|croissant|gempi)\s*(\d+)?/gi;
  const found = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    found.push({ label: FINAL_REJECT_CATEGORIES[m[1].toLowerCase()], qty: m[2] ? parseInt(m[2], 10) : 1 });
  }
  return found;
}

function getReportPengajuanReject() {
  const cfg = DASH_CONFIG.pengajuanReject, p = pRead_(cfg.sheetName);
  if (p.lr < 2) return { total: 0, totalItem: 0, topJenis: [], topOutletByQty: [], antre: 0, selesai: 0, listAntre: [] };
  const oc = _colFrom_(p.headers, ["nama outlet", "outlet"]), outletCol = oc > 0 ? oc : cfg.colOutlet;
  const statusCol = p.cm.statusIdx >= 0 ? p.cm.statusIdx + 1 : cfg.colStatus;
  const catQty = {};
  if (typeof PENGAJUAN_REJECT_CATEGORIES !== 'undefined') {
    Object.keys(PENGAJUAN_REJECT_CATEGORIES).forEach(function(k) { catQty[PENGAJUAN_REJECT_CATEGORIES[k]] = 0; });
  }
  const outletCount = {};
  let grandTotalQty = 0, antre = 0, selesai = 0;
  const listAntre = [];
  for (var i = 1; i < p.data.length; i++) {
    var r = p.data[i];
    var outlet = String(r[outletCol - 1] || "").trim();
    var teks   = String(r[(cfg.colJenis || 1) - 1] || "").trim();
    var statusVal = r[statusCol - 1];
    if (outlet) outletCount[outlet] = (outletCount[outlet] || 0) + 1;
    if (teks) {
      if (typeof _parsePengajuanRejectText === 'function') {
        var parsed = _parsePengajuanRejectText(teks), rowQty = 0;
        parsed.forEach(function(q) { if (catQty[q.label] !== undefined) catQty[q.label] += q.qty; rowQty += q.qty; });
        grandTotalQty += rowQty;
      } else { grandTotalQty += 1; }
    }
    if (outlet || teks) {
      if (_isResolvedStatus(statusVal)) selesai++; else { antre++; if (outlet) listAntre.push(outlet); }
    }
  }
  var topJenis = Object.keys(catQty).map(function(k) { return { name: k, count: catQty[k] }; }).sort(function(a, b) { return b.count - a.count; });
  return { total: antre + selesai, totalItem: grandTotalQty, topJenis: topJenis, topOutletByQty: _topCounts(outletCount, 8), antre: antre, selesai: selesai, listAntre: listAntre.slice(0, 20) };
}

function getReportFinalReject() {
  const cfg = DASH_CONFIG.finalReject, p = pRead_(cfg.sheetName);
  if (p.lr < 2) return { total: 0, totalItem: 0, topJenis: [], topOutletByQty: [], antre: 0, selesai: 0, listAntre: [] };
  const oc = _colFrom_(p.headers, ["nama outlet", "outlet"]), outletCol = oc > 0 ? oc : cfg.colOutlet;
  const statusCol = p.cm.statusIdx >= 0 ? p.cm.statusIdx + 1 : cfg.colStatus;
  const catQty = {};
  Object.keys(FINAL_REJECT_CATEGORIES).forEach(function(k) { catQty[FINAL_REJECT_CATEGORIES[k]] = 0; });
  const outletCount = {};
  let grandTotalQty = 0, antre = 0, selesai = 0;
  const listAntre = [];
  for (var i = 1; i < p.data.length; i++) {
    var r = p.data[i];
    var outlet = String(r[outletCol - 1] || "").trim();
    var teks   = String(r[cfg.colJenis - 1] || "").trim();
    var statusVal = r[statusCol - 1];
    if (outlet) outletCount[outlet] = (outletCount[outlet] || 0) + 1;
    if (teks) {
      var rowQty = 0;
      _parseFinalRejectText(teks).forEach(function(q) { catQty[q.label] += q.qty; rowQty += q.qty; });
      grandTotalQty += rowQty;
    }
    if (outlet || teks) {
      if (_isResolvedStatus(statusVal)) selesai++; else { antre++; if (outlet) listAntre.push(outlet); }
    }
  }
  var topJenis = Object.keys(catQty).map(function(k) { return { name: k, count: catQty[k] }; }).sort(function(a, b) { return b.count - a.count; });
  return { total: antre + selesai, totalItem: grandTotalQty, topJenis: topJenis, topOutletByQty: _topCounts(outletCount, 8), antre: antre, selesai: selesai, listAntre: listAntre.slice(0, 20) };
}

function getReportKendalaProduction() { return _getReportGenericAntreSelesai(DASH_CONFIG.kendalaProduction.sheetName); }

function getReportJualBeli() {
  const cfg = { sheetName: 'Jual Beli', colJual: 4, colBeli: 6, colStatus: 13 };
  const p = pRead_(cfg.sheetName);
  if (p.lr < 2) return { topJual: [], topBeli: [], antre: 0, selesai: 0, listAntre: [] };
  const statusCol = p.cm.statusIdx >= 0 ? p.cm.statusIdx + 1 : cfg.colStatus;
  const jualCount = {}, beliCount = {}; let antre = 0, selesai = 0; const listAntre = [];
  for (var i = 1; i < p.data.length; i++) {
    var r = p.data[i];
    var jual = String(r[cfg.colJual - 1] || "").trim(), beli = String(r[cfg.colBeli - 1] || "").trim();
    if (jual) jualCount[jual] = (jualCount[jual] || 0) + 1;
    if (beli) beliCount[beli] = (beliCount[beli] || 0) + 1;
    if (jual || beli) {
      if (_isResolvedStatus(r[statusCol - 1])) selesai++; else { antre++; listAntre.push(jual && beli ? (jual + " ↔ " + beli) : (jual || beli)); }
    }
  }
  return { topJual: _topCounts(jualCount, 8), topBeli: _topCounts(beliCount, 8), antre: antre, selesai: selesai, listAntre: listAntre.slice(0, 20) };
}

// Generik: hitung Antre/Selesai berdasarkan "Nama Outlet" + "Status" (deteksi header otomatis). Sekali baca per sheet.
function _getReportGenericAntreSelesai(sheetName) {
  const p = pRead_(sheetName);
  if (p.lr < 2) return { total: 0, antre: 0, selesai: 0, listAntre: [], topOutlet: [] };
  const outletCol = _colFrom_(p.headers, ["nama outlet", "outlet"]);
  const statusCol = p.cm.statusIdx >= 0 ? p.cm.statusIdx + 1 : 1;
  var antre = 0, selesai = 0, validRows = 0;
  const listAntre = [], count = {};
  for (var i = 1; i < p.data.length; i++) {
    var r = p.data[i];
    var outlet = outletCol > 0 ? String(r[outletCol - 1] || "").trim() : "";
    if (!outlet) continue;
    validRows++;
    count[outlet] = (count[outlet] || 0) + 1;
    if (_isResolvedStatus(r[statusCol - 1])) selesai++; else { antre++; listAntre.push(outlet); }
  }
  return { total: validRows, antre: antre, selesai: selesai, listAntre: listAntre.slice(0, 20), topOutlet: _topCounts(count, 8) };
}

function getReportBeliLokal()    { return _getReportGenericAntreSelesai(DASH_CONFIG.beliLokal.sheetName); }
function getReportReceipt()      { return _getReportGenericAntreSelesai(DASH_CONFIG.receipt.sheetName); }
function getReportKonfirmasiSO() { return _getReportGenericAntreSelesai(DASH_CONFIG.konfirmasiSO.sheetName); }
function getReportQuestion()     { return _getReportGenericAntreSelesai(DASH_CONFIG.question.sheetName); }
function getReportExpired()      { return _getReportGenericAntreSelesai(DASH_CONFIG.expired.sheetName); }

// Item Clear Hari Ini. Perbaikan performa: tulis riwayat / track / stempel tanggal secara BATCH (bukan per baris).
function getReportTodayCleared() {
  const items = [], histBuf = [], trackNew = [], tz = Session.getScriptTimeZone();
  const sources = [
    { cfg: DASH_CONFIG.pengajuanReject,   label: "Pengajuan Reject",   outletLookup: true },
    { cfg: DASH_CONFIG.kendalaProduction, label: "Kendala Production", outletLookup: true },
    { cfg: DASH_CONFIG.finalReject,       label: "Final Reject",       fixedOutletCol: DASH_CONFIG.finalReject.colOutlet },
    { cfg: DASH_CONFIG.jualBeli,          label: "Jual Beli",          fixedOutletCol: DASH_CONFIG.jualBeli.colJual },
    { cfg: DASH_CONFIG.beliLokal,         label: "Beli Lokal",         outletLookup: true },
    { cfg: DASH_CONFIG.receipt,           label: "Receipt",            outletLookup: true },
    { cfg: DASH_CONFIG.konfirmasiSO,      label: "Konfirmasi SO",      outletLookup: true },
    { cfg: DASH_CONFIG.question,          label: "Question",           outletLookup: true },
    { cfg: DASH_CONFIG.expired,           label: "Expired",            outletLookup: true }
  ];
  const trackMap = _loadStatusTrackMap();

  sources.forEach(function(src) {
    try {
      const p = pRead_(src.cfg.sheetName);
      if (p.lr < 2) return;
      const sh = p.sh, cmDetect = p.cm;
      const statusCol = cmDetect.statusIdx >= 0 ? cmDetect.statusIdx + 1 : (src.cfg.colClearStatus || src.cfg.colStatus || src.cfg.colQueueStatus || 1);
      const outletCol = src.outletLookup ? _colFrom_(p.headers, ["nama outlet", "outlet"]) : src.fixedOutletCol;
      var tglCol = _colFrom_(p.headers, ["tanggal selesai", "updated at"]);
      if (tglCol < 1) {
        tglCol = p.lc + 1;
        sh.getRange(1, tglCol).setValue("Tanggal Selesai").setBackground("#0f766e").setFontColor("#ffffff").setFontWeight("bold");
      }
      const tglWrites = {};

      for (var i = 1; i < p.data.length; i++) {
        var r = p.data[i], sheetRow = i + 1;
        var status = String(r[statusCol - 1] || "").trim();
        var ts = r[tglCol - 1];

        var outletName = "-";
        if (src.label === "Jual Beli") {
          var j = String(r[src.cfg.colJual - 1] || "").trim(), b = String(r[src.cfg.colBeli - 1] || "").trim();
          outletName = (j && b) ? (j + " ↔ " + b) : (j || b || "-");
        } else {
          outletName = outletCol > 0 ? String(r[outletCol - 1] || "-") : "-";
        }
        if (outletName === "-" && !status) continue;

        var key = src.cfg.sheetName + "|" + sheetRow;
        var prior = trackMap[key], priorStatus = prior ? prior.status : null;
        var isResolvedNow = _isResolvedStatus(status);
        var wasResolvedBefore = priorStatus !== null ? _isResolvedStatus(priorStatus) : null;

        var itemVal = "-";
        if (src.label === "Jual Beli") itemVal = outletName;
        else if (cmDetect.itemIdx >= 0) itemVal = String(r[cmDetect.itemIdx] || "-");
        var kodeVal = cmDetect.codeIdx >= 0 ? r[cmDetect.codeIdx] : "";
        var jenisLog = src.cfg.sheetName;

        if (priorStatus === null) {
          if (isResolvedNow && !ts) {
            var now0 = new Date(); tglWrites[sheetRow] = now0; ts = now0;
            histBuf.push([now0, jenisLog, outletName || "-", itemVal || "-", kodeVal || "-", status || "-", sheetRow]);
          }
          trackNew.push([src.cfg.sheetName, sheetRow, status, new Date()]);
          trackMap[key] = { status: status, trackRow: 0 };
        } else if (priorStatus !== status) {
          if (isResolvedNow && !wasResolvedBefore) {
            var now1 = new Date(); tglWrites[sheetRow] = now1; ts = now1;
            histBuf.push([now1, jenisLog, outletName || "-", itemVal || "-", kodeVal || "-", status || "-", sheetRow]);
          } else if (!isResolvedNow && wasResolvedBefore) {
            tglWrites[sheetRow] = ""; ts = "";
            histBuf.push([new Date(), jenisLog, outletName || "-", itemVal || "-", kodeVal || "-", "🔄 Dikoreksi: '" + priorStatus + "' → '" + status + "'", sheetRow]);
          } else {
            histBuf.push([new Date(), jenisLog, outletName || "-", itemVal || "-", kodeVal || "-", status || "-", sheetRow]);
          }
          if (prior.trackRow > 0) _saveStatusTrack(trackMap, key, src.cfg.sheetName, sheetRow, status);
          else { trackNew.push([src.cfg.sheetName, sheetRow, status, new Date()]); prior.status = status; }
        }

        if (isResolvedNow && ts && _isToday(new Date(ts))) {
          items.push({ sumber: src.label, outlet: outletName, waktu: Utilities.formatDate(new Date(ts), tz, "HH:mm"), status: status });
        }
      }

      const wk = Object.keys(tglWrites);
      if (wk.length > 5) {
        const colRng = sh.getRange(2, tglCol, p.lr - 1, 1), colVals = colRng.getValues();
        wk.forEach(function(k) { if (+k - 2 < colVals.length) colVals[+k - 2][0] = tglWrites[k]; });
        colRng.setValues(colVals);
      } else {
        wk.forEach(function(k) { sh.getRange(+k, tglCol).setValue(tglWrites[k]); });
      }
    } catch (e) {}
  });

  try {
    if (trackNew.length) { const ts2 = _getStatusTrackSheet(); ts2.getRange(ts2.getLastRow() + 1, 1, trackNew.length, 4).setValues(trackNew); }
    _flushHistory_(histBuf);
  } catch (e) {}

  items.sort(function(a, b) { return b.waktu.localeCompare(a.waktu); });
  return items;
}

const PORTAL_SHEET_LIST = ["Konfirmasi SO", "Pengajuan Reject", "Final Reject", "Kendala Production", "Jual Beli", "Beli Lokal", "Receipt", "Question", "Expired"];

function checkPortalConnectivity() {
  const out = { ssReachable: false, ssName: "", error: "", sheets: [] };
  var ss;
  try { ss = pSS_(); out.ssReachable = true; out.ssName = ss.getName(); }
  catch (e) {
    out.error = "Tidak bisa membuka spreadsheet database Portal (ID: " + PORTAL_SS_ID + "). " + e.message;
    out.sheets = PORTAL_SHEET_LIST.map(function(n) { return { sheetName: n, found: false, rows: 0, statusColFound: false }; });
    return out;
  }
  PORTAL_SHEET_LIST.forEach(function(name) {
    try {
      const sh = ss.getSheetByName(name);
      if (!sh) { out.sheets.push({ sheetName: name, found: false, rows: 0, statusColFound: false }); return; }
      const lastCol = sh.getLastColumn();
      const colMap  = _detectPortalColumns(lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : []);
      out.sheets.push({ sheetName: name, found: true, rows: Math.max(0, sh.getLastRow() - 1), statusColFound: colMap.statusIdx >= 0, outletColFound: colMap.outletIdx >= 0 });
    } catch (e) { out.sheets.push({ sheetName: name, found: false, rows: 0, statusColFound: false, error: e.message }); }
  });
  return out;
}

// ============================================================
// LIVE REPORT & DASHBOARD — update otomatis oleh trigger server
// ============================================================
var DASH_AUTO_MENIT    = 5;
var DASH_JAM_MULAI     = 6;
var DASH_JAM_AKHIR     = 22;
var DASH_FRESH_MS      = 6 * 60 * 1000;
var DASH_SNAPSHOT_SHEET = "DASH_SNAPSHOT";
var DASH_BUSY_KEY      = "DASH_BUSY_TS";
var DASH_CACHE_KEY     = "DASH_REPORT_V3";

function _dashFresh_(rep) {
  var t = rep && rep.generatedAt ? new Date(rep.generatedAt).getTime() : 0;
  return t > 0 && (Date.now() - t) < DASH_FRESH_MS;
}

function _dashSaveSnapshot_(rep) {
  var json = JSON.stringify(rep), CH = 40000, parts = [];
  for (var i = 0; i < json.length; i += CH) parts.push([json.substring(i, i + CH)]);
  var ss = getInvSS_(), sh = ss.getSheetByName(DASH_SNAPSHOT_SHEET);
  if (!sh) { sh = ss.insertSheet(DASH_SNAPSHOT_SHEET); try { sh.hideSheet(); } catch (e) {} }
  sh.clearContents();
  sh.getRange("A:A").setNumberFormat("@");
  sh.getRange(1, 1, parts.length, 1).setValues(parts);
  sh.getRange(1, 2).setValue(Date.now());
}

function _dashLoadSnapshot_() {
  try {
    var sh = getInvSS_().getSheetByName(DASH_SNAPSHOT_SHEET);
    if (!sh || sh.getLastRow() < 1) return null;
    var ts = Number(sh.getRange(1, 2).getValue()) || 0;
    var json = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join("");
    return { ts: ts, report: JSON.parse(json) };
  } catch (e) { return null; }
}

function _dashClaim_() {
  var props = PropertiesService.getScriptProperties();
  var t = parseInt(props.getProperty(DASH_BUSY_KEY) || "0", 10);
  if (Date.now() - t < 4 * 60 * 1000) return false;
  props.setProperty(DASH_BUSY_KEY, String(Date.now()));
  return true;
}
function _dashRelease_() { PropertiesService.getScriptProperties().deleteProperty(DASH_BUSY_KEY); }

function getDashboardReport(noCache) {
  if (!noCache) {
    const cached = cacheGetBig_(DASH_CACHE_KEY);
    if (cached && _dashFresh_(cached)) return cached;
    const snap = _dashLoadSnapshot_();
    if (snap && _dashFresh_(snap.report)) { cachePutBig_(DASH_CACHE_KEY, snap.report, 300); return snap.report; }
  }
  if (!_dashClaim_()) {
    const snap2 = _dashLoadSnapshot_();
    if (snap2) return snap2.report;
  }
  try { return _dashBuild_(); } finally { _dashRelease_(); }
}

/** Satu panggilan untuk Dashboard: laporan + riwayat (hemat 1 round-trip). */
function getDashboardBundle(force, histOpts) {
  var out = { report: null, history: null, error: {} };
  try { out.report = getDashboardReport(!!force); } catch (e) { out.error.report = e.message; }
  try { out.history = getHistoryLog(histOpts || {}); } catch (e) { out.error.history = e.message; }
  return out;
}

function _dashBuild_() {
  _PM = {};   // baca ulang sheet Portal 1x untuk build ini
  const result = { ok: {}, error: {} };
  const parts = {
    reject: getReportPengajuanReject, finalReject: getReportFinalReject, kendalaProduction: getReportKendalaProduction,
    jualBeli: getReportJualBeli, beliLokal: getReportBeliLokal, receipt: getReportReceipt, konfirmasiSO: getReportKonfirmasiSO,
    question: getReportQuestion, expired: getReportExpired, todayCleared: getReportTodayCleared
  };
  Object.keys(parts).forEach(function(key) {
    try { result[key] = parts[key](); } catch (e) { result[key] = null; result.error[key] = e.message; }
  });
  result.generatedAt = new Date().toISOString();
  if (Object.keys(result.error).length > 0) { try { result.connectivity = checkPortalConnectivity(); } catch (e) { } }
  cachePutBig_(DASH_CACHE_KEY, result, 600);
  try { _dashSaveSnapshot_(result); } catch (e) { }
  return result;
}

function autoRefreshDashboard() {
  var jam = parseInt(Utilities.formatDate(new Date(), "Asia/Jakarta", "H"), 10);
  if (jam < DASH_JAM_MULAI || jam >= DASH_JAM_AKHIR) return;
  try { getDashboardReport(true); } catch (e) { Logger.log("autoRefreshDashboard gagal: " + e); }
}

function aktifkanLiveDashboard() {
  matikanLiveDashboard();
  ScriptApp.newTrigger("autoRefreshDashboard").timeBased().everyMinutes(DASH_AUTO_MENIT).create();
  Logger.log("Live Dashboard aktif: tiap " + DASH_AUTO_MENIT + " menit, jam " + DASH_JAM_MULAI + ":00–" + DASH_JAM_AKHIR + ":00 WIB.");
}

function matikanLiveDashboard() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "autoRefreshDashboard") ScriptApp.deleteTrigger(t);
  });
}

function statusLiveDashboard() {
  var snap = _dashLoadSnapshot_();
  Logger.log("Snapshot terakhir: " + (snap ? snap.report.generatedAt : "belum ada"));
  Logger.log("Trigger aktif: " + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(", "));
}

function debugStatusValues() {
  const sh = _openPortalSheet("Kendala Production");
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const cm = _detectPortalColumns(headers);
  Logger.log("Kolom STATUS terdeteksi di index: " + cm.statusIdx + " -> header: " + headers[cm.statusIdx]);
  sh.getRange(2, cm.statusIdx + 1, Math.min(20, sh.getLastRow() - 1), 1).getValues().forEach(r => Logger.log("[" + r[0] + "]"));
}

// ============================================================
// CHECK SO — JOB LATAR BELAKANG (anti timeout, resumable)
// ============================================================
var CSO_JOB_PREFIX = 'CSO_JOB_';
var CSO_PENDING_KEY = 'CSO_PENDING_DAY';
var CSO_STALE_MS = 12 * 60 * 1000;

function csoGetJob_(day) {
  var raw = PropertiesService.getScriptProperties().getProperty(CSO_JOB_PREFIX + day);
  return raw ? JSON.parse(raw) : null;
}
function csoSaveJob_(day, job) { PropertiesService.getScriptProperties().setProperty(CSO_JOB_PREFIX + day, JSON.stringify(job)); }
function csoClearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'csoJobWorker') ScriptApp.deleteTrigger(t); });
}
function csoJadwalkan_(ms) { ScriptApp.newTrigger('csoJobWorker').timeBased().after(ms).create(); }
function csoMacet_(job) {
  var last = job.updatedAt || job.runAt || job.startedAt;
  return (job.state === 'QUEUED' || job.state === 'RUNNING') && (Date.now() - last) > CSO_STALE_MS;
}

function startCheckSoJob(day, auto) {
  day = String(day || '').toUpperCase();
  if (!PENGIRIMAN_FOLDER_MAP[day]) throw new Error("Folder untuk hari '" + day + "' tidak dikonfigurasi.");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Server sedang sibuk, coba lagi.');
  try {
    var props = PropertiesService.getScriptProperties();
    var pendingDay = props.getProperty(CSO_PENDING_KEY);
    if (pendingDay) {
      var cur = csoGetJob_(pendingDay);
      if (cur && (cur.state === 'QUEUED' || cur.state === 'RUNNING') && !csoMacet_(cur)) return cur;
    }
    var lastFull = parseInt(props.getProperty('CSO_LAST_FULL_' + day) || '0', 10);
    var full = (auto !== true) || (Date.now() - lastFull) > CSO_FULL_SCAN_MS;
    var job = { state: 'QUEUED', day: day, startedAt: Date.now(), updatedAt: Date.now(), msg: 'Menunggu pekerja latar belakang…', auto: auto === true, full: full };
    csoSaveJob_(day, job);
    props.setProperty(CSO_PENDING_KEY, day);
    csoClearTriggers_();
    csoJadwalkan_(1000);
    return job;
  } finally { lock.releaseLock(); }
}

function csoJobWorker() {
  csoClearTriggers_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { csoJadwalkan_(CSO_JEDA_MENIT * 60 * 1000); return; }
  var props = PropertiesService.getScriptProperties();
  var day = props.getProperty(CSO_PENDING_KEY);
  if (!day) { lock.releaseLock(); return; }
  var job = csoGetJob_(day) || { day: day, startedAt: Date.now() };
  job.state = 'RUNNING'; job.runAt = Date.now(); job.updatedAt = Date.now(); job.msg = 'Memeriksa sheet outlet…';
  csoSaveJob_(day, job);
  var lanjut = false;
  try {
    var selesai = csoProsesBatch_(day, job);
    if (selesai) {
      csoFinalisasi_(day, job);
      if (job.full) props.setProperty('CSO_LAST_FULL_' + day, String(Date.now()));
      job.state = 'DONE'; job.count = job.rows; job.msg = 'Selesai'; job.endedAt = Date.now();
      props.deleteProperty(CSO_PENDING_KEY);
      props.setProperty("LAST_CHECK_" + day, new Date().toISOString());
    } else { job.msg = 'Memeriksa… ' + job.files + ' file (lanjut otomatis)'; lanjut = true; }
  } catch (e) {
    job.state = 'ERROR'; job.msg = String((e && e.message) || e); job.endedAt = Date.now();
    props.deleteProperty(CSO_PENDING_KEY);
  }
  csoSaveJob_(day, job);
  lock.releaseLock();
  if (lanjut) csoJadwalkan_(CSO_JEDA_MENIT * 60 * 1000);
}

function getCheckSoJobStatus(day) {
  day = String(day || '').toUpperCase();
  var job = csoGetJob_(day);
  if (!job) return { state: 'NONE' };
  if (csoPulihkan_(day, job)) { job.elapsedSec = Math.round((Date.now() - job.startedAt) / 1000); return job; }
  if (csoMacet_(job)) {
    job.state = 'ERROR'; job.msg = 'Job macet (tidak ada progres >12 menit). Silakan jalankan ulang.';
    csoSaveJob_(day, job);
    PropertiesService.getScriptProperties().deleteProperty(CSO_PENDING_KEY);
    csoClearTriggers_();
  }
  job.elapsedSec = Math.round((Date.now() - job.startedAt) / 1000);
  return job;
}

function jalankanCheckSoSenin()  { startCheckSoJob('SENIN');  }
function jalankanCheckSoSelasa() { startCheckSoJob('SELASA'); }
function jalankanCheckSoRabu()   { startCheckSoJob('RABU');   }
function jalankanCheckSoKamis()  { startCheckSoJob('KAMIS');  }
function jalankanCheckSoJumat()  { startCheckSoJob('JUMAT');  }

function batalkanCheckSo() {
  csoClearTriggers_();
  var props = PropertiesService.getScriptProperties();
  Object.keys(PENGIRIMAN_FOLDER_MAP).forEach(function (d) { props.deleteProperty(CSO_JOB_PREFIX + d); });
  props.deleteProperty(CSO_PENDING_KEY);
}

function diagnosaCheckSo() {
  var day = 'SELASA';
  var t0 = Date.now();
  var it = DriveApp.getFolderById(PENGIRIMAN_FOLDER_MAP[day]).getFilesByType(MimeType.GOOGLE_SHEETS);
  Logger.log('Buka folder + iterator: ' + (Date.now() - t0) + ' ms');
  var n = 0;
  while (it.hasNext() && n < 3) {
    var f = it.next(), t1 = Date.now();
    var rows = csoHitungFile_(f);
    Logger.log(f.getName() + ' → ' + rows.length + ' sheet, ' + (Date.now() - t1) + ' ms');
    n++;
  }
  Logger.log('Pending: ' + PropertiesService.getScriptProperties().getProperty(CSO_PENDING_KEY));
  Logger.log('Job: ' + JSON.stringify(csoGetJob_(day)));
  Logger.log('Trigger aktif: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
}

function csoPulihkan_(day, job) {
  var last = job.updatedAt || job.runAt || job.startedAt;
  var diam = Date.now() - last;
  if (((job.state === 'QUEUED' && diam > 3 * 60 * 1000) || (job.state === 'RUNNING' && diam > 8 * 60 * 1000)) && (job.resumes || 0) < 5) {
    job.resumes = (job.resumes || 0) + 1;
    job.state = 'QUEUED'; job.updatedAt = Date.now();
    job.msg = 'Worker terhenti, melanjutkan otomatis (' + job.resumes + ')…';
    csoSaveJob_(day, job);
    PropertiesService.getScriptProperties().setProperty(CSO_PENDING_KEY, day);
    csoClearTriggers_();
    csoJadwalkan_(1000);
    return true;
  }
  return false;
}

function csoFinalisasi_(day, job) {
  var ss  = getInvSS_();
  var tmp = ss.getSheetByName(CHECK_SO_SHEET_PREFIX + day + "_TMP");
  if (!tmp) return;
  var nCol = CSO_HEADERS.length;
  var n = Math.max(tmp.getLastRow() - 1, 0);
  var main = ss.getSheetByName(CHECK_SO_SHEET_PREFIX + day) || ss.insertSheet(CHECK_SO_SHEET_PREFIX + day);
  main.clear();
  if (n > 0) tmp.getRange(1, 1, n + 1, nCol).copyTo(main.getRange(1, 1));
  else main.getRange(1, 1, 1, nCol).setValues([CSO_HEADERS]);
  main.setFrozenRows(1);
  try { ss.deleteSheet(tmp); } catch (e) {}
  cacheBump_('CSO');
  if (typeof afterDataChanged_ === 'function') afterDataChanged_('CHECK_SO');
}