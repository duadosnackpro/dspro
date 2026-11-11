// Tes daftar nota "perlu ditinjau" (Beranda -> Lihat transaksi, migrasi 0043). Mengambil handler revlist langsung dari web/js/modules.js.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'web/js/modules.js'), 'utf8'), adp = fs.readFileSync(path.join(__dirname, '..', 'web/js/sb-adapter.js'), 'utf8');
let n = 0; const ok = (c, m) => { n++; assert(c, m); };
const a = src.indexOf('  revlist: async () =>'), b = src.indexOf('  /* F-08: perbaiki HPP kosong'); ok(a > 0 && b > a, 'handler revlist ada di modules.js');
const code = src.slice(a, b).replace(/^ {2}revlist: /, 'const H = ').replace(/,\s*$/, ';');
const mk = (opts) => {
  const S = {tab: 'dash'}, out = {html: '', toasts: [], calls: [], rendered: 0};
  const A = {can: () => opts.approve, chName: id => 'Offline', render: () => { out.rendered++; }};
  const f = new Function('S', 'A', 'api', 'esc', 'rp', 'idDate', 'sheet', 'toast', 'navigator', code + '\nreturn H;');
  const H = f(S, A, async (op, body) => { out.calls.push(op); if (opts.fail) throw opts.fail; return opts.reply; }, s => String(s).replace(/</g, '&lt;'), x => 'Rp ' + x, d => String(d).slice(0, 10), h => { out.html = h; }, t => out.toasts.push(t), {onLine: opts.offline === false ? false : true});
  return {H, S, out};
};
const row = (id, no, tgl, extra) => Object.assign({id, nomor: no, tanggal: tgl, channel_id: 'c1', metode_bayar: 'tunai', total: 22000, status: 'selesai', review_note: 'Harga disesuaikan server.'}, extra || {});

// 1) Owner: daftar lintas tanggal, tiap baris punya Lihat nota + Tandai ditinjau, ada tanggal dan catatan
let m = mk({approve: true, reply: {rows: [row('s9', 'OUT-001-261108-004', '2026-11-08 14:05:00')], total: 1}});
(async () => {
  await m.H();
  ok(m.out.calls.length === 1 && m.out.calls[0] === 'sales.review_list', 'memanggil sales.review_list');
  ok(/Perlu ditinjau \(1\)/.test(m.out.html) && /OUT-001-261108-004/.test(m.out.html) && /2026-11-08/.test(m.out.html) && /14:05/.test(m.out.html), 'menampilkan nomor, tanggal, dan jam nota');
  ok(/Harga disesuaikan server/.test(m.out.html), 'menampilkan alasan server');
  ok(/data-act="rcpt" data-id="s9"/.test(m.out.html) && /data-act="sreview" data-id="s9"/.test(m.out.html), 'tombol Lihat nota dan Tandai ditinjau memakai handler yang ada');
  // 2) Auditor: bisa melihat, tidak bisa menandai, dan diberi tahu kenapa
  m = mk({approve: false, reply: {rows: [row('s9', 'OUT-001-261108-004', '2026-11-08 14:05:00')], total: 1}}); await m.H();
  ok(/data-act="rcpt"/.test(m.out.html) && !/data-act="sreview"/.test(m.out.html), 'tanpa hak approve: tidak ada tombol Tandai');
  ok(/Hanya Owner, Admin, atau Supervisor/.test(m.out.html), 'tanpa hak approve: ada penjelasan');
  // 3) Lebih dari 50: sisa disebut
  m = mk({approve: true, reply: {rows: [row('s1', 'A-1', '2026-11-01 10:00:00')], total: 53}}); await m.H();
  ok(/Perlu ditinjau \(53\)/.test(m.out.html) && /Dan 52 nota lain/.test(m.out.html), 'jumlah total dan sisa yang tidak tampil');
  // 4) Kosong
  m = mk({approve: true, reply: {rows: [], total: 0}}); await m.H(); ok(/Tidak ada nota yang perlu ditinjau/.test(m.out.html), 'daftar kosong punya pesan');
  // 5) Server lama (belum 0043): turun ke Riwayat, tidak macet
  m = mk({approve: true, fail: Object.assign(new Error('Could not find the function public.rpc_sales_review_list'), {})}); await m.H();
  ok(m.S.tab === 'riwayat' && m.out.rendered === 1 && m.out.toasts.length === 1 && /0043/.test(m.out.toasts[0]), 'skema lama: pindah ke Riwayat dengan petunjuk');
  // 6) Offline: tidak memanggil server
  m = mk({approve: true, offline: false, reply: {rows: [], total: 0}}); await m.H(); ok(m.out.calls.length === 0 && m.out.toasts.length === 1, 'offline: tanpa permintaan, ada pesan');
  // 7) Peringatan Beranda memakai aksi baru, bukan sekadar pindah tab
  ok(/judul: num\(d\.review_trx\)[^;]*tombol: 'Lihat transaksi', act: 'revlist'/.test(src), 'peringatan review_trx -> tombol Lihat transaksi (act revlist)');
  ok(/bukan antrean di perangkat/.test(src), 'teks peringatan menjelaskan ini bukan antrean');
  // 8) Adapter dan migrasi
  ok(/case 'sales\.review_list': return rpc\('sales_review_list', withOutlet\(p\), token\)/.test(adp), "adapter: 'sales.review_list' -> rpc sales_review_list dengan outlet aktif");
  ok(fs.existsSync(path.join(__dirname, '../supabase/migrations/20261111000043_review_list.sql')), 'migrasi 0043 ada');
  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.error('GAGAL:', e.message); process.exit(1); });
