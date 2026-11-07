/* ---------- Stok awal massal: isi stok dan HPP awal banyak item sekaligus ----------
   Memakai RPC stock.adjust yang sama dengan lembar Penyesuaian (satu panggilan per item, alasan "Stok awal"). Server mencatat penyesuaian PERTAMA sebuah item sebagai saldo
   pembukaan (tanpa kerugian); penyesuaian berikutnya dihitung opname dan diakui sebagai kerugian persediaan. Karena itu layar ini hanya menampilkan item yang belum pernah diisi
   (stok 0 dan HPP 0). Penyimpanan berurutan; yang gagal tetap tampil dengan pesannya, yang berhasil keluar dari daftar, jadi mengulang simpan selalu aman.
   Nama berkas 1395 agar urutan build jatuh sesudah 139-* dan sebelum 14-mulai.js (penutup IIFE). ---------- */
const SA = {t: 'varian', v: {}, f: {}};   // t: tab aktif; v: isian per kunci "tipe:id" -> {s: stok, h: hpp}; f: pesan galat per kunci
const saKey = (t, id) => t + ':' + id;
function saItems(t) {   // item yang belum pernah diisi; peran tanpa akses HPP tidak menerima hpp_rata2, jadi hanya stok yang diperiksa
  const src = t === 'bahan' ? S.data.materials : S.data.variants;
  return src.filter(x => !(Number(x.stok) > 0) && !(Number(x.hpp_rata2) > 0)).map(x => ({k: saKey(t, x.id), id: x.id, t: t, name: t === 'bahan' ? String(x.nama) : String(vName(x)), sub: t === 'bahan' ? '' : String(vSub(x)), unit: t === 'bahan' ? String(x.satuan || '') : 'pcs'}))
    .sort((a, b) => a.name.localeCompare(b.name, 'id') || a.sub.localeCompare(b.sub, 'id'));
}
const saAll = () => saItems('varian').concat(can('materials') ? saItems('bahan') : []);
const saFilled = () => saAll().filter(r => SA.v[r.k] && String(SA.v[r.k].s == null ? '' : SA.v[r.k].s).trim() !== '');
function saCount() {   // tombol simpan mengikuti jumlah baris yang sudah diisi, tanpa menggambar ulang daftar (isian tidak hilang)
  const b = /** @type {any} */ ($('#sa_save')); if (!b) return; const n = saFilled().length;
  b.disabled = !n; b.textContent = n ? 'Simpan ' + num(n) + ' item' : 'Isi jumlah stok dulu';
}
function vStokAwal() {
  const mat = can('materials'), t = SA.t === 'bahan' && mat ? 'bahan' : 'varian', nv = saItems('varian').length, nb = mat ? saItems('bahan').length : 0, rows = saItems(t);
  const row = r => { const v = SA.v[r.k] || {}, f = SA.f[r.k];
    return '<div class="u-blk li sa-row"><div class="st-n"><b>' + esc(r.name) + '</b>' + (r.sub ? '<div class="muted">' + esc(r.sub) + '</div>' : '') + '</div>' +
      '<div class="row2"><label>Stok' + (r.unit ? ' (' + esc(r.unit) + ')' : '') + '<input class="inp" inputmode="decimal" data-sa="s" data-k="' + esc(r.k) + '" value="' + esc(v.s == null ? '' : v.s) + '"></label>' +
      '<label>HPP' + (r.unit ? ' / ' + esc(r.unit) : '') + ' (Rp)<input class="inp" inputmode="decimal" data-sa="h" data-k="' + esc(r.k) + '" value="' + esc(v.h == null ? '' : v.h) + '"></label></div>' + (f ? '<div class="err" role="alert">' + esc(f) + '</div>' : '') + '</div>'; };
  $('#main').innerHTML = '<button class="u-as-start u-mb-s3 chip" data-act="tab" data-t="stok">← Stok</button>' +
    '<div class="u-blk li"><b>Isi stok awal</b><p class="muted">Isi jumlah stok yang ada sekarang untuk item yang belum pernah diisi. Kosongkan baris yang tidak perlu. HPP awal (harga pokok per satuan) boleh dikosongkan, tetapi tanpa itu laba belum akurat. Setelah tersimpan, perubahan berikutnya dihitung sebagai opname.</p></div>' +
    (mat ? wrapChips('<button class="chip ' + (t === 'varian' ? 'on' : '') + '" data-act="sa_tab" data-s="varian">Produk jadi (' + num(nv) + ')</button><button class="chip ' + (t === 'bahan' ? 'on' : '') + '" data-act="sa_tab" data-s="bahan">Bahan dan kemasan (' + num(nb) + ')</button>') : '') +
    (rows.length ? rows.map(row).join('') : emptyState('stok', 'Semua item sudah punya stok awal', 'Untuk mengoreksi jumlah, ketuk item di layar Stok.', '<button class="btn sec" data-act="tab" data-t="stok">Kembali ke Stok</button>')) +
    '<div class="savebar"><button class="btn pri" id="sa_save" data-act="sa_save" disabled>Isi jumlah stok dulu</button></div>';
  saCount();
}
async function saSave() {
  if (!navigator.onLine) return toast('Perlu koneksi internet');
  const rows = saFilled(); if (!rows.length) return toast('Isi jumlah stok minimal satu item');
  let bad = 0; const body = [];
  rows.forEach(r => {   // cek semua isian dulu: satu isian salah tidak boleh membuat sebagian tersimpan diam-diam
    const s = dnum(SA.v[r.k].s), hs = String(SA.v[r.k].h == null ? '' : SA.v[r.k].h).trim(), h = hs === '' ? '' : dnum(hs);
    if (!(s >= 0)) { SA.f[r.k] = 'Stok tidak valid. Isi angka 0 atau lebih.'; bad++; } else if (h !== '' && !(h >= 0)) { SA.f[r.k] = 'HPP tidak valid. Isi angka 0 atau lebih, atau kosongkan.'; bad++; } else { delete SA.f[r.k]; body.push({r: r, s: s, h: h}); }
  });
  if (bad) { vStokAwal(); const e = /** @type {any} */ (document.querySelector('#main .sa-row .err')); if (e && e.scrollIntoView) e.scrollIntoView({block: 'center'}); return toast(bad + ' isian perlu diperbaiki'); }
  return busy('Menyimpan stok awal…', async () => {
    let ok = 0, fail = 0, noHpp = 0, expired = false;
    for (const x of body) {
      if (expired) break;
      try {
        const res = await api('stock.adjust', {tipe: x.r.t, id: x.r.id, stok_baru: x.s, hpp: x.h, alasan: 'Stok awal'});
        const it = x.r.t === 'bahan' ? S.data.materials.find(m => m.id === x.r.id) : vById(x.r.id); if (it) { it.stok = res.stok; it.hpp_rata2 = res.hpp_rata2; }
        delete SA.v[x.r.k]; delete SA.f[x.r.k]; ok++; if (x.h === '' && !(Number(res.hpp_rata2) > 0)) noHpp++;
      } catch (e) { if (e.auth) expired = true; SA.f[x.r.k] = e.auth ? 'Sesi berakhir, silakan masuk lagi.' : e.message; fail++; }
    }
    LS.set('data', S.data); if (S.tab === 'stokawal') vStokAwal();
    toast(expired ? 'Sesi berakhir, silakan masuk lagi' : fail ? ok + ' tersimpan, ' + fail + ' gagal. Lihat pesan di barisnya.' : ok + ' item tersimpan' + (noHpp ? '. ' + noHpp + ' belum punya HPP.' : ''));
  });
}
document.addEventListener('input', e => {
  const t = /** @type {any} */ (e.target); if (S.tab !== 'stokawal' || !t || !t.dataset || !t.dataset.sa) return;
  const k = t.dataset.k; (SA.v[k] = SA.v[k] || {})[t.dataset.sa] = t.value; saCount();
});
TAB_TITLE.stokawal = 'Stok awal'; TAB_CAP.stokawal = 'stockedit'; APP.views.stokawal = vStokAwal;
Object.assign(ACT, {go_sawal: () => { S.tab = 'stokawal'; render(); }, sa_tab: el => { SA.t = el.dataset.s; vStokAwal(); }, sa_save: saSave});
