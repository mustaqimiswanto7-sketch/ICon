/**
 * ============================================================
 *  Dashboard.gs — Membuat sheet & menulis DASHBOARD, MONITORING_DETAIL, ALERT_LOG
 *  VERSI 3 — Executive Dashboard + perbaikan hasil audit (di atas VERSI 2 Anda)
 * ============================================================
 *
 *  Yang diubah dari VERSI 2 (sisanya TIDAK diubah):
 *   - dashShortPeriod_(): label panjang seperti "2026-10-07 (MG 1)" diringkas
 *     menjadi "07/10*" agar header HEATMAP tidak sesak (tanda * = ada label sesi).
 *   - buildDashboardModel_(): alert OPEN kembali membawa Alert ID-nya (dipakai
 *     tombol tutup alert di Panel Kontrol) dan status kesehatan outlet dihitung
 *     lewat satu helper healthOf_() (sebelumya logika RED/AMBER/GREEN ditulis
 *     terpisah di 3 tempat — rawan berbeda hasil saat diubah).
 *   - saveAlertRows(): menghormati parameter CONFIG REOPEN_RECURRING_ALERTS —
 *     jika TRUE, anomali yang muncul kembali setelah CLOSED dibuka lagi (OPEN).
 *   - initializeSheets(): sheet RUN_LOG ikut dibuat (log proses Panel Kontrol).
 *
 *  Dependensi dari file lain (sudah ada di project):
 *   SHEET_NAMES, STYLE, RISK, HEALTH, STATUS, DC, AC, RUN_LOG_HEADERS, RUN_LOG_WIDTHS,
 *   DETAIL_HEADERS, DETAIL_WIDTHS, ALERT_HEADERS, ALERT_WIDTHS, getConfig(),
 *   getActiveSS(), initializeConfigSheet(), readToleranceMap()
 *
 *  Kolom opsional (Nama Item, Selisih, Skor) dideteksi otomatis dari DETAIL_HEADERS.
 *  Jika tidak ditemukan, bagian terkait tampil "-" tanpa membuat script error.
 */

// ---------- Konfigurasi tampilan dashboard ----------

const DASH_CFG = {
  NCOLS: 12,              // lebar area tabel (kolom A..L); chart ditaruh di kolom N dst
  HEALTH_GOOD: 80,        // skor >= 80  -> sehat
  HEALTH_WARN: 60,        // skor 60-79  -> waspada, < 60 -> kritis
  W_CRIT: 1,              // bobot penalti skor kesehatan
  W_HIGH: 0.6,
  W_MED: 0.25,
  TOP_SKU: 10,
  TOP_FINDINGS: 15,
  TOP_ALERTS: 10,
  HEAT_OUTLETS: 15,
  HEAT_PERIODS: 9,
  TREND_PERIODS: 14,
  CHART_COLORS: ['#C62828', '#EF6C00', '#F9A825', '#2E7D32']   // KRITIS, TINGGI, SEDANG, AMAN
};

// ---------- Pembuatan & styling sheet ----------

/** Pastikan semua sheet yang dibutuhkan ada (tidak menghapus data yang sudah ada) */
function initializeSheets() {
  const ss = getActiveSS();
  initializeConfigSheet();
  ensureSheet(SHEET_NAMES.TOLERANCE, ['SKU', 'Nama Item', 'Tolerance'], [100, 260, 100]);
  ensureSheet(SHEET_NAMES.DETAIL, DETAIL_HEADERS, DETAIL_WIDTHS);
  ensureSheet(SHEET_NAMES.ALERT, ALERT_HEADERS, ALERT_WIDTHS);
  ensureSheet(SHEET_NAMES.RUN_LOG, RUN_LOG_HEADERS, RUN_LOG_WIDTHS);

  // PERBAIKAN: jangan memindahkan tab yang sedang dibuka pengguna.
  // DASHBOARD dipindah ke posisi pertama tanpa mengubah sheet aktif.
  const dash = ensureSheet(SHEET_NAMES.DASHBOARD);
  let prev = null;
  try { prev = ss.getActiveSheet(); } catch (e) { prev = null; }
  if (dash.getIndex() !== 1) {
    // Spreadsheet CONTROL dibuka lewat ID (bukan sheet aktif di UI) -> bungkus try/catch agar aman
    try {
      ss.setActiveSheet(dash);
      ss.moveActiveSheet(1);   // DASHBOARD jadi tab pertama
      if (prev && prev.getSheetId() !== dash.getSheetId()) ss.setActiveSheet(prev);  // kembalikan tab semula
    } catch (e) { Logger.log('Pindah tab DASHBOARD dilewati: ' + e.message); }
  }
  Logger.log('✅ Sheet & konfigurasi siap.');
}

/** Ambil sheet (buat jika belum ada). Jika headers diberikan -> tulis & style header + freeze baris 1 */
function ensureSheet(name, headers, widths) {
  const ss = getActiveSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (headers) {
    const range = sheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    styleHeader(range);
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 34);
    if (widths) widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  }
  return sheet;
}

/** Header gelap (Dark Slate), tulisan putih, Arial */
function styleHeader(range) {
  range.setBackground(STYLE.HEADER_BG)
    .setFontColor(STYLE.HEADER_FONT)
    .setFontFamily(STYLE.FONT)
    .setFontSize(10)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
}

/** Conditional formatting berdasarkan teks (Risk Level / Health) pada satu kolom */
function applyTextColorRules(sheet, col, firstRow, styles) {
  const rows = Math.max(sheet.getMaxRows() - firstRow + 1, 1);
  const range = sheet.getRange(firstRow, col, rows, 1);
  const rules = styles.map(s =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s.label)
      .setBackground(s.bg)
      .setFontColor(s.font)
      .setBold(true)
      .setRanges([range])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
}

function riskStyles() {
  return [RISK.CRITICAL, RISK.HIGH, RISK.MEDIUM, RISK.SAFE];
}

function riskRankByLabel(label) {
  const found = riskStyles().filter(r => r.label === label)[0];
  return found ? found.rank : 0;
}

// ---------- Penulisan data (batch) ----------

/** Kosongkan isi tabel (header tetap) */
function clearBody(sheet, ncols) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, ncols).clearContent();
}

/** Tulis baris per batch (BATCH_SIZE) agar tidak berat */
function writeInBatches(sheet, rows, ncols) {
  if (!rows.length) return;
  const needed = rows.length + 1;
  if (sheet.getMaxRows() < needed) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  }
  const size = getConfig().BATCH_SIZE;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    sheet.getRange(2 + i, 1, chunk.length, ncols).setValues(chunk);
  }
}

function setDropdown(sheet, col, rowCount, values) {
  if (rowCount < 1) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sheet.getRange(2, col, rowCount, 1).setDataValidation(rule);
}

// ---------- MONITORING_DETAIL ----------

/**
 * Simpan hasil analisis ke MONITORING_DETAIL.
 * Baris outlet yang dianalisis diganti; baris outlet lain tetap dipertahankan.
 * Status "SUDAH DIPERIKSA" yang Anda isi manual dipertahankan jika anomali masih ada.
 */
function saveDetailRows(newRows, processedOutlets) {
  const sheet = ensureSheet(SHEET_NAMES.DETAIL, DETAIL_HEADERS, DETAIL_WIDTHS);
  const outletSet = new Set(processedOutlets);
  const kept = [];
  const oldStatus = new Map();

  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, DETAIL_HEADERS.length).getValues().forEach(r => {
      if (!r[DC.OUTLET]) return;
      if (outletSet.has(r[DC.OUTLET])) oldStatus.set(detailKey(r), r[DC.STATUS]);
      else kept.push(r);
    });
  }

  newRows.forEach(r => {
    const prev = oldStatus.get(detailKey(r));
    if (prev === STATUS.DONE && r[DC.RISK] !== RISK.SAFE.label) r[DC.STATUS] = prev;
  });

  // Urutkan: outlet, lalu periode (sort stabil -> urutan SKU tetap)
  const all = kept.concat(newRows).sort((a, b) => {
    if (a[DC.OUTLET] !== b[DC.OUTLET]) return String(a[DC.OUTLET]).localeCompare(String(b[DC.OUTLET]));
    return String(a[DC.PERIOD]).localeCompare(String(b[DC.PERIOD]));
  });

  clearBody(sheet, DETAIL_HEADERS.length);
  const maxRows = Math.max(all.length + 1, sheet.getMaxRows());
  // Kolom Periode & SKU dipaksa teks agar "2026-10-07" tidak berubah jadi tanggal
  sheet.getRange(2, DC.PERIOD + 1, Math.max(maxRows - 1, 1), 1).setNumberFormat('@');
  sheet.getRange(2, DC.SKU + 1, Math.max(maxRows - 1, 1), 1).setNumberFormat('@');
  writeInBatches(sheet, all, DETAIL_HEADERS.length);

  if (all.length) {
    sheet.getRange(2, 1, all.length, DETAIL_HEADERS.length)
      .setFontFamily(STYLE.FONT).setFontSize(10).setVerticalAlignment('middle');
    sheet.getRange(2, DC.TS + 1, all.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, DC.SO_DATA + 1, all.length, 6).setHorizontalAlignment('right');
    sheet.getRange(2, DC.RISK + 1, all.length, 1).setHorizontalAlignment('center');
    sheet.getRange(2, DC.REASON + 1, all.length, 1).setWrap(true);
  }
  setDropdown(sheet, DC.STATUS + 1, all.length, [STATUS.OK, STATUS.CHECK, STATUS.DONE]);
  applyTextColorRules(sheet, DC.RISK + 1, 2, riskStyles());
  return all.length;
}

function detailKey(row) {
  return [row[DC.OUTLET], row[DC.PERIOD], row[DC.SKU]].join('|');
}

// ---------- ALERT_LOG ----------

/**
 * Simpan alert. Alert lama yang masih terdeteksi mempertahankan status & waktu deteksi awal.
 * Alert OPEN yang sudah tidak terdeteksi lagi (outlet yang dianalisis) otomatis jadi CLOSED.
 * CONFIG REOPEN_RECURRING_ALERTS = TRUE -> anomali yang muncul kembali setelah CLOSED
 * dibuka lagi (OPEN) agar kejadian berulang tidak terlewat.
 */
function saveAlertRows(newAlerts, processedOutlets) {
  const sheet = ensureSheet(SHEET_NAMES.ALERT, ALERT_HEADERS, ALERT_WIDTHS);
  const outletSet = new Set(processedOutlets);
  const oldMap = new Map();
  const result = [];
  const newIds = new Set(newAlerts.map(a => a[AC.ID]));

  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, ALERT_HEADERS.length).getValues().forEach(r => {
      if (!r[AC.ID]) return;
      oldMap.set(r[AC.ID], r);
      if (!outletSet.has(r[AC.OUTLET])) { result.push(r); return; }  // outlet lain: biarkan
      if (!newIds.has(r[AC.ID])) {                                    // tidak terdeteksi lagi
        if (r[AC.STATUS] === 'OPEN') r[AC.STATUS] = 'CLOSED';
        result.push(r);
      }
    });
  }

  newAlerts.forEach(a => {
    const prev = oldMap.get(a[AC.ID]);
    if (prev) {
      a[AC.TIME] = prev[AC.TIME];
      a[AC.STATUS] = prev[AC.STATUS];
      if (a[AC.STATUS] === 'CLOSED' && getConfig().REOPEN_RECURRING_ALERTS) a[AC.STATUS] = 'OPEN';
    }
    result.push(a);
  });

  // OPEN dulu, lalu risiko tertinggi, lalu outlet
  result.sort((a, b) => {
    if (a[AC.STATUS] !== b[AC.STATUS]) return a[AC.STATUS] === 'OPEN' ? -1 : 1;
    const dr = riskRankByLabel(b[AC.RISK]) - riskRankByLabel(a[AC.RISK]);
    if (dr !== 0) return dr;
    return String(a[AC.OUTLET]).localeCompare(String(b[AC.OUTLET]));
  });

  clearBody(sheet, ALERT_HEADERS.length);
  const maxRows = Math.max(result.length + 1, sheet.getMaxRows());
  sheet.getRange(2, AC.PERIOD + 1, Math.max(maxRows - 1, 1), 1).setNumberFormat('@');
  writeInBatches(sheet, result, ALERT_HEADERS.length);

  if (result.length) {
    sheet.getRange(2, 1, result.length, ALERT_HEADERS.length)
      .setFontFamily(STYLE.FONT).setFontSize(10).setVerticalAlignment('middle');
    sheet.getRange(2, AC.TIME + 1, result.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange(2, AC.RISK + 1, result.length, 1).setHorizontalAlignment('center');
    sheet.getRange(2, AC.REASON + 1, result.length, 1).setWrap(true);
  }
  setDropdown(sheet, AC.STATUS + 1, result.length, ['OPEN', 'CLOSED']);
  applyTextColorRules(sheet, AC.RISK + 1, 2, riskStyles());
  return result.length;
}

// ============================================================
//  DASHBOARD — EXECUTIVE VERSION
// ============================================================

/** Bangun ulang DASHBOARD dari MONITORING_DETAIL + ALERT_LOG */
function refreshDashboard() {
  const ss = getActiveSS();
  const sheet = ensureSheet(SHEET_NAMES.DASHBOARD);
  const rows = dashReadBody_(ss.getSheetByName(SHEET_NAMES.DETAIL), DETAIL_HEADERS.length);
  const alerts = dashReadBody_(ss.getSheetByName(SHEET_NAMES.ALERT), ALERT_HEADERS.length);

  const model = buildDashboardModel_(rows, alerts);
  renderDashboard_(sheet, model);
  sheet.setTabColor(STYLE.HEADER_BG);
  Logger.log('✅ Dashboard diperbarui (' + model.outletCount + ' outlet, ' + model.totalRows + ' baris, ' +
    model.openAlerts.length + ' alert OPEN).');
}

// ---------- Helper umum ----------

function dashReadBody_(sh, ncols) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ncols).getValues();
}

function dashNum_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).replace(/[^0-9,.\-]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.indexOf(',') > -1) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function dashPct_(x) {
  return (Math.round(x * 1000) / 10) + '%';
}

function dashRiskClass_(label) {
  if (label === RISK.CRITICAL.label) return 'K';
  if (label === RISK.HIGH.label) return 'T';
  if (label === RISK.MEDIUM.label) return 'S';
  return 'A';
}

/**
 * Ringkas label periode untuk header heatmap (VERSI 3).
 *   "2026-10-07"        -> "07/10"
 *   "2026-10-07 (MG 1)" -> "07/10*"   (tanda * = ada label sesi, lihat catatan tabel)
 * Label lain yang lebih dari 14 huruf dipotong agar kolom heatmap tetap rapi.
 */
function dashShortPeriod_(p) {
  const s = String(p == null ? '' : p);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + (s.length > 10 ? '*' : '');
  return s.length > 14 ? s.substring(0, 13) + '…' : s;
}

function dashScoreColor_(score) {
  if (score >= DASH_CFG.HEALTH_GOOD) return '#2E7D32';
  if (score >= DASH_CFG.HEALTH_WARN) return '#EF6C00';
  return '#C62828';
}

/** Status kesehatan outlet dari jumlah temuannya (satu sumber kebenaran — VERSI 3) */
function healthOf_(kCount, tCount, sCount) {
  if (kCount > 0) return HEALTH.RED;
  return (tCount + sCount) > 0 ? HEALTH.AMBER : HEALTH.GREEN;
}

/** Deteksi kolom opsional di MONITORING_DETAIL (nama item, selisih, skor) */
function dashResolveCols_() {
  const find = function (re) {
    for (let i = 0; i < DETAIL_HEADERS.length; i++) {
      if (re.test(String(DETAIL_HEADERS[i]))) return i;
    }
    return -1;
  };
  return {
    item: (typeof DC.ITEM === 'number') ? DC.ITEM : find(/nama\s*item|^item/i),
    variance: (typeof DC.VARIANCE === 'number') ? DC.VARIANCE : find(/variance|selisih|diff/i),
    score: (typeof DC.SCORE === 'number') ? DC.SCORE : find(/skor|score/i)
  };
}

// ---------- Model analisis ----------

function buildDashboardModel_(rows, alerts) {
  const W = DASH_CFG;
  const cols = dashResolveCols_();
  const hasVariance = cols.variance >= 0;

  const outletMap = new Map();
  const skuMap = new Map();
  const periodMap = new Map();
  const heatMap = new Map();
  const findings = [];
  const statusCnt = new Map();
  const risk = { K: 0, T: 0, S: 0, A: 0 };
  let totalRows = 0, nonSafe = 0, nonSafeDone = 0, absVarTotal = 0;
  const pts = { K: 3, T: 2, S: 1, A: 0 };

  rows.forEach(r => {
    const outlet = r[DC.OUTLET];
    if (!outlet) return;
    totalRows++;

    const cls = dashRiskClass_(r[DC.RISK]);
    const period = (r[DC.PERIOD] === '' || r[DC.PERIOD] == null) ? '-' : String(r[DC.PERIOD]);
    const skuCode = (r[DC.SKU] == null) ? '' : String(r[DC.SKU]);
    const item = cols.item >= 0 ? String(r[cols.item] || '') : '';
    const variance = hasVariance ? dashNum_(r[cols.variance]) : 0;
    const absVar = Math.abs(variance);
    const status = String(r[DC.STATUS] || '');
    const flagged = cls !== 'A';

    risk[cls]++;
    statusCnt.set(status, (statusCnt.get(status) || 0) + 1);

    // --- per outlet ---
    let o = outletMap.get(outlet);
    if (!o) { o = { name: outlet, total: 0, K: 0, T: 0, S: 0, A: 0, absVar: 0 }; outletMap.set(outlet, o); }
    o.total++; o[cls]++;
    if (flagged) o.absVar += absVar;

    // --- per periode ---
    let p = periodMap.get(period);
    if (!p) { p = { period: period, K: 0, T: 0, S: 0, A: 0, total: 0 }; periodMap.set(period, p); }
    p.total++; p[cls]++;

    // --- per SKU ---
    let s = skuMap.get(skuCode);
    if (!s) { s = { sku: skuCode, item: '', total: 0, K: 0, T: 0, S: 0, absVar: 0, outlets: new Map() }; skuMap.set(skuCode, s); }
    s.total++;
    if (!s.item && item) s.item = item;

    if (flagged) {
      nonSafe++;
      if (status === STATUS.DONE) nonSafeDone++;
      absVarTotal += absVar;
      s[cls]++;
      s.absVar += absVar;
      s.outlets.set(outlet, (s.outlets.get(outlet) || 0) + pts[cls]);

      const hk = outlet + '||' + period;
      heatMap.set(hk, (heatMap.get(hk) || 0) + pts[cls]);

      findings.push({
        outlet: outlet, period: period, sku: skuCode, item: item,
        riskLabel: r[DC.RISK], rank: riskRankByLabel(r[DC.RISK]),
        variance: variance, absVar: absVar, status: status, reason: r[DC.REASON] || ''
      });
    }
  });

  // ----- Outlet: skor kesehatan & ranking (terburuk di atas) — VERSI 3: health via healthOf_() -----
  const outletList = [];
  outletMap.forEach(o => {
    o.anomaly = o.K + o.T + o.S;
    o.rate = o.total ? o.anomaly / o.total : 0;
    const penalty = o.total ? (o.K * W.W_CRIT + o.T * W.W_HIGH + o.S * W.W_MED) / o.total * 100 : 0;
    o.score = Math.max(0, Math.round(100 - penalty));
    o.health = healthOf_(o.K, o.T, o.S);
    o.healthRank = o.health === HEALTH.RED ? 0 : (o.health === HEALTH.AMBER ? 1 : 2);
    outletList.push(o);
  });
  outletList.sort((a, b) => {
    return (a.healthRank - b.healthRank) || (a.score - b.score) || (b.K - a.K) || (b.anomaly - a.anomaly) ||
      String(a.name).localeCompare(String(b.name));
  });
  const healthCount = { RED: 0, AMBER: 0, GREEN: 0 };
  outletList.forEach(o => { healthCount[o.health.label]++; });
  const avgScore = outletList.length
    ? Math.round(outletList.reduce((a, o) => a + o.score, 0) / outletList.length * 10) / 10 : 0;

  // ----- SKU: ranking frekuensi & keparahan -----
  const skuList = [];
  skuMap.forEach(s => {
    s.flag = s.K + s.T + s.S;
    if (!s.flag) return;
    s.points = s.K * 3 + s.T * 2 + s.S;
    s.freq = s.total ? s.flag / s.total : 0;
    s.outletCount = s.outlets.size;
    s.topOutlets = Array.from(s.outlets.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]).join(' · ');
    skuList.push(s);
  });
  skuList.sort((a, b) => (b.points - a.points) || (b.outletCount - a.outletCount) ||
    (b.absVar - a.absVar) || String(a.sku).localeCompare(String(b.sku)));

  // ----- Periode (kronologis) -----
  const periodList = Array.from(periodMap.values())
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  periodList.forEach(p => { p.anomaly = p.K + p.T + p.S; p.rate = p.total ? p.anomaly / p.total : 0; });
  const realPeriods = periodList.filter(p => p.period !== '-');

  // ----- Temuan teratas -----
  findings.sort((a, b) => (b.rank - a.rank) || (b.absVar - a.absVar) ||
    String(a.outlet).localeCompare(String(b.outlet)) || String(a.period).localeCompare(String(b.period)));

  // ----- Alert OPEN (VERSI 3: membawa Alert ID untuk Panel Kontrol) -----
  const now = new Date();
  const openAlerts = [];
  alerts.forEach(a => {
    if (!a[AC.ID] || String(a[AC.STATUS]) !== 'OPEN') return;
    const raw = a[AC.TIME];
    const t = raw instanceof Date ? raw : (raw ? new Date(raw) : null);
    const ok = t && !isNaN(t.getTime());
    openAlerts.push({
      id: a[AC.ID],
      outlet: a[AC.OUTLET], period: a[AC.PERIOD], risk: a[AC.RISK],
      rank: riskRankByLabel(a[AC.RISK]), reason: a[AC.REASON] || '',
      time: ok ? t : '', age: ok ? Math.max(0, Math.floor((now - t) / 86400000)) : null
    });
  });
  openAlerts.sort((a, b) => (b.rank - a.rank) || ((b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age)) ||
    String(a.outlet).localeCompare(String(b.outlet)));
  const aging = [
    ['0–1 hari', 0], ['2–3 hari', 0], ['4–7 hari', 0], ['> 7 hari', 0], ['Tanpa tanggal', 0]
  ];
  let oldestAge = null;
  openAlerts.forEach(a => {
    if (a.age == null) { aging[4][1]++; return; }
    if (oldestAge == null || a.age > oldestAge) oldestAge = a.age;
    if (a.age <= 1) aging[0][1]++;
    else if (a.age <= 3) aging[1][1]++;
    else if (a.age <= 7) aging[2][1]++;
    else aging[3][1]++;
  });

  // ----- Ringkasan lain -----
  let tolCount = 0;
  try { tolCount = readToleranceMap().size; } catch (e) { tolCount = 0; }
  const lastRun = PropertiesService.getDocumentProperties().getProperty('LAST_ANALYSIS') || '-';
  const anomalyRate = totalRows ? nonSafe / totalRows : 0;
  const progressPct = nonSafe ? nonSafeDone / nonSafe : 0;

  // ----- Insight otomatis -----
  const insights = [];
  if (!totalRows) {
    insights.push('Belum ada data rekonsiliasi. Jalankan: 📊 Monitoring Outlet → Jalankan Analisis Lengkap.');
  } else {
    const worst = outletList[0];
    insights.push('Outlet dengan risiko tertinggi: ' + worst.name + ' — skor kesehatan ' + worst.score +
      '/100 (' + worst.K + ' KRITIS, ' + worst.T + ' TINGGI, ' + worst.S + ' SEDANG dari ' + worst.total + ' baris).');
    insights.push('Secara keseluruhan ' + dashPct_(anomalyRate) + ' baris (' + nonSafe + ' dari ' + totalRows +
      ') terindikasi perlu diperiksa; ' + risk.K + ' di antaranya level KRITIS.');

    if (nonSafe > 0 && outletList.length > 3) {
      const top3 = outletList.slice().sort((a, b) => b.anomaly - a.anomaly).slice(0, 3);
      const share = top3.reduce((a, o) => a + o.anomaly, 0) / nonSafe;
      insights.push('Konsentrasi temuan: 3 outlet teratas (' + top3.map(o => o.name).join(', ') + ') menyumbang ' +
        dashPct_(share) + ' dari seluruh temuan.');
    }
    if (skuList.length) {
      const s = skuList[0];
      insights.push('SKU paling sering bermasalah: ' + s.sku + (s.item ? ' — ' + s.item : '') + ' (' + s.flag +
        ' kali terindikasi di ' + s.outletCount + ' outlet).');
    }
    if (realPeriods.length) {
      let peak = null, peakPts = 0;
      realPeriods.forEach(p => {
        const v = p.K * 3 + p.T * 2 + p.S;
        if (v > peakPts) { peakPts = v; peak = p; }
      });
      if (peak) insights.push('Periode dengan tekanan risiko tertinggi: ' + peak.period + ' (' + peak.K + ' KRITIS, ' +
        peak.T + ' TINGGI, ' + peak.S + ' SEDANG).');
    }
    if (realPeriods.length >= 2) {
      const cur = realPeriods[realPeriods.length - 1], prev = realPeriods[realPeriods.length - 2];
      const d = cur.anomaly - prev.anomaly;
      insights.push('Tren terbaru: temuan pada ' + cur.period + ' ' + (d > 0 ? 'naik ' + d : d < 0 ? 'turun ' + Math.abs(d) : 'sama') +
        (d === 0 ? ' ' : ' baris ') + 'dibanding ' + prev.period + '.');
    }
    insights.push(openAlerts.length
      ? openAlerts.length + ' alert masih OPEN' + (oldestAge != null ? ', tertua ' + oldestAge + ' hari' : '') +
        '; ' + openAlerts.filter(a => a.risk === RISK.CRITICAL.label).length + ' di antaranya KRITIS.'
      : 'Tidak ada alert OPEN saat ini.');
    if (nonSafe > 0) {
      insights.push('Progres pemeriksaan: ' + nonSafeDone + ' dari ' + nonSafe + ' temuan (' + dashPct_(progressPct) +
        ') sudah berstatus "' + STATUS.DONE + '".');
    }
  }

  return {
    totalRows: totalRows, nonSafe: nonSafe, nonSafeDone: nonSafeDone, risk: risk,
    anomalyRate: anomalyRate, progressPct: progressPct, hasVariance: hasVariance, absVarTotal: absVarTotal,
    outletCount: outletList.length, outletList: outletList, healthCount: healthCount, avgScore: avgScore,
    skuList: skuList, periodList: periodList, realPeriods: realPeriods, heatMap: heatMap,
    findings: findings, openAlerts: openAlerts, aging: aging, oldestAge: oldestAge,
    statusCnt: statusCnt, tolCount: tolCount, lastRun: lastRun, insights: insights
  };
}

// ---------- Render ----------

function renderDashboard_(sheet, m) {
  const CFG = DASH_CFG;
  const N = CFG.NCOLS;
  const FONT = STYLE.FONT;
  const LINE = '#D5DAE3';
  const ZEBRA = '#F6F8FB';
  const cf = [];
  const anchors = {};
  const BS = SpreadsheetApp.BorderStyle;

  // ----- Reset total -----
  sheet.getCharts().forEach(c => sheet.removeChart(c));
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.setConditionalFormatRules([]);

  const needed = 200 + m.outletList.length + m.insights.length;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  sheet.setRowHeights(1, sheet.getMaxRows(), 21);
  sheet.setHiddenGridlines(true);
  [60, 245, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 25].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ----- Helper lokal -----
  const sectionTitle = function (row, text, note) {
    sheet.getRange(row, 1, 1, N).setBorder(null, null, true, null, null, null, STYLE.HEADER_BG, BS.SOLID_MEDIUM);
    sheet.getRange(row, 1).setValue(text).setFontSize(12).setFontWeight('bold')
      .setFontColor(STYLE.HEADER_BG).setWrap(false).setVerticalAlignment('bottom');
    sheet.setRowHeight(row, 28);
    if (note) {
      sheet.getRange(row + 1, 1).setValue(note).setFontSize(9).setFontStyle('italic')
        .setFontColor('#777777').setWrap(false);
      return row + 2;
    }
    return row + 1;
  };

  const tableHeader = function (row, startCol, labels) {
    const rg = sheet.getRange(row, startCol, 1, labels.length);
    rg.setNumberFormat('@').setValues([labels]);
    styleHeader(rg);
    sheet.setRowHeight(row, 30);
    return rg;
  };

  const tableBody = function (row, startCol, data, ncols, textCols) {
    if (!data.length) return null;
    (textCols || []).forEach(c => sheet.getRange(row, c, data.length, 1).setNumberFormat('@'));
    const rg = sheet.getRange(row, startCol, data.length, ncols);
    rg.setValues(data).setFontSize(10).setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, LINE, BS.SOLID);
    for (let i = 1; i < data.length; i += 2) sheet.getRange(row + i, startCol, 1, ncols).setBackground(ZEBRA);
    return rg;
  };

  const emptyNote = function (row, text) {
    sheet.getRange(row, 1).setValue(text).setFontStyle('italic').setFontColor('#777777').setWrap(false);
    return row + 2;
  };

  const riskRules = function (rg) {
    riskStyles().forEach(s => cf.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s.label).setBackground(s.bg).setFontColor(s.font).setBold(true)
      .setRanges([rg]).build()));
  };

  const healthTextRules = function (rg) {
    [HEALTH.RED, HEALTH.AMBER, HEALTH.GREEN].forEach(h => cf.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(h.label).setBackground(h.bg).setFontColor(h.font).setBold(true)
      .setRanges([rg]).build()));
  };

  const scoreRules = function (rg) {
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(CFG.HEALTH_WARN)
      .setBackground(HEALTH.RED.bg).setFontColor(HEALTH.RED.font).setBold(true).setRanges([rg]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(CFG.HEALTH_WARN, CFG.HEALTH_GOOD - 0.0001)
      .setBackground(HEALTH.AMBER.bg).setFontColor(HEALTH.AMBER.font).setBold(true).setRanges([rg]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(CFG.HEALTH_GOOD)
      .setBackground(HEALTH.GREEN.bg).setFontColor(HEALTH.GREEN.font).setBold(true).setRanges([rg]).build());
  };

  const fontColorIfPositive = function (rg, color) {
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0)
      .setFontColor(color).setBold(true).setRanges([rg]).build());
  };

  const renderCards = function (top, list) {
    list.forEach(function (c, i) {
      const col = 1 + i * 2;
      const block = sheet.getRange(top, col, 3, 2);
      block.setBackground(STYLE.KPI_BG).setBorder(true, true, true, true, false, false, '#FFFFFF', BS.SOLID_THICK);
      sheet.getRange(top, col, 1, 2).setBorder(true, null, null, null, null, null, c.c, BS.SOLID_THICK);

      sheet.getRange(top, col, 1, 2).merge().setValue(c.l).setFontSize(8).setFontWeight('bold')
        .setFontColor('#607D8B').setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
      const val = sheet.getRange(top + 1, col, 1, 2).merge();
      val.setValue(c.v).setFontSize(22).setFontWeight('bold').setFontColor(c.c)
        .setHorizontalAlignment('center').setVerticalAlignment('middle');
      if (c.f) val.setNumberFormat(c.f);
      sheet.getRange(top + 2, col, 1, 2).merge().setValue(c.n).setFontSize(9)
        .setFontColor('#78909C').setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('top');
    });
    sheet.setRowHeight(top, 28);
    sheet.setRowHeight(top + 1, 42);
    sheet.setRowHeight(top + 2, 24);
  };

  const total = m.totalRows;
  const pctOf = function (x) { return total ? x / total : 0; };
  const tz = Session.getScriptTimeZone();

  // =========================================================
  // 1. JUDUL
  // =========================================================
  sheet.getRange('A1').setValue('📊 MONITORING OUTLET — EXECUTIVE DASHBOARD')
    .setFontSize(18).setFontWeight('bold').setFontColor(STYLE.HEADER_BG).setWrap(false).setVerticalAlignment('middle');
  sheet.setRowHeight(1, 40);
  sheet.getRange('A2').setValue('Diperbarui: ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') +
    '   |   Analisis terakhir: ' + m.lastRun + '   |   Sumber: MONITORING_DETAIL & ALERT_LOG')
    .setFontSize(9).setFontColor('#777777').setWrap(false);
  sheet.setFrozenRows(2);

  // =========================================================
  // 2. KARTU KPI
  // =========================================================
  let row = 4;
  const periodRange = m.realPeriods.length
    ? m.realPeriods[0].period + ' → ' + m.realPeriods[m.realPeriods.length - 1].period : '-';

  renderCards(row, [
    { l: 'TOTAL OUTLET DIANALISIS', v: m.outletCount, f: '#,##0', c: '#37474F',
      n: 'RED ' + m.healthCount.RED + ' · AMBER ' + m.healthCount.AMBER + ' · GREEN ' + m.healthCount.GREEN },
    { l: 'SKU AKTIF DIANALISIS', v: m.tolCount, f: '#,##0', c: '#37474F', n: 'sesuai sheet TOLERANCE' },
    { l: 'TOTAL BARIS REKONSILIASI', v: total, f: '#,##0', c: '#37474F', n: m.realPeriods.length + ' periode tercakup' },
    { l: 'ANOMALI KRITIS', v: m.risk.K, f: '#,##0', c: '#C62828', n: dashPct_(pctOf(m.risk.K)) + ' dari seluruh baris' },
    { l: 'PERLU DIPERIKSA (TINGGI + SEDANG)', v: m.risk.T + m.risk.S, f: '#,##0', c: '#EF6C00',
      n: 'TINGGI ' + m.risk.T + ' · SEDANG ' + m.risk.S },
    { l: 'RATA-RATA SKOR KESEHATAN', v: m.avgScore, f: '0.0', c: dashScoreColor_(m.avgScore), n: 'skala 0–100 (semua outlet)' }
  ]);
  row += 4;

  renderCards(row, [
    { l: 'TINGKAT ANOMALI', v: m.anomalyRate, f: '0.0%', c: '#C62828', n: m.nonSafe + ' dari ' + total + ' baris' },
    { l: 'ALERT OPEN', v: m.openAlerts.length, f: '#,##0', c: m.openAlerts.length ? '#C62828' : '#2E7D32',
      n: m.openAlerts.filter(a => a.risk === RISK.CRITICAL.label).length + ' level KRITIS' },
    { l: 'ALERT OPEN TERTUA (HARI)', v: m.oldestAge == null ? '-' : m.oldestAge, f: '0', c: '#EF6C00', n: 'sejak waktu deteksi awal' },
    { l: 'PROGRES PEMERIKSAAN', v: m.progressPct, f: '0.0%', c: '#2E7D32',
      n: m.nonSafeDone + ' dari ' + m.nonSafe + ' temuan selesai' },
    { l: 'TOTAL |SELISIH| TEMUAN', v: m.hasVariance ? m.absVarTotal : '-', f: '#,##0.##', c: '#37474F',
      n: m.hasVariance ? 'akumulasi baris terindikasi' : 'kolom selisih tidak terdeteksi' },
    { l: 'RENTANG PERIODE', v: m.realPeriods.length, f: '0', c: '#37474F', n: periodRange }
  ]);
  row += 4;

  // =========================================================
  // 3. INSIGHT OTOMATIS
  // =========================================================
  row = sectionTitle(row, '💡 INSIGHT OTOMATIS', 'Kesimpulan singkat yang dihitung langsung dari data terbaru. Temuan bersifat indikasi untuk diperiksa.');
  m.insights.forEach(function (t) {
    const rg = sheet.getRange(row, 1, 1, N).merge();
    rg.setValue('▸  ' + t).setWrap(true).setVerticalAlignment('middle').setFontSize(10).setBackground('#F1F4F9')
      .setBorder(null, null, true, null, null, null, '#FFFFFF', BS.SOLID);
    sheet.setRowHeight(row, 30);
    row++;
  });
  row++;

  // =========================================================
  // 4. RINGKASAN RISIKO / PEMERIKSAAN / UMUR ALERT
  // =========================================================
  row = sectionTitle(row, '🧭 RINGKASAN RISIKO, PEMERIKSAAN & UMUR ALERT');
  const sumHdr = row;
  anchors.pie = sumHdr;

  tableHeader(sumHdr, 2, ['Tingkat Risiko', 'Jumlah', '% Total']);
  tableBody(sumHdr + 1, 2, [
    [RISK.CRITICAL.label, m.risk.K, pctOf(m.risk.K)],
    [RISK.HIGH.label, m.risk.T, pctOf(m.risk.T)],
    [RISK.MEDIUM.label, m.risk.S, pctOf(m.risk.S)],
    [RISK.SAFE.label, m.risk.A, pctOf(m.risk.A)]
  ], 3);
  sheet.getRange(sumHdr + 1, 2, 4, 1).setHorizontalAlignment('center');
  sheet.getRange(sumHdr + 1, 3, 4, 1).setNumberFormat('#,##0').setHorizontalAlignment('center');
  sheet.getRange(sumHdr + 1, 4, 4, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
  riskRules(sheet.getRange(sumHdr + 1, 2, 4, 1));

  // Status pemeriksaan (F:G digabung)
  tableHeader(sumHdr, 6, ['Status Pemeriksaan', '', 'Jumlah', '% Total']);
  sheet.getRange(sumHdr, 6, 1, 2).merge();
  const stOk = m.statusCnt.get(STATUS.OK) || 0;
  const stCheck = m.statusCnt.get(STATUS.CHECK) || 0;
  const stDone = m.statusCnt.get(STATUS.DONE) || 0;
  const stOther = Math.max(total - stOk - stCheck - stDone, 0);
  tableBody(sumHdr + 1, 6, [
    [STATUS.OK, '', stOk, pctOf(stOk)],
    [STATUS.CHECK, '', stCheck, pctOf(stCheck)],
    [STATUS.DONE, '', stDone, pctOf(stDone)],
    ['Lainnya / kosong', '', stOther, pctOf(stOther)]
  ], 4);
  for (let i = 1; i <= 4; i++) sheet.getRange(sumHdr + i, 6, 1, 2).merge();
  sheet.getRange(sumHdr + 1, 8, 4, 1).setNumberFormat('#,##0').setHorizontalAlignment('center');
  sheet.getRange(sumHdr + 1, 9, 4, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');

  // Umur alert OPEN
  tableHeader(sumHdr, 11, ['Umur Alert OPEN', 'Jumlah']);
  tableBody(sumHdr + 1, 11, m.aging, 2);
  sheet.getRange(sumHdr + 1, 12, 5, 1).setHorizontalAlignment('center');
  fontColorIfPositive(sheet.getRange(sumHdr + 4, 12, 1, 1), '#C62828');

  row = sumHdr + 7;

  // =========================================================
  // 5. RANKING OUTLET
  // =========================================================
  row = sectionTitle(row, '🏆 RANKING OUTLET — DARI RISIKO TERTINGGI',
    'Skor Kesehatan = 100 − (KRITIS×' + CFG.W_CRIT + ' + TINGGI×' + CFG.W_HIGH + ' + SEDANG×' + CFG.W_MED +
    ') ÷ Total Baris × 100.  ≥ ' + CFG.HEALTH_GOOD + ' sehat · ' + CFG.HEALTH_WARN + '–' + (CFG.HEALTH_GOOD - 1) + ' waspada · < ' + CFG.HEALTH_WARN + ' kritis.');
  if (!m.outletList.length) {
    row = emptyNote(row, 'Belum ada data. Jalankan: 📊 Monitoring Outlet → Jalankan Analisis Lengkap');
  } else {
    anchors.rank = row;
    const hdr = row;
    tableHeader(hdr, 1, ['#', 'Outlet', 'Total Baris', 'KRITIS', 'TINGGI', 'SEDANG', 'AMAN', '% Anomali',
      'Skor Kesehatan', 'Status', 'Indikator Skor', '']);
    sheet.getRange(hdr, 11, 1, 2).merge();

    // Bar indikator berupa teks (bukan rumus) agar aman di semua locale spreadsheet
    const barOf = function (score) {
      const filled = Math.max(0, Math.min(20, Math.round(score / 5)));
      return new Array(filled + 1).join('█') + new Array(20 - filled + 1).join('░');
    };
    const data = m.outletList.map(function (o, i) {
      return [i + 1, o.name, o.total, o.K, o.T, o.S, o.A, o.rate, o.score, o.health.label, barOf(o.score), ''];
    });
    tableBody(hdr + 1, 1, data, N);
    const n = data.length;
    sheet.getRange(hdr + 1, 1, n, 1).setHorizontalAlignment('center').setFontColor('#607D8B');
    sheet.getRange(hdr + 1, 2, n, 1).setFontWeight('bold');
    sheet.getRange(hdr + 1, 3, n, 5).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 8, n, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 9, n, 1).setNumberFormat('0').setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 10, n, 1).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 11, n, 1)
      .setFontColors(m.outletList.map(o => [dashScoreColor_(o.score)]))
      .setFontSize(8).setHorizontalAlignment('left');
    for (let i = 1; i <= n; i++) sheet.getRange(hdr + i, 11, 1, 2).merge();

    fontColorIfPositive(sheet.getRange(hdr + 1, 4, n, 1), '#C62828');
    fontColorIfPositive(sheet.getRange(hdr + 1, 5, n, 1), '#EF6C00');
    scoreRules(sheet.getRange(hdr + 1, 9, n, 1));
    healthTextRules(sheet.getRange(hdr + 1, 10, n, 1));

    anchors.rankHdr = hdr;
    anchors.rankCount = Math.min(10, n);
    row = hdr + n + 2;
  }

  // =========================================================
  // 6. HEATMAP OUTLET × PERIODE
  // =========================================================
  row = sectionTitle(row, '🔥 HEATMAP RISIKO — OUTLET × PERIODE',
    'Poin risiko: KRITIS ×3, TINGGI ×2, SEDANG ×1. Menampilkan ' + CFG.HEAT_OUTLETS + ' outlet terburuk dan ' +
    CFG.HEAT_PERIODS + ' periode terakhir. Makin merah = makin tinggi. Label "dd/mm*" berarti periode memakai label sesi (mis. MG 1).');
  const heatPeriods = m.realPeriods.slice(-CFG.HEAT_PERIODS);
  const heatOutlets = m.outletList.slice(0, CFG.HEAT_OUTLETS);
  if (!heatPeriods.length || !heatOutlets.length) {
    row = emptyNote(row, 'Belum ada data periode untuk heatmap.');
  } else {
    const hdr = row;
    const p = heatPeriods.length;
    tableHeader(hdr, 1, ['#', 'Outlet'].concat(heatPeriods.map(x => dashShortPeriod_(x.period)), ['Total']));
    const data = heatOutlets.map(function (o, i) {
      let sum = 0;
      const vals = heatPeriods.map(function (pp) {
        const v = m.heatMap.get(o.name + '||' + pp.period) || 0;
        sum += v;
        return v;
      });
      return [i + 1, o.name].concat(vals, [sum]);
    });
    tableBody(hdr + 1, 1, data, 3 + p);
    const n = data.length;
    sheet.getRange(hdr + 1, 1, n, 1).setHorizontalAlignment('center').setFontColor('#607D8B');
    sheet.getRange(hdr + 1, 2, n, 1).setFontWeight('bold');
    const grid = sheet.getRange(hdr + 1, 3, n, p);
    grid.setNumberFormat('0;-0;"·"').setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 3 + p, n, 1).setNumberFormat('0').setHorizontalAlignment('center').setFontWeight('bold');
    cf.push(SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint('#FFFFFF').setGradientMaxpoint('#E53935').setRanges([grid]).build());
    row = hdr + n + 2;
  }

  // =========================================================
  // 7. TREN PER PERIODE
  // =========================================================
  row = sectionTitle(row, '📈 TREN TEMUAN PER PERIODE',
    'Menampilkan ' + CFG.TREND_PERIODS + ' periode terakhir (kronologis). Perubahan dibandingkan jumlah temuan periode sebelumnya.');
  const trend = m.realPeriods.slice(-CFG.TREND_PERIODS);
  if (!trend.length) {
    row = emptyNote(row, 'Belum ada data periode.');
  } else {
    anchors.trend = row;
    const hdr = row;
    tableHeader(hdr, 1, ['#', 'Periode', 'KRITIS', 'TINGGI', 'SEDANG', 'AMAN', 'Total Baris', '% Anomali', 'Perubahan']);
    const data = trend.map(function (t, i) {
      let delta = '—';
      if (i > 0) {
        const d = t.anomaly - trend[i - 1].anomaly;
        delta = d > 0 ? '▲ +' + d : (d < 0 ? '▼ ' + d : '— 0');
      }
      return [i + 1, t.period, t.K, t.T, t.S, t.A, t.total, t.rate, delta];
    });
    tableBody(hdr + 1, 1, data, 9, [2]);
    const n = data.length;
    sheet.getRange(hdr + 1, 1, n, 1).setHorizontalAlignment('center').setFontColor('#607D8B');
    sheet.getRange(hdr + 1, 2, n, 1).setHorizontalAlignment('center').setFontWeight('bold');
    sheet.getRange(hdr + 1, 3, n, 5).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 8, n, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 9, n, 1).setHorizontalAlignment('center');
    fontColorIfPositive(sheet.getRange(hdr + 1, 3, n, 1), '#C62828');
    fontColorIfPositive(sheet.getRange(hdr + 1, 4, n, 1), '#EF6C00');
    const dRange = sheet.getRange(hdr + 1, 9, n, 1);
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('▲')
      .setFontColor('#C62828').setBold(true).setRanges([dRange]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('▼')
      .setFontColor('#2E7D32').setBold(true).setRanges([dRange]).build());
    anchors.trendHdr = hdr;
    anchors.trendCount = n;
    row = hdr + n + 2;
  }

  // =========================================================
  // 8. TOP SKU
  // =========================================================
  row = sectionTitle(row, '📦 TOP ' + CFG.TOP_SKU + ' SKU PALING SERING BERMASALAH',
    'Diurutkan berdasarkan poin keparahan (KRITIS×3, TINGGI×2, SEDANG×1), lalu jumlah outlet terdampak.');
  const topSku = m.skuList.slice(0, CFG.TOP_SKU);
  if (!topSku.length) {
    row = emptyNote(row, 'Tidak ada SKU yang terindikasi.');
  } else {
    const hdr = row;
    tableHeader(hdr, 1, ['#', 'SKU — Nama Item', 'Outlet Terdampak', 'KRITIS', 'TINGGI', 'SEDANG', 'Total Temuan',
      'Frekuensi', 'Σ |Selisih|', 'Outlet Utama', '', '']);
    sheet.getRange(hdr, 10, 1, 3).merge();
    const data = topSku.map(function (s, i) {
      return [i + 1, s.sku + (s.item ? ' — ' + s.item : ''), s.outletCount, s.K, s.T, s.S, s.flag, s.freq,
        m.hasVariance ? s.absVar : '-', s.topOutlets, '', ''];
    });
    tableBody(hdr + 1, 1, data, N);
    const n = data.length;
    sheet.getRange(hdr + 1, 1, n, 1).setHorizontalAlignment('center').setFontColor('#607D8B');
    sheet.getRange(hdr + 1, 2, n, 1).setFontWeight('bold').setWrap(true);
    sheet.getRange(hdr + 1, 3, n, 5).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 8, n, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 9, n, 1).setNumberFormat('#,##0.##').setHorizontalAlignment('right');
    for (let i = 1; i <= n; i++) {
      sheet.getRange(hdr + i, 10, 1, 3).merge().setWrap(true);
      sheet.setRowHeight(hdr + i, 30);
    }
    fontColorIfPositive(sheet.getRange(hdr + 1, 4, n, 1), '#C62828');
    fontColorIfPositive(sheet.getRange(hdr + 1, 5, n, 1), '#EF6C00');
    row = hdr + n + 2;
  }

  // =========================================================
  // 9. TEMUAN TERATAS (OUTLET × SKU)
  // =========================================================
  row = sectionTitle(row, '🚨 TOP ' + CFG.TOP_FINDINGS + ' TEMUAN PRIORITAS PEMERIKSAAN',
    'Diurutkan berdasarkan tingkat risiko, lalu besar |selisih|. Gunakan sheet MONITORING_DETAIL untuk daftar lengkap.');
  const topFind = m.findings.slice(0, CFG.TOP_FINDINGS);
  if (!topFind.length) {
    row = emptyNote(row, 'Tidak ada temuan yang perlu diperiksa.');
  } else {
    const hdr = row;
    tableHeader(hdr, 1, ['#', 'Outlet', 'Periode', 'SKU', 'Nama Item', '', 'Risiko', 'Selisih', 'Status', 'Alasan', '', '']);
    sheet.getRange(hdr, 5, 1, 2).merge();
    sheet.getRange(hdr, 10, 1, 3).merge();
    const data = topFind.map(function (f, i) {
      return [i + 1, f.outlet, f.period, f.sku, f.item, '', f.riskLabel, m.hasVariance ? f.variance : '-',
        f.status, f.reason, '', ''];
    });
    tableBody(hdr + 1, 1, data, N, [3, 4]);
    const n = data.length;
    sheet.getRange(hdr + 1, 1, n, 1).setHorizontalAlignment('center').setFontColor('#607D8B');
    sheet.getRange(hdr + 1, 2, n, 1).setFontWeight('bold');
    sheet.getRange(hdr + 1, 3, n, 2).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 7, n, 1).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 8, n, 1).setNumberFormat('#,##0.##;-#,##0.##').setHorizontalAlignment('right');
    sheet.getRange(hdr + 1, 9, n, 1).setHorizontalAlignment('center');
    for (let i = 1; i <= n; i++) {
      sheet.getRange(hdr + i, 5, 1, 2).merge().setWrap(true);
      sheet.getRange(hdr + i, 10, 1, 3).merge().setWrap(true).setFontSize(9);
      sheet.setRowHeight(hdr + i, 34);
    }
    riskRules(sheet.getRange(hdr + 1, 7, n, 1));
    row = hdr + n + 2;
  }

  // =========================================================
  // 10. ALERT OPEN PRIORITAS
  // =========================================================
  row = sectionTitle(row, '🔔 ALERT OPEN PRIORITAS (TOP ' + CFG.TOP_ALERTS + ')',
    'Diurutkan berdasarkan risiko tertinggi, lalu alert tertua. Ubah status ke CLOSED di sheet ALERT_LOG atau lewat Panel Kontrol setelah selesai ditangani.');
  const topAlerts = m.openAlerts.slice(0, CFG.TOP_ALERTS);
  if (!topAlerts.length) {
    row = emptyNote(row, '✅ Tidak ada alert OPEN.');
  } else {
    const hdr = row;
    tableHeader(hdr, 1, ['#', 'Outlet', 'Periode', 'Risiko', 'Umur (hari)', 'Terdeteksi', 'Alasan', '', '', '', '', '']);
    sheet.getRange(hdr, 7, 1, 6).merge();
    const data = topAlerts.map(function (a, i) {
      return [i + 1, a.outlet, a.period, a.risk, a.age == null ? '-' : a.age, a.time, a.reason, '', '', '', '', ''];
    });
    tableBody(hdr + 1, 1, data, N, [3]);
    const n = data.length;
    sheet.getRange(hdr + 1, 1, n, 1).setHorizontalAlignment('center').setFontColor('#607D8B');
    sheet.getRange(hdr + 1, 2, n, 1).setFontWeight('bold');
    sheet.getRange(hdr + 1, 3, n, 5).setHorizontalAlignment('center');
    sheet.getRange(hdr + 1, 6, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    for (let i = 1; i <= n; i++) {
      sheet.getRange(hdr + i, 7, 1, 6).merge().setWrap(true).setFontSize(9).setHorizontalAlignment('left');
      sheet.setRowHeight(hdr + i, 34);
    }
    riskRules(sheet.getRange(hdr + 1, 4, n, 1));
    row = hdr + n + 2;
  }

  // =========================================================
  // 11. CATATAN METODE
  // =========================================================
  row = sectionTitle(row, 'ℹ️ CATATAN METODE');
  [
    'Status Kesehatan outlet: RED = ada anomali KRITIS · AMBER = ada TINGGI/SEDANG tanpa KRITIS · GREEN = semua AMAN.',
    'Hasil sistem merupakan indikasi untuk diperiksa (bukan kesimpulan kecurangan). Verifikasi tetap perlu dilakukan lewat Inventory Movement dan bukti transaksi.',
    'Dashboard dibangun ulang setiap kali analisis dijalankan. Chart ada di sisi kanan (kolom N dst).',
    'RUN_LOG mencatat setiap tahap analisis (mulai, per outlet, selesai) — riwayat proses bisa diperiksa kapan pun.'
  ].forEach(function (t) {
    sheet.getRange(row, 1, 1, N).merge().setValue('• ' + t).setFontSize(9).setFontColor('#607D8B').setWrap(true)
      .setVerticalAlignment('middle');
    sheet.setRowHeight(row, 26);
    row++;
  });

  // ----- Terapkan font & aturan warna -----
  sheet.getRange(1, 1, row, N).setFontFamily(FONT);
  sheet.setConditionalFormatRules(cf);

  // =========================================================
  // 12. CHART (kolom N dst)
  // =========================================================
  if (total) {
    const colors = CFG.CHART_COLORS;
    const chartRow1 = 4;
    const chartRow2 = Math.max(anchors.rank || 0, chartRow1 + 14);
    const chartRow3 = Math.max(anchors.trend || 0, chartRow2 + 16);

    // Pie: distribusi risiko
    sheet.insertChart(sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(anchors.pie, 2, 5, 2))
      .setNumHeaders(1)
      .setPosition(chartRow1, 14, 0, 0)
      .setOption('title', 'Distribusi Tingkat Risiko')
      .setOption('pieHole', 0.45)
      .setOption('colors', colors)
      .setOption('legend.position', 'right')
      .setOption('width', 480)
      .setOption('height', 260)
      .build());

    // Bar bertumpuk: top 10 outlet
    if (anchors.rankHdr) {
      sheet.insertChart(sheet.newChart()
        .setChartType(Charts.ChartType.BAR)
        .addRange(sheet.getRange(anchors.rankHdr, 2, anchors.rankCount + 1, 1))
        .addRange(sheet.getRange(anchors.rankHdr, 4, anchors.rankCount + 1, 3))
        .setNumHeaders(1)
        .setPosition(chartRow2, 14, 0, 0)
        .setOption('title', 'Top 10 Outlet Berisiko (jumlah baris per level)')
        .setOption('isStacked', true)
        .setOption('reverseCategories', true)
        .setOption('colors', colors.slice(0, 3))
        .setOption('legend.position', 'bottom')
        .setOption('width', 480)
        .setOption('height', 300)
        .build());
    }

    // Line: tren periode
    if (anchors.trendHdr) {
      sheet.insertChart(sheet.newChart()
        .setChartType(Charts.ChartType.LINE)
        .addRange(sheet.getRange(anchors.trendHdr, 2, anchors.trendCount + 1, 1))
        .addRange(sheet.getRange(anchors.trendHdr, 3, anchors.trendCount + 1, 3))
        .setNumHeaders(1)
        .setPosition(chartRow3, 14, 0, 0)
        .setOption('title', 'Tren Temuan per Periode')
        .setOption('colors', colors.slice(0, 3))
        .setOption('curveType', 'function')
        .setOption('pointSize', 4)
        .setOption('legend.position', 'bottom')
        .setOption('width', 480)
        .setOption('height', 280)
        .build());
    }
  }
}
