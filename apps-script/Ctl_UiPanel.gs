/**
 * ============================================================
 *  UiPanel.gs — Panel Kontrol modern (sidebar & Web App)  [BARU — VERSI 3]
 * ============================================================
 *  Dua cara pakai:
 *   1. Sidebar di Google Sheets : menu 📊 Monitoring Outlet → 🎛️ Panel Kontrol (UI)
 *   2. Web App full-page        : Deploy → New deployment → Web app, buka URL /exec
 *
 *  Isi panel: KPI ringkas, skor kesehatan, distribusi risiko, insight otomatis,
 *  daftar alert OPEN (bisa ditutup langsung), tombol jalankan analisis dengan
 *  PROGRESS BAR LIVE (polling getProgress setiap 2 detik), dan shortcut buka tab.
 *
 *  Data dashboard dihitung ulang dari MONITORING_DETAIL & ALERT_LOG lewat
 *  buildDashboardModel_() milik Dashboard.gs — tidak ada logika duplikat.
 */

// CATATAN PENGGABUNGAN: openControlPanel(), doGet() dan openWebAppDialog_() milik CONTROL dihapus.
// UI sekarang menjadi tab di index.html INVMOVE; entry point Web App tetap doGet() di Code.gs INVMOVE.

/**
 * Ubah nilai apa pun menjadi tipe yang AMAN dikirim lewat google.script.run.
 * Penyebab bug "unknown / gagal memuat": objek Date (dan nilai non-JSON lain) membuat
 * seluruh hasil fungsi menjadi null di sisi klien.
 */
function panelSafe_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, getActiveSS().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v;
  return String(v);
}

/** Jumlah outlet: pakai cache agar tidak membuka 2 spreadsheet sumber tiap kali panel dimuat */
function getOutletsCached_(force) {
  const cache = CacheService.getScriptCache();
  if (!force && cache) {
    try {
      const raw = cache.get('OUTLETS_V1');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* abaikan cache rusak */ }
  }
  const list = getAvailableOutlets();
  try { if (cache) cache.put('OUTLETS_V1', JSON.stringify(list), 600); } catch (e) { /* >100KB: abaikan */ }
  return list;
}

/**
 * Data lengkap untuk Panel: KPI, ranking outlet, insight, alert OPEN.
 * Dipanggil dari Panel.html via google.script.run.getPanelData().
 * SELALU mengembalikan objek {ok:true,...} atau {ok:false,error} — tidak pernah null.
 */
function getPanelData() {
  try {
    const ss = getActiveSS();
    const rows = dashReadBody_(ss.getSheetByName(SHEET_NAMES.DETAIL), DETAIL_HEADERS.length);
    const alerts = dashReadBody_(ss.getSheetByName(SHEET_NAMES.ALERT), ALERT_HEADERS.length);
    const m = buildDashboardModel_(rows, alerts);

    // Jumlah outlet tersedia: jangan sampai kegagalan membuka spreadsheet sumber menggagalkan panel
    let outletsAvailable = 0;
    try { outletsAvailable = getOutletsCached_(false).length; } catch (e) { outletsAvailable = -1; }

    const risk = m.risk || {};
    const hc = m.healthCount || {};
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      lastRun: panelSafe_(m.lastRun),
      kpi: {
        outletCount: m.outletCount,
        totalRows: m.totalRows,
        anomalyRate: panelSafe_(m.anomalyRate),
        avgScore: panelSafe_(m.avgScore),
        risk: { K: risk.K || 0, T: risk.T || 0, S: risk.S || 0, A: risk.A || 0 },
        openAlerts: m.openAlerts.length,
        openAlertsCritical: m.openAlerts.filter(a => a.risk === RISK.CRITICAL.label).length,
        oldestAge: m.oldestAge == null ? null : m.oldestAge,
        progressDone: m.nonSafeDone,
        progressTotal: m.nonSafe,
        progressPct: panelSafe_(m.progressPct),
        tolCount: m.tolCount
      },
      healthCount: { RED: hc.RED || 0, AMBER: hc.AMBER || 0, GREEN: hc.GREEN || 0 },
      outlets: m.outletList.slice(0, 20).map(o => ({
        name: panelSafe_(o.name), total: o.total, K: o.K, T: o.T, S: o.S, A: o.A,
        score: o.score, health: o.health.label
      })),
      insights: (m.insights || []).map(panelSafe_),
      openAlerts: m.openAlerts.slice(0, 50).map(a => ({
        id: panelSafe_(a.id), outlet: panelSafe_(a.outlet), period: panelSafe_(a.period),
        risk: panelSafe_(a.risk), reason: panelSafe_(a.reason),
        time: panelSafe_(a.time), age: a.age == null ? null : a.age   // Date -> string
      })),
      outletsAvailable: outletsAvailable
    };
  } catch (e) {
    Logger.log('getPanelData gagal: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Jalankan analisis dari Panel (dipanggil via google.script.run — asinkron di sisi klien).
 * @param {string[]|null} outletNames  array nama outlet, atau null/[] = semua
 * @return {Object} {ok: true} atau {ok: false, error}
 */
function runFromPanel(outletNames) {
  try {
    let filter = null;
    if (outletNames && outletNames.length) {
      const available = getOutletsCached_(true);
      const wanted = outletNames.map(o => String(o).trim()).filter(o => available.indexOf(o) >= 0);
      if (!wanted.length) {
        return { ok: false, error: 'Tidak ada outlet valid yang dipilih. Centang minimal satu outlet.' };
      }
      filter = wanted;
    }
    const s = filter ? runAnalysisForOutlets(filter) : runFullAnalysis();
    return {
      ok: true,
      pending: s && s.pending ? s.pending : 0,   // >0 = sisa outlet dilanjutkan otomatis di latar belakang
      failed: s && s.failed ? s.failed.length : 0
    };
  } catch (e) {
    setProgress_(0, 'GAGAL', e.message);
    appendRunLog_('GAGAL', e.message);
    return { ok: false, error: e.message };
  }
}

/** Tutup 1 alert (status → CLOSED) lalu segarkan DASHBOARD. Dipanggil dari Panel. */
function closeAlert(alertId) {
  try {
    const sh = getActiveSS().getSheetByName(SHEET_NAMES.ALERT);
    if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'Sheet ALERT_LOG kosong.' };
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let r = 0; r < ids.length; r++) {
      if (String(ids[r][0]) === String(alertId)) {
        sh.getRange(r + 2, AC.STATUS + 1).setValue('CLOSED');
        invalidateTableCache_();
        refreshDashboard();
        return { ok: true };
      }
    }
    return { ok: false, error: 'Alert tidak ditemukan: ' + alertId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Buka tab sheet dari Panel.
 *  - Sidebar Google Sheets : sheet diaktifkan langsung (setActiveSheet).
 *  - Web App (browser)     : tidak ada UI Sheets, jadi URL sheet (dengan #gid) dikembalikan
 *    agar Panel membukanya di tab browser baru.
 * Selalu mengembalikan {ok, url} — url dipakai Web App.
 */
function activateTab(name) {
  try {
    const ss = getActiveSS();
    const sh = ss.getSheetByName(String(name));
    if (!sh) return { ok: false, error: 'Sheet "' + name + '" belum ada. Jalankan menu ⚙️ Inisialisasi Sheet / analisis dulu.' };
    const url = ss.getUrl() + '#gid=' + sh.getSheetId();
    try { ss.setActiveSheet(sh); } catch (e) { /* di Web App tidak berpengaruh: abaikan */ }
    return { ok: true, url: url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ---------- CACHE TABEL (percepat Alert Log / Monitoring Detail / Run Log) ----------
// Masalah lama: tiap buka tab / ketik pencarian, seluruh sheet dibaca ulang (ribuan baris).
// Solusi: baca sheet SEKALI, simpan di CacheService (dipecah per ~90 KB karena batas 100 KB/nilai),
// lalu pencarian/filter/halaman dikerjakan dari cache. Cache otomatis diganti saat data berubah
// (analisis selesai / alert ditutup) lewat nomor versi TBL_VER.

const TBL_CACHE_TTL_ = 6 * 60 * 60;     // 6 jam (maksimum CacheService)
const TBL_CHUNK_ = 90000;               // karakter per potongan (< 100 KB)
const TBL_MAX_CACHE_ = 4000000;         // data lebih besar dari ini tidak di-cache (tetap jalan, hanya lebih lambat)

function tblVersion_() {
  return PropertiesService.getScriptProperties().getProperty('TBL_VER') || '0';
}

/** Panggil setiap kali isi sheet berubah agar cache dianggap basi. */
function invalidateTableCache_() {
  PropertiesService.getScriptProperties().setProperty('TBL_VER', String(Date.now()));
}

function tblCachePut_(name, obj) {
  const cache = CacheService.getScriptCache();
  if (!cache) return;
  try {
    const json = JSON.stringify(obj);
    if (json.length > TBL_MAX_CACHE_) return;
    const n = Math.ceil(json.length / TBL_CHUNK_);
    const all = {};
    for (let i = 0; i < n; i++) all[name + '#' + i] = json.substr(i * TBL_CHUNK_, TBL_CHUNK_);
    all[name + '#n'] = String(n);
    cache.putAll(all, TBL_CACHE_TTL_);
  } catch (e) { Logger.log('tblCachePut_ gagal: ' + e.message); }
}

function tblCacheGet_(name) {
  const cache = CacheService.getScriptCache();
  if (!cache) return null;
  try {
    const n = parseInt(cache.get(name + '#n'), 10);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(name + '#' + i);
    const got = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < n; i++) {
      const part = got[name + '#' + i];
      if (part === undefined || part === null) return null;   // ada potongan yang hilang -> anggap tidak ada cache
      json += part;
    }
    return JSON.parse(json);
  } catch (e) { return null; }
}

/** Baris + pilihan filter untuk 1 tabel: dari cache, atau baca sheet lalu simpan ke cache. */
function getTableBase_(key, def) {
  const name = 'TBL_' + key + '_' + tblVersion_();
  const hit = tblCacheGet_(name);
  if (hit) return hit;

  const sh = getActiveSS().getSheetByName(def.sheet);
  if (!sh) return null;
  const ncols = def.headers.length;
  const last = sh.getLastRow();
  let rows = last > 1 ? sh.getRange(2, 1, last - 1, ncols).getDisplayValues() : [];
  rows = rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  if (def.newestFirst) rows.reverse();

  const facets = {};
  Object.keys(def.filters).forEach(function (fname) {
    const idx = def.filters[fname];
    const set = {};
    rows.forEach(function (r) { if (r[idx] !== '') set[r[idx]] = true; });
    let vals = Object.keys(set);
    vals = (fname === 'risk')
      ? vals.sort(function (a, b) { return riskRankByLabel(b) - riskRankByLabel(a); })
      : vals.sort(function (a, b) { return a.localeCompare(b); });
    facets[fname] = vals;
  });

  const base = { rows: rows, facets: facets };
  tblCachePut_(name, base);
  return base;
}

/** Pemanasan cache: panggil di akhir analisis agar pengguna tidak menunggu saat buka tab. */
function warmTableCache_() {
  try {
    ['alert', 'detail', 'run'].forEach(function (k) {
      const def = getTableDef_(k);
      if (def) getTableBase_(k, def);
    });
  } catch (e) { Logger.log('warmTableCache_ gagal: ' + e.message); }
}

// ---------- Tampilan tabel (Alert Log, Monitoring Detail, Run Log) ----------

/** Definisi tabel — dibuat lazy agar tidak bergantung urutan muat file .gs */
function getTableDef_(key) {
  const defs = {
    alert:  { sheet: SHEET_NAMES.ALERT,  headers: ALERT_HEADERS,   pageSize: 50,
              filters: { risk: AC.RISK, status: AC.STATUS, outlet: AC.OUTLET, type: AC.TYPE } },
    detail: { sheet: SHEET_NAMES.DETAIL, headers: DETAIL_HEADERS,  pageSize: 50,
              filters: { risk: DC.RISK, status: DC.STATUS, outlet: DC.OUTLET, period: DC.PERIOD } },
    run:    { sheet: SHEET_NAMES.RUN_LOG, headers: RUN_LOG_HEADERS, pageSize: 100,
              filters: {}, newestFirst: true }
  };
  return defs[key] || null;
}

/**
 * Data tabel untuk Panel, dengan pencarian + filter + halaman (dikerjakan di server
 * karena sheet bisa berisi belasan ribu baris).
 * @param {string} key   'alert' | 'detail' | 'run'
 * @param {Object} opts  { q: 'kata kunci', filters: {risk:'KRITIS', ...}, page: 1 }
 * @return {Object} { ok, headers, rows, total, filtered, page, pages, pageSize, facets }
 */
function getTableData(key, opts) {
  try {
    opts = opts || {};
    const def = getTableDef_(key);
    if (!def) return { ok: false, error: 'Tabel tidak dikenal: ' + key };
    const base = getTableBase_(key, def);
    if (!base) return { ok: false, error: 'Sheet "' + def.sheet + '" belum ada. Jalankan menu ⚙️ Inisialisasi Sheet atau analisis dulu.' };
    let rows = base.rows;
    const total = rows.length;
    const facets = base.facets;

    // Filter dropdown
    const f = opts.filters || {};
    Object.keys(def.filters).forEach(function (name) {
      const v = f[name];
      if (v === undefined || v === null || v === '') return;
      const idx = def.filters[name];
      rows = rows.filter(function (r) { return r[idx] === String(v); });
    });

    // Pencarian: semua kata harus muncul di salah satu kolom (tidak peka huruf besar/kecil)
    const terms = String(opts.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      rows = rows.filter(function (r) {
        const hay = r.join(' \u0001 ').toLowerCase();
        return terms.every(function (t) { return hay.indexOf(t) >= 0; });
      });
    }

    const filtered = rows.length;
    const pageSize = def.pageSize;
    const pages = Math.max(1, Math.ceil(filtered / pageSize));
    const page = Math.min(Math.max(parseInt(opts.page, 10) || 1, 1), pages);
    return {
      ok: true,
      headers: def.headers,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: total, filtered: filtered, page: page, pages: pages, pageSize: pageSize,
      facets: facets
    };
  } catch (e) {
    Logger.log('getTableData gagal: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/** Daftar nama outlet tersedia (untuk picker di Panel) */
function getAvailableOutletsJson() {
  try {
    return { ok: true, outlets: getOutletsCached_(true) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}