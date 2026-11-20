/**
 * ════════════════════════════════════════════════════════════════
 *  Jadwal.gs  —  Backend tab "Jadwal" (Jadwal Stock Opname)
 *  File BARU di project INVMOVE. Code.gs & file Ctl_* tidak diubah.
 *
 *  Sumber : spreadsheet "Jadwal Stock Opname", sheet "Jadwal"
 *  Layout : baris 1-6  -> judul + info tanggal per kolom (MINGGU 1..4, BULAN)
 *           baris 8    -> nama hari (SENIN ... SABTU)
 *           baris 9+   -> daftar outlet per hari (warna latar ikut dibawa)
 *
 *  Fungsi yang dipanggil dari web (index.html):
 *    getJadwalData(force)                  -> isi tampilan jadwal (kartu per hari)
 *    jadwalGetSched()                      -> data jadwal tanggal untuk jendela Generate / Edit
 *    jadwalGenerate(offset)                -> generate otomatis, 0 = bulan ini, 1 = bulan depan
 *    jadwalSimpanTanggal(tag, idx, iso)    -> ubah / hapus satu tanggal secara manual
 *
 *  Semua nama internal berawalan jd / JD_ agar TIDAK bentrok dengan Code.gs
 *  (doGet milik INVMOVE tetap dipakai; script Jadwal SO mandiri tidak lagi diperlukan).
 *
 *  Syarat: akun pemilik deployment ("Execute as") punya akses EDIT
 *  ke spreadsheet Jadwal (generate & edit menulis ke baris 2-6 sheet Jadwal).
 * ════════════════════════════════════════════════════════════════
 */

const JADWAL_SS_ID        = "1ouEACE8e6gSJ3qYLJIliQj-RiXwMRIIXQQ80mEOf8bU";
const JADWAL_SHEET_NAME   = "Jadwal";
const JADWAL_SHEET_GID    = 1421767545;   // cadangan bila nama sheet diganti
const JADWAL_CACHE_KEY    = "JADWAL_DATA_V2";
const JADWAL_CACHE_SEC    = 120;          // detik; tombol Refresh selalu melewati cache

const JADWAL_DAY_NAMES_   = ["SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU", "MINGGU"];

// ── Pengaturan generate (dari script Jadwal SO) ──
const JD_CFG = {
  SCHED_FIRST_ROW: 2,    // baris pertama teks "MINGGU 1 : ..."
  SCHED_ROWS: 5,         // MINGGU 1-4 + BULAN
  MULAI_TGL: 7,          // SO tidak dijadwalkan sebelum tanggal ini
  TZ: "Asia/Jakarta"
};
const JD_HARI      = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const JD_DOW       = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const JD_BLN       = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const JD_BLN_UP    = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
const JD_BLN_FULL  = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];


/* ═══════════════ 1. TAMPILAN JADWAL (kartu per hari) ═══════════════ */

function jd_openSheet_() {
  const ss = SpreadsheetApp.openById(JADWAL_SS_ID);
  let sheet = ss.getSheetByName(JADWAL_SHEET_NAME);
  if (!sheet) {
    const all = ss.getSheets();
    for (let i = 0; i < all.length; i++) {
      if (all[i].getSheetId() === JADWAL_SHEET_GID) { sheet = all[i]; break; }
    }
  }
  if (!sheet) {
    throw new Error("Sheet '" + JADWAL_SHEET_NAME + "' tidak ditemukan di spreadsheet Jadwal (ID: " + JADWAL_SS_ID + ").");
  }
  return { ss: ss, sheet: sheet };
}

function jd_sheet_() { return jd_openSheet_().sheet; }

/** Dipanggil dari index.html:  callServer('getJadwalData', force) */
function getJadwalData(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    try {
      const hit = cache.get(JADWAL_CACHE_KEY);
      if (hit) {
        const parsed = JSON.parse(hit);
        parsed.fromCache = true;
        return parsed;
      }
    } catch (e) { /* abaikan, baca ulang dari sheet */ }
  }

  const opened = jd_openSheet_();
  const ss = opened.ss, sheet = opened.sheet;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return {
      sheetName: sheet.getName(), ssName: ss.getName(), ssUrl: ss.getUrl() + "#gid=" + sheet.getSheetId(),
      columns: [], total: 0, kategori: { tutup: [], tidakPl: [], baru: [] },
      fetchedAt: jd_nowText_(), fromCache: false
    };
  }

  const range   = sheet.getRange(1, 1, lastRow, lastCol);
  const values  = range.getDisplayValues();
  const bgs     = range.getBackgrounds();
  const fgs     = range.getFontColors();
  const weights = range.getFontWeights();

  // 1) Cari baris nama hari (minimal 3 sel berisi SENIN/SELASA/...)
  let dayRow = -1;
  const scanLimit = Math.min(values.length, 40);
  for (let r = 0; r < scanLimit; r++) {
    let hit = 0;
    for (let c = 0; c < lastCol; c++) {
      if (JADWAL_DAY_NAMES_.indexOf(String(values[r][c]).trim().toUpperCase()) !== -1) hit++;
    }
    if (hit >= 3) { dayRow = r; break; }
  }
  if (dayRow === -1) {
    throw new Error("Baris nama hari (SENIN, SELASA, ...) tidak ditemukan di sheet '" + sheet.getName() + "'.");
  }

  // 2) Susun kolom per hari
  const columns = [];
  let totalItems = 0;
  for (let c = 0; c < lastCol; c++) {
    const dayName = String(values[dayRow][c]).trim();
    if (JADWAL_DAY_NAMES_.indexOf(dayName.toUpperCase()) === -1) continue;

    const info = [];
    for (let r = 0; r < dayRow; r++) {
      const t = String(values[r][c]).replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (t.toUpperCase() === "JADWAL SO") continue;
      info.push(t);
    }

    const items = [];
    for (let r = dayRow + 1; r < values.length; r++) {
      const name = String(values[r][c]).replace(/\s+/g, " ").trim();
      if (!name) continue;
      items.push({
        name: name,
        bg:   _jadwalColor_(bgs[r][c], true),
        fg:   _jadwalColor_(fgs[r][c], false),
        bold: String(weights[r][c]).toLowerCase() === "bold"
      });
    }
    totalItems += items.length;

    columns.push({
      day:   dayName.toUpperCase(),
      dayBg: _jadwalColor_(bgs[dayRow][c], true),
      dayFg: _jadwalColor_(fgs[dayRow][c], false),
      info:  info,
      items: items
    });
  }

  const result = {
    sheetName: sheet.getName(),
    ssName:    ss.getName(),
    ssUrl:     ss.getUrl() + "#gid=" + sheet.getSheetId(),
    columns:   columns,
    total:     totalItems,
    kategori:  jd_kategori_(values, dayRow),
    fetchedAt: jd_nowText_(),
    fromCache: false
  };

  try {
    const json = JSON.stringify(result);
    if (json.length < 90000) cache.put(JADWAL_CACHE_KEY, json, JADWAL_CACHE_SEC);   // batas CacheService 100KB
  } catch (e) { /* cache gagal bukan masalah */ }

  return result;
}

/** Kolom TUTUP / TIDAK ADA PL / BARU dicari lewat teks header (baris 1 s/d baris nama hari). */
function jd_kategori_(values, dayRow) {
  const out = { tutup: [], tidakPl: [], baru: [] };
  const pola = { tutup: /^TUTUP$/, tidakPl: /^TIDAK\s*ADA\s*PL$/, baru: /^BARU$/ };
  Object.keys(pola).forEach(function (k) {
    for (let r = 0; r <= dayRow; r++) {
      for (let c = 0; c < values[r].length; c++) {
        if (!pola[k].test(String(values[r][c]).replace(/\s+/g, " ").trim().toUpperCase())) continue;
        for (let rr = r + 1; rr < values.length; rr++) {
          const v = String(values[rr][c]).replace(/\u00A0/g, " ").trim();
          if (v) out[k].push(v);
        }
        return;
      }
    }
  });
  return out;
}

function jd_nowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || JD_CFG.TZ, "dd/MM/yyyy HH:mm:ss");
}

/** Putih / hitam bawaan dianggap "tanpa warna" supaya UI memakai warna temanya sendiri. */
function _jadwalColor_(c, isBg) {
  const v = String(c || "").toLowerCase();
  if (!v) return "";
  if (isBg && v === "#ffffff") return "";
  if (!isBg && v === "#000000") return "";
  return v;
}


/* ═══════════════ 2. GENERATE & EDIT TANGGAL (baris 2-6 sheet Jadwal) ═══════════════ */

function jd_pad_(n) { return ("0" + n).slice(-2); }
function jd_todayIso_() { return Utilities.formatDate(new Date(), JD_CFG.TZ, "yyyy-MM-dd"); }
function jd_monthKey_(offset) {
  const p = jd_todayIso_().split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1 + offset, 1));
  return d.getUTCFullYear() + "-" + jd_pad_(d.getUTCMonth() + 1);
}
function jd_label_(key) {
  const p = key.split("-");
  return JD_BLN_FULL[+p[1] - 1] + " " + p[0];
}
function jd_iso_(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + jd_pad_(d.getUTCMonth() + 1) + "-" + jd_pad_(d.getUTCDate());
}
function jd_fmt_(iso) {
  const p = iso.split("-").map(Number);
  return JD_DOW[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ", " + jd_pad_(p[2]) + " " + JD_BLN[p[1] - 1];
}

/** "MINGGU 1 : RABU, 07 OKTOBER 2026" -> {tag:'MINGGU 1', iso:'2026-10-07'} */
function jd_parseCell_(v) {
  const m = String(v || "").replace(/\u00A0/g, " ").trim().toUpperCase()
    .match(/^(MINGGU\s*(\d+)|BULAN)\s*:\s*[A-Z]+\s*,?\s*(\d{1,2})\s+([A-Z]+)\s+(\d{4})/);
  if (!m) return null;
  const mi = JD_BLN_UP.findIndex(function (b) { return b.slice(0, 3) === m[4].slice(0, 3); });
  if (mi < 0) return null;
  return { tag: m[2] ? "MINGGU " + m[2] : "BULAN", iso: m[5] + "-" + jd_pad_(mi + 1) + "-" + jd_pad_(m[3]) };
}
function jd_teks_(tag, iso) {
  const p = iso.split("-").map(Number);
  const hari = JD_DOW[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()].toUpperCase();
  return (tag === "BULAN" ? "BULAN    " : tag) + " : " + hari + ", " + jd_pad_(p[2]) + " " + JD_BLN_UP[p[1] - 1] + " " + p[0];
}
function jd_urut_(a, b) {
  if (a === "BULAN") return 1;
  if (b === "BULAN") return -1;
  return Number(a.split(" ")[1]) - Number(b.split(" ")[1]);
}

/** Array 6 kolom, tiap kolom = { tag : iso }. */
function jd_readColumns_() {
  const cols = JD_HARI.map(function () { return {}; });
  jd_sheet_().getRange(JD_CFG.SCHED_FIRST_ROW, 1, JD_CFG.SCHED_ROWS, 6).getDisplayValues().forEach(function (r) {
    r.forEach(function (c, i) {
      const p = jd_parseCell_(c);
      if (p) cols[i][p.tag] = p.iso;
    });
  });
  return cols;
}

/** Tulis satu kolom (rapat dari atas, sisa baris dikosongkan). */
function jd_writeColumn_(sh, i, map) {
  const tags = Object.keys(map).filter(function (t) { return map[t]; }).sort(jd_urut_);
  if (tags.length > JD_CFG.SCHED_ROWS) throw new Error("Jadwal " + JD_HARI[i] + " lebih dari " + JD_CFG.SCHED_ROWS + " baris.");
  const vals = tags.map(function (t) { return [jd_teks_(t, map[t])]; });
  while (vals.length < JD_CFG.SCHED_ROWS) vals.push([""]);
  sh.getRange(JD_CFG.SCHED_FIRST_ROW, i + 1, JD_CFG.SCHED_ROWS, 1).setValues(vals);
}

function jd_readSched_() {
  const cols = jd_readColumns_();
  const tags = ["MINGGU 1", "MINGGU 2", "MINGGU 3", "MINGGU 4"];
  cols.forEach(function (c) {
    Object.keys(c).forEach(function (t) { if (t !== "BULAN" && tags.indexOf(t) < 0) tags.push(t); });
  });
  tags.sort(jd_urut_);
  tags.push("BULAN");
  let first = "";
  const rows = tags.map(function (t) {
    return { tag: t, cells: cols.map(function (c) { if (c[t] && !first) first = c[t]; return c[t] || ""; }) };
  });
  return { label: first ? jd_label_(first.slice(0, 7)) : "", rows: rows };
}

/**
 * Aturan default (koreksi manual lewat jendela Edit bila ada pengecualian):
 *  - Minggu 1 = minggu (Senin-Sabtu) dari Senin pertama bulan itu.
 *  - Tiap grup hari SO di hari-nya sendiri; tanggal sebelum JD_CFG.MULAI_TGL digeser ke tanggal itu.
 *  - Minggu terakhir (yang memuat SO Bulan): Selasa-Kamis digeser ke Senin, Jumat-Sabtu tidak ada.
 *  - BULAN = Sabtu terakhir di bulan itu, untuk semua grup.
 */
function jd_buildSchedule_(key) {
  const p = key.split("-").map(Number);
  const DAY = 86400000;
  const lastDay = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  let bulan = Date.UTC(p[0], p[1] - 1, lastDay);
  while (new Date(bulan).getUTCDay() !== 6) bulan -= DAY;
  const dow = new Date(Date.UTC(p[0], p[1] - 1, 1)).getUTCDay();
  let mon = Date.UTC(p[0], p[1] - 1, 1 + ((8 - dow) % 7));
  const earliest = Date.UTC(p[0], p[1] - 1, JD_CFG.MULAI_TGL);
  const cols = JD_HARI.map(function () { return {}; });
  let w = 0;
  while (mon <= bulan) {
    w++;
    const lastWeek = bulan - mon < 6 * DAY;
    JD_HARI.forEach(function (_, i) {
      let t = mon + i * DAY;
      if (lastWeek) {
        if (i >= 4) return;
        if (i >= 1) t = mon;
      }
      if (t < earliest) {
        t = earliest;
        while (new Date(t).getUTCDay() === 0) t += DAY;
      }
      cols[i]["MINGGU " + w] = jd_iso_(t);
    });
    mon += 7 * DAY;
  }
  cols.forEach(function (c) { c["BULAN"] = jd_iso_(bulan); });
  return cols;
}

/** Data untuk jendela Generate / Edit. */
function jadwalGetSched() {
  const today = jd_todayIso_();
  const sched = jd_readSched_();
  const events = {};
  sched.rows.forEach(function (r) {
    r.cells.forEach(function (t, i) {
      if (!t) return;
      events[t] = events[t] || [];
      if (events[t].indexOf(JD_HARI[i]) < 0) events[t].push(JD_HARI[i]);
    });
  });
  const nextIso = Object.keys(events).sort().filter(function (d) { return d > today; })[0];
  const p = today.split("-").map(Number);
  return {
    today: today,
    todayLabel: jd_fmt_(today) + " " + p[0],
    todayGroups: events[today] || [],
    next: nextIso ? { iso: nextIso, label: jd_fmt_(nextIso), groups: events[nextIso] } : null,
    sched: sched,
    gen: [jd_label_(jd_monthKey_(0)), jd_label_(jd_monthKey_(1))],
    hari: JD_HARI
  };
}

/** offset 0 = bulan ini, 1 = bulan depan. Menimpa baris 2-6 sheet Jadwal. */
function jadwalGenerate(offset) {
  offset = Number(offset);
  if (offset !== 0 && offset !== 1) throw new Error("Hanya bisa generate bulan ini atau bulan depan.");
  const cols = jd_buildSchedule_(jd_monthKey_(offset));
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = jd_sheet_();
    cols.forEach(function (c, i) { jd_writeColumn_(sh, i, c); });
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(JADWAL_CACHE_KEY);
  } finally {
    lock.releaseLock();
  }
  return jadwalGetSched();
}

/** Ubah satu tanggal. iso kosong = hapus. tag: "MINGGU n" atau "BULAN". */
function jadwalSimpanTanggal(tag, idx, iso) {
  idx = Number(idx);
  if (idx < 0 || idx > 5) throw new Error("Kolom hari tidak valid.");
  if (!/^(MINGGU \d+|BULAN)$/.test(tag)) throw new Error("Baris tidak valid.");
  if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Format tanggal tidak valid.");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const map = jd_readColumns_()[idx];
    if (iso) map[tag] = iso; else delete map[tag];
    jd_writeColumn_(jd_sheet_(), idx, map);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(JADWAL_CACHE_KEY);
  } finally {
    lock.releaseLock();
  }
  return jadwalGetSched();
}