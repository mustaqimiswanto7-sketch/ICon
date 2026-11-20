/**
 * ============================================================
 *  PeriodHealth.gs — Analisis Kesehatan per Periode (MG 1–4 + BLN)
 * ============================================================
 *  FILE BARU. Nama di project INVMOVE: Ctl_PeriodHealth
 *  (di project CONTROL mandiri boleh dinamai PeriodHealth — isinya sama).
 *
 *  TUJUAN
 *   Menampilkan Inventory Health Score tiap OUTLET pada tiap PERIODE:
 *   MG 1, MG 2, MG 3, MG 4 dan BLN, per bulan.
 *
 *  ATURAN PERIODE (sesuai permintaan)
 *   - Tanggal MG tiap outlet bisa berbeda -> header MG hanya "MG 1", "MG 2", dst.
 *     (tanggal asli tiap outlet ada di catatan sel & di sheet HEALTH_DETAIL).
 *   - BLN dilakukan serentak -> header BLN berupa TANGGAL, mis. "31 Oktober 2026".
 *   - Bulan sebuah periode = bulan dari tanggal SO-nya.
 *
 *  OUTPUT
 *   1. OUTLET          (sheet Anda) : kolom D dst. diisi matrix skor per periode +
 *                                      RATA-RATA / STATUS / TREN. Kolom A–C TIDAK diubah isinya.
 *   2. HEALTH_PERIODE  (sheet baru) : KPI, temuan utama, ringkasan per periode, 2 grafik.
 *   3. HEALTH_DETAIL   (sheet baru) : tabel panjang outlet x periode (bisa difilter / pivot).
 *
 *  RUMUS SKOR (sama persis dengan DASHBOARD — memakai DASH_CFG):
 *   skor = 100 - ((KRITIS x W_CRIT + TINGGI x W_HIGH + SEDANG x W_MED) / jumlah baris x 100)
 *   status (healthOf_): RED = ada KRITIS | AMBER = ada TINGGI/SEDANG | GREEN = semua AMAN
 *
 *  SUMBER DATA : sheet MONITORING_DETAIL (hanya dibaca). Tidak ada analisis ulang.
 *
 *  Fungsi publik:
 *   - refreshPeriodHealth()   : bangun ulang ketiga sheet di atas
 *   - testPeriodHealth()      : uji mandiri (jalankan dari editor, lihat Logger)
 *
 *  Dependensi (sudah ada di project): SHEET_NAMES, STYLE, HEALTH, RISK, DC, DETAIL_HEADERS,
 *   DASH_CFG, getActiveSS(), getConfig(), ensureSheet(), styleHeader(), clearBody(),
 *   writeInBatches(), dashReadBody_(), dashRiskClass_(), healthOf_(), dashScoreColor_(),
 *   dashPct_(), parseSoHeader(), mean(), median(), round(), pad2(), showToast()
 */

// ---------- Pengaturan ----------
const PH = {
  SHEET_MATRIX: 'OUTLET',          // sheet matrix (milik Anda)
  SHEET_SUMMARY: 'HEALTH_PERIODE',
  SHEET_DETAIL: 'HEALTH_DETAIL',
  NAME_COL: 3,                     // kolom C = NAMA OUTLET
  FIRST_COL: 4,                    // kolom D = awal blok periode
  SLOTS: ['MG 1', 'MG 2', 'MG 3', 'MG 4', 'BLN'],
  MATRIX_MONTHS: 2,                // jumlah bulan terakhir yang tampil di sheet OUTLET (riwayat lengkap ada di HEALTH_DETAIL)
  TREND_DELTA: 3,                  // selisih skor >= nilai ini dianggap membaik / memburuk
  RESTYLE_LEFT_HEADER: true,       // true = header A1:C1 disamakan gayanya (isi tidak berubah)
  AUTO_AFTER_ANALYSIS: true,       // true = otomatis diperbarui setelah Analisis Lengkap selesai
  COLORS: {
    BLN_HEAD: '#0F766E', SUM_HEAD: '#374151', GRID: '#D5DAE3', ZEBRA: '#F6F8FB',
    UP: '#2E7D32', DOWN: '#C62828', FLAT: '#6B7280', MUTED: '#6B7280', CLOSED: '#F1F3F4', TAB: '#0F766E'
  }
};
const PH_PTS = { K: 3, T: 2, S: 1 };
const PH_MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const PH_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ============================================================
//  ENTRY POINT
// ============================================================

/** Bangun ulang OUTLET (matrix), HEALTH_PERIODE, dan HEALTH_DETAIL dari MONITORING_DETAIL */
function refreshPeriodHealth() {
  const ss = getActiveSS();
  const tz = ss.getSpreadsheetTimeZone();
  const rows = dashReadBody_(ss.getSheetByName(SHEET_NAMES.DETAIL), DETAIL_HEADERS.length);

  // 1) Agregasi per outlet x periode
  const agg = phAggregate_(rows);
  const cells = agg.cells;
  cells.forEach(phFinalizeCell_);
  phBuildTrends_(cells);

  // 2) Daftar outlet di sheet OUTLET + header yang sudah ada
  const info = phReadOutletSheet_(ss, tz, cells);
  const activeOutlets = info.outlets.filter(o => o.hari !== 'TUTUP');
  const activeKeys = new Set(activeOutlets.map(o => o.key));
  const periods = phBuildPeriods_(cells, activeKeys);

  // 3) Bulan yang tampil di matrix: gabungan header sheet + data, ambil N terakhir
  const cycleSet = new Set();
  cells.forEach(c => cycleSet.add(c.ym));
  Object.keys(info.headerBln).forEach(ym => cycleSet.add(ym));
  let cycles = Array.from(cycleSet).sort();
  if (!cycles.length) cycles = [Utilities.formatDate(new Date(), tz, 'yyyy-MM')];
  const shown = cycles.slice(-Math.max(1, PH.MATRIX_MONTHS));

  // Tanggal BLN per bulan: data (serentak) > header yang sudah ada > akhir bulan
  const blnDate = {};
  cycles.forEach(ym => {
    const p = periods.filter(x => x.ym === ym && x.slot === 'BLN')[0];
    blnDate[ym] = (p && p.modeDate) || info.headerBln[ym] || phMonthEnd_(ym);
  });

  // Outlet yang punya data tetapi tidak ada di sheet OUTLET
  const sheetKeys = new Set(info.outlets.map(o => o.key));
  const missingMap = new Map();
  cells.forEach(c => { if (!sheetKeys.has(c.outletKey)) missingMap.set(c.outletKey, c.outlet); });
  const missing = Array.from(missingMap.values()).sort();

  // 4) Tulis
  phWriteMatrix_(info, cells, shown, blnDate);
  const ctx = { activeOutlets: activeOutlets.length, unmapped: agg.unmapped, missing: missing };
  const insights = phBuildInsights_(periods, ctx);
  phWriteSummary_(ss, periods, insights, ctx);
  const detailCount = phWriteDetail_(ss, cells);

  const stats = {
    periods: periods.length, cells: cells.size, outlets: new Set(Array.from(cells.values()).map(c => c.outletKey)).size,
    detailRows: detailCount, unmappedRows: agg.unmapped.rows, missingOutlets: missing.length, shownMonths: shown
  };
  Logger.log('✅ Kesehatan Periode: ' + JSON.stringify(stats));
  showToast(periods.length + ' periode, ' + stats.outlets + ' outlet dianalisis.', '🩺 Kesehatan per Periode', 6);
  if (typeof afterDataChanged_ === 'function') afterDataChanged_('HEALTH');
  return stats;
}

// ============================================================
//  PARSING & HELPER
// ============================================================

function phOutletKey_(name) {
  return String(name == null ? '' : name).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * "2026-10-07 (MG 1)" -> { dateKey:'2026-10-07', ym:'2026-10', slot:'MG 1' }
 * "2026-09-30 (BLN)"  -> { ..., slot:'BLN' }
 * Tanpa label / label tidak dikenal -> slot null (dihitung sebagai "tidak terpetakan").
 */
function phParsePeriod_(value) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s*\(([^)]*)\))?/);
  if (!m) return null;
  const label = (m[4] || '').trim().toUpperCase();
  let slot = null;
  const mg = label.match(/(?:MG|MINGGU)\s*\.?\s*(\d)/);
  if (mg) {
    const n = parseInt(mg[1], 10);
    if (n >= 1 && n <= 4) slot = 'MG ' + n;
  } else if (/^(BLN|BULAN|BULANAN)\b/.test(label)) {
    slot = 'BLN';
  }
  return { dateKey: m[1] + '-' + m[2] + '-' + m[3], ym: m[1] + '-' + m[2], slot: slot, label: label };
}

function phSlotIndex_(slot) { return PH.SLOTS.indexOf(slot); }
function phYmIndex_(ym) { const p = ym.split('-'); return (+p[0]) * 12 + (+p[1] - 1); }
function phOrder_(ym, slot) { return phYmIndex_(ym) * 10 + phSlotIndex_(slot); }

function phMonthEnd_(ym) {
  const p = ym.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate();
  return ym + '-' + pad2(d);
}

function phDateLong_(dateKey) {            // 2026-10-31 -> "31 Oktober 2026"
  if (!dateKey) return '';
  const p = dateKey.split('-');
  return (+p[2]) + ' ' + PH_MONTHS_LONG[+p[1] - 1] + ' ' + p[0];
}

function phDateMed_(dateKey) {             // 2026-10-31 -> "31 Okt 2026"
  if (!dateKey) return '';
  const p = dateKey.split('-');
  return (+p[2]) + ' ' + PH_MONTHS_SHORT[+p[1] - 1] + ' ' + p[0];
}

function phDateRange_(a, b) {              // "07 Okt – 13 Okt 2026"
  if (!a) return '';
  if (!b || a === b) return phDateMed_(a);
  const pa = a.split('-'), pb = b.split('-');
  if (pa[0] === pb[0] && pa[1] === pb[1]) return (+pa[2]) + ' – ' + (+pb[2]) + ' ' + PH_MONTHS_SHORT[+pa[1] - 1] + ' ' + pa[0];
  return phDateMed_(a) + ' – ' + phDateMed_(b);
}

function phPeriodLabel_(ym, slot, dateKey) {
  const p = ym.split('-');
  if (slot === 'BLN') return 'BLN · ' + phDateMed_(dateKey || phMonthEnd_(ym));
  return slot + ' · ' + PH_MONTHS_SHORT[+p[1] - 1] + ' ' + p[0];
}

function phModeDate_(counts) {
  let best = null, n = -1;
  Object.keys(counts).sort().forEach(d => { if (counts[d] > n) { n = counts[d]; best = d; } });
  return best;
}

function phSigned_(n) { return (n > 0 ? '+' : '') + n; }

function phTrendText_(t) {
  if (t === 'UP') return '▲ Membaik';
  if (t === 'DOWN') return '▼ Memburuk';
  if (t === 'FLAT') return '▬ Stabil';
  return '• Awal';
}

function phTrendColor_(t) {
  if (t === 'UP') return PH.COLORS.UP;
  if (t === 'DOWN') return PH.COLORS.DOWN;
  return PH.COLORS.FLAT;
}

// ============================================================
//  AGREGASI
// ============================================================

/** MONITORING_DETAIL -> Map "outlet|yyyy-MM|slot" -> sel agregat */
function phAggregate_(rows) {
  const cells = new Map();
  const unmapped = { rows: 0, samples: [] };

  rows.forEach(r => {
    const outlet = r[DC.OUTLET];
    if (!outlet) return;

    const pp = phParsePeriod_(r[DC.PERIOD]);
    if (!pp || !pp.slot) {
      unmapped.rows++;
      const p = String(r[DC.PERIOD] == null ? '' : r[DC.PERIOD]);
      if (unmapped.samples.length < 3 && unmapped.samples.indexOf(p) < 0) unmapped.samples.push(p);
      return;
    }

    const oKey = phOutletKey_(outlet);
    const key = oKey + '|' + pp.ym + '|' + pp.slot;
    let c = cells.get(key);
    if (!c) {
      c = {
        key: key, outletKey: oKey, outlet: String(outlet).trim(), ym: pp.ym, slot: pp.slot,
        order: phOrder_(pp.ym, pp.slot), dates: {}, total: 0, K: 0, T: 0, S: 0, A: 0, flagged: new Map()
      };
      cells.set(key, c);
    }

    const cls = dashRiskClass_(r[DC.RISK]);
    c.total++;
    c[cls]++;
    c.dates[pp.dateKey] = (c.dates[pp.dateKey] || 0) + 1;

    if (cls !== 'A') {
      const sku = String(r[DC.SKU] == null ? '' : r[DC.SKU]);
      const pts = PH_PTS[cls];
      const old = c.flagged.get(sku);
      if (!old || pts > old.pts) c.flagged.set(sku, { sku: sku, item: String(r[DC.NAME] || ''), pts: pts, cls: cls });
    }
  });
  return { cells: cells, unmapped: unmapped };
}

/** Hitung skor, status, tanggal dominan, SKU teratas untuk satu sel (rumus = DASHBOARD) */
function phFinalizeCell_(c) {
  const W = DASH_CFG;
  c.anomaly = c.K + c.T + c.S;
  c.rate = c.total ? c.anomaly / c.total : 0;
  const penalty = c.total ? (c.K * W.W_CRIT + c.T * W.W_HIGH + c.S * W.W_MED) / c.total * 100 : 0;
  c.score = Math.max(0, Math.round(100 - penalty));
  c.health = healthOf_(c.K, c.T, c.S);
  c.dateKey = phModeDate_(c.dates);
  c.multiDate = Object.keys(c.dates).length > 1;
  c.topSkus = Array.from(c.flagged.values())
    .sort((a, b) => (b.pts - a.pts) || a.sku.localeCompare(b.sku)).slice(0, 3);
}

/** Per outlet: urutkan kronologis lalu hitung selisih skor, tren, SKU berulang, streak RED */
function phBuildTrends_(cells) {
  const byOutlet = new Map();
  cells.forEach(c => {
    let a = byOutlet.get(c.outletKey);
    if (!a) { a = []; byOutlet.set(c.outletKey, a); }
    a.push(c);
  });
  byOutlet.forEach(list => {
    list.sort((a, b) => a.order - b.order);
    list.forEach((c, i) => {
      const p = i > 0 ? list[i - 1] : null;
      c.prev = p;
      c.delta = p ? c.score - p.score : null;
      c.trend = !p ? 'BASELINE' : (c.delta >= PH.TREND_DELTA ? 'UP' : (c.delta <= -PH.TREND_DELTA ? 'DOWN' : 'FLAT'));
      let rec = 0;
      if (p) c.flagged.forEach((_, sku) => { if (p.flagged.has(sku)) rec++; });
      c.recurring = rec;
      c.redStreak = c.health === HEALTH.RED ? ((p && p.redStreak ? p.redStreak : 0) + 1) : 0;
    });
  });
  return byOutlet;
}

/** Ringkasan per periode (lintas outlet), urut kronologis */
function phBuildPeriods_(cells, activeKeys) {
  const map = new Map();
  cells.forEach(c => {
    const k = c.ym + '|' + c.slot;
    let p = map.get(k);
    if (!p) { p = { key: k, ym: c.ym, slot: c.slot, order: c.order, cells: [], dateCount: {} }; map.set(k, p); }
    p.cells.push(c);
    Object.keys(c.dates).forEach(d => { p.dateCount[d] = (p.dateCount[d] || 0) + c.dates[d]; });
  });

  const list = Array.from(map.values()).sort((a, b) => a.order - b.order);
  const activeN = activeKeys ? activeKeys.size : 0;

  list.forEach((p, i) => {
    const scores = p.cells.map(c => c.score);
    p.outlets = p.cells.length;
    p.avg = round(mean(scores), 1);
    p.median = median(scores);
    p.min = Math.min.apply(null, scores);
    p.G = p.cells.filter(c => c.health === HEALTH.GREEN).length;
    p.A = p.cells.filter(c => c.health === HEALTH.AMBER).length;
    p.R = p.cells.filter(c => c.health === HEALTH.RED).length;
    p.total = 0; p.K = 0; p.T = 0; p.S = 0;
    p.cells.forEach(c => { p.total += c.total; p.K += c.K; p.T += c.T; p.S += c.S; });
    p.anomaly = p.K + p.T + p.S;
    p.rate = p.total ? p.anomaly / p.total : 0;

    const dates = Object.keys(p.dateCount).sort();
    p.dateFrom = dates[0];
    p.dateTo = dates[dates.length - 1];
    p.modeDate = phModeDate_(p.dateCount);
    p.label = phPeriodLabel_(p.ym, p.slot, p.modeDate);

    const covered = activeKeys ? p.cells.filter(c => activeKeys.has(c.outletKey)).length : 0;
    p.coverage = activeN ? Math.min(1, covered / activeN) : null;
    p.covered = covered;

    p.worst = p.cells.slice().sort((a, b) => (a.score - b.score) || (b.K - a.K) || a.outlet.localeCompare(b.outlet)).slice(0, 3);
    const prev = i > 0 ? list[i - 1] : null;
    p.delta = prev ? round(p.avg - prev.avg, 1) : null;
  });
  return list;
}

// ============================================================
//  SHEET OUTLET (MATRIX)
// ============================================================

/** Baca daftar outlet (kolom A–C) & header BLN yang sudah ada. Buat sheet bila belum ada. */
function phReadOutletSheet_(ss, tz, cells) {
  let sh = ss.getSheetByName(PH.SHEET_MATRIX);
  if (!sh) {
    sh = ss.insertSheet(PH.SHEET_MATRIX);
    const names = new Map();
    cells.forEach(c => names.set(c.outletKey, c.outlet));
    const sorted = Array.from(names.values()).sort();
    sh.getRange(1, 1, 1, 3).setValues([['HARI', 'HIGH LIGHT', 'NAMA OUTLET']]);
    if (sorted.length) sh.getRange(2, 3, sorted.length, 1).setValues(sorted.map(n => [n]));
  }

  const outlets = [];
  const last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, PH.NAME_COL).getDisplayValues().forEach((r, i) => {
      const name = String(r[PH.NAME_COL - 1]).trim();
      if (!name) return;
      outlets.push({ row: i + 2, name: name, key: phOutletKey_(name), hari: String(r[0]).trim().toUpperCase() });
    });
  }

  // Header BLN yang sudah ada (tanggal) -> dipakai agar bulan yang sudah Anda siapkan tetap tampil
  const headerBln = {};
  const lastCol = sh.getLastColumn();
  if (lastCol >= PH.FIRST_COL) {
    sh.getRange(1, PH.FIRST_COL, 1, lastCol - PH.FIRST_COL + 1).getValues()[0].forEach(v => {
      if (v === '' || v === null || v === undefined) return;
      if (typeof v === 'string' && /^\s*(MG|MINGGU)\s*\d/i.test(v)) return;
      const info = parseSoHeader(v, tz);
      if (info && info.dateKey) headerBln[info.dateKey.substring(0, 7)] = info.dateKey;
    });
  }
  return { sheet: sh, outlets: outlets, headerBln: headerBln };
}

function phCellNote_(c) {
  const L = [];
  L.push(c.outlet + ' — ' + c.slot + (c.dateKey ? ' (' + phDateLong_(c.dateKey) + ')' : ''));
  L.push('Skor kesehatan: ' + c.score + '/100 (' + c.health.label + ')');
  L.push('Baris: ' + c.total + ' | KRITIS ' + c.K + ' | TINGGI ' + c.T + ' | SEDANG ' + c.S + ' | AMAN ' + c.A);
  L.push('Anomaly rate: ' + dashPct_(c.rate));
  if (c.delta !== null && c.delta !== undefined) L.push('Perubahan vs periode sebelumnya: ' + phSigned_(c.delta) + ' poin');
  if (c.recurring) L.push('SKU berulang dari periode sebelumnya: ' + c.recurring);
  if (c.topSkus.length) L.push('SKU teratas: ' + c.topSkus.map(s => s.sku + (s.item ? ' – ' + s.item : '')).join('; '));
  if (c.multiDate) L.push('⚠ Periode ini memuat lebih dari satu tanggal SO');
  return L.join('\n');
}

/** Tulis matrix ke sheet OUTLET mulai kolom D (kolom A–C tidak disentuh isinya) */
function phWriteMatrix_(info, cells, shown, blnDate) {
  const sh = info.sheet;
  const BS = SpreadsheetApp.BorderStyle;
  const nSlots = PH.SLOTS.length;
  const nBlock = shown.length * nSlots;
  const nCols = nBlock + 3;                       // + RATA-RATA, STATUS, TREN
  const lastCol = PH.FIRST_COL + nCols - 1;
  if (sh.getMaxColumns() < lastCol) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol - sh.getMaxColumns());

  // Reset area D..akhir (hanya area matrix)
  const area = sh.getRange(1, PH.FIRST_COL, sh.getMaxRows(), sh.getMaxColumns() - PH.FIRST_COL + 1);
  area.breakApart();
  area.clear();
  area.clearNote();

  // Header
  const header = [];
  shown.forEach(ym => PH.SLOTS.forEach(sl => header.push(sl === 'BLN' ? phDateLong_(blnDate[ym]) : sl)));
  header.push('RATA-RATA', 'STATUS', 'TREN');
  const hr = sh.getRange(1, PH.FIRST_COL, 1, nCols);
  hr.setNumberFormat('@').setValues([header]);
  styleHeader(hr);
  shown.forEach((ym, ci) => sh.getRange(1, PH.FIRST_COL + ci * nSlots + (nSlots - 1)).setBackground(PH.COLORS.BLN_HEAD));
  sh.getRange(1, PH.FIRST_COL + nBlock, 1, 3).setBackground(PH.COLORS.SUM_HEAD);
  sh.setRowHeight(1, 30);
  if (PH.RESTYLE_LEFT_HEADER) styleHeader(sh.getRange(1, 1, 1, PH.NAME_COL));
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);

  // Body
  const maxRowUsed = info.outlets.reduce((m, o) => Math.max(m, o.row), 1);
  const nRows = maxRowUsed - 1;
  if (nRows > 0) {
    const byRow = new Map(info.outlets.map(o => [o.row, o]));
    const V = [], B = [], F = [], N = [];

    for (let r = 2; r <= maxRowUsed; r++) {
      const o = byRow.get(r);
      const v = [], b = [], f = [], n = [];
      const blank = function (bg) { v.push(''); b.push(bg || '#FFFFFF'); f.push('#000000'); n.push(''); };
      const mine = [];

      if (!o) {
        for (let i = 0; i < nCols; i++) blank();
      } else {
        const closed = o.hari === 'TUTUP';
        shown.forEach(ym => PH.SLOTS.forEach(sl => {
          const c = cells.get(o.key + '|' + ym + '|' + sl);
          if (c) {
            mine.push(c);
            v.push(c.score); b.push(c.health.bg); f.push(c.health.font); n.push(phCellNote_(c));
          } else {
            blank(closed ? PH.COLORS.CLOSED : '#FFFFFF');
          }
        }));
        if (mine.length) {
          const avg = round(mean(mine.map(c => c.score)), 1);
          const lastC = mine[mine.length - 1];
          v.push(avg); b.push('#FFFFFF'); f.push(dashScoreColor_(avg)); n.push('');
          v.push(lastC.health.label); b.push(lastC.health.bg); f.push(lastC.health.font); n.push('');
          v.push(phTrendText_(lastC.trend)); b.push('#FFFFFF'); f.push(phTrendColor_(lastC.trend)); n.push('');
        } else {
          for (let i = 0; i < 3; i++) blank(closed ? PH.COLORS.CLOSED : '#FFFFFF');
        }
      }
      V.push(v); B.push(b); F.push(f); N.push(n);
    }

    const body = sh.getRange(2, PH.FIRST_COL, nRows, nCols);
    sh.getRange(2, PH.FIRST_COL, nRows, nBlock).setNumberFormat('0');
    sh.getRange(2, PH.FIRST_COL + nBlock, nRows, 1).setNumberFormat('0.0');
    body.setValues(V).setBackgrounds(B).setFontColors(F).setNotes(N);
    body.setFontFamily(STYLE.FONT).setFontSize(10).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, PH.COLORS.GRID, BS.SOLID);
  }

  // Pemisah antar bulan + kolom ringkasan
  shown.forEach((ym, ci) => {
    sh.getRange(1, PH.FIRST_COL + ci * nSlots, Math.max(nRows, 0) + 1, 1)
      .setBorder(null, true, null, null, null, null, STYLE.HEADER_BG, BS.SOLID_MEDIUM);
  });
  sh.getRange(1, PH.FIRST_COL + nBlock, Math.max(nRows, 0) + 1, 1)
    .setBorder(null, true, null, null, null, null, STYLE.HEADER_BG, BS.SOLID_MEDIUM);

  // Lebar kolom
  sh.setColumnWidths(PH.FIRST_COL, nBlock, 96);
  shown.forEach((ym, ci) => sh.setColumnWidth(PH.FIRST_COL + ci * nSlots + (nSlots - 1), 140));
  sh.setColumnWidth(PH.FIRST_COL + nBlock, 95);
  sh.setColumnWidth(PH.FIRST_COL + nBlock + 1, 90);
  sh.setColumnWidth(PH.FIRST_COL + nBlock + 2, 110);
}

// ============================================================
//  SHEET HEALTH_PERIODE (RINGKASAN)
// ============================================================

function phBuildInsights_(periods, ctx) {
  const out = [];
  if (!periods.length) {
    out.push('Belum ada data periode (MG 1–4 / BLN). Jalankan: 📊 Monitoring Outlet → Jalankan Analisis Lengkap.');
  } else {
    const L = periods[periods.length - 1];
    const P = periods.length > 1 ? periods[periods.length - 2] : null;

    out.push('Periode terbaru ' + L.label + ': skor rata-rata ' + L.avg +
      (P ? ' (' + phSigned_(L.delta) + ' poin dibanding ' + P.label + ')' : '') +
      ' pada ' + L.outlets + ' outlet — ' + L.R + ' RED, ' + L.A + ' AMBER, ' + L.G + ' GREEN.');

    const low = L.worst.filter(c => c.score < 100);
    out.push(low.length
      ? 'Skor terendah di ' + L.slot + ': ' + low.map(c => c.outlet + ' (' + c.score + ', ' + c.K + ' KRITIS)').join(' · ') + '.'
      : 'Semua outlet pada periode terbaru berstatus GREEN dengan skor 100.');

    if (L.cells.some(c => c.prev)) {
      const down = L.cells.filter(c => c.trend === 'DOWN').sort((a, b) => a.delta - b.delta);
      const up = L.cells.filter(c => c.trend === 'UP');
      out.push(up.length + ' outlet membaik dan ' + down.length + ' outlet memburuk (selisih ≥ ' + PH.TREND_DELTA +
        ' poin) dibanding periode sebelumnya' +
        (down.length ? '; penurunan terbesar: ' + down.slice(0, 3).map(c => c.outlet + ' (' + phSigned_(c.delta) + ')').join(' · ') : '') + '.');
    }

    const streak = L.cells.filter(c => c.redStreak >= 2).sort((a, b) => (b.redStreak - a.redStreak) || (a.score - b.score));
    if (streak.length) {
      out.push(streak.length + ' outlet berstatus RED ≥ 2 periode berturut-turut: ' +
        streak.slice(0, 5).map(c => c.outlet + ' (' + c.redStreak + 'x)').join(' · ') + (streak.length > 5 ? ' …' : '') + '.');
    }

    const skuMap = new Map();
    L.cells.forEach(c => c.flagged.forEach(f => {
      let s = skuMap.get(f.sku);
      if (!s) { s = { sku: f.sku, item: f.item, outlets: 0, pts: 0 }; skuMap.set(f.sku, s); }
      s.outlets++; s.pts += f.pts;
    }));
    const skus = Array.from(skuMap.values()).sort((a, b) => (b.outlets - a.outlets) || (b.pts - a.pts) || a.sku.localeCompare(b.sku));
    if (skus.length) {
      out.push('SKU paling sering terindikasi di ' + L.slot + ': ' +
        skus.slice(0, 3).map(s => s.sku + (s.item ? ' – ' + s.item : '') + ' (' + s.outlets + ' outlet)').join(' · ') + '.');
    }

    const recTotal = L.cells.reduce((a, c) => a + c.recurring, 0);
    const recOutlets = L.cells.filter(c => c.recurring > 0).length;
    if (recTotal) out.push(recTotal + ' temuan SKU berulang dari periode sebelumnya di ' + recOutlets + ' outlet — kandidat prioritas pemeriksaan.');

    if (ctx.activeOutlets && L.coverage !== null) {
      out.push('Cakupan ' + L.slot + ': ' + L.covered + ' dari ' + ctx.activeOutlets + ' outlet aktif sudah memiliki data (' + dashPct_(L.coverage) + ').');
    }
  }

  if (ctx.unmapped && ctx.unmapped.rows) {
    out.push('⚠ ' + ctx.unmapped.rows + ' baris MONITORING_DETAIL tidak punya label MG 1–4 / BLN yang dikenali sehingga tidak ikut dihitung (contoh: ' +
      ctx.unmapped.samples.join(', ') + ').');
  }
  if (ctx.missing && ctx.missing.length) {
    out.push('⚠ ' + ctx.missing.length + ' outlet punya data tetapi namanya tidak ditemukan di sheet OUTLET: ' +
      ctx.missing.slice(0, 5).join(', ') + (ctx.missing.length > 5 ? ' …' : '') + '.');
  }
  return out;
}

function phPlaceAfterDashboard_(ss, sheet) {
  try {
    const prev = ss.getActiveSheet();
    const dash = ss.getSheetByName(SHEET_NAMES.DASHBOARD);
    const idx = dash ? dash.getIndex() + 1 : 1;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(idx);
    if (prev && prev.getSheetId() !== sheet.getSheetId()) ss.setActiveSheet(prev);
  } catch (e) { Logger.log('Pindah tab ' + sheet.getName() + ' dilewati: ' + e.message); }
}

function phWriteSummary_(ss, periods, insights, ctx) {
  const BS = SpreadsheetApp.BorderStyle;
  const FONT = STYLE.FONT;
  const NC = 17;
  let sh = ss.getSheetByName(PH.SHEET_SUMMARY);
  const isNew = !sh;
  if (!sh) sh = ss.insertSheet(PH.SHEET_SUMMARY);

  // Reset total
  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.setConditionalFormatRules([]);
  sh.setHiddenGridlines(true);
  sh.setTabColor(PH.COLORS.TAB);

  const needRows = 70 + periods.length + insights.length;
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  if (sh.getMaxColumns() < NC + 1) sh.insertColumnsAfter(sh.getMaxColumns(), NC + 1 - sh.getMaxColumns());
  sh.setRowHeights(1, sh.getMaxRows(), 21);
  sh.getRange(1, 1, sh.getMaxRows(), NC + 1).setFontFamily(FONT).setFontSize(10).setVerticalAlignment('middle');
  [175, 135, 70, 80, 90, 70, 70, 75, 65, 65, 65, 95, 70, 70, 70, 85, 380, 20]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const tz = ss.getSpreadsheetTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, 'dd MMM yyyy HH:mm');
  const W = DASH_CFG;

  // ----- Judul -----
  sh.getRange(1, 1).setValue('ANALISIS KESEHATAN PER PERIODE').setFontSize(16).setFontWeight('bold')
    .setFontColor(STYLE.HEADER_BG).setWrap(false);
  sh.setRowHeight(1, 34);
  sh.getRange(2, 1).setValue('Diperbarui ' + stamp + ' · sumber: MONITORING_DETAIL · MG 1–4 = tanggal SO tiap outlet bisa berbeda, BLN = serentak')
    .setFontSize(9).setFontStyle('italic').setFontColor(PH.COLORS.MUTED).setWrap(false);
  sh.getRange(3, 1).setValue('Skor = 100 − [(KRITIS×' + W.W_CRIT + ' + TINGGI×' + W.W_HIGH + ' + SEDANG×' + W.W_MED +
    ') ÷ jumlah baris × 100] · RED = ada KRITIS · AMBER = ada TINGGI/SEDANG · GREEN = semua AMAN (sama dengan DASHBOARD)')
    .setFontSize(9).setFontStyle('italic').setFontColor(PH.COLORS.MUTED).setWrap(false);

  let r = 5;

  // ----- Kartu KPI -----
  if (periods.length) {
    const L = periods[periods.length - 1];
    const worst = L.worst[0];
    const cards = [
      { span: [1, 2], label: 'PERIODE TERBARU', value: L.label, sub: phDateRange_(L.dateFrom, L.dateTo), color: STYLE.HEADER_BG, size: 16 },
      { span: [3, 5], label: 'SKOR RATA-RATA', value: L.avg, sub: L.delta === null ? 'periode pertama' : (L.delta > 0 ? '▲ naik ' + L.delta : (L.delta < 0 ? '▼ turun ' + Math.abs(L.delta) : '▬ tidak berubah')) + (L.delta === 0 ? ' vs periode sebelumnya' : ' poin vs periode sebelumnya'), color: dashScoreColor_(L.avg), size: 22 },
      { span: [6, 8], label: 'OUTLET RED', value: L.R, sub: 'AMBER ' + L.A + ' · GREEN ' + L.G, color: L.R ? '#C62828' : '#2E7D32', size: 22 },
      { span: [9, 11], label: 'ANOMALY RATE', value: dashPct_(L.rate), sub: L.anomaly + ' dari ' + L.total + ' baris', color: STYLE.HEADER_BG, size: 22 },
      { span: [12, 14], label: 'CAKUPAN OUTLET', value: L.coverage === null ? (L.outlets + ' outlet') : dashPct_(L.coverage), sub: L.coverage === null ? '' : L.covered + ' dari ' + ctx.activeOutlets + ' outlet aktif', color: STYLE.HEADER_BG, size: 22 },
      { span: [15, 17], label: 'SKOR TERENDAH', value: worst ? worst.outlet : '-', sub: worst ? 'Skor ' + worst.score + ' · ' + worst.K + ' KRITIS · ' + worst.T + ' TINGGI' : '', color: '#C62828', size: 14 }
    ];
    cards.forEach(cd => {
      const c1 = cd.span[0], w = cd.span[1] - cd.span[0] + 1;
      sh.getRange(r, c1, 3, w).setBackground(STYLE.KPI_BG).setHorizontalAlignment('center');
      sh.getRange(r, c1, 1, w).merge().setValue(cd.label).setFontSize(9).setFontWeight('bold').setFontColor(PH.COLORS.MUTED);
      sh.getRange(r + 1, c1, 1, w).merge().setValue(cd.value).setFontSize(cd.size).setFontWeight('bold').setFontColor(cd.color).setWrap(false);
      sh.getRange(r + 2, c1, 1, w).merge().setValue(cd.sub).setFontSize(9).setFontColor(PH.COLORS.MUTED).setWrap(false);
      sh.getRange(r, c1, 3, w).setBorder(null, true, null, true, null, null, '#FFFFFF', BS.SOLID_THICK);
    });
    sh.setRowHeight(r, 20); sh.setRowHeight(r + 1, 38); sh.setRowHeight(r + 2, 20);
    r += 4;
  }

  const sectionTitle = function (row, text) {
    sh.getRange(row, 1, 1, NC).setBorder(null, null, true, null, null, null, STYLE.HEADER_BG, BS.SOLID_MEDIUM);
    sh.getRange(row, 1).setValue(text).setFontSize(12).setFontWeight('bold').setFontColor(STYLE.HEADER_BG)
      .setWrap(false).setVerticalAlignment('bottom');
    sh.setRowHeight(row, 28);
    return row + 1;
  };

  // ----- Temuan utama -----
  r = sectionTitle(r, 'TEMUAN UTAMA');
  insights.forEach(t => {
    sh.getRange(r, 1).setValue('•  ' + t).setWrap(false).setFontSize(10)
      .setFontColor(t.indexOf('⚠') === 0 ? '#7A4100' : '#222222');
    r++;
  });
  r += 1;

  // ----- Tabel ringkasan per periode -----
  r = sectionTitle(r, 'RINGKASAN PER PERIODE');
  if (!periods.length) {
    sh.getRange(r, 1).setValue('Belum ada data.').setFontStyle('italic').setFontColor(PH.COLORS.MUTED);
    if (isNew) phPlaceAfterDashboard_(ss, sh);
    return;
  }

  const labels = ['Periode', 'Tanggal SO', 'Outlet', 'Cakupan', 'Skor Rata-rata', 'Median', 'Skor Min', 'Δ Skor',
    'GREEN', 'AMBER', 'RED', 'Baris Dianalisis', 'KRITIS', 'TINGGI', 'SEDANG', 'Anomaly Rate', '3 Outlet Skor Terendah'];
  const hr = r;
  const hRange = sh.getRange(hr, 1, 1, NC);
  hRange.setNumberFormat('@').setValues([labels]);
  styleHeader(hRange);
  sh.setRowHeight(hr, 32);
  const tint = function (col, st) { sh.getRange(hr, col).setBackground(st.bg).setFontColor(st.font); };
  tint(9, HEALTH.GREEN); tint(10, HEALTH.AMBER); tint(11, HEALTH.RED);
  tint(13, RISK.CRITICAL); tint(14, RISK.HIGH); tint(15, RISK.MEDIUM);

  const data = periods.map(p => [
    p.label, phDateRange_(p.dateFrom, p.dateTo), p.outlets, p.coverage === null ? '' : p.coverage,
    p.avg, p.median, p.min, p.delta === null ? '–' : p.delta,
    p.G, p.A, p.R, p.total, p.K, p.T, p.S, p.rate,
    p.worst.map(c => c.outlet + ' (' + c.score + ')').join(' · ')
  ]);
  const n = data.length;
  sh.getRange(hr + 1, 1, n, 2).setNumberFormat('@');
  sh.getRange(hr + 1, 4, n, 1).setNumberFormat('0%');
  sh.getRange(hr + 1, 5, n, 3).setNumberFormat('0.0');
  sh.getRange(hr + 1, 8, n, 1).setNumberFormat('+0.0;-0.0;0.0');
  sh.getRange(hr + 1, 16, n, 1).setNumberFormat('0.0%');
  const body = sh.getRange(hr + 1, 1, n, NC);
  body.setValues(data).setFontSize(10).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, PH.COLORS.GRID, BS.SOLID);
  sh.getRange(hr + 1, 3, n, NC - 3).setHorizontalAlignment('center');
  sh.getRange(hr + 1, 17, n, 1).setHorizontalAlignment('left').setFontSize(9);
  for (let i = 1; i < n; i += 2) sh.getRange(hr + 1 + i, 1, 1, NC).setBackground(PH.COLORS.ZEBRA);

  // Warna per baris: skor, delta, jumlah RED
  for (let i = 0; i < n; i++) {
    const p = periods[i], row = hr + 1 + i;
    sh.getRange(row, 5).setFontColor(dashScoreColor_(p.avg)).setFontWeight('bold');
    if (p.delta !== null) sh.getRange(row, 8).setFontColor(p.delta > 0 ? PH.COLORS.UP : (p.delta < 0 ? PH.COLORS.DOWN : PH.COLORS.FLAT)).setFontWeight('bold');
    if (p.R > 0) sh.getRange(row, 11).setFontColor(HEALTH.RED.font).setBackground(HEALTH.RED.bg).setFontWeight('bold');
  }
  sh.getRange(hr + n, 1, 1, 2).setFontWeight('bold');     // periode terbaru ditebalkan
  r = hr + n + 2;

  // ----- Grafik -----
  r = sectionTitle(r, 'TREN KESEHATAN');
  sh.getRange(r, 1).setValue('Skor rata-rata dan sebaran status outlet pada tiap periode.')
    .setFontSize(9).setFontStyle('italic').setFontColor(PH.COLORS.MUTED).setWrap(false);
  r++;

  const lineChart = sh.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sh.getRange(hr, 1, n + 1, 1))
    .addRange(sh.getRange(hr, 5, n + 1, 1))
    .setNumHeaders(1)
    .setOption('title', 'Skor Kesehatan Rata-rata per Periode')
    .setOption('legend', { position: 'none' })
    .setOption('colors', [PH.COLORS.BLN_HEAD])
    .setOption('pointSize', 6)
    .setOption('lineWidth', 3)
    .setOption('vAxis', { minValue: 0, maxValue: 100, viewWindow: { min: 0, max: 100 } })
    .setOption('width', 640).setOption('height', 300)
    .setPosition(r, 1, 0, 0)
    .build();
  sh.insertChart(lineChart);

  const stackChart = sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(hr, 1, n + 1, 1))
    .addRange(sh.getRange(hr, 9, n + 1, 3))
    .setNumHeaders(1)
    .setOption('title', 'Sebaran Status Outlet per Periode')
    .setOption('isStacked', true)
    .setOption('legend', { position: 'bottom' })
    .setOption('colors', ['#2E7D32', '#EF6C00', '#C62828'])
    .setOption('width', 640).setOption('height', 300)
    .setPosition(r, 8, 0, 0)
    .build();
  sh.insertChart(stackChart);

  if (isNew) phPlaceAfterDashboard_(ss, sh);
}

// ============================================================
//  SHEET HEALTH_DETAIL (TABEL PANJANG)
// ============================================================

function phWriteDetail_(ss, cells) {
  const headers = ['Bulan', 'Periode', 'Tanggal SO', 'Outlet', 'Baris', 'KRITIS', 'TINGGI', 'SEDANG', 'AMAN',
    'Anomaly Rate', 'Skor', 'Status', 'Δ Skor', 'Tren', 'SKU Berulang', 'SKU Teratas'];
  const widths = [75, 70, 100, 260, 65, 65, 65, 65, 65, 90, 60, 75, 70, 105, 95, 430];
  const NC = headers.length;

  const existed = !!ss.getSheetByName(PH.SHEET_DETAIL);
  const sh = ensureSheet(PH.SHEET_DETAIL, headers, widths);
  if (!existed) { sh.setTabColor(PH.COLORS.TAB); phPlaceAfterDashboard_(ss, sh); }

  const flt = sh.getFilter();
  if (flt) flt.remove();
  clearBody(sh, NC);

  const list = Array.from(cells.values()).sort((a, b) =>
    (b.order - a.order) || (a.score - b.score) || (b.K - a.K) || a.outlet.localeCompare(b.outlet));

  const data = list.map(c => [
    c.ym, c.slot, c.dateKey || '', c.outlet, c.total, c.K, c.T, c.S, c.A, c.rate, c.score, c.health.label,
    (c.delta === null || c.delta === undefined) ? '' : c.delta, phTrendText_(c.trend), c.recurring,
    c.topSkus.map(s => s.sku + (s.item ? ' – ' + s.item : '')).join(' | ')
  ]);
  const n = data.length;

  const rules = [];
  if (n) {
    if (sh.getMaxRows() < n + 1) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());
    sh.getRange(2, 1, n, 3).setNumberFormat('@');
    sh.getRange(2, 10, n, 1).setNumberFormat('0.0%');
    sh.getRange(2, 13, n, 1).setNumberFormat('+0;-0;0');
    writeInBatches(sh, data, NC);

    const all = sh.getRange(2, 1, n, NC);
    all.setFontFamily(STYLE.FONT).setFontSize(10).setVerticalAlignment('middle');
    sh.getRange(2, 1, n, 3).setHorizontalAlignment('center');
    sh.getRange(2, 5, n, 12).setHorizontalAlignment('center');
    sh.getRange(2, 16, n, 1).setHorizontalAlignment('left').setFontSize(9);
    sh.getRange(1, 1, n + 1, NC).createFilter();

    const rowsToCover = Math.max(sh.getMaxRows() - 1, 1);
    const statusRg = sh.getRange(2, 12, rowsToCover, 1);
    [HEALTH.RED, HEALTH.AMBER, HEALTH.GREEN].forEach(h => rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(h.label).setBackground(h.bg).setFontColor(h.font).setBold(true).setRanges([statusRg]).build()));
    const trendRg = sh.getRange(2, 14, rowsToCover, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('▲').setFontColor(PH.COLORS.UP).setBold(true).setRanges([trendRg]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('▼').setFontColor(PH.COLORS.DOWN).setBold(true).setRanges([trendRg]).build());
    const scoreRg = sh.getRange(2, 11, rowsToCover, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(DASH_CFG.HEALTH_GOOD).setFontColor('#2E7D32').setBold(true).setRanges([scoreRg]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(DASH_CFG.HEALTH_WARN, DASH_CFG.HEALTH_GOOD - 0.0001).setFontColor('#EF6C00').setBold(true).setRanges([scoreRg]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(DASH_CFG.HEALTH_WARN).setFontColor('#C62828').setBold(true).setRanges([scoreRg]).build());
  }
  sh.setConditionalFormatRules(rules);
  return n;
}

// ============================================================
//  UJI MANDIRI (jalankan dari editor Apps Script, lihat Logger)
// ============================================================

function testPeriodHealth() {
  let pass = 0, fail = 0;
  const eq = function (name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++; else fail++;
    Logger.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : ' | dapat=' + JSON.stringify(got) + ' seharusnya=' + JSON.stringify(want)));
  };

  const a = phParsePeriod_('2026-10-07 (MG 1)');
  eq('parse MG 1', [a.ym, a.slot, a.dateKey], ['2026-10', 'MG 1', '2026-10-07']);
  const b = phParsePeriod_('2026-10-31 (BLN)');
  eq('parse BLN', [b.ym, b.slot], ['2026-10', 'BLN']);
  eq('parse tanpa label', phParsePeriod_('2026-10-07').slot, null);
  eq('parse MG 5 tidak dipetakan', phParsePeriod_('2026-10-29 (MG 5)').slot, null);
  eq('parse kosong', phParsePeriod_('-'), null);
  eq('akhir bulan Feb 2028', phMonthEnd_('2028-02'), '2028-02-29');
  eq('label BLN', phPeriodLabel_('2026-10', 'BLN', '2026-10-31'), 'BLN · 31 Okt 2026');
  eq('tanggal panjang', phDateLong_('2026-11-30'), '30 November 2026');
  eq('kunci outlet', phOutletKey_('RSUD R.A. KARTINI  JEPARA'), phOutletKey_('rsud r.a kartini jepara'));

  // Skenario: 2 outlet, MG 1 beda tanggal, BLN serentak
  const mk = function (outlet, period, sku, risk) {
    const r = new Array(DETAIL_HEADERS.length).fill('');
    r[DC.OUTLET] = outlet; r[DC.PERIOD] = period; r[DC.SKU] = sku; r[DC.NAME] = 'Item ' + sku; r[DC.RISK] = risk;
    return r;
  };
  const rows = [
    mk('RS A', '2026-10-05 (MG 1)', 'S1', RISK.SAFE.label), mk('RS A', '2026-10-05 (MG 1)', 'S2', RISK.SAFE.label),
    mk('RS A', '2026-10-05 (MG 1)', 'S3', RISK.SAFE.label), mk('RS A', '2026-10-05 (MG 1)', 'S4', RISK.MEDIUM.label),
    mk('RS B', '2026-10-07 (MG 1)', 'S1', RISK.CRITICAL.label), mk('RS B', '2026-10-07 (MG 1)', 'S2', RISK.SAFE.label),
    mk('RS A', '2026-10-31 (BLN)', 'S4', RISK.MEDIUM.label), mk('RS A', '2026-10-31 (BLN)', 'S1', RISK.SAFE.label),
    mk('RS B', '2026-10-31 (BLN)', 'S1', RISK.SAFE.label), mk('RS B', '2026-10-31 (BLN)', 'S2', RISK.SAFE.label)
  ];
  const agg = phAggregate_(rows);
  agg.cells.forEach(phFinalizeCell_);
  phBuildTrends_(agg.cells);
  const A1 = agg.cells.get('RSA|2026-10|MG 1'), B1 = agg.cells.get('RSB|2026-10|MG 1');
  eq('skor RS A MG 1 (1 SEDANG / 4 baris)', A1.score, 94);            // 100 - 0.25/4*100 = 93.75 -> 94
  eq('status RS A = AMBER', A1.health.label, 'AMBER');
  eq('skor RS B MG 1 (1 KRITIS / 2 baris)', B1.score, 50);
  eq('status RS B = RED', B1.health.label, 'RED');
  const A2 = agg.cells.get('RSA|2026-10|BLN');
  eq('delta RS A BLN vs MG 1', A2.delta, A2.score - A1.score);
  eq('SKU berulang RS A (S4)', A2.recurring, 1);
  const periods = phBuildPeriods_(agg.cells, new Set(['RSA', 'RSB']));
  eq('jumlah periode', periods.length, 2);
  eq('periode MG 1: 2 outlet, rentang tanggal', [periods[0].outlets, periods[0].dateFrom, periods[0].dateTo], [2, '2026-10-05', '2026-10-07']);
  eq('periode BLN: tanggal serentak', periods[1].modeDate, '2026-10-31');
  eq('cakupan 100%', periods[0].coverage, 1);
  eq('insight tidak kosong', phBuildInsights_(periods, { activeOutlets: 2, unmapped: agg.unmapped, missing: [] }).length > 0, true);

  Logger.log('Hasil uji: ' + pass + ' lulus, ' + fail + ' gagal.');
  return { pass: pass, fail: fail };
}

// ============================================================
//  API UNTUK TAMPILAN WEB (index.html → tab "Kesehatan")   [BARU]
// ============================================================
//  Dipanggil lewat google.script.run dari panel Monitoring Outlet di index.html.
//   - getPeriodHealthData(opts)    : data JSON (hanya BACA; tidak menulis / membuat sheet)
//   - runPeriodHealthFromPanel()   : tombol "Bangun Ulang" -> refreshPeriodHealth() + segarkan cache
//  Kedua fungsi SELALU mengembalikan {ok:true,...} atau {ok:false,error} (tidak pernah null).

const PH_UI = {
  MAX_MONTHS: 12,        // jumlah bulan terakhir yang dikirim ke tampilan
  TOP_SKU: 3
};

/** Daftar outlet di sheet OUTLET — HANYA BACA (tidak membuat sheet seperti phReadOutletSheet_) */
function phReadOutletsReadOnly_(ss) {
  const out = [];
  const sh = ss.getSheetByName(PH.SHEET_MATRIX);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, PH.NAME_COL).getDisplayValues().forEach(function (r) {
    const name = String(r[PH.NAME_COL - 1]).trim();
    if (!name) return;
    out.push({ name: name, key: phOutletKey_(name), hari: String(r[0]).trim().toUpperCase() });
  });
  return out;
}

/** Susun model lengkap (periode, outlet, sel, temuan) dalam bentuk yang aman dikirim ke browser */
function phBuildUiModel_() {
  const ss = getActiveSS();
  const tz = ss.getSpreadsheetTimeZone();
  const rows = dashReadBody_(ss.getSheetByName(SHEET_NAMES.DETAIL), DETAIL_HEADERS.length);

  const agg = phAggregate_(rows);
  const cells = agg.cells;
  cells.forEach(phFinalizeCell_);
  phBuildTrends_(cells);

  // Outlet: urutan sheet OUTLET dulu, lalu outlet yang punya data tetapi belum ada di sheet
  const sheetOutlets = phReadOutletsReadOnly_(ss);
  const outlets = [];
  const idxByKey = {};
  sheetOutlets.forEach(function (o) {
    if (idxByKey[o.key] !== undefined) return;
    idxByKey[o.key] = outlets.length;
    outlets.push({ name: o.name, key: o.key, closed: o.hari === 'TUTUP', hari: o.hari, inSheet: true });
  });
  const missingMap = new Map();
  cells.forEach(function (c) { if (idxByKey[c.outletKey] === undefined) missingMap.set(c.outletKey, c.outlet); });
  Array.from(missingMap.entries()).sort(function (a, b) { return a[1].localeCompare(b[1]); }).forEach(function (kv) {
    idxByKey[kv[0]] = outlets.length;
    outlets.push({ name: kv[1], key: kv[0], closed: false, hari: '', inSheet: false });
  });

  const activeKeys = new Set(outlets.filter(function (o) { return !o.closed; }).map(function (o) { return o.key; }));
  const periodsFull = phBuildPeriods_(cells, activeKeys);
  const missing = Array.from(missingMap.values()).sort();
  const ctx = { activeOutlets: activeKeys.size, unmapped: agg.unmapped, missing: sheetOutlets.length ? missing : [] };
  const insights = phBuildInsights_(periodsFull, ctx);

  // Batasi ke N bulan terakhir agar muatan tetap kecil
  const allYm = Array.from(new Set(periodsFull.map(function (p) { return p.ym; }))).sort();
  const keepYm = new Set(allYm.slice(-PH_UI.MAX_MONTHS));
  const periods = periodsFull.filter(function (p) { return keepYm.has(p.ym); });

  const months = allYm.filter(function (ym) { return keepYm.has(ym); }).map(function (ym) {
    const bln = periodsFull.filter(function (p) { return p.ym === ym && p.slot === 'BLN'; })[0];
    const p = ym.split('-');
    return {
      ym: ym,
      label: PH_MONTHS_LONG[+p[1] - 1] + ' ' + p[0],
      short: PH_MONTHS_SHORT[+p[1] - 1] + ' ' + p[0],
      blnDate: (bln && bln.modeDate) || phMonthEnd_(ym)
    };
  });

  const num = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : null; };

  const periodsOut = periods.map(function (p) {
    return {
      key: p.key, ym: p.ym, slot: p.slot, label: panelSafe_(p.label),
      dateFrom: panelSafe_(p.dateFrom), dateTo: panelSafe_(p.dateTo), dateRange: panelSafe_(phDateRange_(p.dateFrom, p.dateTo)),
      outlets: p.outlets, covered: p.covered, coverage: num(p.coverage),
      avg: num(p.avg), median: num(p.median), min: num(p.min), delta: num(p.delta),
      G: p.G, A: p.A, R: p.R, total: p.total, K: p.K, T: p.T, S: p.S, rate: num(p.rate),
      worst: p.worst.map(function (c) { return { outlet: panelSafe_(c.outlet), score: c.score, K: c.K, T: c.T }; })
    };
  });

  const cellsOut = [];
  cells.forEach(function (c) {
    if (!keepYm.has(c.ym)) return;
    cellsOut.push({
      oi: idxByKey[c.outletKey], ym: c.ym, sl: c.slot, d: panelSafe_(c.dateKey),
      n: c.total, k: c.K, t: c.T, s: c.S, a: c.A, rate: num(c.rate),
      sc: c.score, h: c.health.label,
      dl: (c.delta === null || c.delta === undefined) ? null : c.delta,
      tr: c.trend, rc: c.recurring, rs: c.redStreak || 0, md: c.multiDate ? 1 : 0,
      top: c.topSkus.map(function (s) { return [panelSafe_(s.sku), panelSafe_(s.item), s.cls]; })
    });
  });

  const exists = function (n) { return !!ss.getSheetByName(n); };
  return {
    ok: true,
    generatedAt: Utilities.formatDate(new Date(), tz, 'dd MMM yyyy HH:mm'),
    slots: PH.SLOTS,
    months: months,
    periods: periodsOut,
    outlets: outlets.map(function (o) { return { name: panelSafe_(o.name), closed: o.closed, hari: panelSafe_(o.hari), inSheet: o.inSheet }; }),
    cells: cellsOut,
    insights: insights.map(panelSafe_),
    unmapped: { rows: agg.unmapped.rows, samples: agg.unmapped.samples.map(panelSafe_) },
    missing: missing.slice(0, 20).map(panelSafe_),
    activeOutlets: activeKeys.size,
    cfg: {
      good: DASH_CFG.HEALTH_GOOD, warn: DASH_CFG.HEALTH_WARN,
      wCrit: DASH_CFG.W_CRIT, wHigh: DASH_CFG.W_HIGH, wMed: DASH_CFG.W_MED,
      trendDelta: PH.TREND_DELTA, matrixMonths: PH.MATRIX_MONTHS
    },
    sheets: {
      OUTLET: exists(PH.SHEET_MATRIX), HEALTH_PERIODE: exists(PH.SHEET_SUMMARY), HEALTH_DETAIL: exists(PH.SHEET_DETAIL)
    }
  };
}

/**
 * Data untuk tab "Kesehatan" di index.html.
 * @param {Object} opts { force: true } = abaikan cache dan baca ulang MONITORING_DETAIL
 */
function getPeriodHealthData(opts) {
  try {
    opts = opts || {};
    const name = 'PH_UI_' + tblVersion_();
    if (!opts.force) {
      const hit = tblCacheGet_(name);
      if (hit && hit.ok) { hit.cached = true; return hit; }
    }
    const model = phBuildUiModel_();
    tblCachePut_(name, model);
    model.cached = false;
    return model;
  } catch (e) {
    Logger.log('getPeriodHealthData gagal: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Tombol "Bangun Ulang Sheet": tulis ulang OUTLET (matrix), HEALTH_PERIODE dan HEALTH_DETAIL
 * dari MONITORING_DETAIL, lalu segarkan cache tampilan.
 */
function runPeriodHealthFromPanel() {
  try {
    const p = getProgress();
    if (p && p.running) {
      return { ok: false, error: 'Analisis lengkap sedang berjalan (' + p.stage + '). Tunggu selesai, lalu coba lagi.' };
    }
    getConfig(true);
    const s = refreshPeriodHealth();
    invalidateTableCache_();
    return {
      ok: true,
      stats: {
        periods: s.periods, outlets: s.outlets, detailRows: s.detailRows,
        unmappedRows: s.unmappedRows, missingOutlets: s.missingOutlets,
        shownMonths: (s.shownMonths || []).map(String)
      }
    };
  } catch (e) {
    appendRunLog_('Kesehatan Periode GAGAL', e.message);
    return { ok: false, error: e.message };
  }
}