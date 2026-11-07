// Uji layar Stok awal massal: item yang ditawarkan, muatan ke server (stock.adjust), kegagalan sebagian, validasi, sesi berakhir, dan isian yang tidak hilang.
const fs = require('fs'), path = require('path'), assert = require('assert');
const code = fs.readFileSync(path.join(__dirname, '..', 'src/app/1395-stok-awal.js'), 'utf8');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; };
(async () => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const dnum = s => { s = String(s == null ? '' : s).trim(); return s ? Number(s.replace(',', '.')) : NaN; };
  const dom = {main: {innerHTML: ''}, sa_save: {disabled: true, textContent: ''}}; const toasts = [], calls = [], listeners = {};
  global.document = {addEventListener: (n, f) => { listeners[n] = f; }, querySelector: () => null};
  const NAV = {onLine: true}; Object.defineProperty(global, 'navigator', {value: NAV, configurable: true, writable: true});
  const S = {tab: 'stokawal', data: {materials: [], variants: []}}; let caps = {materials: true}; let behave = () => ({});
  const ACT = {}, APP = {views: {}}, TAB_TITLE = {}, TAB_CAP = {};
  const api = async (name, body) => { calls.push([name, body]); const r = behave(body); if (r instanceof Error) throw r; return r; };
  const f = new Function('S', 'can', 'vName', 'vSub', 'esc', 'num', 'wrapChips', 'emptyState', '$', 'dnum', 'toast', 'busy', 'api', 'vById', 'LS', 'ACT', 'APP', 'TAB_TITLE', 'TAB_CAP', 'render',
    code + '\nreturn {SA, saItems, vStokAwal, saSave, saFilled};');
  const m = f(S, c => !!caps[c], v => v.nama, v => v.ukuran || '', esc, String, h => h, (ic, t, d) => '<empty>' + t + '</empty>', sel => dom[sel.slice(1)] || null, dnum, t => toasts.push(t), (msg, fn) => fn(), api,
    id => S.data.variants.find(v => v.id === id), {set: () => {}}, ACT, APP, TAB_TITLE, TAB_CAP, () => {});
  const reset = () => { S.data = {materials: [{id: 'm1', nama: 'Tepung', satuan: 'kg', stok: 0, hpp_rata2: 0}, {id: 'm2', nama: 'Minyak', satuan: 'liter', stok: 3, hpp_rata2: 20000}],
    variants: [{id: 'v1', nama: 'Basreng', ukuran: '100 g', stok: 0, hpp_rata2: 0}, {id: 'v2', nama: 'Usus', ukuran: '80 g', stok: 0, hpp_rata2: 4000}, {id: 'v3', nama: 'Pilus', ukuran: '50 g', stok: 7, hpp_rata2: 0}]};
    m.SA.v = {}; m.SA.f = {}; m.SA.t = 'varian'; calls.length = 0; toasts.length = 0; behave = b => ({id: b.id, stok: b.stok_baru, hpp_rata2: b.hpp === '' ? 0 : b.hpp}); };
  const type = (k, field, val) => listeners.input({target: {dataset: {sa: field, k: k}, value: val}});

  reset();
  ok(m.saItems('varian').map(x => x.id).join() === 'v1', 'produk jadi: hanya yang stok 0 DAN HPP 0 (habis terjual ber-HPP dan stok ber-HPP-0 tidak ditawarkan)');
  ok(m.saItems('bahan').map(x => x.id).join() === 'm1', 'bahan: hanya yang belum pernah diisi');
  m.vStokAwal(); ok(/Basreng/.test(dom.main.innerHTML) && !/Pilus|Usus/.test(dom.main.innerHTML), 'tab produk jadi hanya memuat Basreng');
  ok(/Produk jadi \(1\)/.test(dom.main.innerHTML) && /Bahan dan kemasan \(1\)/.test(dom.main.innerHTML), 'chip menampilkan jumlah item per tab');
  ok(/Stok \(pcs\)/.test(dom.main.innerHTML), 'produk jadi berlabel pcs');
  ok(dom.sa_save.disabled && /Isi jumlah stok dulu/.test(dom.sa_save.textContent), 'tombol simpan nonaktif sebelum ada isian');
  type('varian:v1', 's', '25'); ok(!dom.sa_save.disabled && dom.sa_save.textContent === 'Simpan 1 item', 'mengetik stok mengaktifkan tombol dan menghitung item');
  m.SA.t = 'bahan'; m.vStokAwal(); ok(/Tepung/.test(dom.main.innerHTML) && /Stok \(kg\)/.test(dom.main.innerHTML) && /HPP \/ kg/.test(dom.main.innerHTML), 'tab bahan memakai satuan bahan');
  type('bahan:m1', 's', '10,5'); type('bahan:m1', 'h', '12000'); ok(dom.sa_save.textContent === 'Simpan 2 item', 'isian lintas tab dihitung bersama');

  // simpan sukses
  await m.saSave();
  ok(calls.length === 2 && calls.every(c => c[0] === 'stock.adjust'), 'dua panggilan stock.adjust');
  const cv = calls.find(c => c[1].tipe === 'varian')[1], cb = calls.find(c => c[1].tipe === 'bahan')[1];
  ok(cv.id === 'v1' && cv.stok_baru === 25 && cv.hpp === '' && cv.alasan === 'Stok awal', 'muatan produk jadi: stok 25, HPP kosong (tidak ditebak), alasan "Stok awal"');
  ok(cb.id === 'm1' && cb.stok_baru === 10.5 && cb.hpp === 12000 && cb.alasan === 'Stok awal', 'muatan bahan: koma desimal terbaca, HPP terkirim');
  ok(S.data.variants[0].stok === 25 && S.data.materials[0].stok === 10.5 && S.data.materials[0].hpp_rata2 === 12000, 'data lokal diperbarui dari balasan server');
  ok(m.saItems('varian').length === 0 && m.saItems('bahan').length === 0, 'item yang tersimpan keluar dari daftar');
  ok(/1 belum punya HPP/.test(toasts[toasts.length - 1]), 'toast memberi tahu item tanpa HPP: ' + toasts[toasts.length - 1]);
  ok(/Semua item sudah punya stok awal/.test(dom.main.innerHTML), 'daftar kosong menampilkan keadaan selesai');

  // gagal sebagian: yang gagal tetap tampil dengan pesan dan isiannya
  reset(); S.data.variants.push({id: 'v4', nama: 'Keripik', ukuran: '', stok: 0, hpp_rata2: 0});
  behave = b => b.id === 'v4' ? new Error('Penyesuaian bernilai besar perlu persetujuan supervisor.') : ({id: b.id, stok: b.stok_baru, hpp_rata2: 0});
  m.SA.t = 'varian'; type('varian:v1', 's', '5'); type('varian:v4', 's', '9999'); type('varian:v4', 'h', '500');
  await m.saSave();
  ok(calls.length === 2 && /1 tersimpan, 1 gagal/.test(toasts[toasts.length - 1]), 'satu gagal tidak menghentikan yang lain: ' + toasts[toasts.length - 1]);
  ok(/Penyesuaian bernilai besar/.test(dom.main.innerHTML) && /Keripik/.test(dom.main.innerHTML) && !/Basreng/.test(dom.main.innerHTML), 'yang gagal tampil dengan pesan server; yang berhasil hilang');
  ok(/value="9999"/.test(dom.main.innerHTML) && /value="500"/.test(dom.main.innerHTML), 'isian yang gagal tidak hilang (bisa diperbaiki dan simpan ulang)');
  calls.length = 0; behave = b => ({id: b.id, stok: b.stok_baru, hpp_rata2: b.hpp}); type('varian:v4', 's', '90'); await m.saSave();
  ok(calls.length === 1 && calls[0][1].id === 'v4' && !/Penyesuaian bernilai besar/.test(dom.main.innerHTML), 'simpan ulang hanya mengirim yang tersisa; pesan lama hilang');

  // validasi: tidak ada yang terkirim bila ada isian salah
  reset(); S.data.variants.push({id: 'v5', nama: 'Cimol', ukuran: '', stok: 0, hpp_rata2: 0});
  type('varian:v1', 's', '5'); type('varian:v5', 's', 'abc'); await m.saSave();
  ok(calls.length === 0 && /Stok tidak valid/.test(dom.main.innerHTML), 'isian tidak valid: tidak ada panggilan sama sekali, pesan di baris yang salah');
  reset(); type('varian:v1', 's', '5'); type('varian:v1', 'h', '-1'); await m.saSave();
  ok(calls.length === 0 && /HPP tidak valid/.test(dom.main.innerHTML), 'HPP negatif ditolak sebelum dikirim');

  // sesi berakhir: berhenti
  reset(); S.data.variants.push({id: 'v6', nama: 'Cireng', ukuran: '', stok: 0, hpp_rata2: 0});
  behave = () => Object.assign(new Error('x'), {auth: true}); type('varian:v1', 's', '5'); type('varian:v6', 's', '5'); await m.saSave();
  ok(calls.length === 1 && /Sesi berakhir/.test(toasts[toasts.length - 1]), 'sesi berakhir menghentikan sisa panggilan');

  // luring dan kosong
  reset(); NAV.onLine = false; type('varian:v1', 's', '5'); await m.saSave(); ok(calls.length === 0 && /koneksi/.test(toasts[toasts.length - 1]), 'luring: tidak mengirim'); NAV.onLine = true;
  reset(); await m.saSave(); ok(calls.length === 0, 'tidak ada isian: tidak mengirim');

  // peran tanpa akses bahan hanya melihat produk jadi
  reset(); caps = {materials: false}; m.SA.t = 'bahan'; m.vStokAwal(); ok(!/Bahan dan kemasan/.test(dom.main.innerHTML) && /Basreng/.test(dom.main.innerHTML), 'tanpa akses bahan: tab bahan tidak ada'); caps = {materials: true};

  // keterpasangan
  ok(TAB_CAP.stokawal === 'stockedit' && TAB_TITLE.stokawal === 'Stok awal' && APP.views.stokawal === m.vStokAwal && typeof ACT.sa_save === 'function' && typeof ACT.go_sawal === 'function', 'tab, hak akses, judul, dan aksi terdaftar');
  // keterhubungan di berkas lain
  const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  ok(/data-act="go_sawal">Isi stok awal/.test(rd('src/app/09-stok-pembelian.js')) && /can\('stockedit'\) && can\('cost'\) \? saAll/.test(rd('src/app/09-stok-pembelian.js')), 'layar Stok punya pintasan, hanya untuk peran yang melihat HPP');
  ok(/t\[0\] === 'stok' && S\.tab === 'stokawal'/.test(rd('src/app/06-kerangka.js')), 'navigasi Stok tetap menyala di layar Stok awal');
  ok(/'stokawal', 'Isi jumlah dan HPP awal sekaligus/.test(rd('web/js/modules.js')) && /t === 'stokawal'\) S\.tab = t/.test(rd('web/js/modules.js')), 'Pemeriksaan data mengarah ke layar Stok awal');
  ok(/1395-stok-awal|vStokAwal/.test(rd('web/js/app.js')) && /\.sa-row \.row2/.test(rd('web/css/app.css')), 'app.js hasil build dan CSS memuat layar baru');
  console.log('Semua lulus (' + pass + ' pemeriksaan)');
})().catch(e => { console.error(e); process.exit(1); });
