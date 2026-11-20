/**
 * ============================================================
 *  Menu.gs — Custom Menu "📊 Monitoring Outlet"  (VERSI 3)
 * ============================================================
 *  onOpen() otomatis berjalan saat spreadsheet dibuka.
 *  Tiap item menu memanggil fungsi menuXxx() di bawah.
 *
 *  Perubahan VERSI 3:
 *   - Item baru "🎛️ Panel Kontrol (UI)" : sidebar modern (KPI, ranking,
 *     alert, tombol jalankan + progress bar live).
 *   - Item baru "🌐 URL Dashboard Web"  : menampilkan URL Web App
 *     (isi setelah deploy Web App) untuk dashboard full-page di browser.
 *   - Handler lain tidak diubah.
 */

function onOpen() {
  // Gabungkan menu SO Tools dari CodeAdmin.gs dan Monitoring Outlet.
  try {
    if (typeof onOpenSoTools_ === 'function') onOpenSoTools_();
  } catch (e) {
    Logger.log('Menu SO Tools gagal dibuat: ' + e.message);
  }

  SpreadsheetApp.getUi()
    .createMenu('📊 Monitoring Outlet')
    .addItem('🔄 Jalankan Analisis Lengkap', 'menuRunFull')
    .addItem('🎯 Analisis Outlet Terpilih', 'menuRunSelected')
    .addSeparator()
    .addItem('🤖 AI: Ringkasan Eksekutif', 'menuAiSummary')
    .addItem('🔑 Atur Gemini API Key', 'menuAiKey')
    .addItem('🧪 Tes Koneksi AI', 'menuAiTest')
    .addSeparator()
    .addItem('📈 Refresh Dashboard', 'menuRefreshDashboard')
    .addItem('🩺 Kesehatan per Periode', 'menuRefreshPeriodHealth')
    .addSeparator()
    .addItem('⚙️ Inisialisasi Sheet & Konfigurasi', 'menuInitialize')
    .addSeparator()
    .addItem('🔍 Diagnosa Cakupan SKU', 'menuDiagnose')
    .addToUi();
}

// ---------- Handler menu ----------

/** 🔄 Analisis semua outlet */
function menuRunFull() {
  runSafely_(function () {
    const ui = SpreadsheetApp.getUi();
    const ok = ui.alert('Jalankan Analisis Lengkap',
      'Semua outlet akan dianalisis. Proses bisa memakan waktu beberapa menit.\n\nLanjutkan?',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
    const s = runFullAnalysis();
    showResultAlert_(s);
  });
}

/**
 * 🎯 Analisis outlet terpilih.
 * Cara 1: blok/klik sel yang berisi nama outlet (di DASHBOARD, MONITORING_DETAIL, atau ALERT_LOG).
 * Cara 2: jika tidak ada yang terdeteksi, muncul kotak dialog untuk memilih / mengetik nama outlet.
 */
function menuRunSelected() {
  runSafely_(function () {
    const available = getAvailableOutlets();
    if (!available.length) {
      throw new Error('Tidak ada outlet ditemukan. Periksa OUTLET_TAB_PREFIX di sheet CONFIG.');
    }

    let chosen = detectOutletsFromSelection_(available);
    if (!chosen.length) chosen = promptOutlets_(available);
    if (!chosen.length) return;  // dibatalkan

    const ui = SpreadsheetApp.getUi();
    const ok = ui.alert('Analisis Outlet Terpilih',
      'Outlet yang akan dianalisis (' + chosen.length + '):\n\n• ' + chosen.join('\n• ') + '\n\nLanjutkan?',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;

    const s = runAnalysisForOutlets(chosen);
    showResultAlert_(s);
  });
}



/** 📈 Refresh dashboard dari data MONITORING_DETAIL yang sudah ada */
function menuRefreshDashboard() {
  runSafely_(function () {
    initializeSheets();
    getConfig(true);
    refreshDashboard();
    showToast('Dashboard berhasil diperbarui.', '📈 Dashboard', 5);
  });
}

/** 🩺 Bangun ulang analisis kesehatan per periode (matrix OUTLET + HEALTH_PERIODE + HEALTH_DETAIL) dari MONITORING_DETAIL */
function menuRefreshPeriodHealth() {
  runSafely_(function () {
    getConfig(true);
    refreshPeriodHealth();   // sudah menampilkan toast sendiri
  });
}

/** ⚙️ Buat semua sheet + parameter default (tidak menimpa data/nilai yang sudah ada) */
function menuInitialize() {
  runSafely_(function () {
    initializeSheets();
    getConfig(true);
    refreshDashboard();
    showToast('Sheet & konfigurasi siap. Isi sheet TOLERANCE lalu jalankan analisis.', '⚙️ Inisialisasi', 8);
  });
}

/** 🔍 Cari tahu kenapa jumlah SKU yang dianalisis berbeda dari data terbaca */
function menuDiagnose() {
  runSafely_(function () { diagnoseSkuCoverage(); });
}

// ---------- Helper menu ----------

/** Bungkus eksekusi: error apa pun ditampilkan sebagai pesan yang mudah dibaca */
function runSafely_(fn) {
  try {
    fn();
  } catch (e) {
    Logger.log('❌ ' + e.message);
    showToast(e.message, '❌ Terjadi kesalahan', 10);
    SpreadsheetApp.getUi().alert('Terjadi kesalahan', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/** Tampilkan dialog hanya jika ada masalah (outlet gagal / tertunda); selain itu cukup Toast */
function showResultAlert_(s) {
  if (!s || (!s.failed.length && !s.pending)) return;   // sisa outlet dilanjutkan otomatis oleh trigger
  const lines = [];
  if (s.failed.length) {
    lines.push('Outlet GAGAL:');
    s.failed.forEach(f => lines.push('• ' + f.outlet + ' — ' + f.message));
  }
  if (s.pending) {
    lines.push('', s.pending + ' outlet tersisa DILANJUTKAN OTOMATIS di latar belakang (±1 menit lagi).',
      'Pantau di Panel Kontrol atau sheet RUN_LOG. Anda boleh pindah tab / menutup dialog ini.');
  }
  SpreadsheetApp.getUi().alert('Analisis selesai dengan catatan', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Deteksi nama outlet dari sel yang sedang dipilih (di sheet mana pun).
 * Sel yang isinya sama persis dengan nama outlet dianggap pilihan.
 */
function detectOutletsFromSelection_(available) {
  const byKey = new Map();
  available.forEach(o => byKey.set(normalizeText(o), o));

  const found = new Set();
  const list = (function () { try { return SpreadsheetApp.getActiveSpreadsheet().getActiveRangeList(); } catch (e) { return null; } })();
  const ranges = list ? list.getRanges() : [];

  ranges.forEach(range => {
    if (range.getNumRows() * range.getNumColumns() > 5000) return;  // seleksi terlalu besar, abaikan
    range.getValues().forEach(row => row.forEach(cell => {
      const hit = byKey.get(normalizeText(cell));
      if (hit && normalizeText(cell) !== '') found.add(hit);
    }));
  });
  return Array.from(found);
}

/** Dialog input: ketik nomor atau nama outlet, pisahkan dengan koma */
function promptOutlets_(available) {
  const ui = SpreadsheetApp.getUi();
  const MAX_SHOW = 40;
  const shown = available.slice(0, MAX_SHOW).map((o, i) => (i + 1) + '. ' + o);
  if (available.length > MAX_SHOW) shown.push('... dan ' + (available.length - MAX_SHOW) + ' outlet lain (ketik nama)');

  const res = ui.prompt('Analisis Outlet Terpilih',
    'Ketik NOMOR atau NAMA outlet, pisahkan dengan koma.\n' +
    'Tips: blok sel nama outlet di DASHBOARD lalu pilih menu ini agar langsung terdeteksi.\n' +
    'Untuk memilih dengan centang, gunakan Panel Kontrol (🎛️).\n\n' +
    shown.join('\n'),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return [];

  const chosen = new Set();
  String(res.getResponseText()).split(',').forEach(part => {
    const p = part.trim();
    if (!p) return;
    if (/^\d+$/.test(p)) {                                 // nomor urut
      const o = available[parseInt(p, 10) - 1];
      if (o) chosen.add(o);
      return;
    }
    const key = normalizeText(p);                          // nama (persis, lalu sebagian)
    const exact = available.filter(o => normalizeText(o) === key);
    const partial = exact.length ? exact : available.filter(o => normalizeText(o).indexOf(key) >= 0);
    partial.forEach(o => chosen.add(o));
  });

  if (!chosen.size) throw new Error('Tidak ada outlet yang cocok dengan input: "' + res.getResponseText() + '"');
  return Array.from(chosen);
}