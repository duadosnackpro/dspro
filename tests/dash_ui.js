// Uji tampilan Beranda v2.6.10: susunan (laba di atas), ringkas, label Habis/Menipis, rincian laba bersih, tanpa derau, aman dari HTML liar.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'web/js/modules.js'), 'utf8');
const a = src.indexOf('function delta('), b = src.indexOf('/* ---------- Biaya produksi');
const code = src.slice(a, b);
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; };
const dom = {dbody: {innerHTML: ''}, wbell: {innerHTML: ''}};
const rp = n => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID'), num = n => String(n), dec = n => String(n);
const f = new Function('S', 'A', '$', 'esc', 'rp', 'num', 'dec', 'pct', 'kv', 'idRange', 'hppCheck', 'qMark', 'ACT',
  code + '\nreturn {drawDash, heroHtml, dowOf, cleanNm, chg};');
const S = {};
const m = f(S, {can: () => true, addDays: (d, n) => d}, sel => dom[sel.slice(1)] || null, s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  rp, num, dec, x => (Math.round(x * 10) / 10).toString().replace('.', ',') + '%', (x, y, c) => '<div class="kv ' + (c || '') + '"><span>' + x + '</span><span>' + y + '</span></div>',
  (a, b) => a + ' – ' + b, () => Promise.resolve({n: 0, names: []}), '<q/>', {});
const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const base = () => ({period: 'minggu', from: '2026-10-30', to: '2026-11-05', pfrom: '2026-10-23', pto: '2026-10-29',
  cur: {omzet: 897000, trx: 40, laba: 178000}, prev: {omzet: 0, trx: 0, laba: 0},
  series: days.map((d, i) => ({d, omzet: [0, 300000, 120000, 90000, 250000, 110000, 27000][i], laba: [0, 40000, 8000, 6000, 30000, 12000, 2000][i]})),
  channels: [{nama: 'Offline', omzet: 897000}],
  top: [{nama: 'Pangsit Kuah Pedas 650 ml ~', qty: 45}, {nama: 'Usus Krispy 80 g Level 1', qty: 14}, {nama: 'Bareng Chili Oil 500 g ~', qty: 13}, {nama: 'Makaroni 100 g Level 1', qty: 6}, {nama: 'Pilus 80 g Level 1', qty: 5}],
  low: ['Pilus', 'Bumbu Asin', 'Cabe Kering Aida', 'Chili Oil', 'Daun Jeruk', 'Usus Krispy', 'Siomay Kering', 'Makaroni', 'Minyak Bawang', 'Minyak Goreng'].map(n => ({nama: n, stok: 0, satuan: 'gram'})),
  stok_minus: [], peringatan: [], biaya: 0, fee_channel: 0, kerugian: 0, laba_bersih: 178000});
const draw = d => { dom.dbody.innerHTML = ''; m.drawDash(d); return dom.dbody.innerHTML; };

// ---- data seperti tangkapan layar pengguna ----
let h = draw(base());
ok(h.indexOf('Laba kotor') > 0 && h.indexOf('Laba bersih') > 0 && h.indexOf('Laba kotor') < h.indexOf('hbars'), 'laba kotor/bersih berada DI ATAS grafik');
ok(h.indexOf('big') < h.indexOf('Laba kotor'), 'urutan: omzet, lalu laba');
ok(!/belum ada data\)/.test(h), 'baris pembanding kosong "(belum ada data)" dihapus');
ok(!/Ketuk batang untuk nilai harian/.test(h) && /id="bt"[^>]*><\/div>/.test(h), 'kotak petunjuk permanen dihapus (kotak nilai kosong sampai batang diketuk)');
ok(/<span>Jum<br>30<\/span>/.test(h) && /<span>Kam<br>05<\/span>/.test(h), 'label grafik memakai nama hari (30 Okt 2026 = Jum, 5 Nov = Kam)');
ok(m.dowOf('2026-11-02') === 'Sen', 'dowOf benar');
ok(/Belum ada fee, biaya, atau kerugian stok, jadi laba bersih sama dengan laba kotor/.test(h), 'fee/biaya/kerugian nol => penjelasan, bukan "setelah fee, biaya" yang menyesatkan');
ok(/id="mgn"/.test(h) && />19,8%</.test(h), 'margin tampil dan #mgn tersedia untuk peringatan HPP: ' + (h.match(/id="mgn">[^<]*/) || [''])[0]);
ok(!/class="stack"/.test(h) && /Offline<\/span><span>Rp897.000 · 100%/.test(h.replace(/\u00a0/g, ' ')), 'satu channel = satu baris dengan rupiah, tanpa batang komposisi');
ok(!/Pangsit Kuah Pedas 650 ml ~/.test(h) && /Pangsit Kuah Pedas 650 ml</.test(h) && !/Chili Oil 500 g ~/.test(h), '"~" di ujung nama produk tidak ditampilkan');
ok((h.match(/class="bar"/g) || []).length === 5 && /Lihat 2 lainnya/.test(h), 'produk terlaris: 3 tampil + 2 dilipat');
ok(/10 habis/.test(h) && !/menipis<\/span>/.test(h) && /class="bdg out">Habis<\/span>/.test(h) && !/>Menipis</.test(h), 'stok 0 berlabel Habis (merah), bukan Menipis, dengan ringkasan "10 habis"');
const stokPart = h.slice(h.indexOf('Stok bahan perlu perhatian'));
ok(/Lihat 7 lainnya/.test(stokPart) && stokPart.indexOf('Lihat 7 lainnya') > stokPart.indexOf('Cabe Kering Aida') && stokPart.indexOf('Chili Oil<') > stokPart.indexOf('Lihat 7 lainnya'), 'stok bahan: 3 teratas tampil, 7 sisanya dilipat');
ok(/Daftar dibatasi 10 bahan teratas/.test(h), 'catatan batas 10 muncul saat daftar penuh');
ok(/data-act="tab" data-t="stok"/.test(h), 'tombol Buka Stok');
ok(!/Biaya operasional/.test(h), 'biaya operasional tidak lagi di kartu perhatian');
ok(/Transaksi/.test(h) && /Rata-rata per transaksi/.test(h) && /Rp22\.425/.test(h), 'Transaksi dan rata-rata per transaksi tetap ada');
ok(!/ vs 7 hari sebelumnya/.test(h), 'tanpa data pembanding tidak ada teks pembanding');

// ---- ada pembanding ----
let d = base(); d.prev = {omzet: 600000, trx: 30, laba: 100000};
h = draw(d);
ok(/▲/.test(h) && /vs 7 hari sebelumnya/.test(h), 'dengan pembanding: panah dan teks pembanding tampil');
ok((h.match(/class="chg"/g) || []).length === 2, 'Transaksi dan rata-rata per transaksi punya panah perubahan sendiri (omzet pakai delta di hero)');
d.prev = {omzet: 2000000, trx: 80, laba: 0}; h = draw(d); ok(/▼/.test(h), 'turun => panah turun');

// ---- rincian laba bersih ----
d = base(); d.fee_channel = 20000; d.biaya = 50000; d.kerugian = 8000; d.laba_bersih = 100000; h = draw(d);
ok(/− fee channel Rp20\.000/.test(h) && /− biaya Rp50\.000/.test(h) && /− kerugian stok Rp8\.000/.test(h) && /= laba bersih Rp100\.000/.test(h), 'rincian laba bersih menyebut tiap komponen yang ada nilainya');
d = base(); d.biaya = 50000; d.laba_bersih = 128000; h = draw(d); ok(/− biaya Rp50\.000/.test(h) && !/− fee channel/.test(h) && !/− kerugian/.test(h), 'komponen bernilai 0 tidak disebut');

// ---- hari ini: tanpa grafik satu batang ----
d = base(); d.period = 'hari'; d.series = [days.map(x => 0).length ? {d: '2026-11-05', omzet: 27000, laba: 2000} : null]; h = draw(d);
ok(!/hbars/.test(h) && !/id="bt"/.test(h), 'Hari ini: grafik satu batang tidak ditampilkan');

// ---- bulan: label tanggal tiap 5 hari, tanpa nama hari ----
d = base(); d.period = 'bulan'; d.series = Array.from({length: 30}, (_, i) => ({d: '2026-10-' + String(i + 1).padStart(2, '0'), omzet: 1000 * i, laba: 100 * i})); h = draw(d);
ok(!/<br>/.test(h.slice(h.indexOf('hlab'))), 'bulan: label hanya tanggal');

// ---- campuran habis + menipis, dan beberapa channel ----
d = base(); d.low = [{nama: 'Cabe', stok: 150, satuan: 'gram'}, {nama: 'Garam', stok: 0, satuan: 'gram'}, {nama: 'Gula', stok: 20, satuan: 'gram'}]; d.channels = [{nama: 'Offline', omzet: 600000}, {nama: 'GoFood', omzet: 297000}]; h = draw(d);
ok(/1 habis/.test(h) && /2 menipis/.test(h), 'ringkasan campuran: 1 habis, 2 menipis');
ok(h.indexOf('Garam') < h.indexOf('Cabe'), 'yang Habis didahulukan');
ok(/Menipis<\/span> 150 gram/.test(h) && !/Daftar dibatasi/.test(h) && !/Lihat \d+ lainnya<\/summary>[^]*Cabe/.test(h.slice(h.indexOf('Stok bahan'))), 'menipis menampilkan sisa stok; <10 item tidak diberi catatan batas dan tidak dilipat');
ok(/class="stack"/.test(h) && /Rp600\.000 · 66,9%/.test(h.replace(/\u00a0/g, ' ')), 'beberapa channel: batang komposisi + rupiah + persen');

// ---- kosong dan aman ----
d = base(); d.top = []; d.low = []; d.channels = []; d.cur = {omzet: 0, trx: 0, laba: 0}; d.laba_bersih = 0; d.series = days.map(x => ({d: x, omzet: 0, laba: 0})); h = draw(d);
ok(/Belum ada data/.test(h) && /Semua stok bahan aman/.test(h) && /Belum ada penjualan/.test(h), 'keadaan kosong tertangani');
ok(!/Buka Stok/.test(h), 'tidak ada tombol Buka Stok bila stok aman');
d = base(); d.top[0].nama = '<img src=x onerror=alert(1)>'; d.low[0].nama = '<b>x</b>'; d.channels[0].nama = '<i>y</i>'; h = draw(d);
ok(!/<img src=x/.test(h) && !/<b>x<\/b>/.test(h) && !/<i>y<\/i>/.test(h), 'nama produk/bahan/channel di-escape');

console.log('Semua lulus (' + pass + ' pemeriksaan)');
