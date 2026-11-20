/**
 * ============================================================
 *  AnomalyDetection.gs — Filtering SKU, rekonsiliasi, MAD, Risk Level
 * ============================================================
 *  Alur per outlet:
 *   1. filterActiveSkus()  -> hanya SKU yang ada di sheet TOLERANCE
 *   2. reconcileSku()      -> Selisih_Raw, Net_Selisih per tanggal SO
 *   3. computeMadScore()   -> skor statistik (Robust Z-Score / MAD)
 *   4. classifyRisk()      -> KRITIS / TINGGI / SEDANG / AMAN
 */

/**
 * White-List: ambil hanya SKU yang terdaftar di TOLERANCE dan ada di kedua sumber.
 * SKU yang tidak terdaftar dianggap item pasif -> DIABAIKAN.
 */
function filterActiveSkus(invItems, soItems, toleranceMap) {
  const active = [];
  toleranceMap.forEach((tolInfo, sku) => {
    const inv = invItems.get(sku);
    const so = soItems.get(sku);
    if (inv && so) active.push({ sku: sku, tolInfo: tolInfo, inv: inv, so: so });
  });

  // Hitung SKU yang diabaikan (untuk informasi log saja)
  const ignored = new Set();
  invItems.forEach((_, sku) => { if (!toleranceMap.has(sku)) ignored.add(sku); });
  soItems.forEach((_, sku) => { if (!toleranceMap.has(sku)) ignored.add(sku); });

  return { active: active, ignoredCount: ignored.size };
}

/**
 * Net_Selisih = bagian selisih yang berada DI LUAR toleransi (tanda + / - dipertahankan).
 *   |raw| <= tol  -> 0
 *   raw = 12, tol = 4  -> 8
 *   raw = -9, tol = 4  -> -5
 */
function calcNetSelisih(raw, tolerance) {
  const abs = Math.abs(raw);
  if (abs <= tolerance) return 0;
  return round((raw > 0 ? 1 : -1) * (abs - tolerance), 4);
}

/**
 * Rekonsiliasi satu SKU di semua tanggal SO.
 * Selisih_Raw = SO_DataSO (fisik) - SO_InvenMove (stok sistem / Ending).
 */
function reconcileSku(entry) {
  const cfg = getConfig();
  const tol = entry.tolInfo.tolerance;
  const records = [];

  Object.keys(entry.so.byDate).sort().forEach(dateKey => {
    const soVal = entry.so.byDate[dateKey];
    const invVal = entry.inv.byDate[dateKey];
    if (!invVal) return;                                          // tidak ada pembanding
    if (invVal.source === 'SO' && !cfg.INCLUDE_BASELINE_SO) return; // kolom SO awal dilewati

    const raw = round(soVal.qty - invVal.qty, 4);
    records.push({
      dateKey: dateKey,
      label: soVal.label,
      soQty: soVal.qty,
      invQty: invVal.qty,
      soUnit: soVal.unit,
      raw: raw,
      tol: tol,
      net: calcNetSelisih(raw, tol)
    });
  });
  return records;
}

// ---------- Statistik ringan (Apps Script murni) ----------

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/**
 * Skor MAD (Modified Z-Score / Robust Z-Score):
 *     score = 0.6745 * |x - median| / MAD
 * - History = selisih SKU yang sama di periode LAIN (leave-one-out),
 *   sehingga lonjakan hari ini tidak ikut "menormalkan" dirinya sendiri.
 * - Jika MAD = 0 (histori sangat stabil) -> pakai Mean Absolute Deviation.
 * - Jika histori sama persis dan nilai baru berbeda -> skor = MAD_CAP.
 * - Histori < MIN_HISTORY -> skor 0 (belum cukup data).
 */
function computeMadScore(value, history) {
  const cfg = getConfig();
  if (history.length < cfg.MIN_HISTORY) return { score: 0, enough: false };

  const med = median(history);
  const devs = history.map(h => Math.abs(h - med));
  const mad = median(devs);
  const diff = Math.abs(value - med);

  let score;
  if (mad > 0) {
    score = 0.6745 * diff / mad;
  } else {
    const meanAd = mean(devs);
    if (meanAd > 0) score = diff / (1.253314 * meanAd);
    else score = diff > 0 ? cfg.MAD_CAP : 0;
  }
  return { score: Math.min(score, cfg.MAD_CAP), enough: true };
}

/**
 * Tentukan Risk Level + jenis anomali + alasan.
 *  KRITIS : stok Ending negatif, ATAU di luar toleransi & MAD > MAD_CRITICAL
 *  TINGGI : di luar toleransi & MAD > MAD_HIGH
 *  SEDANG : di luar toleransi (skor MAD rendah / histori belum cukup)
 *  AMAN   : dalam toleransi
 */
/**
 * Tentukan Risk Level + jenis anomali + alasan.
 *  KRITIS : stok Ending negatif DAN di luar toleransi (|stok| > tol),
 *           ATAU di luar toleransi & MAD > MAD_CRITICAL
 *  TINGGI : di luar toleransi & MAD > MAD_HIGH
 *  SEDANG : di luar toleransi (skor MAD rendah / histori belum cukup)
 *  AMAN   : dalam toleransi
 *  Stok negatif yang masih dalam toleransi -> level mengikuti NEGATIVE_WITHIN_TOL_RISK
 *  (default SAFE), tetap dicatat di alasan.
 */
function classifyRisk(rec, mad, unit) {
  const cfg = getConfig();
  const tol = rec.tol;
  const negative = rec.invQty < 0;
  const negativeSignificant = negative && Math.abs(rec.invQty) > tol;   // di luar toleransi
  const negativeMinor = negative && !negativeSignificant;               // dalam toleransi
  const outside = rec.net !== 0;
  const reasons = [];

  if (negativeSignificant) {
    reasons.push('Stok akhir Inventory Movement NEGATIF (' + rec.invQty + '), melebihi toleransi ±' + tol);
  } else if (negativeMinor) {
    reasons.push('Stok akhir Inventory Movement negatif (' + rec.invQty + ') namun masih dalam toleransi ±' + tol);
  }
  if (outside) {
    const arah = rec.raw > 0
      ? 'stok fisik LEBIH BANYAK dari sistem'
      : 'stok fisik LEBIH SEDIKIT dari sistem';
    reasons.push('Selisih ' + rec.raw + ' ' + unit + ' (' + arah + '), melebihi toleransi ±' +
      tol + ' sebesar ' + Math.abs(rec.net));
    if (!mad.enough) reasons.push('histori belum cukup untuk skor MAD');
    else reasons.push('skor MAD ' + round(mad.score, 2));
  }
  if (rec.soUnit && unit && rec.soUnit !== unit) {
    reasons.push('satuan DataSO (' + rec.soUnit + ') berbeda dengan master (' + unit + ')');
  }

  // --- Level risiko ---
  let risk = RISK.SAFE;
  if (negativeSignificant || (outside && mad.score > cfg.MAD_CRITICAL)) {
    risk = RISK.CRITICAL;
  } else if (outside && mad.score > cfg.MAD_HIGH) {
    risk = RISK.HIGH;
  } else if (outside) {
    risk = RISK.MEDIUM;
  }

  // Stok negatif kecil (dalam toleransi): naikkan level minimal sesuai konfigurasi
  if (negativeMinor) {
    const map = { SAFE: RISK.SAFE, MEDIUM: RISK.MEDIUM, HIGH: RISK.HIGH };
    const floor = map[String(cfg.NEGATIVE_WITHIN_TOL_RISK).toUpperCase()] || RISK.SAFE;
    if (floor.rank > risk.rank) risk = floor;
  }

  // --- Jenis anomali ---
  let type = '';
  if (negativeSignificant) type = 'STOK NEGATIF';
  else if (outside && mad.score > cfg.MAD_HIGH) type = 'LONJAKAN SELISIH (STATISTIK)';
  else if (outside) type = 'SELISIH DI LUAR TOLERANSI';
  else if (negativeMinor && risk !== RISK.SAFE) type = 'STOK NEGATIF (DALAM TOLERANSI)';

  if (!reasons.length || risk === RISK.SAFE) {
    reasons.unshift('Selisih ' + rec.raw + ' masih dalam toleransi ±' + tol);
  }
  return { risk: risk, type: type, reason: reasons.join('; ') };
}

/** ID alert tetap sama untuk kombinasi outlet|periode|SKU|jenis (agar status tidak hilang saat re-run) */
function makeAlertId(key) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key, Utilities.Charset.UTF_8);
  const hex = digest.slice(0, 5).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  return 'ALT-' + hex.toUpperCase();
}

/**
 * Analisis lengkap 1 outlet.
 * Return: { detailRows, alerts, stats }
 */
function analyzeOutlet(outlet, invItems, soItems, toleranceMap) {
  const now = new Date();
  const detailRows = [];
  const alerts = [];

  const filtered = filterActiveSkus(invItems, soItems, toleranceMap);

  filtered.active.forEach(entry => {
    const records = reconcileSku(entry);

    records.forEach((rec, i) => {
      // Histori = selisih mentah di periode lain untuk outlet + SKU yang sama
      const history = records.filter((_, j) => j !== i).map(r => r.raw);
      const mad = computeMadScore(rec.raw, history);

      const unit = entry.inv.unit;
      const cls = classifyRisk(rec, mad, unit);
      const period = buildPeriodLabel(rec.dateKey, rec.label);
      const name = entry.inv.name || entry.tolInfo.name;
      const isSafe = cls.risk === RISK.SAFE;

      detailRows.push([
        now, outlet, period, entry.sku, name, entry.inv.category, unit,
        rec.soQty, rec.invQty, rec.raw, rec.tol, rec.net,
        round(mad.score, 2), cls.risk.label, cls.reason,
        isSafe ? STATUS.OK : STATUS.CHECK
      ]);

      if (!isSafe) {
        alerts.push([
          makeAlertId([outlet, rec.dateKey, entry.sku, cls.type].join('|')),
          now, outlet, entry.sku, name, period,
          cls.risk.label, cls.type, cls.reason, 'OPEN'
        ]);
      }
    });
  });

  return {
    detailRows: detailRows,
    alerts: alerts,
    stats: { activeSkus: filtered.active.length, ignoredSkus: filtered.ignoredCount }
  };
}