/* ---------- Stok dan pembelian ---------- */
const stState = (st, min, thr) => st <= 0 ? 'out' : (min > 0 ? st <= min : st < thr) ? 'low' : 'ok';
const stBadge = x => x === 'out' ? '<span class="bdg out">Habis</span>' : x === 'low' ? '<span class="bdg low">Menipis</span>' : '';
function vStok() {
  const o = can('materials'), bahan = S.stab === 'bahan' && o;
  const tabs = o ? wrapChips('<button class="chip ' + (S.stab === 'varian' ? 'on' : '') + '" data-act="stab" data-s="varian">Produk jadi</button><button class="chip ' + (S.stab === 'bahan' ? 'on' : '') + '" data-act="stab" data-s="bahan">Bahan dan kemasan</button>') : '';
  const cats = bahan ? ['Semua', 'bahan', 'kemasan', 'barang jadi beli'] : ['Semua'].concat(Array.from(new Set(S.data.variants.map(v => String((pById(v.product_id) || {}).kategori || '')).filter(Boolean))));
  if (cats.indexOf(S.scat) < 0) S.scat = 'Semua';
  $('#main').innerHTML = tabs + (bahan && can('stockedit') ? '<button class="u-mt0 btn pri" data-act="pbopen">+ Pembelian bahan</button>' : '') +
    '<label class="u-mt8 search">' + svg('search', 18) + '<input id="sq" class="inp" data-in="sq" placeholder="' + (bahan ? 'Cari bahan' : 'Cari produk atau SKU') + '" value="' + esc(S.sq) + '" aria-label="Cari stok"></label>' +
    wrapChips(cats.map(c => '<button class="chip ' + (c === S.scat ? 'on' : '') + '" data-act="scat" data-c="' + esc(c) + '">' + esc(c === 'Semua' || !bahan ? c : c.charAt(0).toUpperCase() + c.slice(1)) + '</button>').join('')) + '<div id="ssum" class="ssum"></div><div id="slist"></div>';
  stokList();
}
/* 0037: tampilan bantu "≈ N pack" dari isi kemasan di Data Master. Hanya tampilan; stok tetap tersimpan dalam satuan utama. */
function stPack(m) {
  const isi = Number(m.pack_isi), st = Number(m.stok); if (!m.pack_nama || !(isi > 0) || !isFinite(st) || st === 0) return '';
  return ' · ≈ ' + (Math.round(st / isi * 10) / 10).toLocaleString('id-ID', {maximumFractionDigits: 1}) + ' ' + m.pack_nama;
}
function stokList() {
  const o = can('materials'), cost = can('cost'), edit = can('stockedit'), bahan = S.stab === 'bahan' && o, q = S.sq.toLowerCase(), thr = Number(cfg('stok_menipis')) > 0 ? Number(cfg('stok_menipis')) : 5; let rows;
  if (bahan) rows = S.data.materials.filter(m => (S.scat === 'Semua' || m.tipe === S.scat) && (!q || (m.nama + ' ' + m.satuan).toLowerCase().indexOf(q) >= 0)).map(m => ({id: m.id, t: 'bahan', name: String(m.nama), lv: '', sub: (cost ? 'HPP rata-rata ' + rp(m.hpp_rata2) + '/' + m.satuan : m.satuan) + stPack(m), val: qf(m.stok) + ' ' + m.satuan, st: stState(Number(m.stok) || 0, Number(m.stok_minimum) || 0, thr)}));
  else rows = S.data.variants.filter(v => (S.scat === 'Semua' || String((pById(v.product_id) || {}).kategori) === S.scat) && (!q || (vName(v) + ' ' + vSub(v) + ' ' + v.sku).toLowerCase().indexOf(q) >= 0)).map(v => ({id: v.id, t: 'varian', name: String(vName(v)), lv: lvText(v.level_pedas), sub: [v.ukuran].filter(Boolean).join('') + (cost ? ' · HPP ' + rp(v.hpp_rata2) : ''), val: num(v.stok), st: stState(Number(v.stok) || 0, 0, thr)}));
  const rank = {out: 0, low: 1, ok: 2}; rows.sort((a, b) => rank[a.st] - rank[b.st] || a.name.localeCompare(b.name, 'id') || a.sub.localeCompare(b.sub, 'id')); // habis dan menipis di atas
  const nOut = rows.filter(r => r.st === 'out').length, nLow = rows.filter(r => r.st === 'low').length, ss = $('#ssum');
  if (ss) ss.innerHTML = nOut || nLow ? (nOut ? '<span class="bdg out">' + nOut + ' habis</span>' : '') + (nLow ? '<span class="bdg low">' + nLow + ' menipis</span>' : '') : '<span class="muted">' + rows.length + ' item · semua stok aman</span>';
  const row = r => { const body = '<div class="st-n"><b>' + esc(r.name) + (r.lv ? ' <span class="lvt">· ' + esc(r.lv) + '</span>' : '') + '</b><div class="muted">' + esc(r.sub) + '</div></div><div class="st-v"><b>' + esc(r.val) + '</b>' + stBadge(r.st) + '</div>';
    return edit ? '<button class="li st-row" data-act="adj" data-t="' + r.t + '" data-id="' + esc(r.id) + '">' + body + svg('chev', 18) + '</button>' : '<div class="li st-row">' + body + '</div>'; };
  $('#slist').innerHTML = rows.length ? rows.map(row).join('') : (S.sq || S.scat !== 'Semua' ? emptyState('stok', 'Tidak ditemukan', 'Coba kata kunci atau kategori lain.', '') :
    bahan ? emptyState('stok', 'Belum ada bahan', 'Tambahkan bahan dan kemasan yang dipakai resep di Data Master.', '<button class="btn pri" data-act="rimat">Tambah bahan</button>') :
    emptyState('stok', 'Belum ada produk', o ? 'Tambahkan produk, varian, dan stok awal di Data Master.' : 'Minta owner menambahkan produk.', o ? '<button class="btn pri" data-act="go_master">Buka Data Master</button>' : ''));
}
function adjSheet(t, id) {
  const it = t === 'bahan' ? S.data.materials.find(m => m.id === id) : vById(id); if (!it) return; S.adj = {t: t, id: id};
  sheet('<h2>Penyesuaian stok</h2><p class="muted">' + esc(t === 'bahan' ? it.nama : vName(it) + ' ' + vSub(it)) + ' · stok sekarang ' + qf(it.stok) + '</p><label>Stok baru<input class="inp" id="a_s" inputmode="decimal" value="' + esc(String(it.stok).replace('.', ',')) + '"></label>' +
    '<label>HPP rata-rata (kosongkan jika tidak diubah; isi untuk stok awal)<input class="inp" id="a_h" inputmode="decimal" placeholder="' + esc(it.hpp_rata2) + '"></label><div id="a_hw" aria-live="polite"></div><label>Alasan<input class="inp" id="a_r" value="Stok opname"></label>' +
    '<button class="btn pri" data-act="adjsave" data-t="' + t + '" data-id="' + esc(id) + '">Simpan</button>');
  adjHppUpd(); if (t === 'bahan') pbLastLoad().then(adjHppUpd);   // riwayat pembelian (bila ada) menentukan apakah HPP bahan ini hasil pembelian
}
/* Status HPP item yang sedang disesuaikan. Hanya Owner/Admin/Auditor yang menerima hpp_rata2 dari server; peran lain (supervisor, stok) tidak tahu nilainya,
   jadi untuk bahan dipakai riwayat pembelian sebagai petunjuk. known = HPP berjalan pasti ada; maybe = mungkin ada (stok ada, HPP tidak terlihat). */
function adjHppState() {
  const a = S.adj, it = a ? (a.t === 'bahan' ? S.data.materials.find(m => m.id === a.id) : vById(a.id)) : null; if (!a || !it) return null;
  const seen = it.hpp_rata2 !== undefined && it.hpp_rata2 !== null, hist = a.t === 'bahan' && !!(S.pbLast && S.pbLast[a.id]), known = (seen && Number(it.hpp_rata2) > 0) || hist;
  return {it: it, known: known, maybe: !known && !seen && Number(it.stok) > 0, cur: seen ? Number(it.hpp_rata2) : NaN, src: a.t === 'bahan' ? 'pembelian' : 'produksi', bahan: a.t === 'bahan'};
}
function adjHppUpd() {
  const st = adjHppState(), h = /** @type {any} */ ($('#a_h')), w = $('#a_hw'); if (!st || !h || !w) return;
  if (!can('approve')) {   // stok/produksi: server menolak perubahan HPP yang sudah ada (hanya supervisor/owner); HPP awal tetap boleh
    if (st.known) { h.value = ''; h.disabled = true; w.innerHTML = '<p class="muted pbnote">HPP ' + (st.bahan ? 'bahan' : 'produk') + ' ini berasal dari ' + st.src + '. Mengubahnya perlu supervisor atau owner.</p>'; }
    else { h.disabled = false; w.innerHTML = '<p class="muted pbnote">Isi hanya untuk HPP awal. Mengubah HPP yang sudah ada perlu supervisor atau owner.</p>'; }
    return;
  }
  h.disabled = false;
  const filled = String(h.value).trim() !== '';
  w.innerHTML = filled && (st.known || st.maybe) ? '<div class="pbwarn" role="alert"><b>' + (st.known ? 'Ini menimpa HPP rata-rata hasil ' + st.src + '.' : 'Bila ' + (st.bahan ? 'bahan' : 'produk') + ' ini sudah punya HPP hasil ' + st.src + ', isian ini menimpanya.') + '</b> Laba semua penjualan berikutnya ikut berubah. Kosongkan kolom HPP bila hanya mengoreksi stok.</div>' : '';
}
async function adjSave(t, id) {
  const hv = String($('#a_h').value).trim(), st = adjHppState();
  if (hv !== '' && st && can('approve') && (st.known || st.maybe)) {   // menimpa HPP yang sudah berjalan: minta konfirmasi sebelum mengirim
    const nv = dnum(hv); if (!(nv >= 0)) return fieldErr('#a_h', 'HPP tidak valid. Isi angka 0 atau lebih, atau kosongkan kolomnya.');
    if (!(Math.abs(nv - st.cur) < 0.0001)) {
      const ok = await confirmBox({title: 'Timpa HPP rata-rata?', msg: 'HPP rata-rata ' + (st.bahan ? 'bahan' : 'produk') + ' ini hasil ' + st.src + (st.cur > 0 ? ' (' + pbRp(st.cur) + ')' : '') + ' akan diganti menjadi ' + pbRp(nv) + '. Laba semua penjualan berikutnya ikut berubah.', stay: 'Batal', leave: 'Ya, timpa HPP'});
      if (!ok) return;
    }
  }
  return busy('Menyimpan stok…', async () => {
  try {
    const r = await api('stock.adjust', {tipe: t, id: id, stok_baru: dnum($('#a_s').value), hpp: hv === '' ? '' : dnum(hv), alasan: $('#a_r').value});
    const it = t === 'bahan' ? S.data.materials.find(m => m.id === id) : vById(id); it.stok = r.stok; it.hpp_rata2 = r.hpp_rata2; LS.set('data', S.data); closeSheet(); render(); toast('Stok disimpan');
  } catch (e) { toast(e.message); }
  });
}
/* Pintasan dari layar Produksi (bahan kurang): daftar bahan + jumlah kekurangan diisikan sebagai pilihan cepat, harga TETAP diisi pengguna (tidak ditebak).
   back = fungsi untuk kembali ke lembar produksi yang tadi dibuka; dipanggil setelah pembelian tersimpan (stok bahan sudah diperbarui). */
function pbPrefill(need, back) {
  const o = /** @type {any} */ (S.pb || {}), n = (need || []).filter(x => x && x.id && x.qty > 0);
  S.pb = {items: o.items || [], ongkir: o.ongkir || '', sup: o.sup || '', rid: o.rid || '', mode: 'sat', need: n, back: back || null, sel: n[0] ? n[0].id : '', selq: n[0] ? n[0].qty : ''};
  pbSheet(); pbLastLoad();
}
const pbQ = q => String(q).replace('.', ',');
const PB_WARN = 0.3;   // harga beli yang menyimpang lebih dari 30% dari pembanding diminta dikonfirmasi (menangkap salah nol atau salah satuan)
const pbRp = n => 'Rp\u00a0' + (Math.round(Number(n) * 100) / 100).toLocaleString('id-ID', {maximumFractionDigits: 2});   // harga per satuan bisa berpecahan (mis. Rp 16,4/gram): rp() membulatkan ke rupiah
const pbMat = id => S.data.materials.find(x => x.id === id);
const pbVal = id => String((/** @type {any} */ ($('#' + id)) || {}).value || '');
const pbTouch = () => { S.pb.rid = ''; };   // isian berubah = request_id baru; isian sama dikirim ulang = request_id sama (server tidak menggandakan stok)
const pbTgl = w => { const d = String(w || ''); return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; };
/* Pembanding harga untuk satu bahan: harga beli terakhir (dari riwayat pembelian, semua peran stok) dan HPP rata-rata (hanya peran yang boleh melihat biaya). */
function pbRef(id) {
  const l = S.pbLast && S.pbLast[id], m = pbMat(id), h = can('cost') && m ? Number(m.hpp_rata2) : 0;
  return {last: l ? Number(l.harga) : 0, tgl: l ? l.waktu : '', hpp: h > 0 ? h : 0};
}
const pbBase = r => r.hpp > 0 ? {v: r.hpp, nm: 'HPP rata-rata'} : r.last > 0 ? {v: r.last, nm: 'harga beli terakhir'} : null;
function pbHint(id) {
  const m = pbMat(id); if (!m) return ''; const r = pbRef(id), p = [];
  if (r.last > 0) p.push('Terakhir beli ' + pbRp(r.last) + '/' + m.satuan + (pbTgl(r.tgl) ? ' (' + pbTgl(r.tgl) + ')' : ''));
  if (r.hpp > 0) p.push('HPP rata-rata ' + pbRp(r.hpp) + '/' + m.satuan);
  return p.length ? p.join(' · ') : (S.pbLast ? 'Belum ada riwayat pembelian bahan ini.' : '');
}
const pbPlaceholder = id => { const r = pbRef(id), v = r.last > 0 ? r.last : r.hpp; return v > 0 ? pbQ(Math.round(v * 100) / 100) : ''; };
async function pbLastLoad() {   // harga beli terakhir per bahan; gagal/offline = pembanding saja yang kosong, input tetap jalan
  if (!S.pbLast) { try { S.pbLast = await api('purchase.last', {}, {silent: true}); } catch (e) { return; } }
  pbRefUpd();
}
function pbRefUpd() {   // perbarui pembanding tanpa menggambar ulang lembar (isian yang sedang diketik tidak hilang)
  const id = pbVal('pb_m'), m = pbMat(id), r = $('#pb_ref'), h = /** @type {any} */ ($('#pb_h')), u = $('#pb_unit');
  if (r) r.textContent = pbHint(id); if (h) h.placeholder = pbPlaceholder(id); if (u && m) u.textContent = m.satuan;
}
/* Nama dan isi kemasan beli satu bahan. Utama: Data Master (0037, sama di semua perangkat); cadangan: yang diingat di perangkat ini (LS 'pbpack'). */
function pbPackOf(id) {
  const m = S.data.materials.find(x => x.id === id), isi = m ? Number(m.pack_isi) : 0;
  if (m && m.pack_nama && isi > 0) return {nm: String(m.pack_nama), isi: isi, master: true};
  const k = (LS.get('pbpack', {}) || {})[id] || {}; return {nm: k.nm || '', isi: Number(k.isi) || 0, master: false};
}
function pbPackDefault(id) {   // isi nama dan isi kemasan dari Data Master, atau dari yang terakhir dipakai di perangkat ini
  const k = pbPackOf(id), a = /** @type {any} */ ($('#pk_nm')), b = /** @type {any} */ ($('#pk_i'));
  if (a) a.value = k.nm || ''; if (b) b.value = k.isi ? pbQ(k.isi) : '';
}
/* Baca isian form tambah bahan. Mode kemasan: jumlah kemasan x isi per kemasan = jumlah; harga kemasan / isi = harga satuan. */
function pbRead() {
  const id = pbVal('pb_m'), m = pbMat(id); if (!m) return null;
  if (S.pb.mode !== 'kem') { const q = dnum(pbVal('pb_q')), h = dnum(pbVal('pb_h')); return {id: id, m: m, q: q, h: h, ok: q > 0 && h >= 0 && pbVal('pb_h').trim() !== '', label: '', nm: '', isi: 0}; }
  const n = dnum(pbVal('pk_n')), isi = dnum(pbVal('pk_i')), hk = dnum(pbVal('pk_h')), nm = pbVal('pk_nm').trim() || 'kemasan', ok = n > 0 && isi > 0 && hk >= 0 && pbVal('pk_h').trim() !== '';
  return {id: id, m: m, q: ok ? r6(n * isi) : NaN, h: ok ? Math.round(hk / isi * 10000) / 10000 : NaN, ok: ok, label: ok ? qf(n) + ' ' + nm + ' × ' + qf(isi) + ' ' + m.satuan : '', nm: nm, isi: isi};
}
function pbCalc() {
  const c = $('#pb_calc'); if (!c) return; if (S.pb.mode !== 'kem') { c.textContent = ''; return; }
  const x = pbRead(); c.textContent = x && x.ok ? '= ' + qf(x.q) + ' ' + x.m.satuan + ' × ' + pbRp(x.h) + '/' + x.m.satuan + ' (total ' + rp(x.q * x.h) + ')' : 'Contoh: 2 karung × isi 25 kg, harga Rp 400.000 per karung = 50 kg × Rp 16.000/kg.';
}
function pbSetMode(m) {
  S.pb.mode = m === 'kem' ? 'kem' : 'sat'; const a = $('#pb_sat'), b = $('#pb_kem'); if (a) a.hidden = S.pb.mode === 'kem'; if (b) b.hidden = S.pb.mode !== 'kem';
  document.querySelectorAll('#sheet [data-act="pbmode"]').forEach(c => { const on = /** @type {any} */ (c).dataset.m === S.pb.mode; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
  if (S.pb.mode === 'kem') pbPackDefault(pbVal('pb_m')); pbCalc();
}
/* Galat isian tambah baris pembelian: tunjuk kolom pertama yang belum benar (v2.6.13), bukan satu pesan umum. */
function pbAddErr(x) {
  const nv = id => dnum(pbVal(id));
  if (!x) return fieldErr('#pb_m', 'Pilih bahan dulu');
  if (S.pb.mode !== 'kem') return !(nv('pb_q') > 0) ? fieldErr('#pb_q', 'Isi jumlah lebih dari 0') : fieldErr('#pb_h', 'Isi harga satuan (Rp), 0 atau lebih');
  if (!(nv('pk_n') > 0)) return fieldErr('#pk_n', 'Isi jumlah kemasan lebih dari 0');
  if (!(nv('pk_i') > 0)) return fieldErr('#pk_i', 'Isi per kemasan harus lebih dari 0');
  return fieldErr('#pk_h', 'Isi harga per kemasan (Rp), 0 atau lebih');
}
async function pbAdd() {
  const x = pbRead(); if (!x || !x.ok) return pbAddErr(x);
  const b = pbBase(pbRef(x.id));
  if (b && Math.abs(x.h - b.v) / b.v > PB_WARN) {   // selisih besar terhadap pembanding: kemungkinan salah ketik nol atau salah satuan
    const up = x.h > b.v, pct = Math.round(Math.abs(x.h - b.v) / b.v * 100);
    const go = await confirmBox({title: 'Harga berbeda jauh', msg: 'Harga ' + pbRp(x.h) + '/' + x.m.satuan + ' ' + (up ? 'lebih tinggi ' : 'lebih rendah ') + pct + '% dari ' + b.nm + ' (' + pbRp(b.v) + '/' + x.m.satuan + '). Periksa lagi jumlah nol dan satuannya sebelum lanjut.', stay: 'Periksa lagi', leave: 'Harga sudah benar'});
    if (!go) return;
  }
  if (S.pb.mode === 'kem' && !pbPackOf(x.id).master) { const pk = LS.get('pbpack', {}) || {}; pk[x.id] = {nm: x.nm, isi: x.isi}; LS.set('pbpack', pk); }   // cadangan perangkat, hanya bila Data Master belum punya kemasan bahan ini
  S.pb.items.push({id: x.id, qty: x.q, harga: x.h, kem: x.label}); pbTouch(); S.pb.need = (S.pb.need || []).filter(n => n.id !== x.id); const nx = S.pb.need[0]; S.pb.sel = nx ? nx.id : ''; S.pb.selq = nx ? nx.qty : ''; pbSheet();
}
function pbSheet() {
  const m = S.data.materials, pb = S.pb, tot = pb.items.reduce((a, i) => a + i.qty * i.harga, 0), need = (pb.need || []).filter(n => m.some(x => x.id === n.id)), sel = m.some(x => x.id === pb.sel) ? pb.sel : (m[0] ? m[0].id : ''), selM = pbMat(sel), kem = pb.mode === 'kem', pk = pbPackOf(sel);
  sheet((pb.back ? '<button class="chip" data-act="pbback">← Kembali ke produksi</button>' : '') + '<h2>Pembelian bahan</h2>' +
    (need.length ? '<div class="u-blk li"><b>Bahan kurang untuk produksi</b><div class="muted">Ketuk bahan, isi harga beli, lalu Tambah ke daftar.</div><div class="chips">' + need.map(n => { const x = m.find(y => y.id === n.id); return '<button class="chip" data-act="pbfill" data-id="' + esc(n.id) + '" data-q="' + esc(n.qty) + '">' + esc(x.nama) + ' · kurang ' + qf(n.qty) + ' ' + esc(x.satuan) + '</button>'; }).join('') + '</div></div>' : '') +
    '<label>Supplier<select class="inp" data-in="pbsup"><option value="">- tanpa supplier -</option>' + S.data.suppliers.map(s => '<option value="' + esc(s.id) + '"' + (s.id === pb.sup ? ' selected' : '') + '>' + esc(s.nama) + '</option>').join('') + '</select></label>' +
    pb.items.map((i, n) => { const x = m.find(y => y.id === i.id); return '<div class="li"><div><b>' + esc(x ? x.nama : '?') + '</b><div class="muted">' + (i.kem ? esc(i.kem) + ' = ' : '') + qf(i.qty) + ' ' + esc(x ? x.satuan : '') + ' @ ' + pbRp(i.harga) + '</div></div><button class="chip" data-act="pbdel" data-i="' + n + '">Hapus</button></div>'; }).join('') +
    '<label>Bahan<select class="inp" id="pb_m" data-in="pbmat">' + m.map(x => '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.nama) + ' (' + esc(x.satuan) + ')</option>').join('') + '</select></label>' +
    wrapChips('<button class="chip ' + (kem ? '' : 'on') + '" data-act="pbmode" data-m="sat" aria-pressed="' + (!kem) + '">Per satuan</button><button class="chip ' + (kem ? 'on' : '') + '" data-act="pbmode" data-m="kem" aria-pressed="' + kem + '">Per kemasan (karung, dus)</button>') +
    '<div id="pb_sat"' + (kem ? ' hidden' : '') + '><div class="row2"><div class="u-f1"><label>Jumlah<input class="inp" id="pb_q" inputmode="decimal" value="' + esc(pb.selq === '' || pb.selq == null ? '' : pbQ(pb.selq)) + '"></label></div><div class="u-f1"><label>Harga satuan (Rp)<input class="inp" id="pb_h" inputmode="decimal" placeholder="' + esc(pbPlaceholder(sel)) + '"></label></div></div></div>' +
    '<div id="pb_kem"' + (kem ? '' : ' hidden') + '><div class="row2"><div class="u-f1"><label>Jumlah kemasan<input class="inp" id="pk_n" data-in="pbcalc" inputmode="decimal" placeholder="1"></label></div><div class="u-f1"><label>Nama kemasan<input class="inp" id="pk_nm" data-in="pbcalc" placeholder="karung" value="' + esc(pk.nm || '') + '"></label></div></div>' +
    '<div class="row2"><div class="u-f1"><label>Isi per kemasan (<span id="pb_unit">' + esc(selM ? selM.satuan : '') + '</span>)<input class="inp" id="pk_i" data-in="pbcalc" inputmode="decimal" placeholder="25" value="' + esc(pk.isi ? pbQ(pk.isi) : '') + '"></label></div><div class="u-f1"><label>Harga per kemasan (Rp)<input class="inp" id="pk_h" data-in="pbcalc" inputmode="decimal" placeholder="400.000"></label></div></div><div id="pb_calc" class="muted" aria-live="polite"></div></div>' +
    '<div id="pb_ref" class="muted" aria-live="polite">' + esc(pbHint(sel)) + '</div>' +
    '<button class="btn sec" data-act="pbadd">Tambah ke daftar</button><label>Ongkir (Rp, dialokasikan ke HPP)<input class="inp" data-in="pbongkir" data-rp inputmode="numeric" autocomplete="off" value="' + esc(rpIn(pb.ongkir)) + '"></label>' +
    '<div class="kv big"><span>Total</span><span>' + rp(tot + (Number(pb.ongkir) || 0)) + '</span></div><button class="btn pri" data-act="pbsave">Simpan pembelian</button><button class="btn sec sm" data-act="pbhist">Riwayat pembelian / batalkan</button>');
  pbCalc();
}
/* F-16: riwayat pembelian + pembatalan (supervisor ke atas). Stok bahan dikurangi kembali; ditolak bila bahan sudah terpakai. */
async function pbHist() {
  sheet('<h2>Riwayat pembelian</h2><div id="pbh">' + skel(3) + '</div>');
  try {
    const L = await api('purchase.list', {}), sup = id => { const s = (S.data.suppliers || []).find(x => x.id === id); return s ? s.nama : ''; };
    $('#pbh').innerHTML = L.length ? L.map(x => '<div class="u-blk li"><div class="kv"><b>' + esc(String(x.waktu).slice(0, 10)) + (sup(x.supplier_id) ? ' · ' + esc(sup(x.supplier_id)) : '') + '</b><span>' + rp(x.total) + '</span></div>' +
      (x.status === 'cancelled' ? '<div class="muted"><span class="tag red">Dibatalkan</span> ' + esc(x.alasan_batal) + '</div>' : (can('approve') ? '<button class="chip" data-act="pbcancel" data-id="' + esc(x.id) + '">Batalkan</button>' : '')) + '</div>').join('') : '<p class="muted">Belum ada pembelian.</p>';
  } catch (e) { $('#pbh').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
}
async function pbCancel(id) {
  const why = await promptBox({title: 'Batalkan pembelian ini?', msg: 'Stok bahan dikembalikan seperti sebelum pembelian. Alasan dicatat di server.', label: 'Alasan (min. 3 huruf)', err: 'Alasan wajib diisi (minimal 3 huruf).', stay: 'Kembali', leave: 'Batalkan pembelian'}); if (why === null) return;
  return busy('Membatalkan…', async () => { try { await api('purchase.cancel', {id: id, alasan: why}); await loadData(); toast('Pembelian dibatalkan, stok bahan dikembalikan'); pbHist(); } catch (e) { toast(e.message); } });
}
async function pbSave() {
  return busy('Menyimpan pembelian…', async () => {
  const pb = S.pb, back = pb.back; if (!pb.items.length) return fieldErr('[data-act="pbadd"]', 'Daftar masih kosong. Isi bahan, jumlah, dan harga, lalu ketuk Tambah.');
  if (!pb.rid) pb.rid = newReqId();   // dipakai ulang bila kirim ulang (ketuk dua kali, jaringan putus): server mengenali permintaan yang sama dan tidak menambah stok lagi
  try {
    const r = await api('purchase.create', {request_id: pb.rid, supplier_id: pb.sup, ongkir: Number(pb.ongkir) || 0, items: pb.items.map(i => ({material_id: i.id, qty: i.qty, harga_satuan: i.harga}))}), dup = !!(r && r.duplicate);
    if (!dup) r.materials.forEach(u => { const m = S.data.materials.find(x => x.id === u.id); if (m) { m.stok = u.stok; if (u.hpp_rata2 !== undefined) m.hpp_rata2 = u.hpp_rata2; } });   // server hanya mengirim stok; jangan menghapus HPP yang ada
    S.pb = {items: [], ongkir: '', sup: '', rid: '', mode: pb.mode}; S.pbLast = null;
    if (dup || can('cost')) { try { await loadData(); } catch (e) { /* data lama tetap dipakai; sinkron berikutnya memperbarui */ } }   // HPP baru hanya ada di server; jawaban duplikat membawa stok lama
    LS.set('data', S.data); closeSheet(); render(); toast(dup ? 'Pembelian ini sudah tercatat sebelumnya; data disegarkan' : 'Pembelian tersimpan, HPP diperbarui'); if (back) back();
  } catch (e) { toast(e.message); }
  });
}
