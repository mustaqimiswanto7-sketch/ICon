/**
 * ============================================================
 *  Normalize.gs — Pembersihan teks, satuan, angka, dan tanggal
 * ============================================================
 */

// Peta bulan (3 huruf pertama) -> nomor bulan. Mendukung Indonesia & Inggris.
const MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, ags: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12
};

/** SKU: trim + huruf besar, agar "bb0046 " sama dengan "BB0046" */
function normalizeSku(value) {
  return String(value === null || value === undefined ? '' : value).trim().toUpperCase();
}

/** Teks umum: huruf kecil, spasi ganda dirapikan (untuk membandingkan header) */
function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Satuan: "pcs." -> "PCS" */
function normalizeUnit(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[.\s]+/g, '').toUpperCase();
}

/**
 * Ubah teks kuantitas menjadi angka.
 *   "60 PACK"   -> 60
 *   "129,5 PCS" -> 129.5
 *   "1.234,5"   -> 1234.5
 *   "8 PCS."    -> 8
 *   ""          -> null  (kosong = tidak ada data)
 */

// ============================================================
//  KUANTITAS
// ============================================================

// Gaya default jika kolom tidak punya bukti apa pun:
//   'ID' = titik ribuan, koma desimal  (4.968 -> 4968, 4,968 -> 4.968)
//   'EN' = koma ribuan, titik desimal  (4,968 -> 4968, 4.968 -> 4.968)
const DEFAULT_NUMBER_STYLE = 'ID';

/**
 * Analisis satu token angka (mis. "1.234,5").
 * Return { value, style, ambiguous }
 *   style     : 'ID' | 'EN' | null (bukti gaya penulisan yang ditemukan)
 *   ambiguous : true jika hasil bergantung pada gaya (mis. "4.968")
 */
function analyzeNumberToken(token, style) {
  const neg = token.charAt(0) === '-';
  let t = token.replace(/^-/, '').replace(/[.,]+$/, '');   // buang tanda & pemisah di ujung
  const dots = (t.match(/\./g) || []).length;
  const commas = (t.match(/,/g) || []).length;

  const out = function (str, ev, amb) {
    const v = parseFloat(str);
    return { value: isNaN(v) ? null : (neg ? -v : v), style: ev, ambiguous: !!amb };
  };

  // Dua jenis pemisah: yang paling kanan adalah desimal
  if (dots && commas) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) {
      return out(t.replace(/\./g, '').replace(',', '.'), 'ID', false);   // 1.234,5
    }
    return out(t.replace(/,/g, ''), 'EN', false);                       // 1,234.5
  }

  // Pemisah berulang pasti ribuan
  if (dots > 1) return out(t.replace(/\./g, ''), 'ID', false);          // 1.234.567
  if (commas > 1) return out(t.replace(/,/g, ''), 'EN', false);         // 1,234,567

  // Tanpa pemisah
  if (!dots && !commas) return out(t, null, false);

  // Tepat satu pemisah
  const sep = dots ? '.' : ',';
  const parts = t.split(sep);
  const intPart = parts[0];
  const fracPart = parts[1];

  // Ambigu hanya jika: 1-3 digit di depan (tidak diawali 0) dan tepat 3 digit di belakang
  const isAmbiguous = fracPart.length === 3 && /^[1-9]\d{0,2}$/.test(intPart);

  if (!isAmbiguous) {
    // Pasti desimal (mis. 4.5, 0.968, 1234.567, 129,5)
    return out(intPart + '.' + fracPart, sep === ',' ? 'ID' : 'EN', false);
  }

  // Ambigu: tentukan dari gaya kolom, lalu gaya default
  const effective = style || DEFAULT_NUMBER_STYLE;
  const sepIsDecimal = (effective === 'ID') ? (sep === ',') : (sep === '.');
  return out(sepIsDecimal ? intPart + '.' + fracPart : intPart + fracPart, null, true);
}

/**
 * Deteksi gaya angka sebuah kolom dari kumpulan nilai (hanya yang bertipe teks).
 * Return 'ID', 'EN', atau null jika tidak ada bukti / seimbang.
 */
function detectNumberStyle(values) {
  let id = 0, en = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'string') continue;
    const m = v.match(/-?\d[\d.,]*/);
    if (!m) continue;
    const a = analyzeNumberToken(m[0], null);
    if (a.style === 'ID') id++;
    else if (a.style === 'EN') en++;
  }
  if (id > en) return 'ID';
  if (en > id) return 'EN';
  return null;
}

/**
 * Detail hasil parse (untuk logging/audit nilai ambigu).
 * Return { value, ambiguous }
 */
function parseQuantityInfo(value, style) {
  if (value === null || value === undefined || value === '') return { value: null, ambiguous: false };
  if (typeof value === 'number') return { value: isNaN(value) ? null : value, ambiguous: false };
  if (value instanceof Date) return { value: null, ambiguous: false };

  const match = String(value).match(/-?\d[\d.,]*/);
  if (!match) return { value: null, ambiguous: false };

  const a = analyzeNumberToken(match[0], style);
  return { value: a.value, ambiguous: a.ambiguous };
}

/**
 * Ubah teks kuantitas menjadi angka.
 * @param value  isi sel
 * @param style  (opsional) 'ID' | 'EN' hasil detectNumberStyle() untuk kolom tersebut
 *   "60 PACK"   -> 60
 *   "129,5 PCS" -> 129.5
 *   "1.234,5"   -> 1234.5
 *   "0.968"     -> 0.968
 *   "4.968"     -> 4968 (style ID) / 4.968 (style EN)
 */
function parseQuantity(value, style) {
  return parseQuantityInfo(value, style).value;
}

/** Ambil satuan dari teks kuantitas: "60 PACK" -> "PACK" (kosong jika tidak ada) */
function extractUnit(value) {
  if (typeof value !== 'string') return '';
  const m = value.match(/-?\d[\d.,]*\s*(.*)$/);
  return m ? normalizeUnit(m[1]) : '';
}

/** Pembulatan aman untuk selisih desimal (hindari 0.30000000004) */
function round(n, digits) {
  const f = Math.pow(10, digits === undefined ? 4 : digits);
  return Math.round(n * f) / f;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Susun kunci tanggal "yyyy-MM-dd" (null jika tidak valid) */
function buildDateKey(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return y + '-' + pad2(m) + '-' + pad2(d);
}

/**
 * Ubah sel tanggal menjadi kunci "yyyy-MM-dd".
 * Mendukung objek Date, "30/09/26", "1/10/2026", dan "2026-10-01".
 */
function parseDateToKey(value, tz) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  const s = String(value).trim();

  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);        // yyyy-mm-dd
  if (m) return buildDateKey(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);          // dd/mm/yy(yy)
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    return buildDateKey(year, +m[2], +m[1]);
  }
  return null;
}

/**
 * Parse header DataSO_IC, contoh:
 *   "MG 1 : Selasa, 8 September 2026" -> { dateKey: '2026-09-08', label: 'MG 1' }
 *   "BLN : Rabu, 30 September 2026"   -> { dateKey: '2026-09-30', label: 'BLN' }
 */
function parseSoHeader(value, tz) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    const key = parseDateToKey(value, tz);
    return key ? { dateKey: key, label: '' } : null;
  }
  const s = String(value).replace(/\s+/g, ' ').trim();
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;

  const month = MONTH_MAP[m[2].toLowerCase().substring(0, 3)];
  if (!month) return null;

  const dateKey = buildDateKey(+m[3], month, +m[1]);
  if (!dateKey) return null;

  const colon = s.indexOf(':');
  return { dateKey: dateKey, label: colon > 0 ? s.substring(0, colon).trim() : '' };
}

/** Label periode untuk tampilan: "2026-10-07 (MG 1)" */
function buildPeriodLabel(dateKey, label) {
  return label ? dateKey + ' (' + label + ')' : dateKey;
}

/** Nama outlet dari nama tab: "Link SO / RSUD SLEMAN" -> "RSUD SLEMAN" */
function outletNameFromTab(tabName, prefix) {
  let name = String(tabName).trim();
  if (prefix && name.toLowerCase().indexOf(String(prefix).toLowerCase()) === 0) {
    name = name.substring(String(prefix).length);
  }
  return name.replace(/^[\s\/\-:]+/, '').trim() || String(tabName).trim();
}