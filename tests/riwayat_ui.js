// Tes pencarian Riwayat dan detail nota (src/app/08-riwayat.js + penanda retur/salinan di receiptDoc, 03-ikon-tampilan-struk.js) tanpa browser.
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const inti = rd('src/app/01-inti.js'), strk = rd('src/app/03-ikon-tampilan-struk.js'), riw = rd('src/app/08-riwayat.js'), aksi = rd('src/app/13-aksi.js'), adp = rd('web/js/sb-adapter.js');
const pick = (src, re) => { const m = src.match(re); assert(m, 'tidak ditemukan: ' + re); return m[0]; };
const shared = [pick(inti, /const rp = [^\n]*\n/), pick(inti, /const num = [^\n]*\n/), pick(inti, /const qf = [^\n]*\n/), pick(inti, /const T = [^\n]*\n/), pick(inti, /const p2 = [^\n]*\n/),
  pick(strk, /const cfg = [^\n]*\n/), pick(strk, /const rcWidth = [^\n]*\n/), pick(strk, /function wrapWords\(t, w\) \{[\s\S]*?\n\}\n/), pick(strk, /const ljust = [\s\S]*?\nfunction receiptDoc[\s\S]*?\n\}\nconst docText = [^\n]*\n/),
  pick(strk, /const idDate = [^\n]*\n/), pick(strk, /const addDays = [^\n]*\n/), pick(strk, /const emptyState = [^\n]*\n/), pick(strk, /const wrapChips = [^\n]*\n/)].join('\n');
const cfgOn = 'const cfgOn = (k, def) => { const v = cfg(k); return v == null || v === "" ? !!def : T(v); };';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function boot(o) {
  o = o || {}; const els = {}, calls = [], toasts = [], sheets = [], timers = [], pend = [];
  const mkEl = () => ({innerHTML: '', hidden: false, value: '', textContent: ''});
  const $ = sel => o.noDom ? null : (els[sel] || (els[sel] = mkEl()));
  const S = {tab: 'riwayat', day: '2026-11-07', nomor: {}, data: {user: {uid: o.uid || 'u1', role: o.role || 'owner'}, settings: o.settings || {nama_usaha: 'Duado Snack', lebar_struk: 32}}, queue: [], rc: null};
  const ctx = {S: S, $: $, MON: MON, esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), svg: () => '<svg></svg>', skel: () => '<i class="sk"></i>', PGN: {hist: 50},
    chName: id => id === 'c1' ? 'Kasir Toko' : '-', can: cap => cap === 'approve' ? (S.data.user.role === 'owner' || S.data.user.role === 'supervisor') : false, today: () => '2026-11-07', dverKey: () => o.ver || 'v1',
    toast: m => toasts.push(m), softLogout: () => { ctx.__logout = true; }, sheet: h => sheets.push(h), refreshRc: () => { ctx.__refresh = (ctx.__refresh || 0) + 1; }, btBox: () => '<div class="btbox"></div>', navigator: {onLine: o.online !== false}, Date: Date, Math: Math, Number: Number, String: String, Array: Array, Set: Set, Object: Object, Promise: Promise, JSON: JSON,
    setTimeout: (f, ms) => { const t = {f: f, ms: ms, id: timers.length + 1, off: false}; timers.push(t); return t.id; }, clearTimeout: id => { const t = timers.find(x => x.id === id); if (t) t.off = true; },
    api: (op, body) => new Promise((res, rej) => { calls.push({op: op, body: JSON.parse(JSON.stringify(body))}); const h = {res: res, rej: rej, op: op, body: body}; pend.push(h); if (!o.manual) setTimeout(() => {}, 0); if (!o.manual) flushOne(h); }), ACT: {}};
  function flushOne(h) { try { const r = (o.reply || (() => ({})))(h.op, h.body); if (r instanceof Error) h.rej(r); else h.res(r); } catch (e) { h.rej(e); } }
  const src = shared + '\n' + cfgOn + '\n' + riw.replace(/\/\* -{10} Riwayat -{10} \*\/\nasync function vRiwayat\(\) \{[\s\S]*?\n\}\n\n(?=\/\* -{10} Pencarian)/, '');
  const fn = new Function('ctx', 'with (ctx) {\n' + src + '\nreturn {crState, riwayatRow, crMode, crType, crGo, crPaint, rcptOpen, receiptDoc, docText, CR_SPAN};\n}');
  return Object.assign({S: S, els: els, calls: calls, toasts: toasts, sheets: sheets, timers: timers, pend: pend, ctx: ctx, flushOne: flushOne, flushTimers: () => { timers.filter(t => !t.off).forEach(t => { t.off = true; t.f(); }); }}, fn(ctx));
}
const tick = () => new Promise(r => setImmediate(r));
const row = (id, nomor, total, x) => Object.assign({id: id, nomor: nomor, tanggal: '2026-11-07 10:15:00', channel_id: 'c1', metode_bayar: 'tunai', total: total, status: 'selesai', ref_sale_id: null, review: false, cocok: ['produk'], items: [{n: 'Basreng 100g', q: 2}], item_n: 1}, x || {});
const reply = (op, b) => op === 'sales.search' ? {rows: [row('s1', 'OUT-001-261107-001', 20000), row('s2', 'RT-OUT-001-261107-001', -10000, {ref_sale_id: 's1', items: [{n: 'Basreng 100g', q: -1}], cocok: ['total']})], total: 2, omzet: 10000, offset: b.offset || 0} : {};

(async () => {
  // --- adapter: dua aksi baru memanggil RPC yang benar dan MIN_SCHEMA menunjuk migrasi 0042 ---
  ok(/case 'sales\.search': return rpc\('sales_search', withOutlet\(p\), token\)/.test(adp), "adapter: 'sales.search' -> rpc sales_search dengan outlet aktif");
  ok(/case 'sale\.receipt': return rpc\('sale_receipt', p, token\)/.test(adp), "adapter: 'sale.receipt' -> rpc sale_receipt");
  ok(/const MIN_SCHEMA = '20261107000042'/.test(adp), 'MIN_SCHEMA = migrasi 0042');
  ok(fs.existsSync(path.join(__dirname, '../supabase/migrations/20261107000042_riwayat_cari.sql')), 'berkas migrasi 0042 ada');
  ok(/data-in="cr"/.test(riw) && /if \(k === 'cr'\) return crType\(v\)/.test(aksi), 'kolom cari terhubung ke penangan input');
  ['rcpt', 'rcpt_rev', 'crspan', 'crmore'].forEach(a => ok(new RegExp('\\b' + a + ':').test(aksi), 'aksi terdaftar: ' + a));

  // --- keadaan: per pengguna ---
  let m = boot(); const R0 = m.crState(); ok(R0.q === '' && R0.span === 1, 'keadaan awal kosong, rentang 1 hari'); R0.q = 'abc'; ok(m.crState().q === 'abc', 'keadaan tetap selama pengguna sama');
  m.S.data.user.uid = 'u2'; ok(m.crState().q === '', 'ganti pengguna: kata kunci dan hasil lama tidak terbawa');

  // --- baris nota ---
  m = boot(); let h = m.riwayatRow(row('s1', 'OUT-001-261107-001', 20000));
  ok(/data-act="rcpt" data-id="s1"/.test(h) && /aria-label="Lihat struk OUT-001-261107-001"/.test(h), 'baris: area utama membuka struk (tombol dengan nama aksesibel)');
  ok(/data-act="retur" data-id="s1"/.test(h), 'baris penjualan selesai: tombol Retur terpisah'); ok(!/<button[^>]*rli-main[^>]*>[^]*data-act="retur"[^]*<\/button><div class="rli-a">/.test(h), 'tombol Retur berada di luar tombol utama (tidak bersarang)');
  h = m.riwayatRow(row('s2', 'RT-OUT-001-261107-001', -10000, {ref_sale_id: 's1'})); ok(/Retur<\/span>/.test(h) && !/data-act="retur"/.test(h), 'baris retur: tanda Retur, tanpa tombol Retur');
  h = m.riwayatRow(row('s3', 'X-1', 5000, {review: true, review_note: 'harga beda'})); ok(/data-act="sreview" data-id="s3"/.test(h) && /harga beda/.test(h), 'owner melihat tombol Tandai ditinjau + catatan');
  m = boot({role: 'kasir'}); h = m.riwayatRow(row('s3', 'X-1', 5000, {review: true})); ok(!/sreview/.test(h), 'kasir tidak melihat tombol Tandai ditinjau');
  h = m.riwayatRow(row('s4', '<b>x</b>', 1000, {items: [{n: '<i>Produk</i>', q: 1}]}), {items: true, tags: true, date: true}); ok(!/<b>x<\/b>|<i>Produk/.test(h), 'baris: nomor dan nama produk di-escape');
  h = m.riwayatRow(row('s5', 'A-1', 1000, {cocok: ['nomor', 'produk'], item_n: 5, items: [{n: 'A', q: 1}, {n: 'B', q: 2}, {n: 'C', q: 3}]}), {items: true, tags: true, date: true});
  ok(/Nomor<\/span>/.test(h) && /Produk<\/span>/.test(h) && /\+2 lagi/.test(h) && /7 Nov 2026/.test(h), 'baris hasil: tag bidang cocok, ringkasan item (+N lagi), tanggal');

  // --- mengetik: debounce, satu permintaan, rentang tanggal ---
  m = boot({reply: reply}); m.crType('b'); m.crType('ba'); m.crType('bas'); ok(m.calls.length === 0, 'belum ada permintaan sebelum jeda ketik'); ok(m.els['#crr'].hidden === false && m.els['#crday'].hidden === true, 'mode cari: hasil tampil, daftar harian disembunyikan');
  m.flushTimers(); await tick(); await tick(); ok(m.calls.length === 1 && m.calls[0].op === 'sales.search', 'satu permintaan setelah jeda');
  ok(m.calls[0].body.q === 'bas' && m.calls[0].body.from === '2026-11-07' && m.calls[0].body.to === '2026-11-07' && m.calls[0].body.limit === 50 && m.calls[0].body.offset === 0, 'isi permintaan: kata kunci terakhir, hari terpilih, 50 per halaman');
  ok(/OUT-001-261107-001/.test(m.els['#crr'].innerHTML) && /Nota cocok/.test(m.els['#crr'].innerHTML), 'hasil tergambar'); ok(/Nilai nota \(neto\)/.test(m.els['#crr'].innerHTML) && /10\.000/.test(m.els['#crr'].innerHTML), 'ringkasan: jumlah dan nilai neto');
  m.crType('   '); ok(m.els['#crr'].hidden === true && m.els['#crday'].hidden === false && m.crState().res === null, 'kata kunci dikosongkan: kembali ke daftar harian');
  m.crType('x'.repeat(100)); ok(m.crState().q.length === 60, 'kata kunci dibatasi 60 karakter (sama dengan server)');

  // rentang 7 hari: from = hari terpilih - 6
  m = boot({reply: reply}); m.crState().q = 'abc'; m.crState().span = 7; await m.crGo(false); ok(m.calls[0].body.from === '2026-11-01' && m.calls[0].body.to === '2026-11-07', '7 hari: 1–7 Nov');
  m.S.day = '2026-03-02'; m.crState().span = 90; await m.crGo(false); ok(m.calls[1].body.from === '2025-12-03', '90 hari melintasi tahun dihitung benar, dapat ' + m.calls[1].body.from);
  ok(m.ctx.CR_SPAN === undefined && m.CR_SPAN.map(x => x[0]).join() === '1,7,30,90' && Math.max.apply(null, m.CR_SPAN.map(x => x[0])) <= 92, 'pilihan rentang 1/7/30/90 hari (di bawah batas server 92)');

  // --- cache per versi data ---
  m = boot({reply: reply}); m.crState().q = 'abc'; await m.crGo(false); await m.crGo(false); ok(m.calls.length === 1, 'permintaan sama dan versi sama: memakai hasil tersimpan');
  m.ctx.dverKey = () => 'v2'; await m.crGo(false); ok(m.calls.length === 2, 'versi data berubah (transaksi/retur baru): hasil dimuat ulang');

  // --- anti-balapan: hasil lama tidak menimpa hasil baru ---
  m = boot({manual: true}); m.crState().q = 'lama'; const p1 = m.crGo(false); m.crState().q = 'baru'; const p2 = m.crGo(false);
  m.pend[1].res({rows: [row('n1', 'BARU-1', 1000)], total: 1, omzet: 1000}); await p2; m.pend[0].res({rows: [row('o1', 'LAMA-1', 9000)], total: 1, omzet: 9000}); await p1;
  ok(/BARU-1/.test(m.els['#crr'].innerHTML) && !/LAMA-1/.test(m.els['#crr'].innerHTML), 'respons terlambat dari kata kunci lama diabaikan');

  // --- halaman berikutnya: offset = jumlah baris termuat, tanpa ganda ---
  m = boot({reply: (op, b) => b.offset ? {rows: [row('s2', 'DUP', 1), row('s3', 'N-3', 3000)], total: 3, omzet: 3} : {rows: [row('s1', 'N-1', 1000), row('s2', 'N-2', 2000)], total: 3, omzet: 3}});
  m.crState().q = 'abc'; await m.crGo(false); ok(/Tampilkan 1 lagi \(sisa 1\)/.test(m.els['#crr'].innerHTML) && /data-act="crmore"/.test(m.els['#crr'].innerHTML), 'ada sisa: tombol Tampilkan lagi');
  await m.crGo(true); ok(m.calls[1].body.offset === 2, 'halaman berikutnya memakai offset = baris termuat'); ok(m.crState().res.rows.length === 3 && !/DUP/.test(m.els['#crr'].innerHTML), 'baris ganda dibuang; 3 baris'); ok(!/crmore/.test(m.els['#crr'].innerHTML), 'sisa habis: tombol hilang');

  // --- kosong, galat, offline ---
  m = boot({reply: () => ({rows: [], total: 0, omzet: 0})}); m.crState().q = 'zzz'; await m.crGo(false); ok(/Tidak ada nota yang cocok/.test(m.els['#crr'].innerHTML), 'hasil kosong: pesan jelas');
  m = boot({reply: () => Object.assign(new Error('Rentang pencarian maksimal 92 hari.'), {server: true})}); m.crState().q = 'abc'; await m.crGo(false); ok(/maksimal 92 hari/.test(m.els['#crr'].innerHTML) && /u-err/.test(m.els['#crr'].innerHTML), 'galat server ditampilkan apa adanya');
  m = boot({reply: () => new Error('Failed to fetch')}); m.crState().q = 'abc'; await m.crGo(false); ok(/periksa koneksi/.test(m.els['#crr'].innerHTML), 'galat jaringan: pesan koneksi');
  m = boot({reply: () => Object.assign(new Error('Sesi berakhir'), {auth: true})}); m.crState().q = 'abc'; await m.crGo(false); ok(m.ctx.__logout === true, 'sesi berakhir: keluar');
  m = boot({online: false, reply: reply}); m.crState().q = 'abc'; await m.crGo(false); ok(m.calls.length === 0 && /butuh koneksi internet/.test(m.els['#crr'].innerHTML), 'offline: tidak memanggil server, pesan jelas');
  m = boot({reply: reply, noDom: true}); m.crState().q = 'abc'; await m.crGo(false); ok(m.calls.length === 0, 'layar bukan Riwayat / elemen tidak ada: tidak memanggil server');

  // --- detail nota ---
  const sale = {id: 's1', nomor: 'OUT-001-261107-001', tanggal: '2026-11-07 10:15:00', waktu_ms: 1794050100000, jenis: 'sale', status: 'selesai', ref_sale_id: null, ref_nomor: null, channel: 'Kasir Toko', kasir: 'Kasir X', metode_bayar: 'tunai',
    subtotal: 20000, diskon: 0, ppn_nominal: 0, total: 20000, terima: 25000, kembali: 5000, referensi: null, catatan: null, alasan: null, review: false, review_note: null};
  m = boot({reply: (op) => op === 'sale.receipt' ? {sale: sale, items: [{variant_id: 'v1', sku: 'BSR', nama: 'Basreng 100g', label: 'Level 3', qty: 2, harga: 10000, total: 20000}], returns: [{id: 'r1', nomor: 'RT-OUT-001-261107-001', tanggal: '2026-11-07 11:00:00', total: -10000}]} : {}});
  await m.rcptOpen('s1'); ok(m.calls[0].op === 'sale.receipt' && m.calls[0].body.id === 's1', 'membuka nota: memanggil sale.receipt');
  const rc = m.S.rc; ok(rc && rc.nomor === 'OUT-001-261107-001' && rc.salinan === true && rc.retur === false && rc.terima === 25000 && rc.kembali === 5000 && rc.kasir === 'Kasir X' && rc.ch === 'Kasir Toko' && rc.time === 1794050100000, 'struk disusun dari data server (nomor, kasir, kanal, terima/kembali, waktu)');
  ok(rc.lines.length === 1 && rc.lines[0].n === 'Basreng 100g (Level 3)' && rc.lines[0].q === 2 && rc.lines[0].h === 10000, 'baris struk memuat label opsi');
  h = m.sheets[0]; ok(/<h2>OUT-001-261107-001<\/h2>/.test(h) && /id="rtxt"/.test(h) && m.ctx.__refresh === 1, 'sheet: judul nomor, area struk, struk digambar');
  ok(/data-act="retur" data-id="s1"/.test(h) && /data-act="print"/.test(h) && /data-act="share"/.test(h) && /data-act="copyrc"/.test(h) && /data-act="rawbt"/.test(h) && /data-act="wa"/.test(h), 'sheet: Retur, Cetak, Bagikan, Salin, Bluetooth, WhatsApp');
  ok(/Retur terkait/.test(h) && /data-act="rcpt" data-id="r1"/.test(h), 'sheet: daftar retur terkait dapat dibuka'); ok(/Kembalian/.test(h), 'sheet: kembalian untuk tunai');
  let doc = m.docText(m.receiptDoc(rc, {w: 32}), 32);
  ok(/SALINAN STRUK/.test(doc) && /No\s+: OUT-001-261107-001/.test(doc) && /Kasir\s+: Kasir X/.test(doc) && /Basreng 100g \(Level 3\)/.test(doc) && /TOTAL\s+20\.000/.test(doc) && /Tunai\s+25\.000/.test(doc) && /Kembalian\s+5\.000/.test(doc), 'struk salinan: tanda SALINAN, nomor, kasir, item, total, tunai, kembalian');
  ok(!/RETUR/.test(doc), 'struk penjualan tidak bertanda RETUR');
  doc = m.docText(m.receiptDoc(Object.assign({}, rc, {salinan: false}), {w: 48}), 48); ok(!/SALINAN/.test(doc), 'tanpa flag salinan: struk asli tidak berubah');
  ok(m.docText(m.receiptDoc({rid: 'zz', time: 1794050100000, kasir: 'K', ch: 'Toko', metode: 'tunai', terima: 5000, kembali: 0, sub: 5000, dis: 0, ppn: 0, total: 5000, lines: [{n: 'A', q: 1, h: 5000}]}, {w: 32}), 32).indexOf('(menunggu sinkron)') > 0, 'struk transaksi baru (tanpa nomor) tetap menulis menunggu sinkron');

  // retur: tanda, nota asal, refund, tanpa tombol Retur
  const sret = Object.assign({}, sale, {id: 'r1', nomor: 'RT-OUT-001-261107-001', jenis: 'return', ref_sale_id: 's1', ref_nomor: 'OUT-001-261107-001', subtotal: -10000, total: -10000, terima: 10000, kembali: 0, alasan: 'salah input'});
  m = boot({reply: () => ({sale: sret, items: [{nama: 'Basreng 100g', label: null, qty: -1, harga: 10000, total: -10000}], returns: []})}); await m.rcptOpen('r1');
  h = m.sheets[0]; ok(!/data-act="retur"/.test(h) && /Lihat nota asal OUT-001-261107-001/.test(h) && /data-act="rcpt" data-id="s1"/.test(h) && /Dikembalikan/.test(h) && /salah input/.test(h), 'sheet retur: tanpa tombol Retur, tautan nota asal, nilai dikembalikan, alasan');
  doc = m.docText(m.receiptDoc(m.S.rc, {w: 32}), 32); ok(/\*\*\* RETUR \*\*\*/.test(doc) && /Asal\s+: OUT-001-261107-001/.test(doc) && /Refund Tunai\s+10\.000/.test(doc) && !/Kembalian/.test(doc) && /TOTAL\s+-10\.000/.test(doc), 'struk retur: RETUR, nota asal, Refund, total negatif, tanpa kembalian');
  // nota batal
  m = boot({reply: () => ({sale: Object.assign({}, sale, {status: 'batal'}), items: [], returns: []})}); await m.rcptOpen('s1'); ok(!/data-act="retur"/.test(m.sheets[0]) && /Batal<\/span>/.test(m.sheets[0]), 'nota batal: tanda Batal, tanpa Retur');
  // perlu ditinjau
  m = boot({reply: () => ({sale: Object.assign({}, sale, {review: true, review_note: 'harga beda'}), items: [], returns: []})}); await m.rcptOpen('s1'); ok(/data-act="rcpt_rev" data-id="s1"/.test(m.sheets[0]) && /harga beda/.test(m.sheets[0]), 'owner: tombol Tandai ditinjau di detail');
  m = boot({role: 'kasir', reply: () => ({sale: Object.assign({}, sale, {review: true}), items: [], returns: []})}); await m.rcptOpen('s1'); ok(!/rcpt_rev/.test(m.sheets[0]), 'kasir: tanpa tombol Tandai ditinjau');
  // escape
  m = boot({reply: () => ({sale: Object.assign({}, sale, {nomor: '<img src=x>', catatan: '<script>1</script>'}), items: [], returns: []})}); await m.rcptOpen('s1'); ok(!/<img src=x>|<script>/.test(m.sheets[0]), 'detail: nomor dan catatan di-escape');
  // galat
  m = boot({reply: () => Object.assign(new Error('Akses ditolak.'), {server: true})}); await m.rcptOpen('s1'); ok(m.toasts[0] === 'Akses ditolak.' && m.sheets.length === 0, 'galat server: toast, tanpa sheet');
  m = boot({reply: () => new Error('x')}); await m.rcptOpen('s1'); ok(/periksa koneksi/.test(m.toasts[0]), 'galat jaringan: toast koneksi');
  m = boot({online: false}); await m.rcptOpen('s1'); ok(m.calls.length === 0 && /butuh koneksi/.test(m.toasts[0]), 'offline: tidak memanggil server');
  m = boot({reply: () => Object.assign(new Error('Sesi'), {auth: true})}); await m.rcptOpen('s1'); ok(m.ctx.__logout === true, 'sesi berakhir saat membuka nota: keluar');

  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.error('GAGAL: ' + (e && e.message)); process.exit(1); });
