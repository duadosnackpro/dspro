// Tes layar "Input transaksi lama" (src/app/139-transaksi-lama.js) tanpa browser: validasi, isi permintaan ke server, anti-ganda (request_id), dan daftar sesi.
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const inti = rd('src/app/01-inti.js'), src = rd('src/app/139-transaksi-lama.js');
const pick = re => { const m = inti.match(re); assert(m, 'tidak ditemukan di 01-inti.js: ' + re); return m[0]; };
const shared = pick(/function dnum\(s\) \{[\s\S]*?\n\}/) + '\n' + pick(/const T = [^\n]*\n/) + '\n' + pick(/const vOf = [^\n]*\n/) + '\n' + pick(/const newReqId = [^\n]*\n/);

function boot(o) {
  o = o || {};
  const els = {}, calls = [], toasts = [], $ = sel => els[sel] || (els[sel] = {innerHTML: '', value: '', textContent: '', placeholder: '', focus() {}});
  const S = {tab: 'lama', data: {settings: o.settings || {}, channels: [{id: 'c1', nama: 'Shopee'}, {id: 'c2', nama: 'Offline'}], variants: [{id: 'v1', sku: 'BSR-70', nm: 'Basreng 70'}, {id: 'v2', sku: 'MKR-100', nm: 'Makaroni 100'}]}, rhist: 'x', expLoaded: true};
  const prices = {'v1|c2': 12000, 'v2|c2': 15000, 'v1|c1': 11000};
  const field = {};   // elemen berdasarkan id, untuk vOf (document.getElementById)
  const document = {getElementById: id => id === 'bd_v' ? {value: field.bd_v || '', selectedOptions: [{textContent: 'Label ' + (field.bd_v || '')}]} : id in field ? {value: field[id], focus() {}} : null, addEventListener: (t, f) => { document.__h[t] = f; }, __h: {}};
  const ctx = {S: S, $: $, document: document, esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), rp: x => 'Rp ' + Math.round(Number(x) || 0), num: x => String(x), qf: x => String(x),
    idDate: d => String(d).slice(0, 10), vName: v => v.nm, vSub: () => '', cfg: k => S.data.settings[k], priceOf: (v, c) => (v + '|' + c) in prices ? prices[v + '|' + c] : null, toast: m => toasts.push(m), busy: (l, fn) => fn(),
    loadData: async () => { calls.push({op: 'loadData'}); }, render: () => {}, VC: {}, OWN_TABS: [], MENU_TABS: [], APP: {views: {}}, ACT: {}, navigator: {onLine: true}, window: {}, Date: Date, Math: Math,
    api: async (op, body) => { calls.push({op: op, body: JSON.parse(JSON.stringify(body))}); if (ctx.__fail) throw new Error(ctx.__fail); return {sale: {id: 's', nomor: 'T1-261031-00' + calls.length, tanggal: body.tanggal, total: 24000, metode: body.metode_bayar}}; }, __fail: null};
  const fn = new Function('ctx', 'with (ctx) {\n' + shared + '\n' + src + '\nreturn {BD, vLama, bdAdd, bdSave, ACT, APP, OWN_TABS, MENU_TABS};\n}');
  return Object.assign({S: S, els: els, field: field, calls: calls, toasts: toasts, ctx: ctx, document: document}, fn(ctx));
}
const add = (m, v, q, h) => { m.field.bd_v = v; m.field.bd_q = q; m.field.bd_h = h || ''; m.bdAdd(); };

(async () => {
  let m = boot(); m.vLama();
  ok(m.OWN_TABS.indexOf('lama') >= 0 && m.MENU_TABS.indexOf('lama') >= 0 && m.APP.views.lama === m.vLama, 'tab lama terdaftar (khusus Owner/Admin lewat OWN_TABS)');
  ok(m.BD.ch === 'c2', 'channel bernama Offline dipilih otomatis');
  ok(/<option value="tunai" selected>Tunai/.test(m.els['#main'].innerHTML) && /QRIS/.test(m.els['#main'].innerHTML), 'metode tunai, QRIS, transfer tersedia');
  ok(/max="\d{4}-\d{2}-\d{2}"/.test(m.els['#main'].innerHTML) && /Belum ada item/.test(m.els['#bd_items'].innerHTML), 'form tampil: tanggal dibatasi, daftar item kosong');
  m = boot({settings: {bayar_qris: 'false'}}); m.vLama(); ok(!/QRIS/.test(m.els['#main'].innerHTML), 'metode yang dimatikan di Pengaturan tidak ditawarkan');

  m = boot(); m.vLama();
  await m.bdSave(); ok(/minimal satu item/.test(m.toasts.pop()) && !m.calls.length, 'tanpa item ditolak di klien');
  add(m, 'v1', '0', ''); ok(/lebih dari 0/.test(m.toasts.pop()), 'jumlah 0 ditolak');
  add(m, 'v1', '2', '-5'); ok(/Harga tidak valid/.test(m.toasts.pop()) && !m.BD.items.length, 'harga negatif ditolak');
  m.BD.ch = 'c1'; add(m, 'v2', '1', ''); ok(/belum diatur/.test(m.toasts.pop()) && !m.BD.items.length, 'produk tanpa harga channel dan tanpa harga manual ditolak');
  m.BD.ch = 'c2'; add(m, 'v1', '2', ''); add(m, 'v2', '1,5', '14.000');
  ok(m.BD.items.length === 2 && m.BD.items[1].qty === 1.5 && m.BD.items[1].harga === 14000 && m.BD.items[0].harga === null, 'item masuk: jumlah desimal koma dan harga manual terbaca; harga kosong = harga channel');
  ok(/Rp 45000/.test(m.els['#bd_items'].innerHTML), 'subtotal = 2 × 12.000 + 1,5 × 14.000 = 45.000');

  m.BD.tgl = '2999-01-01'; await m.bdSave(); ok(/masa lalu/.test(m.toasts.pop()) && !m.calls.length, 'tanggal masa depan ditolak di klien');
  m.BD.tgl = '2026-10-31'; m.BD.jam = '14:05'; m.BD.metode = 'qris'; m.BD.cat = 'buku catatan';
  m.ctx.__fail = 'Tidak ada koneksi ke server'; await m.bdSave(); const rid1 = m.calls[0].body.request_id;
  ok(m.toasts.pop() === 'Tidak ada koneksi ke server' && m.BD.items.length === 2 && rid1, 'gagal kirim: item tetap ada untuk dicoba lagi');
  m.ctx.__fail = null; await m.bdSave(); const b = m.calls[1].body;
  ok(b.request_id === rid1, 'kirim ulang memakai request_id yang sama (anti-ganda)');
  ok(b.tanggal === '2026-10-31 14:05:00' && b.channel_id === 'c2' && b.metode_bayar === 'qris' && b.potong_stok === false && b.catatan === 'buku catatan', 'isi permintaan: tanggal asli, channel, metode, potong_stok = false (bawaan), catatan');
  ok(JSON.stringify(b.items) === JSON.stringify([{variant_id: 'v1', qty: 2, harga: ''}, {variant_id: 'v2', qty: 1.5, harga: 14000}]), 'item dikirim dengan harga kosong untuk harga channel');
  ok(m.BD.items.length === 0 && m.BD.rid === '' && m.BD.done.length === 1 && m.BD.tgl === '2026-10-31' && m.BD.ch === 'c2' && m.BD.metode === 'qris', 'setelah berhasil: item kosong, tanggal/channel/metode dipertahankan untuk transaksi berikutnya');
  ok(!m.calls.some(c => c.op === 'loadData') && m.S.rhist === null, 'tanpa potong stok: data stok tidak dimuat ulang, cache riwayat dibuang');
  ok(/1 transaksi/.test(m.els['#bd_done'].innerHTML) && /T1-261031/.test(m.els['#bd_done'].innerHTML), 'daftar sesi menampilkan transaksi tersimpan');

  add(m, 'v1', '1', ''); const t = {dataset: {bd: 'stok'}, type: 'checkbox', checked: true, value: ''}; m.BD.rid = 'lama-rid'; m.document.__h.change({target: t});
  ok(m.BD.stok === true && m.BD.rid === '', 'mengubah isian membuat request_id baru');
  await m.bdSave(); ok(m.calls[m.calls.length - 2].body.potong_stok === true && m.calls[m.calls.length - 2].body.request_id !== rid1, 'potong_stok menyala dikirim true, request_id baru'); ok(m.calls[m.calls.length - 1].op === 'loadData', 'potong stok: data dimuat ulang');
  m.ACT.bd_del({dataset: {i: '0'}}); // tidak error pada daftar kosong
  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.error('GAGAL:', e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); });
