/**
 * ============================================================
 *  Diagnostic.gs — Diagnosa kenapa jumlah SKU yang dianalisis berbeda
 * ============================================================
 *  Hasil ditulis ke sheet DIAGNOSA_SKU: [Outlet, SKU, Nama Item, Masalah, Detail]
 *  Tidak mengubah data analisis apa pun.
 */

const DIAG_SHEET = 'DIAGNOSA_SKU';
const DIAG_HEADERS = ['Outlet', 'SKU', 'Nama Item (TOLERANCE)', 'Masalah', 'Detail'];

function diagnoseSkuCoverage() {
  const startTime = new Date();
  getConfig(true);
  const rows = [];

  // ---------- 1) Cek sheet TOLERANCE (baris mentah) ----------
  const tolSheet = getActiveSS().getSheetByName(SHEET_NAMES.TOLERANCE);
  if (!tolSheet || tolSheet.getLastRow() < 2) throw new Error('Sheet TOLERANCE kosong.');
  const raw = tolSheet.getRange(2, 1, tolSheet.getLastRow() - 1, 3).getValues();

  let blankCount = 0;
  const seen = new Map();   // SKU -> nomor baris pertama
  raw.forEach((r, i) => {
    const sku = normalizeSku(r[0]);
    const rowNo = i + 2;
    if (!sku) {
      if (String(r[1]).trim() !== '' || String(r[2]).trim() !== '') {
        blankCount++;
        rows.push(['(semua)', '', String(r[1]).trim(), 'BARIS TOLERANCE TANPA SKU', 'Baris ' + rowNo + ' tidak punya SKU, diabaikan']);
      }
      return;
    }
    if (seen.has(sku)) {
      rows.push(['(semua)', sku, String(r[1]).trim(), 'SKU DUPLIKAT DI TOLERANCE',
        'Baris ' + rowNo + ' sama dengan baris ' + seen.get(sku) + ' (hanya dihitung 1x)']);
    } else {
      seen.set(sku, rowNo);
    }
  });
  const toleranceMap = readToleranceMap();
  const rawFilled = raw.filter(r => normalizeSku(r[0]) !== '').length;

  // ---------- 2) Cek per outlet ----------
  const sources = getSourceSpreadsheets();
  const tabs = listOutletTabs(sources);
  const cfg = getConfig();
  const maxMs = cfg.MAX_RUNTIME_SECONDS * 1000;
  let totalActive = 0, outletsDone = 0;

  for (let i = 0; i < tabs.length; i++) {
    if (new Date() - startTime > maxMs) {
      rows.push(['(semua)', '', '', 'DIAGNOSA TIDAK LENGKAP', 'Batas waktu tercapai di outlet ke-' + (i + 1) + ' dari ' + tabs.length]);
      break;
    }
    const tab = tabs[i];
    showToast('(' + (i + 1) + '/' + tabs.length + ') ' + tab.outlet, '🔍 Diagnosa', 3);

    let invItems, soItems;
    try {
      invItems = readInventoryMovement(sources.inv.getSheetByName(tab.tabName), sources.inv.getSpreadsheetTimeZone());
      soItems = readDataSO(sources.so.getSheetByName(tab.tabName), sources.so.getSpreadsheetTimeZone());
    } catch (e) {
      rows.push([tab.outlet, '', '', 'GAGAL MEMBACA TAB', e.message]);
      continue;
    }

    toleranceMap.forEach((tolInfo, sku) => {
      const inv = invItems.get(sku);
      const so = soItems.get(sku);
      if (!inv && !so) {
        rows.push([tab.outlet, sku, tolInfo.name, 'TIDAK ADA DI KEDUANYA', 'SKU tidak ditemukan di Inventory Movement maupun DataSO_IC']);
        return;
      }
      if (!inv) { rows.push([tab.outlet, sku, tolInfo.name, 'TIDAK ADA DI INVENTORY MOVEMENT', 'Ada di DataSO_IC saja']); return; }
      if (!so)  { rows.push([tab.outlet, sku, tolInfo.name, 'TIDAK ADA DI DATASO_IC', 'Ada di Inventory Movement saja']); return; }

      totalActive++;
      const records = reconcileSku({ sku: sku, tolInfo: tolInfo, inv: inv, so: so });
      if (!records.length) {
        const soDates = Object.keys(so.byDate).length;
        const invDates = Object.keys(inv.byDate).length;
        rows.push([tab.outlet, sku, tolInfo.name, 'LOLOS FILTER TAPI 0 BARIS',
          'Tanggal SO terisi: ' + soDates + ', tanggal Inventory terisi: ' + invDates + ' (tidak ada tanggal yang cocok / sel SO kosong)']);
      }
    });
    outletsDone++;
  }

  // ---------- 3) Tulis ke sheet ----------
  const sheet = ensureSheet(DIAG_SHEET, DIAG_HEADERS, [230, 100, 260, 260, 520]);
  clearBody(sheet, DIAG_HEADERS.length);
  if (rows.length) {
    writeInBatches(sheet, rows, DIAG_HEADERS.length);
    sheet.getRange(2, 1, rows.length, DIAG_HEADERS.length)
      .setFontFamily(STYLE.FONT).setFontSize(10).setVerticalAlignment('middle');
    sheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
  }

  Logger.log('🔍 TOLERANCE: baris terisi ' + rawFilled + ', SKU unik ' + toleranceMap.size +
    ', baris tanpa SKU ' + blankCount + ' | Outlet dicek ' + outletsDone + ' | pasangan SKU-outlet aktif ' + totalActive +
    ' | temuan ' + rows.length);
  showToast('TOLERANCE: ' + rawFilled + ' baris terisi → ' + toleranceMap.size + ' SKU unik. ' +
    rows.length + ' temuan, lihat sheet ' + DIAG_SHEET + '.', '🔍 Diagnosa selesai', 12);
  try { getActiveSS().setActiveSheet(sheet); } catch (e) { /* spreadsheet CONTROL tidak sedang aktif di UI */ }
}