# PORTAL OPERASIONAL — REPOSITORY SIAP UPLOAD

Paket ini menggabungkan:
- Frontend dan konfigurasi Cloudflare dari `InvCon.zip`.
- Backend Apps Script dan sinkronisasi dari `PORTAL-OPERASIONAL-PAKET-FINAL(1).zip`.
- `appsscript.json` dengan scope `drive.readonly` yang diminta.

## 1. Struktur repository

```text
repository/
├── cloudflare-pages/                 <-- Root directory Cloudflare Pages
│   ├── index.html
│   ├── _routes.json
│   ├── assets/
│   │   └── js/
│   │       └── portal-sync.js
│   └── functions/
│       └── api/
│           └── rpc.js
│
├── apps-script/                      <-- Sumber backend, bukan output Pages
│   ├── appsscript.json
│   ├── Code.gs
│   ├── CodeAdmin.gs
│   ├── CloudflareApi.gs
│   ├── CacheManager.gs
│   ├── RealtimeSync.gs
│   ├── Jadwal.gs
│   └── Ctl_*.gs
│
└── README-DEPLOY.md
```

**Penting:** Ekstrak ZIP, lalu unggah isi ZIP ini ke root repository GitHub. Jangan mengunggah folder pembungkus ZIP tambahan. Jangan memasukkan folder `.git` dari arsip lama.

## 2. Perbandingan dua arsip

- `index.html` pada kedua arsip identik byte-for-byte.
- `_routes.json` pada kedua arsip identik.
- `functions/api/rpc.js` pada paket final menambahkan `cache: 'no-store'` pada request ke Apps Script. Versi paket final dipakai.
- `portal-sync.js` tersedia di paket final, tetapi tidak ada di ZIP `InvCon.zip`; sekarang sudah disertakan.
- Source Apps Script dari paket final disertakan di folder terpisah `apps-script/`.
- Folder `.git` internal yang ikut terbawa pada ZIP `InvCon.zip` sengaja tidak disertakan.

## 3. Pengaturan Cloudflare Pages

Karena folder frontend berada di `cloudflare-pages/`, gunakan:

| Pengaturan | Nilai |
|---|---|
| Framework preset | `None` |
| Root directory | `cloudflare-pages` |
| Build command | Kosong |
| Build output directory | `.` |

Jangan isi Root directory dengan teks `root repository`. Jangan isi output directory dengan nama repository. Root directory harus tepat `cloudflare-pages`.

Setelah konfigurasi disimpan, jalankan deployment baru. Pada log build, Cloudflare seharusnya menemukan `functions` di direktori root proyek Pages. Jika log masih menyatakan `No functions dir at /functions found`, periksa kembali Root directory dan pastikan folder `cloudflare-pages/functions/api/rpc.js` sudah ada pada commit yang dideploy.

## 4. Environment variables Cloudflare

Tambahkan pada Pages → Settings → Variables and Secrets, untuk Production (dan Preview bila diperlukan):

| Variable | Isi |
|---|---|
| `GAS_WEB_APP_URL` | URL Apps Script Web App aktif, berakhiran `/exec` |
| `GAS_API_SECRET` | Secret acak minimal 32 karakter |

`GAS_API_SECRET` harus sama persis dengan Script Property `CLOUDFLARE_API_SECRET` di Apps Script. Jangan letakkan secret pada `index.html` atau file JavaScript frontend.

Setelah mengubah environment variables, lakukan deployment ulang agar deployment baru menggunakan nilai tersebut.

## 5. Pemasangan Apps Script

Folder `apps-script/` adalah sumber untuk project Apps Script, bukan bagian dari output Cloudflare Pages.

1. Buka project Apps Script backend yang memang digunakan Portal Operasional.
2. Backup kode project saat ini.
3. Cocokkan dan pasang file `.gs` dari folder `apps-script/`. Untuk file yang sudah ada, ganti isi hanya setelah memastikan file paket adalah versi yang dimaksud.
4. Pastikan hanya ada satu fungsi `doPost(e)` dalam project. `CloudflareApi.gs` menyediakan `doPost(e)`.
5. Aktifkan tampilan `appsscript.json` dan cocokkan manifest yang disertakan. Manifest paket mempertahankan konfigurasi dan library yang diberikan, serta menambahkan scope `drive.readonly`.
6. Pada Project Settings → Script Properties, buat `CLOUDFLARE_API_SECRET` dengan nilai yang sama persis dengan `GAS_API_SECRET`.
7. Jalankan `initializePortalSyncVersions()` satu kali.
8. Jalankan `installPortalSyncTriggers()` satu kali dan setujui otorisasi.
9. Deploy Apps Script sebagai Web App versi baru:
   - Execute as: User deploying / Me
   - Who has access: Anyone
10. Pastikan `GAS_WEB_APP_URL` di Cloudflare mengarah ke URL `/exec` deployment aktif.

Trigger spreadsheet pada `RealtimeSync.gs` menggunakan ID spreadsheet yang tertulis di source paket. Verifikasi ID tersebut cocok dengan file produksi sebelum menjalankan `installPortalSyncTriggers()`.

## 6. Pengujian endpoint

Endpoint API yang disediakan adalah:

`POST https://DOMAIN-PAGES/api/rpc`

Membuka `/api/rpc` langsung pada address bar mengirim GET, sedangkan handler ini menyediakan POST dan OPTIONS. Uji POST, misalnya:

```bash
curl -i -X POST "https://DOMAIN-PAGES/api/rpc" \
  -H "Content-Type: application/json" \
  -d '{"function":"getPortalVersions","args":[]}'
```

Respons `getPortalVersions` yang berhasil memiliki bentuk `{ "ok": true, "data": { ... } }`.

Interpretasi hasil:
- **404**: Pages Function tidak terdeteksi/ter-deploy atau URL/path salah. Periksa Root directory, commit, dan `functions/api/rpc.js`.
- **500 dengan pesan konfigurasi Cloudflare**: `GAS_WEB_APP_URL` atau `GAS_API_SECRET` belum tersedia pada environment deployment.
- **502**: proxy gagal menghubungi Apps Script atau respons upstream bukan JSON; periksa URL `/exec`, deployment Web App, dan Apps Script Executions.
- **`Unauthorized`**: nilai secret Cloudflare dan Script Properties tidak sama.
- **Fungsi backend tidak ditemukan**: nama fungsi tidak tersedia di project Apps Script atau belum dipasang.

## 7. Batas sinkronisasi

- Saat tab portal terlihat, frontend memeriksa versi modul setiap 3 detik.
- Saat tab disembunyikan, polling dihentikan; ketika kembali terlihat, pemeriksaan dijalankan lagi.
- Edit manual pada spreadsheet yang terdaftar ditangani oleh trigger `onEdit`.
- Fallback memeriksa waktu perubahan file kira-kira setiap satu menit.
- Apps Script tidak dapat menjamin polling 3 detik ketika semua browser tertutup.
- Penulisan dari fungsi Apps Script tidak memicu `onEdit`; fungsi write harus mengirim invalidasi versi setelah sukses. Paket memiliki pemetaan fungsi RPC yang dikenal pada `portalSyncAfterRpcWrite_()`.

## 8. Catatan kelengkapan

Paket sumber final menyebut `SoForm.html` dan `SoPanel.html` tidak tersedia pada arsip sumber. Keduanya tidak dibuat-buat dalam paket ini. Jika halaman crew terpisah tersebut masih diperlukan, file aslinya harus ditambahkan dari project Apps Script sebelum menganggap rute/fitur tersebut lengkap.

Paket ini menggabungkan file yang tersedia; pengujian deployment pada akun Cloudflare dan Apps Script produksi tetap perlu dilakukan.
