/** STOCK OPNAME WEB APP v2 - Code.gs (bound ke spreadsheet STOCK OPNAME)
 *  - Daftar item = sheet TEMPLATE kolom A:B (baris kosong diabaikan). KATALOG hanya pelengkap (kategori, mingguan, expired, satuan, outlet khusus).
 *  - Sheet KONVERSI: A=SKU, B=NAMA, C=SATUAN HASIL, D=BERAT PER 1 SATUAN (gram). Bila hanya ada A:C (berat di C), tetap terbaca.
 *  - Hasil konversi (gram -> satuan hasil): satuan kg/liter boleh berkoma (mis. 1294 gram = 1,294 kg); satuan lain (PCS, PACK, dll)
 *    DIBULATKAN KE BAWAH ke bilangan bulat. Penentu: kolom C (SATUAN HASIL) di sheet KONVERSI, lihat SATUAN_DESIMAL.
 *    Pengecualian: SKU di SKU_DESIMAL tetap berkoma walau satuannya PACK/PCS.
 *  - SHEET OUTLET menyimpan nilai yang SUDAH DIKONVERSI untuk SKU di sheet KONVERSI (berat kolom D terisi),
 *    KECUALI SKU di SKU_OUTLET_GRAM: di sheet outlet tetap GRAM (tidak dikonversi). EXPIRED & HASIL_KONVERSI tetap dikonversi.
 *    Tampilan form/admin tetap satuan awal (gram). Gram asli disimpan di sheet DATA_ASLI (dibuat otomatis).
 *  - Sheet EXPIRED disimpan sudah dikonversi sejak awal (kolom I = gram asli, cadangan untuk membuka ulang form).
 *  - Halaman admin (?page=admin): monitoring terbuka, fitur lihat/ubah data dikunci PIN (menu SO Tools > Atur PIN admin).
 *  - File Sopimg.gs (getSopImg) tetap dipakai, tidak diubah.
 **/
const SH = {TPL:'TEMPLATE', OUT:'OUTLETS', CAT:'KATALOG', PER:'PERIODE', EXP:'EXPIRED', SCH:'SCHEDULE', DRF:'DRAFT', LOG:'LOG_KIRIM', STA:'STATUS', MST:'MASTER', KNV:'KONVERSI', HSL:'HASIL_KONVERSI', ADM:'LOG_ADMIN', RAW:'DATA_ASLI'};
const TZ = 'Asia/Jakarta';
const WAJIB_EXPIRED = true; // true: item bernilai >0 yang punya expired WAJIB isi tanggal expired
// Logo ROPI: tempel data URI (data:image/webp;base64,...) di antara tanda kutip. Kosong = tampil ikon roti.
const LOGO_DATA = '';

// Kategori khusus outlet tertentu (kolom OUTLET KHUSUS di KATALOG; kosong = semua outlet)
const KHUSUS = ['BB0346','BB0349','BB0347','BB0345','BB0344'], KHUSUS_OUTLET = 'RESTU KASIH';
const TERBUKA = []; // fitur Utuh+Terbuka tidak dipakai (diganti: ditimbang semua)
// Item timbang bawaan (hanya dipakai untuk mengisi awal sheet KONVERSI). Sumber sebenarnya: sheet KONVERSI.
const TIMBANG = ['BB0134','BB0143','BB0117','BB0112','BB0122','BB0120','BB0171'];
// Cadangan metadata bila SKU belum ada di KATALOG: [kategori, flag(Mingguan Y/N + Expired Y/N), item "SKU Nama (SATUAN)"]
const SEED = [
 ['DOUGH DAN KRIM KOPI','YY',['BB0046 Dough Butter (PACK)','BB0047 Dough Coklat (PACK)','BB0049 Dough Keju (PACK)','BB0168 Dough Croissant (PACK)','BB0261 Dough Gempi (PACK)','BB0085 Krim Kopi (PCS)']],
 ['ROTI SISA HARI INI','YN',['RR0001 Ropi Butter (PCS)','RR0002 Ropi Coklat (PCS)','RR0003 Ropi Keju (PCS)','RR0008 Roti Croissant (PCS)','RR0009 Roti Gempi (PCS)']],
 ['MINUMAN','YY',['BB0312 Air Mineral 600ml (PCS)','BB0309 Bubuk Hepi Cappucino (SACHET)','BB0308 Bubuk Hepi Moccacino (SACHET)','BB0310 Bubuk Hepi Karamel (SACHET)','BB0311 Bubuk Hepi Chocolate (SACHET)','BB0341 Coffee Classic 120g (GRAM)','BB0329 Jasmine Green Tea 750g (GRAM)','BB0342 Dark Cocoa Drink 1Kg (GRAM)','BB0340 Coffee Latte 500g (GRAM)','BB0145 Susu Bubuk (GRAM)','BB0305 Gula Cair Sachet (SACHET)','BB0067 Gula Cair Silver (GRAM)','BB0353 Gula Cair 250g (GRAM)','BB0322 Kopi Hitam (SACHET)','BB0043 Daun Teh (PCS)','BB0071 Gula Stik (PCS)']],
 ['MINUMAN MESIN VENDING','YY',['BB0346 Milo Activ 960g (GRAM)','BB0349 Lemonade 640g (GRAM)','BB0347 Teh Tarik 960g (GRAM)','BB0345 Coffeemate 450g (GRAM)','BB0344 Selezione 500g (GRAM)']],
 ['OLESAN DAN PENANDA RASA','YY',['BB0102 Olesan Choco Crunchy (GRAM)','BB0103 Olesan Dark Choco (GRAM)','BB0110 Olesan Tiramisu (GRAM)','BB0105 Olesan Margarine (GRAM)','BB0042 Crispy Ball (GRAM)','BB0096 Meises Coklat (GRAM)','BB0164 Wijen Hitam (GRAM)','BB0081 Keju Chedar (GRAM)','BB0174 Olesan Pastry (GRAM)','BB0352 Olesan Pastry 250g (GRAM)','BB0100 Minyak Oles (GRAM)']],
 ['CUP DAN BOTOL','YN',['BB0298 Cup 14 Oz (PCS)','BB0257 Cup 9 Oz (PCS)']],
 ['PACKAGING DAN PLASTIK','YN',['BB0112 Paper Bag Kap.1 Roti (PCS)','BB0171 Box Gempi (PCS)','BB0066 Goodie Bag (PCS)','BB0080 Kardus Ropi Isi 20 Roti (PCS)','BB0117 Plastik Alas Gempi (PCS)','BB0122 Plastik Seal Roti (PCS)','BB0120 Plastik Krim (PCS)','BB0118 Plastik Kresek Ukuran 17 (PACK)','BB0119 Plastik Kresek Ukuran 24 (PACK)','BB0296 Plastik Cup Isi 1 (PACK)','BB0297 Plastik Cup Isi 2 (PACK)','BB0134 Sedotan Teh (PCS)','BB0143 Stirrer (PCS)','BB0132 Sarung Tangan Plastik (PACK)']],
 ['PERLENGKAPAN OUTLET','NN',['BB0131 Sarung Tangan Oven (PACK)','BB0191 Kertas Thermal (PCS)','BB0012 Beater Better (PCS)','BB0159 Timbangan (PCS)','BB0092 Loyang (PCS)','BB0093 Loyang Gempi (PCS)','BB0068 Kuas Oles Loyang Kecil (PCS)','BB0090 Kuas Oles Loyang Besar (PCS)','BB0006 Apron (PCS)','BB0185 Botol Spray (PCS)','BB0034 Cangkir Stainless 12cm (PCS)','BB0035 Cangkir Stainless 7cm (PCS)','BB0036 Capitan Roti (PCS)','BB0039 Coffee Spoon (PCS)','BB0040 Corong (PCS)','BB0156 Cup Holder (PCS)','BB0044 Dispenser 8L (PCS)','BB0224 Galon (PCS)','BB0064 Gelas Takar 2 L (PCS)','BB0065 Gelas Takar 5 L (PCS)','BB0072 Gunting (PCS)','BB0073 Jigger (PCS)','BB0074 Kanebo (PCS)','BB0075 Kaos Gempi (PCS)','BB0076 Kaos Panjang (PCS)','BB0077 Kaos Pendek (PCS)','BB0114 Parutan Keju (PCS)','BB0116 Pisau Roti (PCS)','BB0129 Tempat Es Batu (PCS)','BB0130 Saringan Teh (PCS)','BB0136 Sendok Es Batu (PCS)','BB0141 Solet Gempi (PCS)','BB0142 Spatula (PCS)','BB0152 Teko Listrik (PCS)','BB0160 Topi (PCS)','BB0133 Toples Tempat Olesan (PCS)','BB0161 Toples Panjang (PCS)','BB0128 Regulator (PCS)','BB0135 Selang Gas (PCS)','BB0148 Tabung Gas (PCS)']]
];

/* ---------- cache & helpers ---------- */
let _BASE = null, _KNV = null;
function resetCache_(){ _BASE = null; _KNV = null; }

const SO_DB_ID_ = '1T1aRWoMRBwtbGS6KVwJi6YpVR1LRz8VRmyIykPsQdds';
let _SSO = null;
function ss_(){ return _SSO || (_SSO = SpreadsheetApp.openById(SO_DB_ID_)); }

function rows_(name, cols){
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow()-1, Math.min(cols, sh.getMaxColumns())).getValues();
}
function toDate_(v){ return v instanceof Date ? v : Utilities.parseDate(String(v), TZ, 'yyyy-MM-dd'); }
function dstr_(v){ return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v||''); }
function fmtD_(d){ return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm') : String(d||''); }
function outlets_(){ return rows_(SH.OUT,1).map(r=>String(r[0]).trim()).filter(x=>x && !/^(loading|#)/i.test(x)); }
const BLN = {JANUARI:0,FEBRUARI:1,MARET:2,APRIL:3,MEI:4,JUNI:5,JULI:6,AGUSTUS:7,SEPTEMBER:8,OKTOBER:9,NOVEMBER:10,DESEMBER:11};
function norm_(s){ return String(s).replace(/\s+/g,' ').trim(); }
function parseNm_(s){ const m = String(s||'').match(/^(.*?)\s*\(([^)]+)\)\s*$/); return m ? {n:m[1], u:m[2]} : {n:String(s||''), u:''}; }
function delRuns_(sh, test, cols){
  const n = sh ? sh.getLastRow()-1 : 0; if (n < 1) return 0;
  const runs = []; sh.getRange(2,1,n,cols).getValues().forEach((r,k)=>{ if (test(r)){ const row = k+2, L = runs[runs.length-1]; if (L && L[1] === row-1) L[1] = row; else runs.push([row,row]); } });
  let cnt = 0; for (let k=runs.length-1; k>=0; k--){ sh.deleteRows(runs[k][0], runs[k][1]-runs[k][0]+1); cnt += runs[k][1]-runs[k][0]+1; }
  return cnt;
}
function findRow_(sh, sku, col){
  const n = sh ? sh.getLastRow()-1 : 0; if (n < 1) return 0;
  const i = sh.getRange(2,col,n,1).getValues().findIndex(r=>String(r[0]).trim() === sku);
  return i < 0 ? 0 : i+2;
}

/* ---------- jadwal & periode ---------- */
// SCHEDULE: baris 2-7 = jadwal per kolom, baris 8 = nama hari, baris 9+ = daftar outlet pada kolom itu
function schedFor_(outlet, vv){
  const sh = ss_().getSheetByName(SH.SCH); if (!sh) return null;
  const v = vv || sh.getDataRange().getValues(), key = norm_(outlet).toUpperCase();
  for (let c=0; c<v[0].length; c++) for (let r=8; r<v.length; r++) if (norm_(v[r][c]).toUpperCase() === key){
    const per = []; for (let i=1; i<6 && i<v.length; i++){ const t = norm_(v[i][c]); if (/^(MINGGU|BULAN)\b/i.test(t)) per.push(t); }
    return {hari: norm_(v[7][c]), per};
  }
  return null;
}
function pdate_(t){ const m = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/); if (!m || BLN[m[2].toUpperCase()]===undefined) return '';
  return m[3]+'-'+String(BLN[m[2].toUpperCase()]+1).padStart(2,'0')+'-'+m[1].padStart(2,'0'); }
function frozen_(label){ return rows_(SH.PER,3).some(r=>norm_(r[0])===label && String(r[2]).toUpperCase()==='BEKU'); }
function periodInfo_(outlet, label){
  const sc = schedFor_(outlet); if (!sc || sc.per.indexOf(label) < 0) return null;
  return [label, /^BULAN/i.test(label)?'BULANAN':'MINGGUAN', frozen_(label)?'BEKU':'BUKA'];
}

/* ---------- draft ---------- */
function drafts_(){
  const s = ss_(); let sh = s.getSheetByName(SH.DRF);
  if (!sh){ sh = s.insertSheet(SH.DRF); sh.getRange(1,1,1,4).setValues([['OUTLET','PERIODE','DATA (JSON)','DISIMPAN']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function findDraft_(outlet, periode){
  const sh = drafts_(), n = sh.getLastRow(); if (n < 2) return 0;
  const i = sh.getRange(2,1,n-1,2).getValues().findIndex(r=>r[0]===outlet && r[1]===periode);
  return i < 0 ? 0 : i+2;
}
function saveDraft(p){
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (outlets_().indexOf(p.outlet) < 0) throw new Error('Outlet tidak valid');
    const per = periodInfo_(p.outlet, p.periode); if (!per) throw new Error('Periode tidak ada di jadwal outlet ini');
    if (per[2] === 'BEKU') throw new Error('Periode ini sudah DIBEKUKAN');
    const sh = drafts_(), now = new Date(), row = findDraft_(p.outlet, p.periode) || sh.getLastRow()+1;
    sh.getRange(row,1,1,4).setValues([[p.outlet, p.periode, JSON.stringify(p.data), now]]);
    return {ok:true, jam: Utilities.formatDate(now,TZ,'HH:mm')};
  } finally { lock.releaseLock(); }
}
function getPeriods(outlet){
  const sc = schedFor_(outlet); if (!sc) return {hari:'', periods:[]};
  const today = Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd');
  const osh = outSheet_(outlet, false), odata = osh && osh.getLastRow() > 1 && osh.getLastColumn() ? osh.getRange(1,1,osh.getLastRow(),osh.getLastColumn()).getValues() : [], hdr = odata[0] || [];
  const dsh = drafts_(), dr = dsh.getLastRow() > 1 ? dsh.getRange(2,1,dsh.getLastRow()-1,2).getValues() : [];
  const ps = sc.per.map(l=>({label:l, jenis:/^BULAN/i.test(l)?'BULANAN':'MINGGUAN', date:pdate_(l), frozen:frozen_(l),
    sent: (()=>{ const ci = hdr.indexOf(l); if (ci < 0) return false; for (let r=1; r<odata.length; r++) if (odata[r][ci] !== '') return true; return false; })(), draft: dr.some(r=>r[0]===outlet && r[1]===l)}));
  const open = ps.filter(p=>!p.frozen && p.date), past = open.filter(p=>p.date<=today).sort((a,b)=>a.date<b.date?1:-1), fut = open.filter(p=>p.date>today).sort((a,b)=>a.date<b.date?-1:1);
  const s = past[0] || fut[0]; if (s) s.sug = true;
  return {hari: sc.hari, periods: ps};
}

/* ---------- daftar item: TEMPLATE A:B + metadata ---------- */
// Baris TEMPLATE yang SKU-nya kosong diabaikan. Duplikat SKU hanya diambil sekali.
function tplRows_(){
  const t = ss_().getSheetByName(SH.TPL); if (!t || t.getLastRow() < 2) return [];
  const seen = {}, out = [];
  t.getRange(2,1,t.getLastRow()-1,2).getValues().forEach(r=>{
    const sku = String(r[0]).trim();
    if (!sku || /^sku$/i.test(sku) || /^TMB-/i.test(sku) || seen[sku]) return;
    seen[sku] = 1; out.push([sku, String(r[1]||'').trim()]);
  });
  return out;
}
function seedMeta_(){
  const m = {};
  SEED.forEach(g=>g[2].forEach(it=>{ const i = it.indexOf(' '), sku = it.slice(0,i), p = parseNm_(it.slice(i+1));
    m[sku] = {kat:g[0], nama:p.n, ming:g[1][0]==='Y', exp:g[1][1]==='Y', unit:p.u, khusus:KHUSUS.indexOf(sku)>=0?KHUSUS_OUTLET:''}; }));
  return m;
}
function katMeta_(){
  const m = {};
  rows_(SH.CAT,8).forEach(r=>{ const sku = String(r[1]).trim(); if (!sku) return; const p = parseNm_(r[2]);
    m[sku] = {kat:String(r[0]||'').trim(), nama:p.n.trim(), ming:String(r[3]).toUpperCase()==='Y', exp:String(r[4]).toUpperCase()==='Y', unit:String(r[5]||'').trim() || p.u, khusus:String(r[7]||'').trim(), inKat:true}; });
  return m;
}
// Sheet KONVERSI: A SKU, B NAMA, C SATUAN HASIL, D BERAT (gram). Jika D kosong semua tetapi C berisi angka, C dianggap berat.
function konvInfo_(){
  if (_KNV) return _KNV;
  const sh = ss_().getSheetByName(SH.KNV), map = {}; let wcol = 'D';
  if (sh && sh.getLastRow() > 1){
    const v = sh.getRange(2,1,sh.getLastRow()-1,Math.min(4, sh.getMaxColumns())).getValues();
    const nd = v.filter(r=>Number(r[3])>0).length, nc = v.filter(r=>Number(r[2])>0).length;
    wcol = (!nd && nc) ? 'C' : 'D';
    v.forEach(r=>{ const sku = String(r[0]).trim(); if (!sku) return;
      const g = Number(wcol === 'D' ? r[3] : r[2]) || 0;
      map[sku] = {g, sku, u: wcol === 'D' ? (String(r[2]||'').trim().toUpperCase() || 'PCS') : 'PCS'}; });
  }
  return (_KNV = {map, wcol});
}
// Satuan hasil (kolom C sheet KONVERSI) yang boleh berkoma. Satuan lain (PCS, PACK, dll) dibulatkan KE BAWAH ke bilangan bulat.
const SATUAN_DESIMAL = ['KG','KILOGRAM','L','LT','LTR','LITER'];
// SKU yang hasil konversinya tetap berkoma walaupun satuan hasilnya PACK/PCS
const SKU_DESIMAL = ['BB0341','BB0329','BB0342','BB0340'];
const DESIMAL = 3; // angka di belakang koma (mis. 500 gram / 120 = 4,166 pack)
function konvDes_(k){
  if (!k) return 0;
  if (k.sku && SKU_DESIMAL.indexOf(k.sku) >= 0) return DESIMAL;
  return k.u && SATUAN_DESIMAL.indexOf(String(k.u).trim().toUpperCase()) >= 0 ? DESIMAL : 0;
}
function konvBagi_(gram, k){ const f = Math.pow(10, konvDes_(k)); return Math.floor(Number(gram)/k.g*f + 1e-6)/f; }
// SKU yang di SHEET OUTLET tetap GRAM (tidak dikonversi). EXPIRED & HASIL_KONVERSI tetap dikonversi.
const SKU_OUTLET_GRAM = ['BB0341','BB0329','BB0342','BB0340','BB0102','BB0103','BB0110','BB0105','BB0096','BB0081','BB0100','BB0145','BB0164','BB0174'];
// Info konversi untuk sheet outlet: null bila SKU dikecualikan (nilai di sheet outlet tetap gram)
function kOut_(k){ return k && SKU_OUTLET_GRAM.indexOf(k.sku) < 0 ? k : null; }
function konv_(){ return konvInfo_().map; }
function base_(){
  if (_BASE) return _BASE;
  const seed = seedMeta_(), kat = katMeta_(), kv = konv_(), out = [];
  tplRows_().forEach(t=>{
    const sku = t[0], k = kat[sku], m = k || seed[sku] || {}, nama = t[1] || m.nama || sku;
    out.push({sku, nama, kat:m.kat || 'LAINNYA', ming:!!m.ming, exp:!!m.exp, unit: kv[sku] ? 'GRAM' : (m.unit || 'PCS'), khusus:m.khusus || '', kv:kv[sku] || null, inKat:!!k});
  });
  return (_BASE = out);
}
function tplList_(){ return base_().map(c=>[c.sku, c.nama]); }
function catalog_(jenis, outlet){
  const key = outlet ? norm_(outlet).toUpperCase() : '', wk = String(jenis).toUpperCase() === 'MINGGUAN';
  return base_().filter(c=>(!wk || c.ming) && (!key || !c.khusus || String(c.khusus).split(/[;,]/).some(k=>k.trim() && key.indexOf(norm_(k).toUpperCase()) >= 0)))
    .map(c=>({key:c.sku, sku:c.sku, kat:c.kat, nama:c.nama, unit:c.unit, full:c.nama, exp:c.exp, kv:c.kv}));
}
function shName_(o){ return String(o).replace(/[\[\]\*\?\/\\:]/g,'-').slice(0,99); }
function outSheet_(outlet, create){
  const s = ss_(), n = shName_(outlet);
  let sh = s.getSheetByName(n);
  if (!sh && create) sh = s.getSheetByName(SH.TPL).copyTo(s).setName(n);
  return sh;
}
function col_(sh, label, create){
  const lc = Math.max(sh.getLastColumn(), 3);
  const h = sh.getRange(1,1,1,lc).getValues()[0];
  const i = h.indexOf(label); if (i >= 0) return i+1;
  if (!create) return 0;
  for (let j=3; j<h.length; j++) if (h[j]==='' || h[j]==='Tanggal'){ sh.getRange(1,j+1).setValue(label); return j+1; }
  if (lc >= sh.getMaxColumns()) sh.insertColumnAfter(lc);
  sh.getRange(1,lc+1).setValue(label); return lc+1;
}
// STOK AKHIR (kolom C) = nilai terakhir yang terisi pada kolom periode (D dst.)
function lastVal_(arr){ for (let j=arr.length-1; j>=0; j--) if (arr[j] !== '') return arr[j]; return ''; }
function recalcC_(sh){
  const lr = sh.getLastRow(), lc = sh.getLastColumn(); if (lr < 2 || lc < 3) return;
  const blk = lc >= 4 ? sh.getRange(2,4,lr-1,lc-3).getValues() : [];
  sh.getRange(2,3,lr-1,1).setValues(Array.from({length:lr-1}, (_,i)=>[lastVal_(blk[i]||[])]));
}

function getLogo(){ return LOGO_DATA; }
function getInit(){ return {outlets: outlets_(), wajibExp: WAJIB_EXPIRED}; }
// Data untuk halaman admin (?page=admin): dibaca dari sheet STATUS, refresh=true menghitung ulang dulu
function getAdminData(refresh){
  const s = ss_(), pr = PropertiesService.getScriptProperties(); let sh = s.getSheetByName(SH.STA);
  const at = +pr.getProperty('STA_AT') || 0;
  if (!sh || sh.getLastRow() < 2 || (refresh && Date.now()-at > 45000)){ perbaruiStatus(); sh = s.getSheetByName(SH.STA); }
  const rows = sh && sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,10).getValues() : [];
  const u = sh ? sh.getRange('M5').getValue() : '';
  return {updated: fmtD_(u),
    rows: rows.filter(r=>r[0]).map(r=>({o:String(r[0]), h:String(r[1]), j:String(r[2]), jn:String(r[3]), tgl:pdate_(String(r[2])), st:String(r[4]), pct:Number(r[5])||0, isi:r[6], tot:r[7], upd:fmtD_(r[8]), ket:String(r[9]||'')}))};
}
function getForm(outlet, periode){
  const per = periodInfo_(outlet, periode); if (!per) throw new Error('Periode tidak ada di jadwal outlet ini');
  const res = {items: catalog_(per[1], outlet), values:{}, tambahan:[], expiry:{}, sent:false, draft:null};
  const sh = outSheet_(outlet, false);
  if (sh && sh.getLastRow() > 1){
    const last = sh.getLastRow(), c = col_(sh, periode, false);
    const ab = sh.getRange(2,1,last-1,2).getValues();
    const v = c ? sh.getRange(2,c,last-1,1).getValues() : null;
    const rw = rawMap_(outlet, periode), kv = konv_();
    ab.forEach((r,i)=>{ const sku = String(r[0]).trim(), val = v ? v[i][0] : '';
      if (/^TMB-/.test(sku)) res.tambahan.push({sku, nama:String(r[1]), val});
      else if (val !== '') res.values[sku] = gramDari_(val, rw[sku], kOut_(kv[sku])); });
    res.sent = c > 0 && Object.keys(res.values).length > 0;
  }
  const dr = findDraft_(outlet, periode);
  if (dr){ const dv = drafts_().getRange(dr,3,1,2).getValues()[0];
    try { res.draft = JSON.parse(dv[0]); res.draftAt = dv[1] instanceof Date ? Utilities.formatDate(dv[1],TZ,'dd/MM HH:mm') : ''; } catch(e){} }
  rows_(SH.EXP,9).forEach(r=>{ if (r[0]===periode && r[1]===outlet) (res.expiry[r[2]] = res.expiry[r[2]]||[]).push({d:dstr_(r[7]), q:expRaw_(r)}); });
  return res;
}
// Stok (gram) diambil langsung dari sheet outlet, jadi ikut berubah bila sel di sheet outlet diedit
function gs_(r, sp, outlet){ const n = shName_(outlet).replace(/'/g,"''");
  return `=IFERROR(INDIRECT("'${n}'!R"&MATCH($C${r}${sp}'${n}'!$A:$A${sp}0)&"C"&MATCH($A${r}${sp}'${n}'!$1:$1${sp}0)${sp}FALSE)${sp}"")`; }
// Estimasi (satuan hasil) = stok gram / berat per satuan, dibulatkan ke bawah (des = angka di belakang koma: 3 untuk kg/liter, 0 lainnya)
function es_(r, sp, des){ return `=IF(AND(E${r}<>""${sp}ISNUMBER(E${r})${sp}N(F${r})>0)${sp}ROUNDDOWN(E${r}/F${r}${sp}${des||0})${sp}"")`; }
function perbaikiHasil_(){
  const hs = ss_().getSheetByName(SH.HSL), n = hs ? hs.getLastRow()-1 : 0;
  if (n < 1) return 'HASIL_KONVERSI: masih kosong (dilewati)';
  resetCache_();
  const sp = sep_(), v = hs.getRange(2,1,n,5).getValues(), kv = konv_(), cache = {}, rw = {};
  const rsh = rawSheet_();
  if (rsh.getLastRow() > 1) rsh.getRange(2,1,rsh.getLastRow()-1,4).getValues().forEach(r=>{ rw[r[0]+'|'+r[1]+'|'+String(r[2]).trim()] = Number(r[3]); });
  const E = v.map(r=>{ const per = String(r[0]), o = String(r[1]), sku = String(r[2]).trim(), k = kv[sku], g = k && k.g > 0 ? k.g : 0;
    const cv = outCell_(cache, o, per, sku);
    if (cv === undefined || cv === '') return [r[4]];
    return [gramDari_(cv, rw[per+'|'+o+'|'+sku], kOut_(k))]; });
  hs.getRange(2,5,n,1).setValues(E);
  hs.getRange(2,7,n,1).setValues(v.map((r,i)=>[es_(i+2, sp, konvDes_(kv[String(r[2]).trim()]))]));
  return 'HASIL_KONVERSI: stok (gram) diisi dari data asli, estimasi dibulatkan ke bawah ('+n+' baris)';
}
// Tambah baris ke sheet EXPIRED (Name/Unit/Category = XLOOKUP ke sheet MASTER; item TMB- disimpan apa adanya)
function expAdd_(periode, outlet, log){
  if (!log.length) return;
  const es = ss_().getSheetByName(SH.EXP), start = Math.max(es.getLastRow(),1)+1, end = start+log.length-1;
  if (es.getMaxColumns() < 9) es.insertColumnsAfter(es.getMaxColumns(), 9-es.getMaxColumns());
  if (end > es.getMaxRows()) es.insertRowsAfter(es.getMaxRows(), end-es.getMaxRows());
  if (es.getRange(1,9).getValue() === '') es.getRange(1,9).setValue('Qty asli (gram)').setFontWeight('bold');
  // x.q = gram (satuan awal). Untuk SKU berkonversi: kolom G disimpan SUDAH DIKONVERSI (dibulatkan ke bawah), kolom I = gram asli.
  const km = konv_();
  es.getRange(start,1,log.length,9).setValues(log.map((x,k)=>{ const r = start+k, t = /^TMB-/.test(x.sku), g = (!t && km[x.sku] && km[x.sku].g > 0) ? km[x.sku].g : 0;
    return [periode, outlet, x.sku, t?x.name:xl_(r,'B'), t?x.unit:xl_(r,'C'), t?'Tambahan':xl_(r,'D'), g ? konvBagi_(x.q, km[x.sku]) : x.q, x.d, g ? x.q : '']; }));
  es.getRange(start,8,log.length,1).setNumberFormat('dd/mm/yyyy');
}

// Qty hasil konversi (gram -> satuan hasil), dibulatkan ke bawah (des = angka di belakang koma: 3 untuk kg/liter, 0 lainnya)
function qx_(r, sp, des){ const k = "'"+SH.KNV+"'", w = konvInfo_().wcol;
  return `=IFERROR(ROUNDDOWN($I${r}/XLOOKUP($C${r}${sp}${k}!$A:$A${sp}${k}!$${w}:$${w}${sp}0)${sp}${des||0})${sp}"")`; }
// Qty asli sebuah baris EXPIRED: kolom I bila ada (item konversi), jika tidak kolom G
function expRaw_(r){ return (r[8] !== undefined && r[8] !== '') ? r[8] : r[6]; }

// Tambah baris ke HASIL_KONVERSI. list = [{sku, gram}] (gram asli sebelum konversi)
function hasilAdd_(periode, outlet, list){
  const hs = ss_().getSheetByName(SH.HSL); if (!hs || !list.length) return;
  const st = Math.max(hs.getLastRow(),1)+1, sp = sep_(), kk = "'"+SH.KNV+"'", end = st+list.length-1, w = konvInfo_().wcol;
  if (end > hs.getMaxRows()) hs.insertRowsAfter(hs.getMaxRows(), end-hs.getMaxRows());
  const lk = (r,col)=>`=XLOOKUP($C${r}${sp}${kk}!$A:$A${sp}${kk}!$${col}:$${col}${sp}"")`;
  hs.getRange(st,1,list.length,7).setValues(list.map((x,i)=>{ const r = st+i;
    return [periode, outlet, x.sku, lk(r,'B'), x.gram, lk(r,w), es_(r, sp, konvDes_(konv_()[x.sku]))]; }));
}
function submitSO(p){
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (outlets_().indexOf(p.outlet) < 0) throw new Error('Outlet tidak valid');
    const per = periodInfo_(p.outlet, p.periode); if (!per) throw new Error('Periode tidak ada di jadwal outlet ini');
    if (String(per[2]).toUpperCase() !== 'BUKA') throw new Error('Periode ini sudah DIBEKUKAN, tidak bisa diubah');
    const sh = outSheet_(p.outlet, true), cat = catalog_(per[1], p.outlet);
    sinkron_(sh, tplList_());
    let last = Math.max(sh.getLastRow(), 1);
    let skus = last > 1 ? sh.getRange(2,1,last-1,1).getValues().map(r=>String(r[0]).trim()) : [];
    const add = [];
    cat.forEach(c=>{ if (skus.indexOf(c.sku) < 0){ add.push([c.sku, c.full]); skus.push(c.sku); } });
    let mx = Math.max(0, ...skus.filter(s=>/^TMB-/.test(s)).map(s=>+s.slice(4)));
    (p.tambahan||[]).forEach(t=>{ if (!t.sku){ t.sku = 'TMB-'+String(++mx).padStart(3,'0'); add.push([t.sku, t.nama]); skus.push(t.sku); } });
    if (add.length){
      const need = last + add.length - sh.getMaxRows();
      if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
      sh.getRange(last+1,1,add.length,2).setValues(add); last += add.length;
    }
    const c = col_(sh, p.periode, true), n = last-1;
    const rng = sh.getRange(2,c,n,1), vals = rng.getValues(), log = [], now = new Date(); rng.clearNote();
    const km = konv_(), rawList = [];
    p.entries.concat(p.tambahan||[]).forEach(e=>{
      const i = skus.indexOf(e.sku); if (i < 0) return;
      const raw = Number(e.val) || 0, kk = kOut_(km[e.sku]), g = (kk && kk.g > 0 && !/^TMB-/.test(e.sku)) ? kk.g : 0;
      vals[i][0] = g ? konvBagi_(raw, kk) : raw; // sheet outlet = hasil konversi (kecuali SKU_OUTLET_GRAM: tetap gram)
      if (g) rawList.push({sku:e.sku, gram:raw});
      const mm = parseNm_(e.nama); e.exp.forEach(x=>log.push({sku:e.sku, name:mm.u?mm.n:(e.nama||''), unit:mm.u, q:Number(x.q), d:toDate_(x.d)}));
    });
    rng.setValues(vals);
    recalcC_(sh);
    // sheet EXPIRED: hapus baris lama outlet+periode ini, lalu tambahkan baris baru
    delRuns_(ss_().getSheetByName(SH.EXP), r=>r[0]===p.periode && r[1]===p.outlet, 2);
    expAdd_(p.periode, p.outlet, log);
    // sheet HASIL_KONVERSI
    // gram asli (sebelum konversi) untuk membuka ulang form
    rawDel_(p.periode, p.outlet); rawAdd_(p.periode, p.outlet, rawList);
    const hs = ss_().getSheetByName(SH.HSL);
    if (hs && Object.keys(km).length){
      delRuns_(hs, r=>r[0]===p.periode && r[1]===p.outlet, 2);
      hasilAdd_(p.periode, p.outlet, p.entries.filter(e=>km[e.sku]).map(e=>({sku:e.sku, gram:Number(e.val)||0})));
    }
    const dr = findDraft_(p.outlet, p.periode); if (dr) drafts_().deleteRow(dr);
    logKirim_(p.outlet, p.periode, now);
    return {ok:true, jam: Utilities.formatDate(now,TZ,'dd/MM/yyyy HH:mm')};
  } finally { lock.releaseLock(); }
}

/* ---------- menu & setup ---------- */
function onOpenSoTools_(){
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('SO Tools')
    .addItem('📊 Perbarui status & bersihkan data kosong','statusMenu')
    .addItem('⏱️ Update status otomatis (tiap 15 menit)','aktifkanTriggerStatus')
    .addItem('❄️ Bekukan periode...','bekukanPeriode')
    .addSeparator()
    .addItem('🔁 Terapkan konversi (outlet, EXPIRED, hasil)','menuTerapkanKonversi')
    .addItem('🔧 Perbaiki konversi berkoma','menuPerbaikiDesimal')
    .addItem('🆕 Buat sheet outlet baru','menuBuatSheetOutlet')
    .addItem('🔄 Sinkronkan TEMPLATE ke semua sheet outlet','menuSinkron')
    .addItem('🔐 Atur PIN admin','aturPinAdmin')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠️ Setup & perbaikan')
      .addItem('Setup awal (cukup sekali)','setupAwal')
      .addItem('Perbarui struktur setelah update kode','menuPerbarui'))
    .addToUi();
}
function aturPinAdmin(){
  const ui = SpreadsheetApp.getUi(), r = ui.prompt('Atur PIN admin', 'PIN dipakai untuk membuka Data SO, Master Item, dan fitur ubah di halaman admin.\nMasukkan PIN baru (minimal 4 karakter):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pin = r.getResponseText().trim();
  if (pin.length < 4) return ui.alert('PIN minimal 4 karakter. PIN tidak diubah.');
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', pin);
  CacheService.getScriptCache().remove('pinfail');
  ui.alert('PIN admin disimpan.');
}
function resetKatalog(){
  const s = ss_(); let sh = s.getSheetByName(SH.CAT) || s.insertSheet(SH.CAT);
  sh.clear().getRange(1,1,1,8).setValues([['KATEGORI','SKU','NAMA BARANG','MINGGUAN','EXPIRED','SATUAN','TERBUKA (GRAM)','OUTLET KHUSUS']]).setFontWeight('bold');
  const out = [];
  SEED.forEach(g=>g[2].forEach(it=>{ const i = it.indexOf(' '); const nm = it.slice(i+1), m = nm.match(/^(.*?)\s*\(([^)]+)\)\s*$/); out.push([g[0], it.slice(0,i), m?m[1]:nm, g[1][0], g[1][1], TIMBANG.indexOf(it.slice(0,i))>=0?'GRAM':(m?m[2]:''), TERBUKA.indexOf(it.slice(0,i))>=0?'Y':'N', KHUSUS.indexOf(it.slice(0,i))>=0?KHUSUS_OUTLET:'']); }));
  sh.getRange(2,1,out.length,8).setValues(out); resetCache_(); sh.setFrozenRows(1);
  return out;
}
function siapkanKonversi_(){
  const s = ss_(), W = {BB0120:4, BB0117:3, BB0112:3, BB0171:46}, KN = {BB0134:'Sedotan Teh', BB0143:'Stirrer', BB0117:'Plastik Alas Gempi', BB0112:'Paper Bag Kap.1 Roti', BB0122:'Plastik Seal Roti', BB0120:'Plastik Krim', BB0171:'Box Gempi'};
  if (!s.getSheetByName(SH.KNV)){ const k = s.insertSheet(SH.KNV);
    k.getRange(1,1,1,4).setValues([['SKU','NAMA BARANG','SATUAN HASIL','BERAT PER 1 SATUAN (GRAM)']]).setFontWeight('bold'); k.setFrozenRows(1);
    k.getRange(2,1,TIMBANG.length,4).setValues(TIMBANG.map(x=>[x, KN[x], 'PCS', W[x]||''])); k.setColumnWidth(2,220); k.setColumnWidth(4,200); }
  if (!s.getSheetByName(SH.HSL)){ const h = s.insertSheet(SH.HSL);
    h.getRange(1,1,1,7).setValues([['PERIODE','OUTLET','SKU','Nama Barang','Stok (gram)','Berat per pcs (gram)','Estimasi (pcs)']]).setFontWeight('bold'); h.setFrozenRows(1); }
}
// Aman dijalankan ulang: hanya membuat yang belum ada, tidak menimpa data/KATALOG yang sudah diedit
function setupAwal(){
  const s = ss_(); PropertiesService.getScriptProperties().setProperty('SS_ID', s.getId());
  const ck = s.getSheetByName(SH.CAT), cat = (!ck || ck.getLastRow() < 2) ? resetKatalog() : rows_(SH.CAT,7);
  if (!s.getSheetByName(SH.PER)){ const p = s.insertSheet(SH.PER);
    p.getRange(1,1,1,3).setValues([['LABEL PERIODE (diisi lewat menu Bekukan periode)','JENIS','STATUS']]).setFontWeight('bold');
    p.getRange('B2:B500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['MINGGUAN','BULANAN']).build());
    p.getRange('C2:C500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['BUKA','BEKU']).build());
    p.setColumnWidth(1,300).setFrozenRows(1); }
  if (!s.getSheetByName(SH.EXP)){ const e = s.insertSheet(SH.EXP); e.getRange(1,1,1,8).setValues([['PERIODE','OUTLET','SKU','Name','Unit','Inventory Category','Real Qty','TGL EXPIRE']]).setFontWeight('bold'); e.setFrozenRows(1); }
  if (!s.getSheetByName(SH.MST)){ const ms = s.insertSheet(SH.MST); ms.getRange(1,1,1,5).setValues([['SKU','Name','Unit','Inventory Category','Real Qty']]).setFontWeight('bold'); ms.setFrozenRows(1); }
  siapkanKonversi_();
  const t = s.getSheetByName(SH.TPL) || s.insertSheet(SH.TPL);
  if (t.getLastRow() < 2){
    t.getRange(1,1,1,4).setValues([['SKU','NAMA BARANG','STOK AKHIR','Tanggal']]).setFontWeight('bold');
    const seen = {}, rows = cat.filter(r=>r[1] && !seen[r[1]] && (seen[r[1]]=1)).map(r=>[r[1], r[2]]);
    t.getRange(2,1,rows.length,2).setValues(rows);
  }
  resetCache_();
  SpreadsheetApp.getUi().alert('Setup selesai. Sheet yang belum ada sudah dibuat, yang sudah ada tidak diubah.\nLangkah berikutnya: Atur PIN admin, lalu Deploy > Manage deployments > New version.');
}
function bekukanPeriode(){
  const ui = SpreadsheetApp.getUi(), sh = ss_().getSheetByName(SH.SCH), v = sh.getDataRange().getValues(), set = {};
  for (let c=0; c<v[0].length; c++) for (let i=1; i<6 && i<v.length; i++){ const t = norm_(v[i][c]); if (/^(MINGGU|BULAN)\b/i.test(t)) set[t] = 1; }
  const L = Object.keys(set);
  const r = ui.prompt('Bekukan periode', 'Ketik nomor (pisahkan koma):\n'+L.map((l,i)=>(i+1)+'. '+l).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const rows = r.getResponseText().split(',').map(x=>L[+x.trim()-1]).filter(Boolean).map(l=>[l, /^BULAN/i.test(l)?'BULANAN':'MINGGUAN','BEKU']);
  if (!rows.length) return ui.alert('Tidak ada yang dipilih.');
  const p = ss_().getSheetByName(SH.PER); p.getRange(Math.max(p.getLastRow(),1)+1,1,rows.length,3).setValues(rows);
  ui.alert(rows.length+' periode dibekukan. Untuk membuka lagi, ubah STATUS di sheet PERIODE menjadi BUKA.');
}

/* ---------- rekap status SO ---------- */
function logKirim_(outlet, periode, now){
  const s = ss_(); let sh = s.getSheetByName(SH.LOG);
  if (!sh){ sh = s.insertSheet(SH.LOG); sh.getRange(1,1,1,3).setValues([['OUTLET','PERIODE','DIKIRIM']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  const n = sh.getLastRow(), i = n > 1 ? sh.getRange(2,1,n-1,2).getValues().findIndex(r=>r[0]===outlet && r[1]===periode) : -1;
  sh.getRange(i < 0 ? n+1 : i+2, 1, 1, 3).setValues([[outlet, periode, now]]);
}
function statusMenu(){ perbaruiStatus(); SpreadsheetApp.getActive().toast('Status diperbarui dan data kosong dibersihkan', 'SO Tools', 5); }
function aktifkanTriggerStatus(){
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='perbaruiStatus').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('perbaruiStatus').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert('Sheet STATUS akan diperbarui otomatis tiap 15 menit.');
}
// Hapus baris HASIL_KONVERSI & EXPIRED yang stok-nya sudah dikosongkan di sheet outlet (baris/kolom yang tidak ditemukan dibiarkan, demi keamanan)
function bersihkanYatim_(){
  const s = ss_(), cache = {};
  const cell = (outlet, periode, sku)=>{
    if (!(outlet in cache)){ const sh = outSheet_(outlet, false); let d = null;
      if (sh && sh.getLastRow() > 1 && sh.getLastColumn() >= 3){ const v = sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues(), rows = {};
        for (let r=1; r<v.length; r++) rows[String(v[r][0]).trim()] = r; d = {v, rows, h:v[0]}; }
      cache[outlet] = d; }
    const d = cache[outlet]; if (!d) return undefined;
    const ci = d.h.indexOf(periode), ri = d.rows[sku]; if (ci < 0 || ri === undefined) return undefined;
    return d.v[ri][ci];
  };
  const clean = (sh, test)=> delRuns_(sh, r=>r[0] && test(cell(String(r[1]), String(r[0]), String(r[2]).trim())), 3);
  return {hasil: clean(s.getSheetByName(SH.HSL), v=>v === ''), expired: clean(s.getSheetByName(SH.EXP), v=>v === '' || (v !== undefined && Number(v) === 0))};
}
function perbaruiStatus(){ try { buatSheetOutlet_(30); } catch(e){} try { bersihkanYatim_(); } catch(e){} perbaruiStatus_(); PropertiesService.getScriptProperties().setProperty('STA_AT', String(Date.now())); }
function perbaruiStatus_(){
  const s = ss_(), fmt = fmtD_;
  const dmap = {}, lmap = {}, fz = {};
  const ds = drafts_(); if (ds.getLastRow() > 1) ds.getRange(2,1,ds.getLastRow()-1,4).getValues().forEach(r=>{ try { dmap[r[0]+'|'+r[1]] = {d: JSON.parse(r[2]), t: r[3]}; } catch(e){} });
  const ls = s.getSheetByName(SH.LOG); if (ls && ls.getLastRow() > 1) ls.getRange(2,1,ls.getLastRow()-1,3).getValues().forEach(r=>lmap[r[0]+'|'+r[1]] = r[2]);
  rows_(SH.PER,3).forEach(r=>{ if (String(r[2]).toUpperCase()==='BEKU') fz[norm_(r[0])] = 1; });
  const schv = s.getSheetByName(SH.SCH).getDataRange().getValues(), out = [];
  outlets_().forEach(o=>{
    const sc = schedFor_(o, schv);
    if (!sc){ out.push([o,'','(tidak ada di SCHEDULE)','','TIDAK ADA JADWAL',0,0,0,'','']); return; }
    const sh = outSheet_(o, false); let data = null, hdr = [];
    if (sh && sh.getLastRow() > 1 && sh.getLastColumn() >= 3){ data = sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues(); hdr = data[0]; }
    sc.per.forEach(l=>{
      const jenis = /^BULAN/i.test(l) ? 'BULANAN' : 'MINGGUAN', skus = catalog_(jenis, o).map(x=>x.sku), total = skus.length, key = o+'|'+l, dr = dmap[key], ci = hdr.indexOf(l);
      let st = 'BELUM MULAI', isi = 0, upd = '', ket = [];
      let sent = false;
      if (ci >= 0){ const m = {}; for (let r=1; r<data.length; r++) m[String(data[r][0]).trim()] = data[r][ci];
        isi = skus.filter(k=>m[k] !== '' && m[k] !== undefined).length; sent = isi > 0; }
      if (sent){ st = 'TERKIRIM'; upd = lmap[key]; if (dr) ket.push('Ada draft revisi belum dikirim'); }
      else if (dr){ const dv = dr.d.vals || {}; isi = skus.filter(k=>dv[k] !== '' && dv[k] !== undefined).length; st = 'DRAFT'; upd = dr.t; }
      if (fz[l]) ket.push('BEKU');
      out.push([o, sc.hari, l, jenis, st, total ? isi/total : 0, isi, total, fmt(upd), ket.join(' | ')]);
    });
  });
  let sh = s.getSheetByName(SH.STA) || s.insertSheet(SH.STA);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1,1,1,10).setValues([['OUTLET','HARI','JADWAL SO','JENIS','STATUS','% ISI','TERISI','TOTAL ITEM','UPDATE TERAKHIR','KETERANGAN']]).setFontWeight('bold').setBackground('#b3261e').setFontColor('#fff');
  if (out.length){
    const n = out.length;
    sh.getRange(2,9,n,1).setNumberFormat('@'); // jam update tetap teks (tidak diubah jadi tanggal oleh Sheets)
    sh.getRange(2,1,n,10).setValues(out); sh.getRange(2,6,n,1).setNumberFormat('0%');
    const col = {'TERKIRIM':'#d7f0e0','DRAFT':'#fff2c2','BELUM MULAI':'#f8d9d6','TIDAK ADA JADWAL':'#e0e0e0'};
    sh.getRange(2,5,n,1).setBackgrounds(out.map(r=>[col[r[4]]]));
    sh.getRange(1,1,n+1,10).createFilter(); sh.setFrozenRows(1);
    const R = 'E2:E'+(n+1), f = t=>`=SUMPRODUCT(SUBTOTAL(103,OFFSET(E2,ROW(${R})-ROW(E2),0))*(${R}="${t}"))`;
    sh.getRange('M5').setNumberFormat('@');
    sh.getRange('L1:M5').setValues([['RINGKASAN (ikut filter)',''],['Terkirim',f('TERKIRIM')],['Draft',f('DRAFT')],['Belum mulai',f('BELUM MULAI')],['Diperbarui',fmt(new Date())]]);
    sh.getRange('L1').setFontWeight('bold'); sh.setColumnWidth(1,280); sh.setColumnWidth(3,300); sh.setColumnWidth(12,150);
  }
}

/* ---------- buat sheet outlet baru otomatis ---------- */
// Outlet yang ada di sheet OUTLETS DAN punya jadwal di SCHEDULE, tetapi belum punya sheet -> dibuat dari salinan TEMPLATE.
// Dipanggil otomatis oleh perbaruiStatus (tiap 15 menit bila trigger aktif, atau menu Perbarui status), dan lewat menu "Buat sheet outlet baru".
// Pengiriman SO lewat web juga tetap membuat sheet sendiri bila belum ada. maks = batas jumlah sheet per jalan (hindari timeout).
function buatSheetOutlet_(maks){
  const s = ss_(), tpl = s.getSheetByName(SH.TPL), sch = s.getSheetByName(SH.SCH);
  if (!tpl || !sch) return {dibuat:[], sisa:0};
  const schv = sch.getDataRange().getValues(), ada = {};
  s.getSheets().forEach(sh=>{ ada[sh.getName()] = 1; });
  const perlu = outlets_().filter(o=>!ada[shName_(o)] && schedFor_(o, schv));
  const dibuat = [];
  perlu.slice(0, maks || 30).forEach(o=>{ try { outSheet_(o, true); dibuat.push(o); } catch(e){ Logger.log('Gagal buat sheet '+o+': '+e.message); } });
  return {dibuat, sisa: perlu.length - dibuat.length};
}
function menuBuatSheetOutlet(){
  const r = buatSheetOutlet_(40), ui = SpreadsheetApp.getUi();
  ui.alert('Buat sheet outlet baru', r.dibuat.length
    ? r.dibuat.length+' sheet dibuat:\n'+r.dibuat.join('\n')+(r.sisa ? '\n\nMasih ada '+r.sisa+' outlet lagi. Jalankan menu ini sekali lagi.' : '')
    : 'Tidak ada outlet baru. Semua outlet yang punya jadwal sudah punya sheet.', ui.ButtonSet.OK);
}

/* ---------- sinkron sheet outlet dengan TEMPLATE ---------- */
// Susun ulang kolom SKU & NAMA sesuai TEMPLATE; data tiap SKU ikut pindah. SKU yang tidak ada di TEMPLATE (mis. TMB-) tetap di bawah.
function sinkron_(sh, tpl){
  if (!tpl.length) return false;
  const lr = sh.getLastRow(), lc = Math.max(sh.getLastColumn(), 3);
  const data = lr > 1 ? sh.getRange(2,1,lr-1,lc).getValues() : [], map = {}, used = {}, out = [];
  data.forEach(r=>{ map[String(r[0]).trim()] = r; });
  tpl.forEach(t=>{ used[t[0]] = 1; const old = map[t[0]], row = old ? old.slice() : new Array(lc).fill(''); row[0] = t[0]; row[1] = t[1]; out.push(row); });
  data.forEach(r=>{ const k = String(r[0]).trim(); if (k && !used[k]){ used[k] = 1; out.push(r); } });
  if (out.length === data.length && out.every((r,i)=>r[0]===data[i][0] && r[1]===data[i][1])) return false;
  const need = out.length + 1 - sh.getMaxRows(); if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(2,1,out.length,lc).setValues(out);
  if (data.length > out.length) sh.getRange(2+out.length,1,data.length-out.length,lc).clearContent();
  return true;
}
function sinkronSemua_(){
  const tpl = tplList_(); let ok = 0, ubah = 0; const err = [];
  outlets_().forEach(o=>{ const sh = outSheet_(o, false); if (!sh) return;
    try { ok++; if (sinkron_(sh, tpl)) ubah++; } catch(e){ err.push(o+': '+e.message); } });
  return {ok, ubah, err};
}
// Samakan semua sheet outlet dengan TEMPLATE (TEMPLATE adalah sumber daftar item)
function menuSinkron(){
  resetCache_();
  const r = sinkronSemua_();
  SpreadsheetApp.getUi().alert('Sinkron selesai.\n- Sheet outlet: '+r.ok+' diperiksa, '+r.ubah+' diperbarui.'+(r.err.length?'\n\nGagal:\n'+r.err.join('\n'):''));
}
// Jalankan sekali setelah update kode: rapikan KATALOG, siapkan item timbang, perbaiki rumus
function menuPerbarui(){
  resetCache_();
  const m = [rapikanKatalog_(), aktifkanTimbang_(), migrasiKonversiOutlet_(), perbaikiExpired_(), perbaikiHasil_()].filter(Boolean);
  SpreadsheetApp.getUi().alert('Perbarui struktur selesai:\n- '+m.join('\n- '));
}
function rapikanKatalog_(){
  const sh = ss_().getSheetByName(SH.CAT); if (!sh || sh.getLastRow() < 2) return 'KATALOG belum ada (jalankan Setup awal dulu)';
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8-sh.getMaxColumns());
  const baru = sh.getRange(1,8).getValue() !== 'OUTLET KHUSUS';
  sh.getRange(1,6,1,3).setValues([['SATUAN','TERBUKA (GRAM)','OUTLET KHUSUS']]).setFontWeight('bold');
  const n = sh.getLastRow()-1, v = sh.getRange(2,1,n,8).getValues();
  v.forEach(r=>{ const m = String(r[2]).match(/^(.*?)\s*\(([^)]+)\)\s*$/); if (m){ r[2] = m[1]; if (!r[5]) r[5] = m[2]; }
    if (baru && KHUSUS.indexOf(String(r[1]).trim()) >= 0 && !r[7]) r[7] = KHUSUS_OUTLET; });
  sh.getRange(2,1,n,8).setValues(v); resetCache_();
  return 'KATALOG: kolom SATUAN dan OUTLET KHUSUS siap (mesin vending hanya untuk '+KHUSUS_OUTLET+')';
}
/* ---------- rumus XLOOKUP (otomatis menyesuaikan pemisah , atau ; sesuai bahasa spreadsheet) ---------- */
function sep_(){
  const p = PropertiesService.getScriptProperties(); let s = p.getProperty('SEP'); if (s) return s;
  const ss = ss_(), t = ss.insertSheet('_tmp_sep_'); s = ',';
  try {
    t.getRange('A1').setValue('=SUM(1,2)'); SpreadsheetApp.flush();
    if (t.getRange('A1').getValue() !== 3){ t.getRange('A2').setValue('=SUM(1;2)'); SpreadsheetApp.flush(); if (t.getRange('A2').getValue() === 3) s = ';'; }
  } finally { ss.deleteSheet(t); }
  p.setProperty('SEP', s); return s;
}
function xl_(r, col){ const s = sep_(), m = "'"+SH.MST+"'"; return `=XLOOKUP($C${r}${s}${m}!$A:$A${s}${m}!$${col}:$${col}${s}"")`; }

function perbaikiExpired_(){
  PropertiesService.getScriptProperties().deleteProperty('SEP');
  const es = ss_().getSheetByName(SH.EXP), n = es ? es.getLastRow()-1 : 0;
  if (n < 1) return 'EXPIRED: masih kosong (dilewati)';
  resetCache_();
  if (es.getMaxColumns() < 9) es.insertColumnsAfter(es.getMaxColumns(), 9-es.getMaxColumns());
  es.getRange(1,9).setValue('Qty asli (gram)').setFontWeight('bold');
  const sp = sep_(), km = konv_(), v = es.getRange(2,1,n,9).getValues(), gf = es.getRange(2,7,n,1).getFormulas();
  let cv = 0;
  const out = v.map((r,i)=>{ const row = i+2, sku = String(r[2]).trim(), tmb = /^TMB-/.test(sku), k = km[sku], conv = !tmb && k && k.g > 0;
    const D = tmb ? [r[3], r[4], r[5]] : [xl_(row,'B'), xl_(row,'C'), xl_(row,'D')];
    if (conv){ cv++; return D.concat([qx_(row,sp,konvDes_(k)), r[7], r[8] !== '' ? r[8] : r[6]]); }
    return D.concat([gf[i][0] || r[6], r[7], r[8]]); });
  es.getRange(2,4,n,6).setValues(out);
  es.getRange(2,8,n,1).setNumberFormat('dd/mm/yyyy');
  SpreadsheetApp.flush();
  const t = es.getRange(2,4,1,1).getValue();
  return String(t).indexOf('#') === 0 ? 'EXPIRED: rumus masih error ('+t+'), cek sheet '+SH.MST+' dan SKU di kolom A'
    : 'EXPIRED: rumus diperbaiki ('+n+' baris), '+cv+' baris dikonversi ke satuan hasil (dibulatkan ke bawah)';
}

/* ---------- tools khusus: hitung ulang konversi sheet EXPIRED ---------- */
// Hanya menyentuh kolom G (Real Qty) dan I (Qty asli gram) di sheet EXPIRED.
//  - SKU yang ada di KONVERSI dan berat (kolom D) terisi -> G = ROUNDDOWN(gram / berat, 0), I = gram asli.
//  - SKU yang tadinya terkonversi tapi sudah dihapus / beratnya dikosongkan di KONVERSI -> G dikembalikan ke gram asli, I dikosongkan.
//  - Baris lain, kolom A-F dan H tidak diubah. Aman dijalankan berulang.
function konversiExpired_(){
  const es = ss_().getSheetByName(SH.EXP), n = es ? es.getLastRow()-1 : 0;
  if (n < 1) return 'Sheet EXPIRED masih kosong, tidak ada yang dihitung.';
  resetCache_();
  if (es.getMaxColumns() < 9) es.insertColumnsAfter(es.getMaxColumns(), 9-es.getMaxColumns());
  if (es.getRange(1,9).getValue() === '') es.getRange(1,9).setValue('Qty asli (gram)').setFontWeight('bold');
  const kv = konv_(), sp = sep_();
  const v = es.getRange(2,1,n,9).getValues(), gf = es.getRange(2,7,n,1).getFormulas();
  const G = [], I = [], tanpaBerat = {};
  let hit = 0, balik = 0, firstConv = 0;
  v.forEach((r,i)=>{
    const row = i+2, sku = String(r[2]).trim(), tmb = /^TMB-/.test(sku), k = kv[sku], conv = !tmb && k && k.g > 0;
    if (conv){
      G.push([qx_(row, sp, konvDes_(k))]); I.push([r[8] !== '' ? r[8] : r[6]]); hit++; if (!firstConv) firstConv = row;
    } else if (!tmb && r[8] !== ''){
      G.push([r[8]]); I.push(['']); balik++;
    } else {
      G.push([gf[i][0] || r[6]]); I.push([r[8]]);
      if (!tmb && k) tanpaBerat[sku] = 1;
    }
  });
  es.getRange(2,7,n,1).setValues(G);
  es.getRange(2,9,n,1).setValues(I);
  SpreadsheetApp.flush();
  let m = 'Selesai. '+hit+' baris dikonversi (dibulatkan ke bawah)';
  if (balik) m += ', '+balik+' baris dikembalikan ke gram (SKU sudah tidak dikonversi)';
  m += '.';
  const nb = Object.keys(tanpaBerat);
  if (nb.length) m += '\n\nSKU ada di KONVERSI tapi berat (kolom D) masih kosong, dilewati:\n'+nb.join(', ');
  if (firstConv){ const t = String(es.getRange(firstConv,7).getValue()); if (t.indexOf('#') === 0) m += '\n\nPeringatan: rumus masih error ('+t+'). Cek sheet '+SH.KNV+' dan pastikan SKU di kolom A sama.'; }
  return m;
}
function menuKonversiExpired(){
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Hitung ulang konversi EXPIRED', 'Kolom Real Qty (G) dan Qty asli gram (I) di sheet EXPIRED dihitung ulang sesuai sheet KONVERSI.\nKolom lain tidak diubah.\n\nLanjutkan?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert('Hitung ulang konversi EXPIRED', konversiExpired_(), ui.ButtonSet.OK);
}

/* ---------- DATA_ASLI: gram asli (sebelum konversi) per outlet, periode, SKU ---------- */
function rawSheet_(){
  const s = ss_(); let sh = s.getSheetByName(SH.RAW);
  if (!sh){ sh = s.insertSheet(SH.RAW); sh.getRange(1,1,1,4).setValues([['PERIODE','OUTLET','SKU','GRAM (SEBELUM KONVERSI)']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function rawMap_(outlet, periode){
  const sh = rawSheet_(), n = sh.getLastRow()-1, m = {}; if (n < 1) return m;
  sh.getRange(2,1,n,4).getValues().forEach(r=>{ if (r[0]===periode && r[1]===outlet) m[String(r[2]).trim()] = Number(r[3]); });
  return m;
}
function rawAdd_(periode, outlet, list){
  if (!list.length) return;
  const sh = rawSheet_(), st = Math.max(sh.getLastRow(),1)+1, end = st+list.length-1;
  if (end > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), end-sh.getMaxRows());
  sh.getRange(st,1,list.length,4).setValues(list.map(x=>[periode, outlet, x.sku, x.gram]));
}
function rawDel_(periode, outlet, sku){
  delRuns_(rawSheet_(), r=>r[0]===periode && r[1]===outlet && (!sku || String(r[2]).trim()===sku), 3);
}
// Nilai sheet outlet (hasil konversi) -> gram. Pakai gram asli kalau cocok; kalau sel diedit manual, dihitung nilai x berat.
function gramDari_(val, raw, k){
  if (val === '' || val === undefined || val === null) return '';
  const g = k && k.g > 0 ? k.g : 0, n = Number(val); if (isNaN(n) || !g) return val;
  if (raw !== undefined && raw !== '' && !isNaN(Number(raw)) && Math.abs(konvBagi_(raw, k) - n) < 1e-9) return Number(raw);
  return Math.round(n*g*1000)/1000;
}
function outCell_(cache, outlet, periode, sku){
  if (!(outlet in cache)){ const sh = outSheet_(outlet, false); let d = null;
    if (sh && sh.getLastRow() > 1 && sh.getLastColumn() >= 3){ const v = sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues(), rows = {};
      for (let r=1; r<v.length; r++) rows[String(v[r][0]).trim()] = r; d = {v, rows, h:v[0]}; }
    cache[outlet] = d; }
  const d = cache[outlet]; if (!d) return undefined;
  const ci = d.h.indexOf(periode), ri = d.rows[sku]; if (ci < 0 || ri === undefined) return undefined;
  return d.v[ri][ci];
}
// Ubah isi sheet outlet yang MASIH dalam gram menjadi hasil konversi (hanya SKU berkonversi yang belum punya catatan di DATA_ASLI).
// SKU di SKU_OUTLET_GRAM dilewati (di sheet outlet tetap gram).
// Aman dijalankan berulang: nilai yang sudah dikonversi lewat form/admin (punya catatan di DATA_ASLI) tidak diubah lagi.
function migrasiKonversiOutlet_(){
  resetCache_();
  const kv = konv_(), rsh = rawSheet_(), has = {};
  if (rsh.getLastRow() > 1) rsh.getRange(2,1,rsh.getLastRow()-1,3).getValues().forEach(r=>{ has[r[0]+'|'+r[1]+'|'+String(r[2]).trim()] = 1; });
  const add = []; let cells = 0, sheets = 0;
  outlets_().forEach(o=>{
    const sh = outSheet_(o, false); if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 4) return;
    const lr = sh.getLastRow(), lc = sh.getLastColumn(), v = sh.getRange(1,1,lr,lc).getValues(), cols = {};
    for (let c=3; c<lc; c++){
      const per = String(v[0][c]).trim(); if (!per || per === 'Tanggal') continue;
      for (let r=1; r<lr; r++){
        const sku = String(v[r][0]).trim(), k = kOut_(kv[sku]);
        if (!k || !(k.g > 0) || /^TMB-/.test(sku)) continue;
        const val = v[r][c]; if (val === '' || val === null || isNaN(Number(val))) continue;
        const key = per+'|'+o+'|'+sku; if (has[key]) continue;
        has[key] = 1; add.push([per, o, sku, Number(val)]);
        v[r][c] = konvBagi_(Number(val), k); cols[c] = 1; cells++;
      }
    }
    const ks = Object.keys(cols); if (!ks.length) return;
    ks.forEach(c=>{ const ci = Number(c); sh.getRange(2,ci+1,lr-1,1).setValues(v.slice(1).map(row=>[row[ci]])); });
    recalcC_(sh); sheets++;
  });
  if (add.length){
    const st = Math.max(rsh.getLastRow(),1)+1, end = st+add.length-1;
    if (end > rsh.getMaxRows()) rsh.insertRowsAfter(rsh.getMaxRows(), end-rsh.getMaxRows());
    rsh.getRange(st,1,add.length,4).setValues(add);
  }
  return 'Sheet outlet: '+cells+' nilai dikonversi ke satuan hasil di '+sheets+' sheet (gram asli disimpan di sheet '+SH.RAW+')';
}
function menuTerapkanKonversi(){
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Terapkan konversi', 'Sesuai sheet KONVERSI:\n- Sheet outlet: nilai SKU berkonversi disimpan dalam satuan hasil (gram asli disimpan di '+SH.RAW+'); SKU di SKU_OUTLET_GRAM tetap gram\n- EXPIRED dan HASIL_KONVERSI dihitung ulang\n\nAman dijalankan berulang (nilai yang sudah dikonversi tidak dikonversi lagi).\n\nLanjutkan?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const m = [migrasiKonversiOutlet_(), konversiExpired_(), perbaikiHasil_()];
  ui.alert('Terapkan konversi', '- '+m.join('\n\n- '), ui.ButtonSet.OK);
}

// Kembalikan nilai sheet outlet untuk SKU_OUTLET_GRAM ke GRAM asli (dari DATA_ASLI), lalu bersihkan catatan DATA_ASLI SKU tsb.
function perbaikiDesimalOutlet_(){
  resetCache_();
  const rsh = rawSheet_(), n = rsh.getLastRow()-1;
  if (n < 1) return 'DATA_ASLI kosong (dilewati)';
  const byOutlet = {};
  rsh.getRange(2,1,n,4).getValues().forEach(r=>{
    const sku = String(r[2]).trim(); if (SKU_OUTLET_GRAM.indexOf(sku) < 0) return;
    (byOutlet[r[1]] = byOutlet[r[1]] || []).push([String(r[0]), sku, Number(r[3])]);
  });
  let cells = 0, sheets = 0;
  Object.keys(byOutlet).forEach(o=>{
    const sh = outSheet_(o, false); if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 4) return;
    const v = sh.getRange(1,1,sh.getLastRow(),sh.getLastColumn()).getValues(), rows = {};
    for (let r=1; r<v.length; r++) rows[String(v[r][0]).trim()] = r+1;
    byOutlet[o].forEach(x=>{
      const c = v[0].indexOf(x[0]), row = rows[x[1]]; if (c < 0 || !row) return;
      sh.getRange(row, c+1).setValue(x[2]); cells++; // kembali ke gram
    });
    recalcC_(sh); sheets++;
  });
  const hapus = delRuns_(rsh, r=>SKU_OUTLET_GRAM.indexOf(String(r[2]).trim()) >= 0, 3);
  return 'Sheet outlet: '+cells+' nilai dikembalikan ke gram di '+sheets+' sheet ('+hapus+' catatan DATA_ASLI dibersihkan)';
}
function menuPerbaikiDesimal(){
  const ui = SpreadsheetApp.getUi();
  const m = [perbaikiDesimalOutlet_(), konversiExpired_(), perbaikiHasil_()];
  ui.alert('Perbaiki konversi berkoma', '- '+m.join('\n\n- '), ui.ButtonSet.OK);
}


/* ---------- item timbang (GRAM) ---------- */
function aktifkanTimbang_(){
  const sh = ss_().getSheetByName(SH.CAT); if (!sh || sh.getLastRow() < 2) return 'Item timbang: KATALOG belum ada';
  if (sh.getMaxColumns() < 7) sh.insertColumnsAfter(sh.getMaxColumns(), 7-sh.getMaxColumns());
  siapkanKonversi_(); resetCache_();
  const tm = Object.keys(konv_()).concat(TIMBANG), n = sh.getLastRow()-1, v = sh.getRange(2,1,n,7).getValues();
  v.forEach(r=>{ if (tm.indexOf(String(r[1]).trim()) >= 0){ r[5] = 'GRAM'; r[6] = 'N'; } });
  sh.getRange(2,1,n,7).setValues(v); resetCache_();
  return 'Item timbang: item di sheet KONVERSI berstatus GRAM di KATALOG (isi berat per satuan yang masih kosong di KONVERSI)';
}

/* =====================================================================
 *  ADMIN: login PIN, lihat & ubah data SO, master item, expired
 *  Semua fungsi admin* memerlukan PIN (kecuali monitoring getAdminData).
 * ===================================================================== */
function adminCheck_(pin){
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!real) throw new Error('AUTH: PIN admin belum diatur. Buka spreadsheet, menu SO Tools > Atur PIN admin.');
  const c = CacheService.getScriptCache(), fails = +c.get('pinfail') || 0;
  if (fails >= 5) throw new Error('AUTH: Terlalu banyak percobaan salah. Coba lagi dalam 10 menit.');
  if (String(pin||'') !== real){ c.put('pinfail', String(fails+1), 600); throw new Error('AUTH: PIN salah'); }
  if (fails) c.remove('pinfail');
}
function adminLogin(pin){ adminCheck_(pin); return {ok:true}; }
function adminLog_(aksi, outlet, periode, sku, detail){
  try {
    const s = ss_(); let sh = s.getSheetByName(SH.ADM);
    if (!sh){ sh = s.insertSheet(SH.ADM); sh.getRange(1,1,1,6).setValues([['WAKTU','AKSI','OUTLET','PERIODE','SKU','DETAIL']]).setFontWeight('bold'); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), aksi, outlet||'', periode||'', sku||'', detail||'']);
  } catch(e){}
}
function lastSent_(outlet, periode){
  const ls = ss_().getSheetByName(SH.LOG); if (!ls || ls.getLastRow() < 2) return '';
  const r = ls.getRange(2,1,ls.getLastRow()-1,3).getValues().find(x=>x[0]===outlet && x[1]===periode);
  return r ? fmtD_(r[2]) : '';
}
// ---- Data SO per outlet & periode
function adminGetSO(pin, outlet, periode){
  adminCheck_(pin);
  if (outlets_().indexOf(outlet) < 0) throw new Error('Outlet tidak valid');
  const jenis = /^BULAN/i.test(periode) ? 'BULANAN' : 'MINGGUAN', cat = catalog_(jenis, outlet), meta = {}, kv = konv_();
  base_().forEach(c=>{ meta[c.sku] = c; });
  const sh = outSheet_(outlet, false), vals = {}, names = {}; let hasCol = false;
  if (sh && sh.getLastRow() > 1){
    const lr = sh.getLastRow(), c = col_(sh, periode, false), ab = sh.getRange(2,1,lr-1,2).getValues(), v = c ? sh.getRange(2,c,lr-1,1).getValues() : null;
    hasCol = c > 0;
    ab.forEach((r,i)=>{ const sku = String(r[0]).trim(); if (!sku) return; names[sku] = String(r[1]||''); const val = v ? v[i][0] : ''; if (val !== '') vals[sku] = val; });
  }
  const rw = rawMap_(outlet, periode); // tampilkan kembali dalam gram (satuan awal)
  Object.keys(vals).forEach(sku=>{ const k = kOut_(kv[sku]); if (k && k.g > 0 && !/^TMB-/.test(sku)) vals[sku] = gramDari_(vals[sku], rw[sku], k); });
  const ex = {};
  rows_(SH.EXP,9).forEach(r=>{ if (r[0]===periode && r[1]===outlet){ const k = String(r[2]).trim(); (ex[k] = ex[k]||[]).push({d:dstr_(r[7]), q:Number(expRaw_(r))||0}); } });
  const rows = [], seen = {};
  const push = (sku, m, inCat)=>{
    if (seen[sku]) return; seen[sku] = 1;
    const tmb = /^TMB-/.test(sku), pn = parseNm_(names[sku]), e = (ex[sku]||[]).sort((a,b)=>a.d<b.d?-1:1), val = vals[sku] === undefined ? '' : vals[sku];
    const expFlag = m ? m.exp : tmb;
    rows.push({sku, nama: tmb ? (pn.n || sku) : (m ? m.nama : (names[sku] || sku)), kat: m ? m.kat : (tmb ? 'TAMBAHAN' : 'LAINNYA'), unit: m ? m.unit : (pn.u || 'PCS'),
      val, exp:e, tmb, expFlag, inCat, kv: kv[sku] || null, need: expFlag && Number(val) > 0 && !e.length});
  };
  cat.forEach(c=>push(c.sku, meta[c.sku], true));
  Object.keys(vals).forEach(sku=>push(sku, meta[sku], false));
  return {rows, hasCol, total: cat.length, filled: cat.filter(c=>vals[c.sku] !== undefined).length, sent: lastSent_(outlet, periode), frozen: frozen_(periode), jenis};
}
function adminSaveItem(pin, p){
  adminCheck_(pin);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (outlets_().indexOf(p.outlet) < 0) throw new Error('Outlet tidak valid');
    const periode = String(p.periode||''); if (!periode) throw new Error('Periode kosong');
    const ex = (p.exp||[]).filter(x=>x && x.d && Number(x.q) > 0).map(x=>({q:Number(x.q), d:toDate_(x.d)}));
    let val = Number(p.val);
    if (ex.length) val = ex.reduce((s,x)=>s+x.q, 0);
    if (!isFinite(val) || val < 0) throw new Error('Jumlah harus angka 0 atau lebih');
    const sh = outSheet_(p.outlet, true); resetCache_();
    sinkron_(sh, tplList_());
    const last = Math.max(sh.getLastRow(), 1);
    const skus = last > 1 ? sh.getRange(2,1,last-1,1).getValues().map(r=>String(r[0]).trim()) : [];
    let sku = String(p.sku||'').trim(), unit = String(p.unit||'PCS').toUpperCase();
    const nama = String(p.nama||'').trim(), meta = {}; base_().forEach(c=>{ meta[c.sku] = c; });
    if (!sku){
      if (!nama) throw new Error('Nama barang wajib diisi');
      const mx = Math.max(0, ...skus.filter(s=>/^TMB-/.test(s)).map(s=>+s.slice(4)));
      sku = 'TMB-'+String(mx+1).padStart(3,'0');
    }
    const tmb = /^TMB-/.test(sku); let idx = skus.indexOf(sku), rowNum;
    if (idx < 0){
      if (!tmb && !meta[sku]) throw new Error('SKU '+sku+' tidak ada di TEMPLATE');
      rowNum = last+1; if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
      sh.getRange(rowNum,1,1,2).setValues([[sku, tmb ? nama+' ('+unit+')' : meta[sku].nama]]);
    } else {
      rowNum = idx+2;
      if (tmb && nama) sh.getRange(rowNum,2).setValue(nama+' ('+unit+')');
    }
    const c = col_(sh, periode, true);
    const kvi = kOut_(konv_()[sku]), g = (!tmb && kvi && kvi.g > 0) ? kvi.g : 0;
    sh.getRange(rowNum,c).setValue(g ? konvBagi_(val, kvi) : val); // sheet outlet = hasil konversi (kecuali SKU_OUTLET_GRAM: tetap gram)
    rawDel_(periode, p.outlet, sku); if (g) rawAdd_(periode, p.outlet, [{sku, gram:val}]);
    const lc = sh.getLastColumn(); sh.getRange(rowNum,3).setValue(lc >= 4 ? lastVal_(sh.getRange(rowNum,4,1,lc-3).getValues()[0]) : '');
    // EXPIRED
    delRuns_(ss_().getSheetByName(SH.EXP), r=>r[0]===periode && r[1]===p.outlet && String(r[2]).trim()===sku, 3);
    const pn = tmb ? parseNm_(sh.getRange(rowNum,2).getValue()) : {n:'', u:''};
    expAdd_(periode, p.outlet, ex.map(x=>({sku, name:pn.n, unit:pn.u, q:x.q, d:x.d})));
    // HASIL_KONVERSI
    const hs = ss_().getSheetByName(SH.HSL);
    if (hs && konv_()[sku]){ delRuns_(hs, r=>r[0]===periode && r[1]===p.outlet && String(r[2]).trim()===sku, 3); hasilAdd_(periode, p.outlet, [{sku, gram:val}]); }
    adminLog_('UBAH ITEM', p.outlet, periode, sku, 'jumlah='+val+(ex.length?'; expired='+ex.map(x=>dstr_(x.d)+'x'+x.q).join(','):''));
    return {ok:true, sku};
  } finally { lock.releaseLock(); }
}
function adminDeleteItem(pin, p){
  adminCheck_(pin);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = outSheet_(p.outlet, false); if (!sh) throw new Error('Sheet outlet tidak ditemukan');
    const sku = String(p.sku||'').trim(), row = findRow_(sh, sku, 1), c = col_(sh, p.periode, false);
    if (row && c){ sh.getRange(row,c).clearContent(); const lc = sh.getLastColumn(); sh.getRange(row,3).setValue(lc >= 4 ? lastVal_(sh.getRange(row,4,1,lc-3).getValues()[0]) : ''); }
    delRuns_(ss_().getSheetByName(SH.EXP), r=>r[0]===p.periode && r[1]===p.outlet && String(r[2]).trim()===sku, 3);
    delRuns_(ss_().getSheetByName(SH.HSL), r=>r[0]===p.periode && r[1]===p.outlet && String(r[2]).trim()===sku, 3);
    rawDel_(p.periode, p.outlet, sku);
    adminLog_('KOSONGKAN ITEM', p.outlet, p.periode, sku, '');
    return {ok:true};
  } finally { lock.releaseLock(); }
}
function adminClearSO(pin, outlet, periode){
  adminCheck_(pin);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = outSheet_(outlet, false);
    if (sh && sh.getLastRow() > 1){ const c = col_(sh, periode, false); if (c){ sh.getRange(2,c,sh.getLastRow()-1,1).clearContent(); recalcC_(sh); } }
    const ss = ss_();
    delRuns_(ss.getSheetByName(SH.EXP), r=>r[0]===periode && r[1]===outlet, 2);
    delRuns_(ss.getSheetByName(SH.HSL), r=>r[0]===periode && r[1]===outlet, 2);
    delRuns_(ss.getSheetByName(SH.LOG), r=>r[0]===outlet && r[1]===periode, 2);
    rawDel_(periode, outlet);
    const dr = findDraft_(outlet, periode); if (dr) drafts_().deleteRow(dr);
    adminLog_('RESET SO', outlet, periode, '', 'seluruh isian periode dikosongkan');
    return {ok:true};
  } finally { lock.releaseLock(); }
}
// ---- Master item (TEMPLATE A:B + KATALOG + KONVERSI)
function adminGetMaster(pin){
  adminCheck_(pin); resetCache_();
  const items = base_().map(c=>({sku:c.sku, nama:c.nama, kat:c.kat, unit:c.unit, ming:c.ming, exp:c.exp, khusus:c.khusus, inKat:c.inKat, kv:c.kv}));
  const cats = []; items.forEach(i=>{ if (cats.indexOf(i.kat) < 0) cats.push(i.kat); });
  return {items, cats, wcol: konvInfo_().wcol};
}
function katSheet_(){
  const s = ss_(); let sh = s.getSheetByName(SH.CAT);
  if (!sh){ sh = s.insertSheet(SH.CAT); sh.getRange(1,1,1,8).setValues([['KATEGORI','SKU','NAMA BARANG','MINGGUAN','EXPIRED','SATUAN','TERBUKA (GRAM)','OUTLET KHUSUS']]).setFontWeight('bold'); sh.setFrozenRows(1); }
  if (sh.getMaxColumns() < 8) sh.insertColumnsAfter(sh.getMaxColumns(), 8-sh.getMaxColumns());
  return sh;
}
function adminSaveMaster(pin, p){
  adminCheck_(pin);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sku = String(p.sku||'').trim(), nama = String(p.nama||'').trim(), kat = String(p.kat||'').trim().toUpperCase();
    let unit = String(p.unit||'PCS').trim().toUpperCase();
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(sku) || /^TMB-/i.test(sku)) throw new Error('SKU hanya huruf, angka, - atau _ (2-30 karakter) dan tidak boleh berawalan TMB-');
    if (!nama) throw new Error('Nama barang wajib diisi');
    if (!kat) throw new Error('Kategori wajib diisi');
    const g = Number(p.berat) || 0;
    if (p.timbang){ unit = 'GRAM'; }
    resetCache_();
    const tpl = ss_().getSheetByName(SH.TPL); if (!tpl) throw new Error('Sheet TEMPLATE tidak ditemukan');
    const row = findRow_(tpl, sku, 1);
    if (p.isNew && row) throw new Error('SKU '+sku+' sudah ada di TEMPLATE');
    if (!p.isNew && !row) throw new Error('SKU '+sku+' tidak ditemukan di TEMPLATE');
    if (row) tpl.getRange(row,2).setValue(nama);
    else {
      const list = base_(); let at = -1; list.forEach((c,i)=>{ if (c.kat === kat) at = i; });
      const ref = at >= 0 ? findRow_(tpl, list[at].sku, 1) : 0;
      if (ref){ tpl.insertRowAfter(ref); tpl.getRange(ref+1,1,1,2).setValues([[sku, nama]]); }
      else { const nr = tpl.getLastRow()+1; if (nr > tpl.getMaxRows()) tpl.insertRowsAfter(tpl.getMaxRows(), 1); tpl.getRange(nr,1,1,2).setValues([[sku, nama]]); }
    }
    const ks = katSheet_(), kr = findRow_(ks, sku, 2), rv = [kat, sku, nama, p.ming?'Y':'N', p.exp?'Y':'N', unit, 'N', String(p.khusus||'').trim()];
    if (kr) ks.getRange(kr,1,1,8).setValues([rv]); else ks.getRange(Math.max(ks.getLastRow(),1)+1,1,1,8).setValues([rv]);
    // KONVERSI
    const kn = ss_().getSheetByName(SH.KNV);
    if (p.timbang){
      siapkanKonversi_(); const k2 = ss_().getSheetByName(SH.KNV), w = konvInfo_().wcol, sat = String(p.satuanHasil||'PCS').trim().toUpperCase();
      const vv = w === 'C' ? [sku, nama, g || ''] : [sku, nama, sat, g || '']; const r2 = findRow_(k2, sku, 1);
      if (r2) k2.getRange(r2,1,1,vv.length).setValues([vv]); else k2.getRange(Math.max(k2.getLastRow(),1)+1,1,1,vv.length).setValues([vv]);
    } else if (kn){ const r2 = findRow_(kn, sku, 1); if (r2) kn.deleteRow(r2); }
    resetCache_();
    adminLog_(p.isNew ? 'TAMBAH MASTER' : 'UBAH MASTER', '', '', sku, nama+' | '+kat);
    return {ok:true};
  } finally { lock.releaseLock(); }
}
function adminDeleteMaster(pin, sku){
  adminCheck_(pin);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    sku = String(sku||'').trim(); const ss = ss_();
    [[SH.TPL,1],[SH.CAT,2],[SH.KNV,1]].forEach(x=>{ const sh = ss.getSheetByName(x[0]), r = sh ? findRow_(sh, sku, x[1]) : 0; if (r) sh.deleteRow(r); });
    resetCache_(); adminLog_('HAPUS MASTER', '', '', sku, '');
    return {ok:true};
  } finally { lock.releaseLock(); }
}
function adminSyncAll(pin){
  adminCheck_(pin); resetCache_();
  const r = sinkronSemua_(); adminLog_('SINKRON', '', '', '', r.ok+' diperiksa, '+r.ubah+' diperbarui');
  return r;
}
// ---- Rekap tanggal expired lintas outlet
function adminGetExpired(pin){
  adminCheck_(pin);
  const meta = {}; base_().forEach(c=>{ meta[c.sku] = c; });
  const ok = v=>v !== '' && v !== null && v !== undefined && String(v).charAt(0) !== '#';
  const rows = rows_(SH.EXP,8).filter(r=>r[0] && r[1] && r[2]).map(r=>{ const sku = String(r[2]).trim(), m = meta[sku];
    return {p:String(r[0]), pd:pdate_(norm_(r[0])), o:String(r[1]), sku, nama: ok(r[3]) ? String(r[3]) : (m ? m.nama : sku), unit: ok(r[4]) ? String(r[4]) : (m ? m.unit : ''),
      kat: ok(r[5]) ? String(r[5]) : (m ? m.kat : ''), q:Number(r[6])||0, d:dstr_(r[7])}; }).filter(r=>r.d && r.q > 0);
  return {rows, today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')};
}