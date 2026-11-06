// Tes UI Produksi (web/js/modules.js) di sandbox vm dengan APP palsu: ubah jumlah batch, pintasan pembelian saat bahan kurang,
// pencarian + ingatan resep, filter tanggal riwayat, tanggal selesai. Memicu ACT dan listener input/change yang sebenarnya.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const src = fs.readFileSync(path.join(__dirname, '..', 'web/js/modules.js'), 'utf8');

function boot(role) {
  const els = {}, listeners = {}, calls = [], toasts = [], store = {}, ACT = {}, views = {};
  const $ = sel => els[sel] || (els[sel] = {innerHTML: '', value: '', disabled: false, dataset: {}, focus() {}});
  const S = {data: {user: {uid: 'u1', role: role}, settings: {}, materials: [
      {id: 'm1', nama: 'Tepung', satuan: 'kg', stok: 3, hpp_rata2: 5000, tipe: 'bahan'}, {id: 'm2', nama: 'Gula', satuan: 'kg', stok: 100, hpp_rata2: 1000, tipe: 'bahan'}],
    variants: [{id: 'v1'}, {id: 'v2'}], recipe_items: [{recipe_id: 'r1', material_id: 'm1', qty: 2}, {recipe_id: 'r1', material_id: 'm2', qty: 1}, {recipe_id: 'r2', material_id: 'm2', qty: 1}],
    recipes: [{id: 'r1', nama: 'Resep Basreng', variant_id: 'v1', hasil_standar: 10, jenis: 'batch', tenaga_kerja: 0}, {id: 'r2', nama: 'Resep Keripik', variant_id: 'v2', hasil_standar: 5, jenis: 'batch', tenaga_kerja: 0}]},
    prod: [], pform: {jenis: 'batch', recipe: '', batch: '1', catatan: ''}};
  for (let i = 3; i <= 7; i++) { S.data.recipes.push({id: 'r' + i, nama: 'Resep Lain ' + i, variant_id: 'v2', hasil_standar: 5, jenis: 'batch', tenaga_kerja: 0}); S.data.recipe_items.push({recipe_id: 'r' + i, material_id: 'm2', qty: 1}); }
  S.data.recipes.push({id: 'rp1', nama: 'Repack Basreng', variant_id: 'v1', hasil_standar: 4, jenis: 'repack', tenaga_kerja: 0});
  const respond = {};   // action -> fungsi(payload) => hasil | lempar galat
  const A = {S: S, $: $, ACT: ACT, views: views, rp: x => 'Rp' + x, num: x => String(x), esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    LS: {get: (k, d) => k in store ? store[k] : d, set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }}, T: {},
    sheet: h => { els.__sheet = h; }, closeSheet: () => { els.__sheet = ''; }, toast: m => toasts.push(m), busy: (l, fn) => fn(), skel: () => '<skel>',
    api: async (op, body) => { calls.push({op: op, body: body}); if (!respond[op]) return {}; return respond[op](body); },
    vload: (op, body, paint, opt) => { calls.push({op: 'vload:' + op, body: body, opt: opt}); paint(respond['list'] ? respond['list'](body) : [], false); },
    dnum: s => Number(String(s).replace(',', '.')), rpIn: v => String(v == null ? '' : v).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.'), r6: x => Math.round(Number(x) * 1e6) / 1e6, wrapChips: h => '<div class="chips">' + h + '</div>',
    emptyState: (i, t, d, a) => '<empty>' + t + '|' + d + (a || '') + '</empty>', idDate: d => d, idRange: () => '', today: () => '2026-11-05', addDays: (d, k) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + k); return x.toISOString().slice(0, 10); },
    vById: id => S.data.variants.find(v => v.id === id) && Object.assign({stok: 0, hpp_rata2: 0}, S.data.variants.find(v => v.id === id)), vName: v => v.id === 'v1' ? 'Basreng' : 'Keripik', vSub: () => '100g',
    can: cap => ({stockedit: ['owner', 'admin', 'supervisor', 'stok'], approve: ['owner', 'admin', 'supervisor'], produce: ['owner', 'admin', 'supervisor', 'produksi']}[cap] || []).indexOf(role) >= 0,
    own: () => role === 'owner', loadData: async () => {}, start() {}, pbPrefill: (items, back) => calls.push({op: 'pbPrefill', items: items, back: back})};
  const win = {APP: A, crypto: require('crypto').webcrypto};
  const doc = {addEventListener: (t, f) => { listeners[t] = f; }, querySelectorAll: () => []};
  vm.runInNewContext(src, {window: win, document: doc, console: console, crypto: require('crypto').webcrypto, confirm: () => true, Date: Date, Math: Math, JSON: JSON, Object: Object, Promise: Promise, String: String, Number: Number, Array: Array, setTimeout: setTimeout});
  return {A: A, S: S, ACT: ACT, els: els, calls: calls, toasts: toasts, store: store, listeners: listeners, respond: respond, views: views};
}
const plan = o => Object.assign({id: 'po1', variant_id: 'v1', recipe_id: 'r1', jenis: 'batch', jumlah_batch: 2, tanggal: '2026-11-03 08:00:00', tanggal_selesai: null, status: 'rencana', qty_standar: 20, qty_hasil: null, catatan: 'c'}, o);
const done = o => plan(Object.assign({id: 'po2', status: 'selesai', tanggal_selesai: '2026-11-05 10:30:00', qty_hasil: 19, qty_standar: 20, hpp_per_unit: 1000, bahan: 1, kemasan: 0, tenaga_kerja: 0, overhead: 0, total: 1}, o));
const input = (m, attr, v) => m.listeners.input({target: {dataset: {[attr[0]]: attr[1]}, value: v}});
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  // ===== Daftar: tanggal selesai =====
  let m = boot('owner'); m.respond.list = () => [plan(), done()]; m.views.produksi();
  let list = m.els['#plist'].innerHTML;
  ok(/selesai 2026-11-05/.test(list) && !/selesai 2026-11-03/.test(list), 'daftar: pesanan selesai menampilkan tanggal selesai, rencana menampilkan tanggal dibuat');
  ok(/2026-11-03/.test(list), 'daftar: rencana tetap menampilkan tanggal dibuat');
  m.ACT.pdetail({dataset: {id: 'po2'}}); ok(/dibuat 2026-11-03 08:00/.test(m.els.__sheet) && /selesai 2026-11-05 10:30/.test(m.els.__sheet), 'detail selesai: tanggal dibuat dan selesai');
  m.ACT.pdetail({dataset: {id: 'po1'}}); ok(/data-act="pedit"/.test(m.els.__sheet) && /Ubah jumlah batch/.test(m.els.__sheet), 'detail rencana: ada tombol Ubah jumlah batch');
  m.ACT.pdetail({dataset: {id: 'po2'}}); ok(!/data-act="pedit"/.test(m.els.__sheet), 'detail selesai: tidak ada tombol ubah');

  // ===== Ubah jumlah batch =====
  m.ACT.pedit({dataset: {id: 'po1'}}); let sh = m.els.__sheet;
  ok(/Ubah jumlah batch/.test(sh) && /value="2"/.test(sh) && /standar 10 unit per batch/.test(sh), 'edit: lembar terbuka dengan batch 2 dan standar per batch 10');
  const rid0 = m.S.pe.rid; input(m, ['pe', 'batch'], '1'); ok(m.S.pe.rid !== rid0, 'edit: isian berubah => request_id baru');
  ok(!/KURANG/.test(m.els['#pev'].innerHTML) && !/pbshort/.test(m.els['#pev'].innerHTML), 'edit batch 1: bahan cukup (2 kg dari 3), tanpa pesan kurang');
  input(m, ['pe', 'batch'], '3'); ok(/Hasil standar 30 unit/.test(m.els['#pev'].innerHTML) && /KURANG/.test(m.els['#pev'].innerHTML) && /data-act="pbshort"/.test(m.els['#pev'].innerHTML), 'edit batch 3: pratinjau 30 unit, Tepung kurang, tombol pembelian');
  input(m, ['pe', 'batch'], '0'); ok(/lebih dari 0/.test(m.els['#pev'].innerHTML) && m.els['#pebtn'].disabled === true, 'edit batch 0: ditolak di klien, tombol mati');
  m.respond['production.update'] = b => ({id: b.id, status: 'planned', jumlah_batch: b.jumlah_batch, qty_standar: 30, catatan: b.catatan});
  input(m, ['pe', 'batch'], '3'); input(m, ['pe', 'catatan'], 'revisi'); const rid1 = m.S.pe.rid; m.calls.length = 0;
  await m.ACT.pesave(); await tick();
  const up = m.calls.find(c => c.op === 'production.update');
  ok(up && up.body.request_id === rid1 && up.body.id === 'po1' && up.body.jumlah_batch === 3 && up.body.catatan === 'revisi', 'edit: kirim request_id yang sama dengan isian terakhir, batch 3, catatan');
  ok(m.toasts.pop() === 'Jumlah batch diubah menjadi 3', 'edit: pesan sukses');
  const reload = m.calls.find(c => c.op === 'vload:production.list'); ok(reload && reload.opt && reload.opt.force === true, 'edit: daftar dimuat ulang paksa (rencana tidak menaikkan versi data)');
  // kirim ulang (duplicate)
  m.ACT.pedit({dataset: {id: 'po1'}}); m.respond['production.update'] = b => ({id: b.id, jumlah_batch: 2, qty_standar: 20, duplicate: true});
  await m.ACT.pesave(); await tick(); ok(m.toasts.pop() === 'Perubahan ini sudah tersimpan sebelumnya', 'edit ulang: pesan "sudah tersimpan sebelumnya", bukan sukses baru');
  // galat server (mis. sudah selesai oleh perangkat lain)
  m.ACT.pedit({dataset: {id: 'po1'}}); m.respond['production.update'] = () => { throw new Error('Hanya rencana produksi yang belum selesai yang bisa diubah (produksi ini sudah selesai).'); };
  await m.ACT.pesave(); await tick(); ok(/sudah selesai/.test(m.toasts.pop()) && m.S.pe, 'edit: galat server ditampilkan, lembar tetap terbuka (isian tidak hilang)');
  m.ACT.pedit({dataset: {id: 'po2'}}); ok(/Hanya rencana/.test(m.toasts.pop()), 'edit: pesanan selesai ditolak di klien');

  // ===== Pintasan pembelian =====
  m = boot('owner'); m.respond.list = () => [plan()]; m.views.produksi(); m.ACT.pdone({dataset: {id: 'po1'}});
  ok(/data-act="pbshort"/.test(m.els['#pdv'].innerHTML) && /Stok kurang: Tepung/.test(m.els['#pdv'].innerHTML), 'selesaikan: bahan kurang => tombol Catat pembelian bahan kurang');
  m.ACT.pbshort({}); let pf = m.calls.find(c => c.op === 'pbPrefill');
  ok(pf && pf.items.length === 1 && pf.items[0].id === 'm1' && pf.items[0].qty === 1, 'pintasan: kekurangan Tepung = 4 - 3 = 1 kg');
  m.S.pd.qty = '15'; const pdQty = m.S.pd.qty; pf.back(); ok(m.S.pd.qty === pdQty && /Selesaikan produksi/.test(m.els.__sheet) && /value="15"/.test(m.els.__sheet), 'kembali: lembar selesaikan dibuka lagi dengan isian terjaga (tidak direset)');
  m.S.data.materials[0].stok = 4; input(m, ['pd', 'qty'], '15'); ok(!/pbshort/.test(m.els['#pdv'].innerHTML) && m.els['#pdbtn'].disabled === false, 'stok sudah cukup (sesudah pembelian): tombol hilang, Selesaikan aktif');
  m = boot('produksi'); m.respond.list = () => [plan()]; m.views.produksi(); m.ACT.pdone({dataset: {id: 'po1'}});
  ok(!/data-act="pbshort"/.test(m.els['#pdv'].innerHTML) && /Minta bagian Stok/.test(m.els['#pdv'].innerHTML), 'peran produksi (tanpa hak pembelian): tanpa tombol, ada petunjuk');
  m = boot('owner'); m.ACT.prec(); input(m, ['pq', 'batch'], '5'); ok(/data-act="pbshort"/.test(m.els['#prv'].innerHTML), 'catat produksi selesai: pintasan juga ada');
  m.ACT.pbshort({}); pf = m.calls.find(c => c.op === 'pbPrefill'); ok(pf.items[0].qty === 7, 'pintasan: 5 batch x 2 kg = 10, stok 3 => kurang 7'); pf.back(); ok(/Catat produksi selesai/.test(m.els.__sheet), 'kembali ke lembar catat produksi');
  m = boot('owner'); m.S.data.materials[0].stok = 3.0004; m.S.data.recipe_items[0].qty = 0.3333; m.ACT.prec(); input(m, ['pq', 'batch'], '10'); m.ACT.pbshort({});
  ok(m.calls.find(c => c.op === 'pbPrefill').items[0].qty === 0.333, 'kekurangan pecahan dibulatkan ke atas 3 desimal (3,333 - 3,0004 = 0,3326 => 0,333)');

  // ===== Cari + ingat resep =====
  m = boot('owner'); m.ACT.prec(); sh = m.els.__sheet;
  ok(/data-rs="rec"/.test(sh) && (sh.match(/<option/g) || []).length === 7, 'catat produksi: 7 resep non-repack => kotak cari muncul');
  m.ACT.prjenis({dataset: {j: 'repack'}}); ok(!/data-rs=/.test(m.els.__sheet) && m.S.prec.recipe === 'rp1', 'repack: 1 resep => tanpa kotak cari, resep terpilih');
  m.ACT.prjenis({dataset: {j: 'batch'}}); const rid2 = m.S.prec.rid; input(m, ['rs', 'rec'], 'lain 5');
  ok(m.S.prec.recipe === 'r5' && /Resep Lain 5/.test(m.els['#rsel'].innerHTML) && (m.els['#rsel'].innerHTML.match(/<option/g) || []).length === 1 && m.S.prec.rid !== rid2, 'cari "lain 5": satu pilihan, otomatis terpilih, request_id baru');
  input(m, ['rs', 'rec'], 'basreng'); ok(m.S.prec.recipe === 'r1', 'cari lewat nama produk (Basreng)');
  input(m, ['rs', 'rec'], 'zzz'); ok(/Tidak ada resep yang cocok/.test(m.els['#rsel'].innerHTML) && m.S.prec.recipe === '' && m.els['#prbtn'].disabled === true, 'cari tanpa hasil: pesan, tidak ada resep, tombol simpan mati');
  input(m, ['rs', 'rec'], ''); ok((m.els['#rsel'].innerHTML.match(/<option/g) || []).length === 7 && m.S.prec.recipe !== '', 'kosongkan pencarian: semua resep kembali, ada yang terpilih');
  m.respond['production.record'] = () => ({status: 'done', duplicate: false, costs: {hpp_per_unit: 10}, materials: [], variant: {id: 'v2', stok: 1, hpp_rata2: 1}});
  input(m, ['pq', 'recipe'], 'r4'); input(m, ['pq', 'batch'], '1'); await m.ACT.prsave(); await tick();
  ok(m.store.recipe_last && m.store.recipe_last.u1 && m.store.recipe_last.u1.batch === 'r4', 'tersimpan: resep terakhir (batch) = r4 per pengguna');
  m.ACT.prec(); ok(m.S.prec.recipe === 'r4' && /<option value="r4" selected>/.test(m.els.__sheet), 'buka lagi: resep terakhir (r4) langsung terpilih');
  m.ACT.prjenis({dataset: {j: 'repack'}}); m.ACT.prjenis({dataset: {j: 'batch'}}); ok(m.S.prec.recipe === 'r4', 'ganti jenis lalu kembali: tetap resep terakhir');
  m.S.data.recipes = m.S.data.recipes.filter(r => r.id !== 'r4'); m.S.prec = null; m.ACT.prec(); ok(m.S.prec.recipe === 'r1', 'resep terakhir sudah dihapus: jatuh ke resep pertama');
  // rencana: guard tanpa resep + ingatan
  m = boot('owner'); m.ACT.pnew(); input(m, ['pf', 'recipe'], 'r3'); m.respond['production.create'] = () => ({id: 'x', status: 'planned'});
  await m.ACT.psave(); await tick(); ok(m.store.recipe_last.u1.batch === 'r3', 'rencana tersimpan juga mengingat resep');
  m = boot('owner'); m.ACT.pnew(); input(m, ['rs', 'plan'], 'zzz'); m.calls.length = 0; await m.ACT.psave(); ok(!m.calls.some(c => c.op === 'production.create') && /Pilih resep/.test(m.toasts.pop()), 'rencana: tanpa resep terpilih tidak mengirim ke server');

  // ===== Filter tanggal =====
  m = boot('owner'); m.respond.list = () => []; m.views.produksi(); let v0 = m.calls.filter(c => c.op === 'vload:production.list').pop();
  ok(JSON.stringify(v0.body) === '{}', 'tanpa filter: permintaan kosong (perilaku lama)');
  m.listeners.change({target: {dataset: {chg: 'pfrom'}, value: '2026-11-01'}}); v0 = m.calls.filter(c => c.op === 'vload:production.list').pop();
  ok(JSON.stringify(v0.body) === '{"from":"2026-11-01"}', 'isi "dari": hanya from dikirim');
  m.listeners.change({target: {dataset: {chg: 'pto'}, value: '2026-11-04'}}); v0 = m.calls.filter(c => c.op === 'vload:production.list').pop();
  ok(v0.body.from === '2026-11-01' && v0.body.to === '2026-11-04', 'isi "sampai": from + to dikirim');
  ok(/value="2026-11-01"/.test(m.els['#main'].innerHTML) && /value="2026-11-04"/.test(m.els['#main'].innerHTML), 'input tanggal menampilkan filter aktif');
  const bad = {dataset: {chg: 'pfrom'}, value: '2026-11-09'}; m.calls.length = 0; m.listeners.change({target: bad});
  ok(/Tanggal awal/.test(m.toasts.pop()) && bad.value === '2026-11-01' && m.S.pfl.from === '2026-11-01' && !m.calls.some(c => c.op === 'vload:production.list'), 'rentang terbalik: ditolak, nilai lama dikembalikan, tidak memanggil server');
  m.ACT.pfq({dataset: {p: 'today'}}); v0 = m.calls.filter(c => c.op === 'vload:production.list').pop(); ok(v0.body.from === '2026-11-05' && v0.body.to === '2026-11-05' && /chip on" data-act="pfq" data-p="today"/.test(m.els['#main'].innerHTML), 'chip Hari ini: from=to=hari ini, chip aktif');
  m.ACT.pfq({dataset: {p: '7d'}}); v0 = m.calls.filter(c => c.op === 'vload:production.list').pop(); ok(v0.body.from === '2026-10-30' && v0.body.to === '2026-11-05', 'chip 7 hari: 30 Okt s/d 5 Nov');
  ok(/Tidak ada produksi pada rentang tanggal ini/.test(m.els['#plist'].innerHTML) && /data-p="all"/.test(m.els['#plist'].innerHTML), 'filter tanpa hasil: pesan khusus + tombol Tampilkan semua');
  m.ACT.pfq({dataset: {p: 'all'}}); v0 = m.calls.filter(c => c.op === 'vload:production.list').pop(); ok(JSON.stringify(v0.body) === '{}' && /Belum ada produksi/.test(m.els['#plist'].innerHTML), 'Semua: filter dihapus, kembali ke keadaan kosong biasa');
  m.respond.list = () => Array.from({length: 200}, (_, i) => plan({id: 'p' + i})); m.views.produksi(); ok(/Menampilkan 200 produksi terbaru/.test(m.els['#plist'].innerHTML), '200 baris: petunjuk persempit filter');
  // jawaban filter lama yang datang terlambat tidak boleh menimpa
  m = boot('owner'); let late = null; m.A.vload = (op, body, paint) => { if (!body.from) late = () => paint([plan({id: 'LAMA'})], false); else paint([plan({id: 'BARU'})], false); };
  m.views.produksi(); m.listeners.change({target: {dataset: {chg: 'pfrom'}, value: '2026-11-01'}}); late(); ok(/BARU/.test(m.els['#plist'].innerHTML) && !/LAMA/.test(m.els['#plist'].innerHTML), 'jawaban basi untuk filter lama diabaikan');

  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.error(e); process.exit(1); });
