/* ---------- Opsi produk (0032): level pedas, cara masak ----------
   Pilihan muncul setelah produk diketuk di Kasir, tersimpan sebagai sub-nama pada baris penjualan, dan TIDAK mengubah stok maupun HPP.
   Klien hanya mengirim id item opsi (items[].opsi); harga akhir dihitung server (harga channel + selisih opsi). Baris keranjang: {v, qty, o: [id item], ol: label}. */
let OPTC = null;
const optReset = () => { OPTC = null; };
function optIdx() {
  const d = S.data || {}, gi = d.option_items || [], gg = d.option_groups || [], pi = d.product_options || [], n = gi.length + gg.length + pi.length;
  if (OPTC && OPTC.gi === gi && OPTC.gg === gg && OPTC.pi === pi && OPTC.n === n) return OPTC;
  const item = new Map(), grp = new Map(), byP = new Map();
  gi.forEach(x => item.set(x.id, x)); gg.forEach(x => grp.set(x.id, x));
  pi.forEach(l => {
    const p = pById(l.product_id), g = grp.get(l.group_id); if (!p || !p.pakai_opsi || !g) return;   // saklar mati: opsi tetap tersimpan di server tetapi tidak tampil di Kasir
    const items = gi.filter(i => i.group_id === g.id); if (!items.length) return;
    if (!byP.has(l.product_id)) byP.set(l.product_id, []);
    byP.get(l.product_id).push({g: g, wajib: l.wajib !== false, def: l.default_item_id || null, urut: Number(l.urutan) || 0, items: items});
  });
  byP.forEach(a => a.sort((x, y) => (x.urut - y.urut) || ((Number(x.g.urutan) || 0) - (Number(y.g.urutan) || 0)) || String(x.g.nama).localeCompare(String(y.g.nama))));
  return OPTC = {gi: gi, gg: gg, pi: pi, n: n, item: item, grp: grp, byP: byP};
}
const optGroupsOf = pid => optIdx().byP.get(pid) || [];
const hasOpt = v => !!v && optGroupsOf(v.product_id).length > 0;
const lineOpts = l => Array.isArray(l.o) ? l.o : [];
const optKey = o => o.slice().sort().join(',');                       // kunci baris keranjang = variant_id + id item opsi terurut
const optDelta = ids => ids.reduce((a, id) => { const i = optIdx().item.get(id); return a + (i ? Number(i.selisih_harga) || 0 : 0); }, 0);
const linePrice = l => { const p = priceOf(l.v, S.ch); return p == null ? 0 : p + optDelta(lineOpts(l)); };
function optLabel(ids) {   // urutan sama dengan label server: urutan grup lalu nama grup
  const ix = optIdx();
  return ids.map(id => { const i = ix.item.get(id), g = i ? ix.grp.get(i.group_id) : null; return {n: i ? i.nama : '?', s: g ? Number(g.urutan) || 0 : 0, gn: g ? String(g.nama) : ''}; })
    .sort((a, b) => (a.s - b.s) || a.gn.localeCompare(b.gn)).map(x => x.n).join(' · ');
}
function reqMissing(l) {   // grup wajib yang belum dipilih pada baris keranjang
  const v = vById(l.v); if (!v) return false; const o = lineOpts(l);
  return optGroupsOf(v.product_id).some(x => x.wajib && !x.items.some(i => o.indexOf(i.id) >= 0));
}
const optStale = l => lineOpts(l).some(id => !optIdx().item.has(id));   // item sudah nonaktif/dihapus sejak dipilih

/* Keranjang di perangkat diberi penanda versi format (cartv=2). Keranjang lama berisi produk yang kini beropsi tidak punya pilihan, jadi baris itu dibuang agar tidak salah catat. */
function cartMigrate() {
  if (!S.data) return; if (LS.get('cartv', 1) >= 2) return; LS.set('cartv', 2);
  const n = S.cart.length; S.cart = S.cart.filter(l => !hasOpt(vById(l.v)));
  if (S.cart.length !== n) { LS.set('cart', S.cart); setTimeout(() => toast('Keranjang diperbarui: produk beropsi perlu dipilih ulang'), 900); }
}

/* ===== Sheet "Pilih opsi" ===== */
function optOpen(vid, edit) {
  const v = vById(vid); if (!v) return;
  const gs = optGroupsOf(v.product_id), mem = LS.get('optlast', {}) || {}, last = mem[v.product_id] || {}, ix = optIdx().item, old = edit != null ? S.cart[edit] : null, sel = {};
  gs.forEach(x => {
    let pick = null;
    if (old) pick = lineOpts(old).find(id => { const i = ix.get(id); return !!i && i.group_id === x.g.id; }) || null;
    else pick = [last[x.g.id], x.def].find(id => !!id && x.items.some(i => i.id === id)) || null;   // ingatan dan bawaan dipakai hanya bila id-nya masih aktif
    if (pick) sel[x.g.id] = pick;
  });
  S.opt = {v: vid, sel: sel, qty: old ? old.qty : 1, edit: old ? edit : null};
  optPaint(null);
}
function optPaint(focus) {
  const O = S.opt, v = O && vById(O.v); if (!O || !v) return;
  const gs = optGroupsOf(v.product_id), ids = Object.keys(O.sel).map(k => O.sel[k]), ok = gs.every(x => !!O.sel[x.g.id] || !x.wajib);
  const unit = (priceOf(O.v, S.ch) || 0) + optDelta(ids);
  sheet('<div class="grab"></div><h2>Pilih opsi</h2><p class="muted">' + esc((vName(v) + ' ' + vSub(v)).trim()) + '</p>' +
    gs.map((x, n) => '<div class="opt-g" role="radiogroup" aria-labelledby="og' + n + '"><div class="opt-l" id="og' + n + '">' + esc(x.g.nama) + (x.wajib ? '' : ' <small class="muted">(boleh dikosongkan)</small>') + '</div><div class="chips opt-c">' +
      x.items.map(i => { const on = O.sel[x.g.id] === i.id;
        return '<button type="button" class="chip opt-chip' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-act="optpick" data-g="' + esc(x.g.id) + '" data-i="' + esc(i.id) + '">' + esc(i.nama) + (Number(i.selisih_harga) > 0 ? ' <small>+' + num(i.selisih_harga) + '</small>' : '') + '</button>'; }).join('') + '</div></div>').join('') +
    '<div class="opt-q"><span>Jumlah</span><div class="qty"><button type="button" data-act="optdec" aria-label="Kurangi jumlah">−</button><span aria-live="polite">' + O.qty + '</span><button type="button" data-act="optinc" aria-label="Tambah jumlah">+</button></div></div>' +
    (ok ? '' : '<p class="muted opt-hint" role="status">Pilih semua opsi wajib dulu.</p>') +
    '<button type="button" class="btn pri big" data-act="optadd"' + (ok ? '' : ' disabled') + '>' + (O.edit != null ? 'Simpan' : 'Tambah') + ' · ' + rp(unit * O.qty) + '</button><button type="button" class="btn sec" data-act="close">Batal</button>');
  if (focus) { const t = /** @type {HTMLElement|null} */ (document.querySelector('#sheet [data-act="optpick"][data-g="' + focus.g + '"][data-i="' + focus.i + '"]')); if (t) t.focus({preventScroll: true}); }
}
function optConfirm() {
  const O = S.opt, v = O && vById(O.v); if (!O || !v) return;
  const gs = optGroupsOf(v.product_id); if (gs.some(x => x.wajib && !O.sel[x.g.id])) return toast('Pilih semua opsi wajib');
  const o = Object.keys(O.sel).map(k => O.sel[k]).sort(), old = O.edit != null ? S.cart[O.edit] : null, st = Number(v.stok) || 0;
  if (T(cfg('blokir_stok_minus')) && cartQty(O.v) - (old ? old.qty : 0) + O.qty > st) return toast(st > 0 ? 'Stok tidak cukup' : 'Stok habis');
  const mem = LS.get('optlast', {}) || {}; mem[v.product_id] = Object.assign({}, O.sel); LS.set('optlast', mem);   // pilihan terakhir per produk, hanya di perangkat ini
  if (old) S.cart.splice(O.edit, 1);
  const k = optKey(o), ex = S.cart.find(x => x.v === O.v && optKey(lineOpts(x)) === k);
  if (ex) ex.qty += O.qty; else S.cart.splice(old ? Math.min(O.edit, S.cart.length) : S.cart.length, 0, {v: O.v, qty: O.qty, o: o, ol: optLabel(o)});
  if (S.cart.length > lim('cart')) LIM.cart = S.cart.length;
  saveCart(); S.opt = null; closeSheet(); updCard(v.id); syncCart(); buzz();
  if (old && !isWide() && S.cart.length) cartSheet();
}

/* ===== Master Produk: saklar "Pakai opsi" + tautan grup dari pustaka (di dalam form produk) ===== */
function optForm(pid) {
  const gg = (S.data.option_groups || []), gi = (S.data.option_items || []), p = pid ? pById(pid) : null, links = (S.data.product_options || []).filter(l => l.product_id === pid), on = !!(p && p.pakai_opsi);
  const rows = gg.map(g => { const l = links.find(x => x.group_id === g.id), its = gi.filter(i => i.group_id === g.id);
    return '<div class="opt-row"><label class="sw sm"><input type="checkbox" data-og-on="' + esc(g.id) + '"' + (l ? ' checked' : '') + '><span class="sw-t" aria-hidden="true"></span><span class="sw-l"><b>' + esc(g.nama) + '</b></span></label>' +
      '<div class="row2"><label>Pilihan<select class="inp" data-og-req="' + esc(g.id) + '"><option value="ya"' + (!l || l.wajib !== false ? ' selected' : '') + '>Wajib dipilih</option><option value="tidak"' + (l && l.wajib === false ? ' selected' : '') + '>Boleh kosong</option></select></label>' +
      '<label>Bawaan<select class="inp" data-og-def="' + esc(g.id) + '"><option value="">Tanpa bawaan</option>' + its.map(i => '<option value="' + esc(i.id) + '"' + (l && l.default_item_id === i.id ? ' selected' : '') + '>' + esc(i.nama) + '</option>').join('') + '</select></label></div></div>'; }).join('');
  return '<div id="optf" class="opt-form"><label class="sw"><input type="checkbox" id="opt_on" data-act="optsw"' + (on ? ' checked' : '') + '><span class="sw-t" aria-hidden="true"></span><span class="sw-l"><b>Pakai opsi (level, cara masak)</b><small>Pilihan muncul di Kasir setelah produk diketuk. Tidak mengubah stok maupun HPP.</small></span></label>' +
    '<div id="optg"' + (on ? '' : ' hidden') + '>' + (rows || '<p class="muted">Pustaka opsi masih kosong. Buat grup di Pengaturan → Pustaka opsi.</p>') + '</div></div>';
}
function optFormRead() {
  const on = !!(/** @type {any} */ ($('#opt_on')) || {}).checked, tautan = [];
  document.querySelectorAll('#sheet [data-og-on]').forEach(e => {
    if (!(/** @type {any} */ (e)).checked) return; const g = dsOf(e).ogOn, rq = /** @type {any} */ (document.querySelector('#sheet [data-og-req="' + g + '"]')), df = /** @type {any} */ (document.querySelector('#sheet [data-og-def="' + g + '"]'));
    tautan.push({group_id: g, wajib: !rq || rq.value !== 'tidak', default_item_id: df && df.value ? df.value : null, urutan: tautan.length + 1});
  });
  return {pakai_opsi: on, tautan: tautan};
}
async function optFormSave(pid) {
  const f = optFormRead(), had = (S.data.product_options || []).some(l => l.product_id === pid);
  if (!f.pakai_opsi && !had) return;   // produk baru tanpa opsi: tidak ada yang perlu dikirim
  const r = await api('opsi.produk_set', {product_id: pid, pakai_opsi: f.pakai_opsi, tautan: f.tautan});
  S.data.product_options = (S.data.product_options || []).filter(l => l.product_id !== pid).concat((r.tautan || []).map(l => ({product_id: pid, group_id: l.group_id, wajib: l.required, default_item_id: l.default_item_id, urutan: l.sort})));
  const p = pById(pid); if (p) p.pakai_opsi = !!r.pakai_opsi;
  optReset(); LS.set('data', S.data);
}

/* ===== Pustaka opsi (Pengaturan): grup dan item global ===== */
async function pustakaOpen() {
  if (navigator.onLine === false) return toast('Pustaka opsi hanya bisa dikelola saat online');
  return busy('Memuat pustaka opsi…', async () => { try { S.pus = await api('opsi.pustaka', {}); pustakaList(); } catch (e) { toast(e.message); } });
}
function pustakaList() {
  const P = S.pus || {groups: [], items: []};
  sheet('<div class="grab"></div><h2>Pustaka opsi</h2><p class="muted">Grup dan pilihan yang dipakai produk, mis. Level dan Cara masak. Mengubah nama atau selisih harga tidak mengubah riwayat transaksi yang sudah tercatat.</p>' +
    P.groups.map(g => { const n = P.items.filter(i => i.group_id === g.id && i.aktif).length;
      return '<button type="button" class="li li-btn" data-act="pgrp" data-id="' + esc(g.id) + '"><span><b>' + esc(g.nama) + '</b> <span class="muted">' + n + ' pilihan</span>' + (g.aktif ? '' : ' <span class="tag red">Nonaktif</span>') + '</span><span class="muted">Ubah</span></button>'; }).join('') +
    '<button type="button" class="btn pri" data-act="pgrp" data-id="">+ Tambah grup</button><button type="button" class="btn sec" data-act="close">Tutup</button>');
}
const pgRow = i => '<div class="opt-row" data-pr="' + esc(i.id || '') + '"><div class="row2"><label>Nama pilihan<input class="inp" data-pn maxlength="40" value="' + esc(i.nama || '') + '"></label>' +
  '<label>Tambah harga (Rp)<input class="inp" data-pd inputmode="numeric" value="' + esc(i.selisih_harga || 0) + '"></label></div>' +
  '<label class="sw sm"><input type="checkbox" data-pa' + (i.aktif === false ? '' : ' checked') + '><span class="sw-t" aria-hidden="true"></span><span class="sw-l">Aktif</span></label></div>';
function pustakaEdit(id) {
  const P = S.pus || {groups: [], items: []}, g = id ? P.groups.find(x => x.id === id) : {nama: '', urutan: P.groups.length + 1, aktif: true};
  if (!g) return; S.pgid = id || '';
  sheet('<div class="grab"></div><h2>' + (id ? 'Ubah grup' : 'Tambah grup') + '</h2><label>Nama grup<input class="inp" id="pg_n" maxlength="40" value="' + esc(g.nama) + '"></label>' +
    '<label class="sw sm"><input type="checkbox" id="pg_a"' + (g.aktif === false ? '' : ' checked') + '><span class="sw-t" aria-hidden="true"></span><span class="sw-l">Grup aktif</span></label>' +
    '<div id="pg_items">' + (id ? P.items.filter(i => i.group_id === id).map(pgRow).join('') : '') + '</div>' +
    '<button type="button" class="btn sec sm" data-act="pgadd">+ Tambah pilihan</button><p class="muted">Pilihan yang dimatikan tidak muncul di Kasir, tetapi riwayat transaksi tetap utuh.</p>' +
    '<button type="button" class="btn pri" data-act="pgsave">Simpan</button><button type="button" class="btn sec" data-act="pustaka">Kembali</button>');
}
async function pustakaSave() {
  const nama = (/** @type {any} */ ($('#pg_n')) || {}).value.trim(); if (!nama) return fieldErr('#pg_n', 'Isi nama grup');
  const items = []; document.querySelectorAll('#sheet [data-pr]').forEach((e, n) => {
    const nm = (/** @type {any} */ (e.querySelector('[data-pn]'))).value.trim(), d = dnum((/** @type {any} */ (e.querySelector('[data-pd]'))).value) || 0, a = !!(/** @type {any} */ (e.querySelector('[data-pa]'))).checked, id = dsOf(e).pr;
    if (!nm && !id) return; items.push({id: id || undefined, nama: nm || undefined, selisih_harga: d, urutan: n + 1, aktif: a});
  });
  if (items.some(x => x.selisih_harga < 0)) return fieldErr(Array.from(document.querySelectorAll('#sheet [data-pd]')).find(e => dnum(/** @type {any} */ (e).value) < 0) || '#pg_items', 'Tambahan harga tidak boleh negatif');
  const body = {id: S.pgid || undefined, nama: nama, aktif: !!(/** @type {any} */ ($('#pg_a'))).checked, items: items};
  return busy('Menyimpan…', async () => {
    try { await api('opsi.grup_save', body); await loadData(); optReset(); S.pus = await api('opsi.pustaka', {}); pustakaList(); toast('Pustaka opsi tersimpan'); }
    catch (e) { toast(e.message); }
  });
}

Object.assign(ACT, {
  optpick: el => { const O = S.opt, v = O && vById(O.v); if (!O || !v) return; const g = dsOf(el).g, i = dsOf(el).i, grp = optGroupsOf(v.product_id).find(x => x.g.id === g);
    if (O.sel[g] === i && grp && !grp.wajib) delete O.sel[g]; else O.sel[g] = i; optPaint({g: g, i: i}); },
  optinc: () => { const O = S.opt, v = O && vById(O.v); if (!O || !v) return; const st = Number(v.stok) || 0, old = O.edit != null ? S.cart[O.edit] : null;
    if (T(cfg('blokir_stok_minus')) && cartQty(O.v) - (old ? old.qty : 0) + O.qty + 1 > st) return toast('Stok tidak cukup'); O.qty++; optPaint(null); },
  optdec: () => { const O = S.opt; if (!O || O.qty <= 1) return; O.qty--; optPaint(null); },
  optadd: () => optConfirm(),
  optedit: el => { const i = Number(dsOf(el).i), l = S.cart[i]; if (l) optOpen(l.v, i); },
  optsw: el => { const g = $('#optg'); if (!g) return; const on = !!(/** @type {any} */ (el)).checked; g.hidden = !on;
    if (on && !document.querySelector('#sheet [data-og-on]:checked') && !(S.data.product_options || []).length) document.querySelectorAll('#sheet [data-og-on]').forEach(e => { (/** @type {any} */ (e)).checked = true; }); },   // mengaktifkan di produk yang belum punya opsi: semua grup pustaka terpilih (hapus centang yang tidak perlu)
  pustaka: () => pustakaOpen(), pgrp: el => pustakaEdit(dsOf(el).id || ''),
  pgadd: () => { const w = $('#pg_items'); if (w) { w.insertAdjacentHTML('beforeend', pgRow({})); const r = w.querySelectorAll('[data-pn]'); const f = /** @type {HTMLElement|undefined} */ (/** @type {any} */ (r[r.length - 1])); if (f) f.focus(); } },
  pgsave: () => pustakaSave()
});
