/**
 * ============================================================
 *  Config.gs — Konfigurasi global & helper konfigurasi  (VERSI 3)
 * ============================================================
 *  Berisi: nama sheet, warna, header tabel, parameter default,
 *  dan fungsi untuk membaca/menulis sheet CONFIG.
 *
 *  Perubahan VERSI 3 (dibanding VERSI 2 patch Anda):
 *   - SHEET_NAMES.RUN_LOG : log proses analisis (dipakai Panel Kontrol).
 *   - RUN_LOG_HEADERS     : header sheet RUN_LOG.
 *   - Parameter baru di DEFAULT_CONFIG: RUN_LOG_MAX_ROWS,
 *     REOPEN_RECURRING_ALERTS (lihat keterangan di sheet CONFIG).
 */

// ---------- Nama sheet di spreadsheet "Monitoring Outlet" ----------
const SHEET_NAMES = {
  DASHBOARD: 'DASHBOARD',
  DETAIL: 'MONITORING_DETAIL',
  ALERT: 'ALERT_LOG',
  TOLERANCE: 'TOLERANCE',
  CONFIG: 'CONFIG',
  RUN_LOG: 'RUN_LOG'
};

// ---------- Level risiko (rank makin besar = makin parah) ----------
const RISK = {
  CRITICAL: { label: 'KRITIS', rank: 4, bg: '#F4B6B0', font: '#7F0000' },
  HIGH:     { label: 'TINGGI', rank: 3, bg: '#FFD59A', font: '#7A4100' },
  MEDIUM:   { label: 'SEDANG', rank: 2, bg: '#FFF2A8', font: '#665500' },
  SAFE:     { label: 'AMAN',   rank: 1, bg: '#BFE5C8', font: '#14532D' }
};

// ---------- Status kesehatan outlet (Dashboard) ----------
const HEALTH = {
  RED:   { label: 'RED',   bg: '#F4B6B0', font: '#7F0000' },
  AMBER: { label: 'AMBER', bg: '#FFD59A', font: '#7A4100' },
  GREEN: { label: 'GREEN', bg: '#BFE5C8', font: '#14532D' }
};

// ---------- Status pemeriksaan (kolom manual di MONITORING_DETAIL) ----------
const STATUS = { OK: 'OK', CHECK: 'PERLU DIPERIKSA', DONE: 'SUDAH DIPERIKSA' };

// ---------- Gaya tampilan ----------
const STYLE = {
  FONT: 'Arial',
  HEADER_BG: '#1F2A44',   // Dark slate blue
  HEADER_FONT: '#FFFFFF',
  KPI_BG: '#EEF1F6'
};

// ---------- Header kolom sheet output ----------
const DETAIL_HEADERS = [
  'Timestamp Analisis', 'Outlet', 'Tanggal/Periode', 'SKU', 'Nama Item', 'Kategori', 'Satuan',
  'SO_DataSO', 'SO_InvenMove', 'Variance_Qty', 'Tolerance_Allowed', 'Net_Selisih',
  'Statistical_Score_MAD', 'Risk_Level', 'Reason', 'Status_Pemeriksaan'
];
// Indeks kolom (mulai 0) agar kode mudah dibaca
const DC = {
  TS: 0, OUTLET: 1, PERIOD: 2, SKU: 3, NAME: 4, CAT: 5, UNIT: 6,
  SO_DATA: 7, SO_INV: 8, VAR: 9, TOL: 10, NET: 11, MAD: 12, RISK: 13, REASON: 14, STATUS: 15
};
const DETAIL_WIDTHS = [140, 230, 150, 80, 170, 100, 70, 90, 100, 90, 110, 90, 130, 90, 420, 150];

const ALERT_HEADERS = [
  'Alert ID', 'Waktu Deteksi', 'Outlet', 'SKU', 'Nama Item', 'Periode',
  'Risk Level', 'Jenis Anomali', 'Alasan', 'Status'
];
const AC = { ID: 0, TIME: 1, OUTLET: 2, SKU: 3, NAME: 4, PERIOD: 5, RISK: 6, TYPE: 7, REASON: 8, STATUS: 9 };
const ALERT_WIDTHS = [110, 140, 230, 80, 170, 150, 90, 210, 420, 80];

// ---------- Header sheet RUN_LOG (log proses, dibaca Panel Kontrol) ----------
const RUN_LOG_HEADERS = ['Waktu', 'Tahap', 'Detail'];
const RUN_LOG_WIDTHS = [150, 160, 620];

// ---------- Parameter default (ditulis ke sheet CONFIG) ----------
// Format: [Parameter, Nilai default, Keterangan]
const DEFAULT_CONFIG = [
  ['INVENTORY_SS_ID', '1CgZQa1vdgzLsArObtqvpMFsZ1vRaSFzqrR2nuzDdqQE', 'ID Spreadsheet Inventory Movement'],
  ['DATASO_SS_ID', '1bM5dtCLgTiDvd6oZL0pXcDxgb18g77Akj5XDk5k3Z9w', 'ID Spreadsheet DataSO_IC'],
  ['OUTLET_TAB_PREFIX', 'Link SO', 'Hanya tab berawalan teks ini yang dianggap sebagai outlet'],
  ['INV_DATE_ROW', 1, 'Inventory Movement: baris yang berisi tanggal (blok per hari)'],
  ['INV_HEADER_ROW', 2, 'Inventory Movement: baris header kolom (SO, Ending, dst.)'],
  ['INV_FIRST_DATA_ROW', 3, 'Inventory Movement: baris data pertama'],
  ['INV_FIRST_VALUE_COL', 5, 'Inventory Movement: kolom pertama blok tanggal (E = 5)'],
  ['SO_HEADER_ROW', 1, 'DataSO_IC: baris header tanggal'],
  ['SO_FIRST_DATA_ROW', 2, 'DataSO_IC: baris data pertama'],
  ['SO_FIRST_VALUE_COL', 3, 'DataSO_IC: kolom pertama tanggal SO (C = 3)'],
  ['INCLUDE_BASELINE_SO', false, 'TRUE = ikut bandingkan kolom "SO" awal (biasanya selalu sama, jadi FALSE)'],
  ['MAD_CRITICAL', 3.0, 'Skor MAD di atas nilai ini + di luar toleransi = KRITIS'],
  ['MAD_HIGH', 2.0, 'Skor MAD di atas nilai ini + di luar toleransi = TINGGI'],
  ['MIN_HISTORY', 3, 'Minimal jumlah histori periode lain per SKU agar skor MAD dihitung'],
  ['MAD_CAP', 10, 'Batas maksimum skor MAD (dipakai jika histori tidak punya variasi)'],
  ['BATCH_SIZE', 1000, 'Jumlah baris per sekali tulis ke sheet (pengaturan batch)'],
  ['MAX_RUNTIME_SECONDS', 300, 'Batas waktu proses (detik) sebelum analisis berhenti aman (limit GAS = 360)'],
  ['RUN_LOG_MAX_ROWS', 500, 'RUN_LOG: jumlah baris log yang dipertahankan (log terlama dihapus)'],
  ['REOPEN_RECURRING_ALERTS', false, 'TRUE = alert yang muncul kembali setelah CLOSED otomatis dibuka lagi (status OPEN)'],
  ['GEMINI_MODEL', 'gemini-4-argon', 'AI: model Gemini (Interactions API). API key diatur lewat menu 🔑 Atur Gemini API Key'],
  ['GEMINI_THINKING_LEVEL', 'low', 'AI: tingkat berpikir model — minimal | low | medium | high (isi "default" = ikuti bawaan model)'],
  ['GEMINI_MAX_OUTPUT_TOKENS', 3000, 'AI: batas token keluaran per jawaban (termasuk token berpikir)'],
  ['AI_PROVIDER', 'gemini', 'AI: penyedia — gemini | anthropic | openai (openai = semua API berformat chat/completions: OpenAI, Groq, OpenRouter, dll.)'],
  ['AI_MODEL', '', 'AI: nama model untuk provider anthropic/openai (mis. claude-sonnet-5-5 atau claude-haiku-5-5). Untuk gemini pakai GEMINI_MODEL'],
  ['AI_BASE_URL', '', 'AI: hanya provider openai — URL dasar API (kosong = https://api.openai.com/v1)'],
  ['GEMINI_FALLBACK_MODEL', '', 'AI: model cadangan bila kuota model utama habis (429). Kosong = nonaktif. Isi nama model yang tersedia di AI Studio'],
  ['AI_SOURCES', 'monitoring,portal,so,checkso,checklist,history', 'AI: sumber data yang boleh dibaca asisten (pisahkan koma): monitoring, portal, so, checkso, checklist, history. Hapus nama sumber untuk menonaktifkannya'],
  ['AI_MAX_CONTEXT_CHARS', 40000, 'AI: batas total karakter data yang dikirim ke model per pertanyaan (lebih besar = lebih lengkap tetapi lebih mahal/lambat)'],
  ['AI_PORTAL_ROW_LIMIT', 25, 'AI: maks. baris Portal per sheet yang dikirim ke model (antrean terbaru dulu)'],
  ['AI_HISTORY_DAYS', 14, 'AI: rentang hari HISTORY_LOG yang dibaca asisten']
];

// ---------- Helper ----------
let _configCache = null;

// ============================================================
//  DIGABUNG KE INVMOVE: data CONTROL tetap di spreadsheet CONTROL sendiri.
//  Script ini sekarang milik project INVMOVE, jadi spreadsheet CONTROL dibuka
//  lewat ID (bukan getActiveSpreadsheet yang akan menunjuk ke spreadsheet INVMOVE).
// ============================================================
const CONTROL_SS_ID = '1ujAPtz9yvniAhJW4kR05qSnDqouLV03USrDvTTevPKQ';
let _ctlSS = null;

/** Spreadsheet "Monitoring Outlet" (CONTROL) — dibuka sekali per eksekusi */
function getActiveSS() {
  if (!_ctlSS) _ctlSS = SpreadsheetApp.openById(CONTROL_SS_ID);
  return _ctlSS;
}

/**
 * Baca konfigurasi: nilai default ditimpa oleh isi sheet CONFIG.
 * Tipe data (angka / boolean / teks) mengikuti tipe nilai default.
 */
function getConfig(forceReload) {
  if (_configCache && !forceReload) return _configCache;

  const cfg = {};
  DEFAULT_CONFIG.forEach(r => { cfg[r[0]] = r[1]; });

  const sheet = getActiveSS().getSheetByName(SHEET_NAMES.CONFIG);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(row => {
      const key = String(row[0]).trim();
      const val = row[1];
      if (!key || !(key in cfg) || val === '') return;

      const type = typeof cfg[key];
      if (type === 'number') {
        const n = Number(String(val).replace(',', '.'));
        if (!isNaN(n)) cfg[key] = n;
      } else if (type === 'boolean') {
        cfg[key] = String(val).toUpperCase() === 'TRUE';
      } else {
        cfg[key] = String(val).trim();
      }
    });
  }
  _configCache = cfg;
  return cfg;
}

/** Buat sheet CONFIG + isi parameter default yang belum ada (tidak menimpa nilai Anda) */
function initializeConfigSheet() {
  const sheet = ensureSheet(SHEET_NAMES.CONFIG, ['Parameter', 'Nilai', 'Keterangan'], [220, 380, 520]);
  const last = sheet.getLastRow();

  const existing = new Set();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(r => existing.add(String(r[0]).trim()));
  }
  const toAdd = DEFAULT_CONFIG.filter(r => !existing.has(r[0]));
  if (toAdd.length) {
    sheet.getRange(last + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
  sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 3)
    .setFontFamily(STYLE.FONT).setFontSize(10).setVerticalAlignment('middle');
  _configCache = null;
}