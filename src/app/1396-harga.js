/* ---------- Tabel harga jual: semua varian x channel dalam satu layar ----------
   Dulu: satu baris harga per varian x channel (3 varian x 2 channel = 6 baris), dan form mengharuskan memilih varian dan channel satu per satu.
   Sekarang: satu kartu per varian dengan satu isian per channel. Hanya sel yang berubah yang disimpan, lewat master.save (upsert pada pasangan varian + channel)
   yang sama dengan form lama, satu panggilan per sel. Sel yang gagal tetap tampil dengan pesannya, yang berhasil kembali ke nilai tersimpan, jadi mengulang simpan selalu aman.
   Menghapus satu harga tetap lewat daftar lama di bagian bawah. Nama berkas 1396 agar urutan build jatuh sesudah 1395-* dan sebelum 14-mulai.js (penutup IIFE). ---------- */
const HGR = {v: {}, f: {}};   // v: isian per kunci "variantId|channelId" (hanya sel yang pernah diubah); f: pesan galat per kunci
const hgKey = (vid, cid) => vid + '|' + cid;
const hgChans = () => (S.data.channels || []).filter(c => String(c.aktif) !== 'false');
const hgVars = () => (S.data.variants || []).slice().sort((a, b) => String(vName(a)).localeCompare(String(vName(b)), 'id') || String(vSub(a)).localeCompare(String(vSub(b)), 'id'));
/* Sel yang diubah dibanding harga tersimpan. Isian kosong pada harga yang belum ada = dilewati; kosong pada harga yang sudah ada = galat (menghapus lewat daftar di bawah). */
function hgChanges() {
  const out = [];
  hgVars().forEach(v => hgChans().forEach(c => {
    const k = hgKey(v.id, c.id); if (!(k in HGR.v)) return;
    const raw = String(HGR.v[k] == null ? '' : HGR.v[k]).trim(), cur = priceOf(v.id, c.id), n = raw === '' ? NaN : dnum(raw);
    if (raw === '') { if (cur != null) out.push({k: k, v: v, c: c, n: NaN, bad: 'Harga tidak boleh kosong. Untuk menghapus harga, pakai daftar di bagian bawah.'}); return; }
    if (!(n >= 0) || !isFinite(n)) { out.push({k: k, v: v, c: c, n: n, bad: 'Harga tidak valid. Isi angka 0 atau lebih.'}); return; }
    if (cur == null || Math.round(n) !== Math.round(cur)) out.push({k: k, v: v, c: c, n: Math.round(n), bad: ''});
  }));
  return out;
}
function hgCount() {   // tombol simpan mengikuti jumlah sel yang berubah, tanpa menggambar ulang kartu (isian tidak hilang)
  const b = /** @type {any} */ ($('#hg_save')); if (!b) return; const n = hgChanges().length;
  b.disabled = !n; b.textContent = n ? 'Simpan ' + num(n) + ' harga' : 'Ubah harga dulu';
}
function hargaBody() {
  const chs = hgChans(), vs = hgVars();
  if (!vs.length) return emptyState('katalog', 'Belum ada varian', 'Harga jual dipasang per varian. Buat produk dan variannya dulu.', '<button class="btn sec" data-act="mt" data-k="product_variants">Buka Varian</button>');
  if (!chs.length) return emptyState('katalog', 'Belum ada channel', 'Harga jual dipasang per channel (mis. Offline, Shopee). Buat channel dulu.', '<button class="btn sec" data-act="mt" data-k="channels">Buka Channel</button>');
  let last = null;
  const cell = (v, c) => {
    const k = hgKey(v.id, c.id), cur = priceOf(v.id, c.id), val = k in HGR.v ? HGR.v[k] : (cur == null ? '' : rpIn(String(Math.round(cur)))), f = HGR.f[k];
    return '<label>' + esc(c.nama) + ' (Rp)<input class="inp" inputmode="numeric" autocomplete="off" data-rp data-hg="' + esc(k) + '" placeholder="belum ada" value="' + esc(val) + '"></label>' + (f ? '<div class="err" role="alert">' + esc(f) + '</div>' : '');
  };
  const rows = vs.map(v => {
    const head = vName(v) !== last ? '<h3 class="hg-h">' + esc(vName(v)) + '</h3>' : ''; last = vName(v);
    return head + '<div class="u-blk li hg-row"><div class="st-n"><b>' + esc(vSub(v) || 'Satu ukuran') + '</b></div><div class="hg-cells">' + chs.map(c => '<div class="hg-c">' + cell(v, c) + '</div>').join('') + '</div></div>';
  }).join('');
  const old = (S.data.prices || []).map(r => '<button class="li-flat li" data-act="medit" data-id="' + esc(r.id) + '"><span>' + esc(MT.channel_prices.t(r)) + '</span><span class="muted">Ubah</span></button>').join('');
  return '<div class="u-blk li"><b>Harga jual per varian dan channel</b><p class="muted">Ubah angka yang perlu saja, lalu simpan sekali. Isian "belum ada" berarti varian itu belum dijual di channel tersebut; isi untuk mulai menjualnya.</p></div>' + rows +
    '<details class="more"><summary>Daftar harga satu per satu (untuk menghapus harga)</summary>' + (old || '<p class="muted">Belum ada harga.</p>') + '</details>' +
    '<div class="savebar"><button class="btn pri" id="hg_save" data-act="hg_save" disabled>Ubah harga dulu</button></div>';
}
async function hgSave() {
  if (!navigator.onLine) return toast('Perlu koneksi internet');
  const ch = hgChanges(); if (!ch.length) return toast('Belum ada harga yang diubah');
  const bad = ch.filter(x => x.bad); ch.forEach(x => { if (x.bad) HGR.f[x.k] = x.bad; else delete HGR.f[x.k]; });   // cek semua isian dulu: satu isian salah tidak boleh membuat sebagian tersimpan diam-diam
  if (bad.length) { vMaster(true); const e = /** @type {any} */ (document.querySelector('#main .hg-row .err')); if (e && e.scrollIntoView) e.scrollIntoView({block: 'center'}); return toast(bad.length + ' isian perlu diperbaiki'); }
  return busy('Menyimpan harga…', async () => {
    let ok = 0, fail = 0, expired = false;
    for (const x of ch) {
      if (expired) break;
      try {
        const rec = await api('master.save', {table: 'channel_prices', data: {variant_id: x.v.id, channel_id: x.c.id, harga_jual: x.n}});
        if (!patchMaster('channel_prices', rec)) await loadData();
        delete HGR.v[x.k]; delete HGR.f[x.k]; ok++;
      } catch (e) { if (e.auth) expired = true; HGR.f[x.k] = e.auth ? 'Sesi berakhir, silakan masuk lagi.' : e.message; fail++; }
    }
    if (S.tab === 'master' && S.mt === 'channel_prices') vMaster(true);
    toast(expired ? 'Sesi berakhir, silakan masuk lagi' : fail ? ok + ' harga tersimpan, ' + fail + ' gagal. Lihat pesan di barisnya.' : ok + ' harga tersimpan');
  });
}
document.addEventListener('input', e => {
  const t = /** @type {any} */ (e.target); if (S.tab !== 'master' || S.mt !== 'channel_prices' || !t || !t.dataset || !t.dataset.hg) return;
  HGR.v[t.dataset.hg] = t.value; delete HGR.f[t.dataset.hg]; hgCount();
});
Object.assign(ACT, {hg_save: hgSave});
