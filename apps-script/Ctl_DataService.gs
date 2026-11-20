/**
 * ============================================================
 *  DataService.gs — Membaca data (batch getValues untuk performa)
 * ============================================================
 *  Struktur sumber data:
 *  - Inventory Movement : baris 1 = tanggal (blok per hari), baris 2 = header
 *                         kolom (SO / Production_IC / ... / Ending), data mulai baris 3.
 *  - DataSO_IC          : baris 1 = header tanggal "MG 1 : Selasa, 8 September 2026",
 *                         data mulai baris 2, nilai berupa "60 PACK".
 *  Kedua spreadsheet punya tab outlet dengan NAMA YANG SAMA.
 */

/** Buka kedua spreadsheet sumber berdasarkan ID di CONFIG */
function getSourceSpreadsheets() {
  const cfg = getConfig();
  try {
    return {
      inv: SpreadsheetApp.openById(cfg.INVENTORY_SS_ID),
      so: SpreadsheetApp.openById(cfg.DATASO_SS_ID)
    };
  } catch (e) {
    throw new Error('Gagal membuka spreadsheet sumber. Pastikan ID di sheet CONFIG benar ' +
      'dan akun Anda punya akses ke kedua file. Detail: ' + e.message);
  }
}

/** Daftar tab outlet yang ada di KEDUA spreadsheet -> [{tabName, outlet}] */
function listOutletTabs(sources) {
  const cfg = getConfig();
  const prefix = String(cfg.OUTLET_TAB_PREFIX || '').toLowerCase();
  const soNames = new Set(sources.so.getSheets().map(s => s.getName()));

  const result = [];
  sources.inv.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (name.toLowerCase().indexOf(prefix) !== 0) return;  // bukan tab outlet
    if (!soNames.has(name)) {
      Logger.log('⚠️ Tab "' + name + '" tidak ada di DataSO_IC, dilewati.');
      return;
    }
    result.push({ tabName: name, outlet: outletNameFromTab(name, cfg.OUTLET_TAB_PREFIX) });
  });
  return result;
}

/**
 * Baca sheet TOLERANCE (White-List SKU aktif).
 * Return Map: SKU -> { sku, name, tolerance }. Tolerance kosong = 0.
 */
function readToleranceMap() {
  const map = new Map();
  const sheet = getActiveSS().getSheetByName(SHEET_NAMES.TOLERANCE);
  if (!sheet || sheet.getLastRow() < 2) return map;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(row => {
    const sku = normalizeSku(row[0]);
    if (!sku) return;
    const tol = parseQuantity(row[2]);
    map.set(sku, {
      sku: sku,
      name: String(row[1]).trim(),
      tolerance: tol === null ? 0 : Math.abs(tol)
    });
  });
  return map;
}

/**
 * Baca satu tab Inventory Movement.
 * Return Map: SKU -> { sku, name, category, unit, byDate: { 'yyyy-MM-dd': {qty, source} } }
 *   source = 'ENDING' (stok akhir hari itu) atau 'SO' (kolom SO awal)
 */
function readInventoryMovement(sheet, tz) {
  const cfg = getConfig();
  const values = sheet.getDataRange().getValues();
  const dateRow = values[cfg.INV_DATE_ROW - 1] || [];
  const headRow = values[cfg.INV_HEADER_ROW - 1] || [];

  // 1) Cari blok tanggal. Sel tanggal yang di-merge hanya terisi di kolom pertama,
  //    jadi sebuah blok berlangsung sampai ketemu tanggal berikutnya.
  const blocks = [];
  for (let c = cfg.INV_FIRST_VALUE_COL - 1; c < dateRow.length; c++) {
    const key = parseDateToKey(dateRow[c], tz);
    if (key) blocks.push({ dateKey: key, start: c, end: dateRow.length, endingCol: -1, soCol: -1 });
  }
  blocks.forEach((b, i) => { if (i < blocks.length - 1) b.end = blocks[i + 1].start; });

  // 2) Di tiap blok, tentukan kolom "Ending" dan kolom "SO"
  blocks.forEach(b => {
    for (let c = b.start; c < b.end; c++) {
      const h = normalizeText(headRow[c]);
      if (h.indexOf('ending') >= 0 && b.endingCol < 0) b.endingCol = c;
      else if (h === 'so' && b.soCol < 0) b.soCol = c;
    }
  });

  // 3) Baca baris per SKU
  const items = new Map();
  for (let r = cfg.INV_FIRST_DATA_ROW - 1; r < values.length; r++) {
    const row = values[r];
    const sku = normalizeSku(row[0]);
    if (!sku) continue;

    const byDate = {};
    blocks.forEach(b => {
      if (b.endingCol >= 0) {
        const q = parseQuantity(row[b.endingCol]);
        if (q !== null) byDate[b.dateKey] = { qty: q, source: 'ENDING' };
      } else if (b.soCol >= 0) {
        const q = parseQuantity(row[b.soCol]);
        if (q !== null) byDate[b.dateKey] = { qty: q, source: 'SO' };
      }
    });

    items.set(sku, {
      sku: sku,
      name: String(row[1]).trim(),
      category: String(row[2]).trim(),
      unit: normalizeUnit(row[3]),
      byDate: byDate
    });
  }
  return items;
}

/**
 * Baca satu tab DataSO_IC.
 * Return Map: SKU -> { sku, name, byDate: { 'yyyy-MM-dd': {qty, label, unit} } }
 * Sel kosong dianggap "belum di-SO" (bukan 0), jadi tidak dibandingkan.
 */
function readDataSO(sheet, tz) {
  const cfg = getConfig();
  const values = sheet.getDataRange().getValues();
  const headRow = values[cfg.SO_HEADER_ROW - 1] || [];

  // Kolom tanggal SO
  const cols = [];
  for (let c = cfg.SO_FIRST_VALUE_COL - 1; c < headRow.length; c++) {
    const info = parseSoHeader(headRow[c], tz);
    if (info) cols.push({ col: c, dateKey: info.dateKey, label: info.label });
  }

  const items = new Map();
  for (let r = cfg.SO_FIRST_DATA_ROW - 1; r < values.length; r++) {
    const row = values[r];
    const sku = normalizeSku(row[0]);
    if (!sku) continue;

    const byDate = {};
    cols.forEach(info => {
      const raw = row[info.col];
      const q = parseQuantity(raw);
      if (q !== null) byDate[info.dateKey] = { qty: q, label: info.label, unit: extractUnit(raw) };
    });
    items.set(sku, { sku: sku, name: String(row[1]).trim(), byDate: byDate });
  }
  return items;
}