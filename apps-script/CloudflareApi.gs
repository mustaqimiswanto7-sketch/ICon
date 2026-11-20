/**
 * CLOUDFLARE API + REALTIME INVALIDATION
 *
 * Ganti isi file CloudflareApi.gs lama dengan file ini.
 * Mempertahankan kontrak yang sudah dipakai functions/api/rpc.js:
 * { secret, function, args } -> { ok:true, data } / { ok:false, error }
 *
 * Script Properties:
 * CLOUDFLARE_API_SECRET = sama persis dengan Cloudflare GAS_API_SECRET.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('CLOUDFLARE_API_SECRET');

    if (!expected || !body.secret || body.secret !== expected) {
      return jsonRpc_({ ok: false, error: 'Unauthorized' });
    }

    var fn = String(body.function || '');
    var args = Array.isArray(body.args) ? body.args : [];

    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(fn) || fn === 'doGet' || fn === 'doPost') {
      return jsonRpc_({ ok: false, error: 'Nama fungsi tidak diizinkan.' });
    }

    // Fungsi internal dengan underscore tidak boleh dipanggil melalui RPC.
    if (fn.charAt(0) === '_' || fn.slice(-1) === '_') {
      return jsonRpc_({ ok: false, error: 'Fungsi internal tidak dapat dipanggil melalui RPC.' });
    }

    var target = this[fn];
    if (typeof target !== 'function') {
      return jsonRpc_({ ok: false, error: 'Fungsi backend tidak ditemukan: ' + fn });
    }

    var result = target.apply(null, args);

    // Versi modul hanya dinaikkan setelah fungsi write berhasil.
    if (typeof portalSyncAfterRpcWrite_ === 'function') {
      portalSyncAfterRpcWrite_(fn, args, result);
    }

    return jsonRpc_({ ok: true, data: result === undefined ? null : result });
  } catch (err) {
    return jsonRpc_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function jsonRpc_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
