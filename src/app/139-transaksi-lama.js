/* ---------- Input transaksi lama (v2.6.7, migrasi 0038; opsi produk v2.6.8, migrasi 0039): penjualan bertanggal lampau, khusus Owner/Admin. Perhitungan dan aturan dijaga server (rpc_sale_backdate).
   Produk beropsi (level, cara masak) memakai pilihan yang sama dengan Kasir (src/app/138-opsi.js); klien hanya mengirim id item opsi (items[].opsi), harga dan snapshot dihitung server. ---------- */
const BD = {tgl: '', jam: '12:00', ch: '', metode: 'tunai', stok: false, cat: '', items: [], rid: '', done: [], sel: {}};   // rid: sama selama isian tidak berubah (kirim ulang aman), baru bila isian berubah
const bdBack = '<button class="chip" data-act="tab" data-t="menu" style="align-self:flex-start;margin-bottom:var(--s3)">← Menu</button>';
const bdP2 = n => ('0' + n).slice(-2);
const bdYmd = d => d.getFullYear() + '-' + bdP2(d.getMonth() + 1) + '-' + bdP2(d.getDate());
const bdPayOk = k => { const v = cfg('bayar_' + k); return v == null || v === '' || T(v); };
const bdSelIds = () => Object.keys(BD.sel).map(k => BD.sel[k]).sort();   // pilihan opsi untuk produk yang sedang dipilih di form (grup -> id item)
const bdPrice = it => it.harga != null ? it.harga : (priceOf(it.v, BD.ch) || 0) + optDelta(it.o || []);   // harga channel + selisih opsi, sama dengan hitungan server
const bdTotal = () => BD.items.reduce((a, i) => a + i.qty * bdPrice(i), 0);
function bdItems() {   // daftar item dan total (digambar ulang sebagian supaya isian di atasnya tidak hilang)
  const el = $('#bd_items'); if (!el) return;
  el.innerHTML = BD.items.length ? BD.items.map((i, n) => '<div class="li"><div><b>' + esc(i.t) + '</b><div class="muted">' + (i.ol ? esc(i.ol) + ' · ' : '') + qf(i.qty) + ' × ' + rp(bdPrice(i)) + (i.harga == null ? (i.o && i.o.length ? ' (harga channel + opsi)' : ' (harga channel)') : '') + ' = ' + rp(i.qty * bdPrice(i)) + '</div></div><button class="chip" data-act="bd_del" data-i="' + n + '" aria-label="Hapus baris">Hapus</button></div>').join('') +
    '<div class="kv"><span>Subtotal</span><b>' + rp(bdTotal()) + '</b></div><div class="muted">PPN dan fee channel dihitung otomatis oleh server sesuai pengaturan.</div>' : '<div class="muted">Belum ada item.</div>';
}
function bdDone() {
  const el = $('#bd_done'); if (!el) return; const d = BD.done;
  el.innerHTML = d.length ? '<h3 style="margin-top:var(--s4)">Tersimpan di sesi ini</h3><div class="muted">' + num(d.length) + ' transaksi · ' + rp(d.reduce((a, x) => a + x.total, 0)) + '</div>' +
    d.slice(0, 12).map(x => '<div class="li"><div><b>' + esc(x.nomor) + '</b><div class="muted">' + esc(idDate(x.tgl)) + ' ' + esc(String(x.tgl).slice(11, 16)) + ' · ' + esc(String(x.metode).toUpperCase()) + '</div></div><b>' + rp(x.total) + '</b></div>').join('') +
    (d.length > 12 ? '<div class="muted">… dan ' + (d.length - 12) + ' lainnya (lihat di Riwayat)</div>' : '') : '';
}
function bdPh() {   // placeholder harga = harga channel saat ini + selisih opsi yang dipilih, untuk produk yang dipilih
  const h = /** @type {any} */ ($('#bd_h')), v = vOf('bd_v'), p = v && BD.ch ? priceOf(v, BD.ch) : null; if (h) h.placeholder = p != null ? String(p + optDelta(bdSelIds())) : 'harga belum diatur';
}
function bdOpt() {   // pilihan opsi (level, cara masak) untuk produk yang dipilih; pilihan lama dipertahankan bila grupnya sama (mis. ganti ukuran), selain itu memakai bawaan produk
  const el = $('#bd_opt'); if (!el) return;
  const v = vById(vOf('bd_v')), gs = v ? optGroupsOf(v.product_id) : [], keep = BD.sel; BD.sel = {};
  gs.forEach(x => { const k = keep[x.g.id]; if (k && x.items.some(i => i.id === k)) BD.sel[x.g.id] = k; else if (x.def && x.items.some(i => i.id === x.def)) BD.sel[x.g.id] = x.def; });
  el.innerHTML = gs.map(x => '<label>' + esc(x.g.nama) + (x.wajib ? '' : ' <small class="muted">(boleh dikosongkan)</small>') + '<select class="inp" data-bdo="' + esc(x.g.id) + '"><option value="">' + (x.wajib ? '— pilih —' : '— tanpa —') + '</option>' +
    x.items.map(i => '<option value="' + esc(i.id) + '"' + (BD.sel[x.g.id] === i.id ? ' selected' : '') + '>' + esc(i.nama) + (Number(i.selisih_harga) > 0 ? ' (+' + num(i.selisih_harga) + ')' : '') + '</option>').join('') + '</select></label>').join('');
  bdPh();
}
function vLama() {
  const chs = S.data.channels || [], vs = S.data.variants.map(v => ({id: v.id, t: String(vName(v) + ' ' + vSub(v)).trim() + ' · ' + v.sku})).sort((a, b) => a.t.localeCompare(b.t, 'id'));
  BD.items.forEach(i => { const x = vs.find(v => v.id === i.v); if (x) i.t = x.t; });
  if (!BD.tgl) BD.tgl = bdYmd(new Date(Date.now() - 864e5));
  if (!chs.some(c => c.id === BD.ch)) { const o = chs.find(c => /offline/i.test(String(c.nama))) || chs[0]; BD.ch = o ? o.id : ''; }
  const mt = [['tunai', 'Tunai'], ['qris', 'QRIS'], ['transfer', 'Transfer']].filter(m => bdPayOk(m[0])); if (!mt.some(m => m[0] === BD.metode) && mt[0]) BD.metode = mt[0][0];
  $('#main').innerHTML = bdBack +
    '<div class="notice"><span>Untuk penjualan yang terjadi <b>sebelum</b> aplikasi dipakai. Diberi tanggal asli dan tidak masuk laci kasir hari ini. Transaksi hari ini tetap lewat Kasir.</span></div>' +
    '<section class="set-card"><h3>Transaksi</h3>' +
      '<div class="row2"><div style="flex:1"><label>Tanggal<input class="inp" type="date" data-bd="tgl" max="' + bdYmd(new Date()) + '" value="' + esc(BD.tgl) + '"></label></div><div style="flex:1"><label>Jam<input class="inp" type="time" data-bd="jam" value="' + esc(BD.jam) + '"></label></div></div>' +
      '<label>Channel<select class="inp" data-bd="ch">' + chs.map(c => '<option value="' + esc(c.id) + '"' + (c.id === BD.ch ? ' selected' : '') + '>' + esc(c.nama) + '</option>').join('') + '</select></label>' +
      '<label>Metode bayar<select class="inp" data-bd="metode">' + mt.map(m => '<option value="' + m[0] + '"' + (m[0] === BD.metode ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></label>' +
      '<label>Catatan (opsional)<input class="inp" data-bd="cat" maxlength="120" value="' + esc(BD.cat) + '" autocomplete="off"></label></section>' +
    '<section class="set-card"><h3>Item</h3>' +
      '<label>Produk<select class="inp" id="bd_v" data-bdv="1">' + vs.map(v => '<option value="' + esc(v.id) + '">' + esc(v.t) + '</option>').join('') + '</select></label><div id="bd_opt"></div>' +
      '<div class="row2"><div style="flex:1"><label>Jumlah<input class="inp" id="bd_q" inputmode="decimal" placeholder="1"></label></div><div style="flex:1"><label>Harga satuan (Rp)<input class="inp" id="bd_h" inputmode="decimal"></label></div></div>' +
      '<div class="muted">Harga dikosongkan = harga channel saat ini. Isi bila harga saat itu berbeda.</div>' +
      '<button class="btn sec" data-act="bd_add">Tambah ke transaksi</button><div id="bd_items" style="margin-top:var(--s3)"></div></section>' +
    '<section class="set-card"><label class="rs-opt"><input type="checkbox" data-bd="stok"' + (BD.stok ? ' checked' : '') + '><span><b>Kurangi stok</b><small>Biarkan mati bila stok akhir nanti dihitung fisik (stok sekarang sudah memuat penjualan ini). Nyalakan bila stok awal sudah dimasukkan sebelum tanggal transaksi.</small></span></label>' +
      '<button class="btn pri big" data-act="bd_save">Simpan transaksi</button><div id="bd_done"></div></section>';
  bdItems(); bdDone(); BD.sel = {}; bdOpt();
}
function bdAdd() {
  const v = vOf('bd_v'), q = Math.round(dnum(vOf('bd_q')) * 10000) / 10000, hs = vOf('bd_h').trim(), h = hs === '' ? null : dnum(hs);
  if (!v) return toast('Pilih produk'); if (!(q > 0)) return toast('Isi jumlah lebih dari 0');
  if (h != null && !(h >= 0)) return toast('Harga tidak valid');
  if (h == null && priceOf(v, BD.ch) == null) return toast('Harga channel belum diatur untuk produk ini. Isi harga satuan.');
  const vr = vById(v), o = vr && hasOpt(vr) ? bdSelIds() : [];
  if (vr && reqMissing({v: v, o: o})) return toast('Pilih opsi wajib: ' + optGroupsOf(vr.product_id).filter(x => x.wajib && !x.items.some(i => o.indexOf(i.id) >= 0)).map(x => x.g.nama).join(', '));
  const sel = /** @type {any} */ (document.getElementById('bd_v')), t = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : v;
  BD.items.push({v: v, t: String(t), qty: q, harga: h, o: o, ol: o.length ? optLabel(o) : ''}); BD.rid = '';   // opsi tetap terpilih untuk baris berikutnya (mis. beberapa porsi dengan level sama)
  const qe = /** @type {any} */ (document.getElementById('bd_q')), he = /** @type {any} */ (document.getElementById('bd_h')); if (qe) qe.value = ''; if (he) he.value = '';
  bdItems(); bdPh(); if (qe && qe.focus) qe.focus();
}
async function bdSave() {
  if (!BD.items.length) return toast('Tambahkan minimal satu item');
  if (!BD.ch) return toast('Pilih channel');
  const when = new Date(BD.tgl + 'T' + (BD.jam || '12:00'));
  if (!BD.tgl || isNaN(+when)) return toast('Isi tanggal dan jam');
  if (+when >= Date.now()) return toast('Tanggal harus di masa lalu. Transaksi hari ini lewat Kasir.');
  if (!navigator.onLine) return toast('Perlu koneksi internet');
  BD.rid = BD.rid || newReqId();
  const body = {request_id: BD.rid, tanggal: BD.tgl + ' ' + (BD.jam || '12:00') + ':00', channel_id: BD.ch, metode_bayar: BD.metode, potong_stok: !!BD.stok, catatan: BD.cat.trim(),
    items: BD.items.map(i => { const x = /** @type {any} */ ({variant_id: i.v, qty: i.qty, harga: i.harga == null ? '' : i.harga}); if (i.o && i.o.length) x.opsi = i.o; return x; })};
  return busy('Menyimpan transaksi…', async () => {
    try {
      const r = await api('sale.backdate', body), s = r.sale || {};
      BD.done.unshift({nomor: s.nomor, tgl: s.tanggal, total: Number(s.total) || 0, metode: s.metode || BD.metode}); BD.items = []; BD.rid = '';
      S.rhist = null; S.expLoaded = false; VC = {}; if (BD.stok) { try { await loadData(); } catch (e) { /* data dimuat ulang saat berikutnya */ } }
      bdItems(); bdDone(); toast('Tersimpan: ' + s.nomor);
    } catch (e) { toast(e.auth ? 'Sesi berakhir, silakan masuk lagi' : e.message); }
  });
}
document.addEventListener('change', e => {
  const t = /** @type {any} */ (e.target); if (S.tab !== 'lama' || !t || !t.dataset) return;
  if (t.dataset.bdv) { bdOpt(); return; }
  if (t.dataset.bdo) { if (t.value) BD.sel[t.dataset.bdo] = t.value; else delete BD.sel[t.dataset.bdo]; bdPh(); return; }
  const k = t.dataset.bd; if (!k) return;
  BD[k] = t.type === 'checkbox' ? t.checked : t.value; BD.rid = ''; if (k === 'ch') { bdItems(); bdPh(); }
});
OWN_TABS.push('lama'); MENU_TABS.push('lama'); APP.views.lama = vLama;
Object.assign(ACT, {go_lama: () => { S.tab = 'lama'; render(); }, bd_add: bdAdd, bd_save: bdSave, bd_del: el => { BD.items.splice(Number(el.dataset.i), 1); BD.rid = ''; bdItems(); }});
