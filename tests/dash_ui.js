// Uji tampilan Beranda v2.6.10: susunan (laba di atas), ringkas, label Habis/Menipis, rincian laba bersih, tanpa derau, aman dari HTML liar.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'web/js/modules.js'), 'utf8');
const a = src.indexOf('function delta('), b = src.indexOf('/* ---------- Biaya produksi');
const code = src.slice(a, b);
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; };
const dom = {dbody: {innerHTML: ''}, wbell: {innerHTML: ''}, chcard: {innerHTML: ''}, topcard: {innerHTML: ''}};
const rp = n => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID'), num = n => String(n), dec = n => String(n);
const f = new Function('S', 'A', '$', 'esc', 'rp', 'num', 'dec', 'pct', 'kv', 'idRange', 'idDate', 'hppCheck', 'qMark', 'ACT',
  code + '\nreturn {drawDash, heroHtml, dowOf, cleanNm, chg, dashTab, dashTop, jamHtml, chInner, topInner, jamRange};');
const S = {};   // dibagi pakai fungsi uji
const m = f(S, {can: () => true, addDays: (d, n) => d}, sel => dom[sel.slice(1)] || null, s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  rp, num, dec, x => (Math.round(x * 10) / 10).toString().replace('.', ',') + '%', (x, y, c) => '<div class="kv ' + (c || '') + '"><span>' + x + '</span><span>' + y + '</span></div>',
  (a, b) => a + ' – ' + b, d => 'tgl ' + d, () => Promise.resolve({n: 0, names: []}), '<q/>', {});
const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const base = () => ({period: 'minggu', from: '2026-10-30', to: '2026-11-05', pfrom: '2026-10-23', pto: '2026-10-29',
  cur: {omzet: 897000, trx: 40, laba: 178000}, prev: {omzet: 0, trx: 0, laba: 0},
  series: days.map((d, i) => ({d, omzet: [0, 300000, 120000, 90000, 250000, 110000, 27000][i], laba: [0, 40000, 8000, 6000, 30000, 12000, 2000][i]})),
  channels: [{nama: 'Offline', omzet: 897000}],
  top: [{nama: 'Pangsit Kuah Pedas 650 ml ~', qty: 45}, {nama: 'Usus Krispy 80 g Level 1', qty: 14}, {nama: 'Bareng Chili Oil 500 g ~', qty: 13}, {nama: 'Makaroni 100 g Level 1', qty: 6}, {nama: 'Pilus 80 g Level 1', qty: 5}],
  low: ['Pilus', 'Bumbu Asin', 'Cabe Kering Aida', 'Chili Oil', 'Daun Jeruk', 'Usus Krispy', 'Siomay Kering', 'Makaroni', 'Minyak Bawang', 'Minyak Goreng'].map(n => ({nama: n, stok: 0, satuan: 'gram'})),
  stok_minus: [], peringatan: [], biaya: 0, fee_channel: 0, kerugian: 0, laba_bersih: 178000});
const draw = d => { dom.dbody.innerHTML = ''; m.drawDash(d); return dom.dbody.innerHTML; };
ok(!/Produk terjual|dtab|dtop|Jam ramai/.test(draw(base())), 'data tanpa kunci tahap 2 (server/cache lama): tampilan tahap 1 tetap utuh, tanpa tab/kartu baru');

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
ok(/Transaksi/.test(h) && /Rata-rata \/ transaksi/.test(h) && /Rp22\.425/.test(h), 'Transaksi dan rata-rata per transaksi tetap ada');
ok(!/ vs 7 hari sebelumnya/.test(h), 'tanpa data pembanding tidak ada teks pembanding');

// ---- ada pembanding ----
let d = base(); d.prev = {omzet: 600000, trx: 30, laba: 100000};
h = draw(d);
ok(/▲/.test(h) && /vs 7 hari sebelumnya/.test(h), 'dengan pembanding: panah dan teks pembanding tampil');
ok((h.match(/class="chg( [^"]*)?"/g) || []).length === 2, 'Transaksi dan rata-rata per transaksi punya panah perubahan sendiri (omzet pakai delta di hero)');
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

// ================= Tahap 2 (v2.6.11): pcs, diskon/retur, per pembayaran, jam ramai, urutan terlaris, total bahan =================
const t2 = () => { const d = base();
  d.cur = {omzet: 897000, trx: 40, laba: 178000, pcs: 92, diskon: 12000, retur_n: 2, retur_rp: 30000}; d.prev = {omzet: 600000, trx: 30, laba: 100000, pcs: 70};
  d.metode = [{metode: 'tunai', trx: 25, rp: 600000}, {metode: 'qris', trx: 12, rp: 250000}, {metode: 'transfer', trx: 3, rp: 47000}];
  d.jam = [{jam: 9, trx: 2, omzet: 40000}, {jam: 12, trx: 11, omzet: 260000}, {jam: 13, trx: 9, omzet: 210000}, {jam: 18, trx: 9, omzet: 230000}, {jam: 23, trx: 1, omzet: 9000}];
  d.top_om = [{nama: 'Bareng Chili Oil 500 g ~', qty: 13, om: 520000, laba: 150000}, {nama: 'Pangsit Kuah Pedas 650 ml ~', qty: 45, om: 450000, laba: 20000}];
  d.top_laba = [{nama: 'Makaroni 100 g Level 1', qty: 6, om: 90000, laba: 70000}, {nama: 'Pilus 80 g Level 1', qty: 5, om: 60000, laba: 40000}];
  d.low_habis = 14; d.low_tipis = 1; return d; };
h = draw(t2());
ok(/class="kgrid k3"/.test(h) && /Produk terjual/.test(h) && />92 pcs</.test(h), 'KPI Produk terjual (pcs) tampil dalam 3 kolom');
ok(/▲/.test(h.slice(h.indexOf('Produk terjual'), h.indexOf('Rata-rata'))) , 'pcs punya panah perubahan terhadap periode sebelumnya');
ok(/Diskon Rp12\.000 · Retur 2 trx \(Rp30\.000, sudah mengurangi omzet\)/.test(h.replace(/\u00a0/g, ' ')), 'catatan diskon dan retur');
d = t2(); d.cur.diskon = 0; d.cur.retur_n = 0; h = draw(d); ok(!/Diskon|Retur/.test(h.slice(h.indexOf('kgrid'), h.indexOf('dgrid'))), 'tanpa diskon/retur: catatan tidak muncul');
S.dtab = undefined; S.dtopm = undefined; h = draw(t2());
ok(/id="chcard"/.test(h) && />Channel<\/button>/.test(h) && />Pembayaran<\/button>/.test(h) && /chip sm on" data-act="dtab" data-t="ch"/.test(h), 'kartu channel/pembayaran: tab Channel aktif secara bawaan');
m.dashTab('pay'); let c1 = dom.chcard.innerHTML.replace(/\u00a0/g, ' ');
ok(S.dtab === 'pay' && /Tunai · 25 trx/.test(c1) && /QRIS · 12 trx/.test(c1) && /Transfer · 3 trx/.test(c1) && /Rp600\.000 · 66,9%/.test(c1) && /class="stack"/.test(c1), 'tab Pembayaran: nama metode, jumlah trx, rupiah, persen, batang komposisi: ' + c1.slice(0, 160));
ok(/sudah dikurangi retur/.test(c1) && /chip sm on" data-act="dtab" data-t="pay"/.test(c1), 'keterangan neto retur + tab Pembayaran aktif');
h = draw(t2()); ok(/Tunai · 25 trx/.test(h.replace(/\u00a0/g, ' ')), 'pilihan tab bertahan saat Beranda digambar ulang');
m.dashTab('ch'); c1 = dom.chcard.innerHTML; ok(/Offline/.test(c1) && !/Tunai/.test(c1) && S.dtab === 'ch', 'kembali ke tab Channel');
m.dashTab('ngawur'); ok(S.dtab === 'ch', 'nilai tab tidak dikenal => channel');
d = t2(); d.metode = [{metode: 'tunai', trx: 3, rp: 90000}]; draw(d); m.dashTab('pay'); ok(!/class="stack"/.test(dom.chcard.innerHTML), 'satu metode: tanpa batang komposisi');
d = t2(); d.metode = [{metode: 'tunai', trx: 3, rp: 90000}, {metode: 'qris', trx: 0, rp: -20000}]; draw(d); m.dashTab('pay'); ok(!/width:-/.test(dom.chcard.innerHTML) && /QRIS/.test(dom.chcard.innerHTML), 'metode bernilai negatif (hanya retur) tidak merusak lebar batang');
d = t2(); d.metode = [{metode: '<b>x</b>', trx: 1, rp: 1000}]; draw(d); m.dashTab('pay'); ok(!/<b>x<\/b>/.test(dom.chcard.innerHTML), 'nama metode tak dikenal di-escape');
d = t2(); d.metode = []; draw(d); m.dashTab('pay'); ok(/Belum ada pembayaran/.test(dom.chcard.innerHTML), 'tanpa pembayaran: pesan kosong');
S.dtab = 'ch';

// ---- produk terlaris: jumlah / omzet / laba ----
draw(t2()); h = dom.dbody.innerHTML;
ok(/data-act="dtop" data-t="qty"/.test(h) && /data-act="dtop" data-t="om"/.test(h) && /data-act="dtop" data-t="laba"/.test(h), 'tab Jumlah/Omzet/Laba tersedia');
m.dashTop('om'); c1 = dom.topcard.innerHTML.replace(/\u00a0/g, ' ');
ok(S.dtopm === 'om' && c1.indexOf('Bareng Chili Oil 500 g<') < c1.indexOf('Pangsit Kuah Pedas 650 ml<') && /Rp520\.000/.test(c1) && !/ pcs</.test(c1) && !/ ~</.test(c1), 'urut menurut omzet, tampil rupiah, tanpa "~": ' + c1.slice(0, 200));
m.dashTop('laba'); c1 = dom.topcard.innerHTML.replace(/\u00a0/g, ' ');
ok(/Makaroni 100 g Level 1/.test(c1) && /Rp70\.000/.test(c1), 'urut menurut laba');
ok(!/HPP belum lengkap/.test(c1), 'tanpa peringatan HPP: tidak ada catatan');
d = t2(); d.peringatan = [{aksi: 'hpp', teks: 'x'}]; draw(d); m.dashTop('laba'); ok(/HPP belum lengkap: laba produk bisa lebih tinggi/.test(dom.topcard.innerHTML), 'ada peringatan HPP: laba produk diberi catatan');
m.dashTop('qty'); ok(/ pcs</.test(dom.topcard.innerHTML) && S.dtopm === 'qty', 'kembali ke jumlah');
m.dashTop('ngawur'); ok(S.dtopm === 'qty', 'nilai tak dikenal => jumlah');
d = t2(); delete d.top_om; delete d.top_laba; draw(d); ok(!/data-act="dtop"/.test(dom.dbody.innerHTML), 'server tanpa top_om/top_laba: tanpa tab, tetap tampil jumlah');
S.dtopm = 'laba'; d = t2(); delete d.top_laba; m.dashTop('laba'); draw(d); ok(/ pcs</.test(dom.dbody.innerHTML), 'mode tersimpan tapi data tidak ada => jatuh ke jumlah');
S.dtopm = 'qty';

// ---- jam ramai ----
h = draw(t2()); const jh = h.slice(h.indexOf('Jam ramai'), h.indexOf('Stok bahan perlu'));
ok(/12\.00–13\.00<\/span><span>11 trx/.test(jh), 'jam terramai: 12.00–13.00, 11 trx');
ok(jh.indexOf('12.00–13.00') < jh.indexOf('18.00–19.00') && jh.indexOf('18.00–19.00') < jh.indexOf('13.00–14.00'), 'urut menurut transaksi; seri (9 trx) diurut menurut omzet: 18.00 (Rp230.000) sebelum 13.00 (Rp210.000): ' + jh.replace(/<[^>]+>/g, ' ').slice(0, 140));
ok((jh.match(/class="bar"/g) || []).length === 3 && !/09\.00|23\.00/.test(jh), 'hanya 3 jam teratas');
ok(m.jamRange(23) === '23.00–00.00' && m.jamRange(0) === '00.00–01.00', 'rentang jam melewati tengah malam');
ok(/transaksi lama yang diinput belakangan tidak dihitung/.test(jh), 'keterangan sumber data jam');
d = t2(); d.jam = []; h = draw(d); ok(!/Jam ramai/.test(h), 'tanpa data jam: kartu tidak ditampilkan');

// ---- stok bahan memakai total sebenarnya ----
d = t2(); d.low = d.low.map((l, i) => i < 9 ? l : {nama: l.nama, stok: 40, satuan: 'gram'}); h = draw(d);
ok(/14 habis/.test(h) && /1 menipis/.test(h), 'ringkasan memakai jumlah sebenarnya dari server (14 habis, 1 menipis)');
ok(/Menampilkan 10 dari 15 bahan/.test(h) && !/Daftar dibatasi/.test(h), 'catatan "Menampilkan 10 dari 15"');
d = t2(); d.low = d.low.slice(0, 2); d.low_habis = 2; d.low_tipis = 0; h = draw(d); ok(!/Menampilkan/.test(h) && /2 habis/.test(h), 'semua tampil: tanpa catatan "Menampilkan"');

// ---- laba produk negatif (HPP > harga jual) tidak merusak batang ----
d = t2(); d.top_laba = [{nama: 'Produk A', qty: 5, om: 50000, laba: 20000}, {nama: 'Produk Rugi', qty: 9, om: 40000, laba: -15000}]; draw(d); m.dashTop('laba');
ok(!/width:-/.test(dom.topcard.innerHTML) && /Produk Rugi/.test(dom.topcard.innerHTML) && /-Rp15\.000|Rp-15\.000|−Rp15\.000/.test(dom.topcard.innerHTML.replace(/\u00a0/g, ' ')), 'laba negatif tampil apa adanya dan lebar batang tidak negatif: ' + dom.topcard.innerHTML.slice(-260));
m.dashTop('qty');

// ---- kunci cache Beranda memuat versi bentuk data (cache lama tanpa kunci tahap 2 diambil ulang) ----
ok(/const k = A\.dverKey\(\) \+ '\|' \+ A\.today\(\) \+ '\|v2'/.test(src), 'kunci cache Beranda memuat penanda bentuk data |v2');
ok(/dtab: el => dashTab\(el\.dataset\.t\), dtop: el => dashTop\(el\.dataset\.t\)/.test(src), 'aksi dtab dan dtop terdaftar pada ACT');

// ---- Bulan ini: grafik hanya tanggal bulan berjalan (server mengirim minimal 7 hari, termasuk akhir bulan lalu) ----
d = base(); d.period = 'bulan'; d.from = '2026-11-01'; d.to = '2026-11-06';
d.series = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((x, i) => ({d: x, omzet: 1000 * (i + 1), laba: 100 * i}));
h = draw(d); const ch = h.slice(h.indexOf('class="hbars'), h.indexOf('Per channel') > 0 ? h.indexOf('Per channel') : h.length), hl = h.slice(h.indexOf('class="hlab"'), h.indexOf('class="hlab"') + 400);
ok((ch.match(/data-act="bar"/g) || []).length === 6, 'Bulan ini (6 Nov): 6 batang (1-6 Nov), bukan 7: ' + (ch.match(/data-act="bar"/g) || []).length);
ok(/<span>Min<br>01<\/span>/.test(hl) && /<span>Jum<br>06<\/span>/.test(hl) && !/<br>31</.test(hl), 'label dimulai 01 dan berakhir 06, tanpa 31 bulan lalu');
ok(S.dser.length === 6 && S.dser[0].d === '2026-11-01', 'S.dser (dipakai ketukan batang) memakai deret yang sama dengan grafik');
d = base(); d.period = 'bulan'; d.from = '2026-11-01'; d.to = '2026-11-01'; d.series = [{d: '2026-10-26', omzet: 1, laba: 0}, {d: '2026-10-27', omzet: 1, laba: 0}, {d: '2026-10-28', omzet: 1, laba: 0}, {d: '2026-10-29', omzet: 1, laba: 0}, {d: '2026-10-30', omzet: 1, laba: 0}, {d: '2026-10-31', omzet: 1, laba: 0}, {d: '2026-11-01', omzet: 5, laba: 1}];
h = draw(d); ok(!/hbars/.test(h), 'tanggal 1: hanya 1 hari berjalan => grafik satu batang tidak ditampilkan');
const orig = base(); orig.period = 'minggu'; draw(orig); ok(S.dser.length === 7, 'periode 7 hari tidak berubah: 7 batang');
const hr = base(); hr.period = 'hari'; hr.from = '2026-11-05'; hr.to = '2026-11-05'; draw(hr); ok(S.dser.length === 7, 'Hari ini tetap memakai 7 hari sebagai konteks');

// aksesibilitas grafik Beranda: batang = tombol yang bisa difokus, berlabel nilai, satu perhentian Tab, ringkasan tersembunyi
{ const h = m.heroHtml(base(), 'minggu'), bars = h.match(/<div role="button"[^>]*data-act="bar"[^>]*>/g) || [];
  ok(bars.length === 7, 'tiap batang berperan tombol (7)');
  ok(bars.every(b => /aria-label="tgl [\d-]+: omzet Rp[^"]*laba kotor Rp/.test(b)), 'tiap batang punya label tanggal, omzet, dan laba kotor');
  ok(bars.filter(b => /tabindex="0"/.test(b)).length === 1 && bars.filter(b => /tabindex="-1"/.test(b)).length === 6, 'roving tabindex: hanya satu batang di urutan Tab');
  ok(/class="hbars bchart" role="group"[^>]*aria-describedby="bsum"/.test(h) && !/role="img"/.test(h), 'pembungkus role=group (bukan img yang menyembunyikan anak) + deskripsi');
  ok(/<p class="sr" id="bsum">Grafik omzet 7 hari\. Tertinggi tgl 2026-10-31 Rp300\.000, terendah tgl 2026-10-30 Rp0/.test(h), 'ringkasan tersembunyi: tertinggi dan terendah benar');
  ok(/class="hlab" aria-hidden="true"/.test(h), 'baris tanggal visual disembunyikan dari pembaca layar (label sudah ada per batang)'); }

console.log('Semua lulus (' + pass + ' pemeriksaan)');

