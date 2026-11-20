/**
 * ============================================================
 *  Code.gs — Pengendali / alur utama analisis  (VERSI 3)
 * ============================================================
 *  PERBAIKAN (limit waktu): analisis dipotong aman di ±240 dtk, sisa outlet
 *   dilanjutkan OTOMATIS lewat time-trigger (aman ditinggal / pindah tab).
 *
 *  Perubahan VERSI 3 (dibanding VERSI 2 patch Anda):
 *   - PROGRESS: kemajuan analisis ditulis ke Document Properties
 *     (dipolling live oleh Panel Kontrol) + dicatat ke sheet RUN_LOG.
 *   - getProgress(): status kemajuan untuk Panel/HTML UI (poll 2 detik).
 *   - Kegagalan per outlet ikut tercatat di RUN_LOG (tidak hanya Logger).
 *   - Alur & logika analisis TIDAK diubah (tingkat risiko, MAD, dll sama).
 *
 *  Alur besar:
 *   1. Siapkan sheet & baca konfigurasi
 *   2. Baca White-List SKU dari sheet TOLERANCE
 *   3. Untuk setiap outlet: baca Inventory Movement + DataSO_IC -> analisis
 *   4. Simpan hasil ke MONITORING_DETAIL & ALERT_LOG
 *   5. Refresh DASHBOARD + tampilkan Toast
 *
 *  Fungsi publik:
 *   - runFullAnalysis()                 : semua outlet
 *   - runAnalysisForOutlets(daftarNama) : outlet tertentu
 *   - getProgress()                     : status kemajuan (dipakai Panel)
 */

/** Analisis SEMUA outlet */
function runFullAnalysis() {
  return runAnalysis(null);
}

/** Analisis outlet tertentu. outletNames = array nama outlet (mis. ['RSUD SLEMAN']) */
function runAnalysisForOutlets(outletNames) {
  return runAnalysis(outletNames);
}

// Batas aman satu "potongan" analisis. Limit Apps Script = 360 dtk; sisa waktu dipakai
// untuk menyimpan hasil (MONITORING_DETAIL/ALERT_LOG). Nilai CONFIG MAX_RUNTIME_SECONDS
// yang lebih besar akan dibatasi ke angka ini.
const SAFE_RUNTIME_CAP_SEC = 240;
const MAX_CONTINUATIONS = 40;   // pengaman agar lanjutan otomatis tidak berputar selamanya

/**
 * Inti proses analisis (dengan LANJUT OTOMATIS sebelum limit waktu).
 *
 * Jika waktu hampir habis, outlet yang tersisa disimpan sebagai "pending" dan sebuah
 * time-trigger melanjutkan prosesnya di latar belakang (tidak bergantung pada tab/sidebar
 * yang terbuka). Hasil tiap potongan langsung disimpan, jadi tidak ada data yang hilang.
 *
 * @param {string[]|null} outletFilter  null = semua outlet
 * @param {Object=} opts  { resume: true } dipakai internal oleh trigger lanjutan
 * @return {Object} ringkasan { processed, processedTotal, failed, skipped, pending, ... }
 */
function runAnalysis(outletFilter, opts) {
  const resume = !!(opts && opts.resume);

  // Kunci agar analisis tidak berjalan dobel (mis. menu diklik 2x)
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    throw new Error('Analisis lain sedang berjalan. Tunggu sampai selesai lalu coba lagi.');
  }

  try {
    const startTime = new Date();
    let state;
    if (resume) {
      state = loadRunState_();
      if (!state || !state.pending.length) return { processed: [], processedTotal: 0, failed: [], skipped: [], pending: 0 };
      outletFilter = state.pending;
      state.chunks++;
    } else {
      deleteContinuationTriggers_();
      clearRunState_();
      clearProgress_();
      state = { total: 0, done: 0, processedCount: 0, failed: [], newDetail: 0, newAlerts: 0,
                ignoredSkus: 0, chunks: 1, startedAt: startTime.getTime(), pending: [] };
    }

    setProgress_(resume ? progressPct_(state) : 3, 'PERSIAPAN', resume ? 'Melanjutkan sisa outlet (potongan ' + state.chunks + ')' : 'Menyiapkan sheet & konfigurasi');
    appendRunLog_(resume ? 'Lanjut' : 'Mulai', resume
      ? 'Melanjutkan ' + outletFilter.length + ' outlet tersisa (potongan ' + state.chunks + ')'
      : 'Analisis dimulai' + (outletFilter ? ' (' + outletFilter.length + ' outlet terpilih)' : ' (semua outlet)'));
    showToast(resume ? 'Melanjutkan analisis...' : 'Memulai analisis...', '⏳ Monitoring Outlet', 5);

    try {
      // 1) Siapkan sheet + muat ulang konfigurasi terbaru dari sheet CONFIG
      initializeSheets();
      const cfg = getConfig(true);
      const maxMs = Math.min(cfg.MAX_RUNTIME_SECONDS, SAFE_RUNTIME_CAP_SEC) * 1000;

      // 2) White-List SKU dari sheet TOLERANCE
      setProgress_(resume ? progressPct_(state) : 6, 'PERSIAPAN', 'Membaca white-list SKU (sheet TOLERANCE)');
      const toleranceMap = readToleranceMap();
      if (toleranceMap.size === 0) {
        throw new Error('Sheet TOLERANCE masih kosong. Isi kolom SKU, Nama Item, dan Tolerance ' +
          'terlebih dahulu (hanya SKU di sheet ini yang dianalisis).');
      }
      Logger.log('📋 SKU aktif (TOLERANCE): ' + toleranceMap.size);

      // 3) Tentukan outlet yang akan dianalisis
      const sources = getSourceSpreadsheets();
      const allTabs = listOutletTabs(sources);
      const tabs = filterOutletTabs(allTabs, outletFilter);
      if (!tabs.length) {
        throw new Error('Tidak ada outlet yang cocok untuk dianalisis. ' +
          'Periksa OUTLET_TAB_PREFIX di sheet CONFIG dan nama tab di kedua spreadsheet sumber.');
      }
      if (!resume) state.total = tabs.length;
      Logger.log('🏪 Outlet dianalisis di potongan ini: ' + tabs.length + ' dari ' + allTabs.length);
      setProgress_(progressPct_(state), 'MENGANALISIS', 'Outlet dianalisis: ' + state.total + (resume ? ' (sisa ' + tabs.length + ')' : ''));

      // 4) Analisis per outlet (satu outlet gagal tidak menghentikan yang lain)
      const allDetail = [];
      const allAlerts = [];
      const processed = [];
      const failed = [];
      const skipped = [];
      let ignoredSkus = state.ignoredSkus;
      let spentOnOutlets = 0;

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];

        // Berhenti aman SEBELUM limit: perkirakan durasi outlet berikutnya dari rata-rata sejauh ini
        const elapsed = new Date() - startTime;
        const avg = i ? spentOnOutlets / i : 0;
        if (i > 0 && elapsed + avg * 1.5 > maxMs) {
          for (let j = i; j < tabs.length; j++) skipped.push(tabs[j].outlet);
          Logger.log('⏱️ Mendekati batas waktu. Sisa outlet dilanjutkan otomatis: ' + skipped.length);
          break;
        }

        const t0 = new Date();
        setProgress_(progressPct_(state, processed.length + failed.length), 'MENGANALISIS',
          '(' + (state.done + processed.length + failed.length + 1) + '/' + state.total + ') ' + tab.outlet);
        try {
          const result = analyzeOneOutlet(tab, sources, toleranceMap);
          result.detailRows.forEach(r => allDetail.push(r));
          result.alerts.forEach(a => allAlerts.push(a));
          ignoredSkus = Math.max(ignoredSkus, result.stats.ignoredSkus);
          processed.push(tab.outlet);
          Logger.log('✔ ' + tab.outlet + ' | SKU aktif: ' + result.stats.activeSkus +
            ' | baris: ' + result.detailRows.length + ' | alert: ' + result.alerts.length);
        } catch (e) {
          failed.push({ outlet: tab.outlet, message: String(e.message).substring(0, 200) });
          appendRunLog_('Outlet GAGAL', tab.outlet + ' — ' + e.message);
          Logger.log('❌ ' + tab.outlet + ' gagal: ' + e.message);
        }
        spentOnOutlets += (new Date() - t0);
      }

      // 5) Simpan hasil potongan ini (hanya outlet sukses; data lama outlet gagal tetap utuh)
      setProgress_(progressPct_(state, processed.length + failed.length), 'MENYIMPAN', 'Menulis MONITORING_DETAIL & ALERT_LOG');
      let detailTotal = 0;
      let alertTotal = 0;
      if (processed.length) {
        detailTotal = saveDetailRows(allDetail, processed);
        alertTotal = saveAlertRows(allAlerts, processed);
        const stamp = Utilities.formatDate(new Date(), getActiveSS().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        PropertiesService.getDocumentProperties().setProperty('LAST_ANALYSIS', stamp);
      }

      // Akumulasi status lintas potongan
      state.done += processed.length + failed.length;
      state.processedCount += processed.length;
      state.newDetail += allDetail.length;
      state.newAlerts += allAlerts.length;
      state.ignoredSkus = ignoredSkus;
      failed.forEach(f => { if (state.failed.length < 30) state.failed.push(f); });
      state.pending = skipped;

      const seconds = round((new Date() - startTime) / 1000, 1);
      appendRunLog_('Potongan selesai', processed.length + ' outlet sukses, ' + failed.length + ' gagal, ' +
        skipped.length + ' tersisa | baris: ' + allDetail.length + ' | alert: ' + allAlerts.length + ' | ' + seconds + ' dtk');

      // 6a) Masih ada sisa -> simpan status & jadwalkan lanjutan otomatis (tanpa refresh dashboard berat)
      if (skipped.length) {
        if (state.chunks >= MAX_CONTINUATIONS) {
          clearRunState_();
          setProgress_(progressPct_(state), 'GAGAL', 'Terlalu banyak potongan lanjutan. Jalankan ulang analisis.');
          throw new Error('Terlalu banyak potongan lanjutan (' + MAX_CONTINUATIONS + '). Jalankan analisis ulang.');
        }
        saveRunState_(state);
        const scheduled = scheduleContinuation_();
        setProgress_(progressPct_(state), 'LANJUT OTOMATIS',
          state.done + '/' + state.total + ' outlet selesai. ' + skipped.length + ' sisa ' +
          (scheduled ? 'dilanjutkan otomatis ±1 menit lagi (aman ditinggal/pindah tab).' : 'menunggu — tekan Lanjutkan.'));
        appendRunLog_('Dijadwalkan', skipped.length + ' outlet dilanjutkan otomatis' + (scheduled ? '' : ' (trigger gagal dibuat, lanjutkan manual)'));
        const part = {
          processed: processed, processedTotal: state.processedCount, failed: failed, skipped: skipped,
          pending: skipped.length, ignoredSkus: ignoredSkus, newDetailRows: allDetail.length,
          newAlerts: allAlerts.length, detailTotal: detailTotal, alertTotal: alertTotal, seconds: seconds
        };
        showToast(state.done + '/' + state.total + ' selesai. Sisa ' + skipped.length + ' dilanjutkan otomatis.', '⏱️ Lanjut Otomatis', 8);
        if (typeof afterDataChanged_ === 'function') afterDataChanged_('MONITORING');
        return part;
      }

      // 6b) Semua selesai -> refresh dashboard sekali, bersihkan status
      setProgress_(96, 'DASHBOARD', 'Menyegarkan DASHBOARD');
      refreshDashboard();
      if (typeof PH !== 'undefined' && PH.AUTO_AFTER_ANALYSIS) {   // Kesehatan per Periode (file Ctl_PeriodHealth)
        setProgress_(98, 'KESEHATAN PERIODE', 'Menyusun analisis kesehatan per periode');
        try { refreshPeriodHealth(); }
        catch (e) { appendRunLog_('Kesehatan Periode GAGAL', e.message); Logger.log('refreshPeriodHealth gagal: ' + e.message); }
      }
      invalidateTableCache_();   // data berubah -> cache tabel lama dianggap basi
      warmTableCache_();         // isi cache baru sekarang, supaya buka tab Panel langsung cepat
      if (typeof afterDataChanged_ === 'function') afterDataChanged_('MONITORING');
      const summary = {
        processed: processed,
        processedTotal: state.processedCount,
        failed: state.failed,
        skipped: [],
        pending: 0,
        ignoredSkus: state.ignoredSkus,
        newDetailRows: state.newDetail,
        newAlerts: state.newAlerts,
        detailTotal: detailTotal,
        alertTotal: alertTotal,
        seconds: round((new Date() - new Date(state.startedAt)) / 1000, 1)
      };
      clearRunState_();
      deleteContinuationTriggers_();
      Logger.log('🏁 Selesai dalam ' + summary.seconds + ' detik. ' + JSON.stringify({
        sukses: summary.processedTotal, gagal: summary.failed.length, barisBaru: summary.newDetailRows, alertBaru: summary.newAlerts
      }));
      setProgress_(100, 'SELESAI', summary.processedTotal + ' outlet selesai, ' + summary.newAlerts +
        ' alert' + (summary.failed.length ? ', ' + summary.failed.length + ' gagal' : ''));
      appendRunLog_('Selesai', summary.processedTotal + ' outlet sukses, ' + summary.failed.length + ' gagal | baris baru: ' +
        summary.newDetailRows + ' | alert baru: ' + summary.newAlerts + ' | durasi total: ' + summary.seconds + ' dtk');
      showFinishToast(summary);
      return summary;

    } catch (e) {
      // Jangan biarkan progres menggantung di "berjalan" bila terjadi error
      const cur = getProgress();
      if (cur.stage !== 'GAGAL') setProgress_(cur.pct || 0, 'GAGAL', e.message);
      clearRunState_();
      deleteContinuationTriggers_();
      throw e;
    }
  } finally {
    lock.releaseLock();
  }
}

// ---------- Lanjut otomatis (state + trigger) ----------

/** Persentase progres keseluruhan lintas potongan: 10% persiapan + 78% analisis */
function progressPct_(state, extraDone) {
  const total = Math.max(state.total || 0, 1);
  return 10 + Math.floor((((state.done || 0) + (extraDone || 0)) / total) * 78);
}

const RUN_STATE_KEY = 'RUN_STATE';
const RUN_PENDING_KEY = 'RUN_PENDING';

/** Simpan status; daftar outlet pending dipisah (properti dibatasi ±9KB per nilai) */
function saveRunState_(state) {
  const props = PropertiesService.getDocumentProperties();
  const pending = state.pending || [];
  const copy = {};
  Object.keys(state).forEach(k => { if (k !== 'pending') copy[k] = state[k]; });
  props.setProperty(RUN_STATE_KEY, JSON.stringify(copy));

  // Pecah daftar pending jika panjang
  clearPendingKeys_();
  const str = JSON.stringify(pending);
  const SIZE = 8000;
  let n = 0;
  for (let i = 0; i < str.length; i += SIZE) {
    props.setProperty(RUN_PENDING_KEY + '_' + n, str.substring(i, i + SIZE));
    n++;
  }
  props.setProperty(RUN_PENDING_KEY + '_N', String(n));
}

function loadRunState_() {
  const props = PropertiesService.getDocumentProperties();
  const raw = props.getProperty(RUN_STATE_KEY);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    const n = Number(props.getProperty(RUN_PENDING_KEY + '_N')) || 0;
    let str = '';
    for (let i = 0; i < n; i++) str += props.getProperty(RUN_PENDING_KEY + '_' + i) || '';
    state.pending = str ? JSON.parse(str) : [];
    return state;
  } catch (e) {
    Logger.log('loadRunState_ gagal: ' + e.message);
    return null;
  }
}

function clearPendingKeys_() {
  const props = PropertiesService.getDocumentProperties();
  const n = Number(props.getProperty(RUN_PENDING_KEY + '_N')) || 0;
  for (let i = 0; i < n; i++) props.deleteProperty(RUN_PENDING_KEY + '_' + i);
  props.deleteProperty(RUN_PENDING_KEY + '_N');
}

function clearRunState_() {
  try {
    PropertiesService.getDocumentProperties().deleteProperty(RUN_STATE_KEY);
    clearPendingKeys_();
  } catch (e) { Logger.log('clearRunState_ gagal: ' + e.message); }
}

/** Jadwalkan trigger sekali jalan (±1 menit lagi). Return true jika berhasil. */
function scheduleContinuation_() {
  try {
    deleteContinuationTriggers_();
    ScriptApp.newTrigger('continueAnalysis_').timeBased().after(60 * 1000).create();
    return true;
  } catch (e) {
    Logger.log('Gagal membuat trigger lanjutan: ' + e.message);
    return false;
  }
}

function deleteContinuationTriggers_() {
  try {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'continueAnalysis_') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { Logger.log('deleteContinuationTriggers_ gagal: ' + e.message); }
}

/** Handler trigger: melanjutkan outlet yang tersisa (berjalan di server, tanpa UI) */
function continueAnalysis_() {
  deleteContinuationTriggers_();
  const state = loadRunState_();
  if (!state || !state.pending.length) return;
  try {
    runAnalysis(null, { resume: true });
  } catch (e) {
    if (String(e.message).indexOf('sedang berjalan') >= 0 && state.chunks < MAX_CONTINUATIONS) {
      state.chunks++;
      saveRunState_(state);
      scheduleContinuation_();   // kunci masih dipakai proses lain: coba lagi nanti
    } else {
      Logger.log('continueAnalysis_ gagal: ' + e.message);
    }
  }
}

/** Dipanggil Panel: lanjutkan sisa outlet SEKARANG (bila trigger gagal / tidak sabar menunggu) */
function resumeAnalysis() {
  try {
    deleteContinuationTriggers_();
    const s = runAnalysis(null, { resume: true });
    return { ok: true, pending: s && s.pending ? s.pending : 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Dipanggil Panel: batalkan sisa analisis yang tertunda */
function cancelPendingAnalysis() {
  deleteContinuationTriggers_();
  clearRunState_();
  setProgress_(0, 'IDLE', 'Analisis lanjutan dibatalkan');
  appendRunLog_('Dibatalkan', 'Sisa outlet tertunda dibatalkan oleh pengguna');
  return { ok: true };
}

/**
 * Analisis 1 outlet: baca kedua sumber lalu panggil analyzeOutlet().
 * Dipisah agar mudah dites / dipelajari.
 */
function analyzeOneOutlet(tab, sources, toleranceMap) {
  const invSheet = sources.inv.getSheetByName(tab.tabName);
  const soSheet = sources.so.getSheetByName(tab.tabName);
  if (!invSheet || !soSheet) {
    throw new Error('Tab "' + tab.tabName + '" tidak ditemukan di salah satu spreadsheet sumber.');
  }

  const invItems = readInventoryMovement(invSheet, sources.inv.getSpreadsheetTimeZone());
  const soItems = readDataSO(soSheet, sources.so.getSpreadsheetTimeZone());
  return analyzeOutlet(tab.outlet, invItems, soItems, toleranceMap);
}

/**
 * Saring daftar tab outlet berdasarkan nama yang dipilih.
 * Pencocokan tidak peka huruf besar/kecil dan mengabaikan spasi ganda.
 */
function filterOutletTabs(allTabs, outletFilter) {
  if (!outletFilter || !outletFilter.length) return allTabs;
  const wanted = new Set(outletFilter.map(normalizeText));
  return allTabs.filter(t => wanted.has(normalizeText(t.outlet)) || wanted.has(normalizeText(t.tabName)));
}

/** Daftar nama outlet yang tersedia (dipakai menu "Analisis Outlet Terpilih" & Panel) */
function getAvailableOutlets() {
  initializeConfigSheet();
  getConfig(true);
  return listOutletTabs(getSourceSpreadsheets()).map(t => t.outlet);
}

// ---------- Progres analisis (dipakai Panel Kontrol) ----------

/** Simpan kemajuan ke Document Properties (dipolling Panel tiap ±2 detik) */
function setProgress_(pct, stage, detail) {
  try {
    PropertiesService.getDocumentProperties().setProperty('RUN_PROGRESS', JSON.stringify({
      pct: pct,
      stage: stage,
      detail: detail || '',
      at: new Date().toISOString()
    }));
  } catch (e) {
    Logger.log('setProgress_ gagal: ' + e.message);  // jangan biarkan progres menggagalkan analisis
  }
}

/** Kosongkan progres sebelum mulai */
function clearProgress_() {
  setProgress_(0, 'PERSIAPAN', '');
}

/**
 * Baca kemajuan analisis. Dipanggil Panel/HTML UI via google.script.run.
 * Return { pct, stage, detail, at, running }.
 */
function getProgress() {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty('RUN_PROGRESS');
    if (!raw) return { pct: 0, stage: 'IDLE', detail: '', at: null, running: false };
    const p = JSON.parse(raw);
    p.running = p.stage !== 'SELESAI' && p.stage !== 'IDLE' && p.stage !== 'GAGAL';
    return p;
  } catch (e) {
    return { pct: 0, stage: 'IDLE', detail: '', at: null, running: false };
  }
}

// ---------- RUN_LOG (riwayat proses) ----------

/** Tambah 1 baris log ke sheet RUN_LOG (aman dipanggil dari mana saja) */
function appendRunLog_(stage, detail) {
  try {
    const sh = getActiveSS().getSheetByName(SHEET_NAMES.RUN_LOG);
    if (!sh) return;
    sh.appendRow([new Date(), stage, detail || '']);
    const maxRows = Number(getConfig().RUN_LOG_MAX_ROWS) || 500;
    const last = sh.getLastRow();
    if (last > maxRows + 50) sh.deleteRows(2, last - maxRows);  // pangkas log paling lama
  } catch (e) {
    Logger.log('RUN_LOG gagal: ' + e.message);  // jangan biarkan log menggagalkan analisis
  }
}

// ---------- Notifikasi ----------

/** Toast di pojok kanan bawah Google Sheets (aman dipanggil dari editor juga) */
function showToast(message, title, seconds) {
  try {
    try { getActiveSS().toast(message, title || 'Monitoring Outlet', seconds || 5); } catch (e) { /* toast hanya untuk spreadsheet aktif */ }
  } catch (e) {
    Logger.log(message);  // abaikan jika toast tidak tersedia
  }
}

/** Toast akhir proses: menjelaskan sukses / sebagian gagal */
function showFinishToast(s) {
  const done = s.processedTotal != null ? s.processedTotal : s.processed.length;
  let msg = done + ' outlet selesai, ' + (s.newAlerts || 0) + ' alert terdeteksi.';
  if (s.failed.length) msg += ' ⚠️ ' + s.failed.length + ' outlet gagal (lihat RUN_LOG & Logger).';
  showToast(msg, '✅ Analisis Selesai (' + s.seconds + ' dtk)', 10);
}