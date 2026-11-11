// Tes peringatan Beranda yang efektif (v2.7.3): tiap peringatan membuka tempat yang benar, menyebut item, jujur soal hak akses, dan yang tak bisa selesai bisa diabaikan.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'web/js/modules.js'), 'utf8');
let n = 0; const ok = (c, m) => { n++; assert(c, m); };
const cut = (a, b) => { const i = src.indexOf(a); ok(i >= 0, 'ada: ' + a.trim().slice(0, 30)); const j = src.indexOf(b, i); ok(j > i, 'penutup: ' + b.trim().slice(0, 30)); return src.slice(i, j); };

// ---- dashWarnings ----
const dwCode = cut('function dashWarnings', 'function drawDash');
const mkDw = (caps, data) => new Function('S', 'A', 'num', 'dec', 'vLabel2', dwCode + '\nreturn dashWarnings;')({data}, {can: c => caps.indexOf(c) >= 0}, String, String, v => v.n);
const full = ['manage', 'stockedit', 'materials'], aud = [];
const data = {materials: [{nama: 'Minyak'}], variants: [{n: 'Basreng 100g', stok: 5, hpp_rata2: 0}, {n: 'Chili Oil', stok: 3, hpp_rata2: 0}, {n: 'Keripik', stok: 0, hpp_rata2: 0}, {n: 'Usus', stok: 9, hpp_rata2: 4000}]};
let w = mkDw(full, data)({stok_minus: [{nama: 'Minyak', stok: -2}]});
ok(w[0].act === 'stokgo' && w[0].t === 'bahan', 'stok minus pada bahan -> tab Stok Bahan');
ok(/isi stok fisik/.test(w[0].teks), 'stok minus: petunjuk cara menyelesaikan untuk yang berhak');
w = mkDw(full, data)({stok_minus: [{nama: 'Basreng 100g', stok: -1}]}); ok(w[0].t === 'varian', 'stok minus pada produk jadi -> tab Produk jadi');
w = mkDw(aud, data)({stok_minus: [{nama: 'Minyak', stok: -2}]}); ok(w[0].t === 'varian' && /hanya bisa melihat/.test(w[0].teks), 'tanpa hak materials/stockedit: tab Produk jadi + penjelasan peran');
w = mkDw(full, data)({peringatan: [{aksi: 'stok', teks: '2 varian yang ada stoknya belum punya HPP.'}]});
ok(/Basreng 100g, Chili Oil/.test(w[0].teks) && !/Keripik|Usus/.test(w[0].teks) && w[0].act === 'stokgo', 'peringatan stok: menyebut varian bersetok tanpa HPP');
w = mkDw(aud, data)({peringatan: [{aksi: 'hpp', teks: '45 baris belum punya HPP.'}]}); ok(w[0].tombol === '' && /hanya bisa dilakukan Owner atau Admin/.test(w[0].teks), 'HPP tanpa hak: tanpa tombol tetapi ada penjelasan');
w = mkDw(full, data)({peringatan: [{aksi: 'hpp', teks: 'x'}]}); ok(w[0].tombol === 'Perbaiki HPP' && /dampaknya dulu/.test(w[0].teks), 'HPP dengan hak: tombol + penjelasan alur');

// ---- stokgo dan dwskip ----
const hCode = 'const H = {' + cut('  stokgo: el =>', '  /* v2.7.3: daftar nota') + '};';
const mkH = (caps, uid) => { const mem = {}, o = {renders: 0, toasts: [], closed: 0, dwarn: 0, bell: 0}, S = {tab: 'dash', stab: 'varian', scat: 'Kategori', sq: 'cari', data: {user: {uid: uid || 'u1'}}};
  const ACT = {dwarn: () => { o.dwarn++; }}, LS = {get: (k, d) => mem[k] == null ? d : mem[k], set: (k, v) => { mem[k] = v; }};
  const H = new Function('S', 'A', 'ACT', 'LS', 'drawBell', 'closeSheet', 'toast', hCode + '\nreturn H;')(S, {can: c => caps.indexOf(c) >= 0, render: () => { o.renders++; }}, ACT, LS, () => { o.bell++; }, () => { o.closed++; }, t => o.toasts.push(t));
  return {H, S, o, mem}; };
let m = mkH(full); m.H.stokgo({dataset: {t: 'bahan'}}); ok(m.S.tab === 'stok' && m.S.stab === 'bahan' && m.S.sq === '' && m.S.scat === 'Semua' && m.o.renders === 1, 'stokgo bahan: tab Stok, Bahan, pencarian dan kategori dibersihkan');
m = mkH(aud); m.H.stokgo({dataset: {t: 'bahan'}}); ok(m.S.stab === 'varian', 'stokgo: tanpa hak materials tidak membuka tab Bahan');
m = mkH(full); m.S.dwarn = [{judul: 'a'}, {judul: 'b', abaikan: 'SIG-B'}]; m.H.dwskip({dataset: {i: '1'}});
ok(m.mem.dwskip.length === 1 && m.mem.dwskip[0] === 'SIG-B' && m.S.dwarn.length === 1 && m.o.bell === 1 && m.o.dwarn === 1 && m.o.closed === 0 && m.o.toasts.length === 1, 'dwskip: simpan tanda tangan, buang dari daftar, gambar ulang lembar');
m.H.dwskip({dataset: {i: '0'}}); ok(m.S.dwarn.length === 1 && m.mem.dwskip.length === 1, 'dwskip: peringatan tanpa tombol abaikan (galat) tidak bisa disembunyikan');
m = mkH(full); m.S.dwarn = [{judul: 'b', abaikan: 'SIG-B'}]; m.H.dwskip({dataset: {i: '0'}}); ok(m.o.closed === 1 && m.o.dwarn === 0, 'dwskip: daftar habis -> lembar ditutup');

// ---- setupWarn: hanya catatan yang bisa diabaikan, dan muncul lagi bila daftar item berubah ----
const sCode = cut('A.setupWarn = () =>', 'A.issueCount');
const mkS = (uid, mem, items) => new Function('A', 'S', 'LS', 'checks', sCode.replace(/^A\.setupWarn = /, 'return ').replace(/;\s*$/, ';'))({own: () => true}, {data: {user: {uid}}}, {get: (k, d) => mem[k] == null ? d : mem[k]}, () => [
  {lv: 'err', title: 'Produk belum punya varian', items: ['Kopi'], go: 'product_variants'},
  {lv: 'info', title: 'Item belum punya stok awal', items: items, go: 'stokawal'},
  {lv: 'info', title: 'Overhead belum diisi (HPP belum termasuk gas)', items: ['Overhead masih 0'], go: 'settings'},
  {lv: 'info', title: 'Produk tanpa kategori', items: ['X'], go: 'products'}]);
let mem = {}, r = mkS('u1', mem, ['Usus'])();
ok(r.length === 3 && !r[0].abaikan && r[1].abaikan && r[2].abaikan, 'galat tidak bisa diabaikan; catatan stok awal dan overhead bisa');
ok(/Abaikan bila memang tidak dipakai/.test(r[1].teks) && !/Abaikan bila/.test(r[0].teks), 'teks menjelaskan arti Abaikan hanya pada yang bisa diabaikan');
mem.dwskip = [r[1].abaikan];
ok(mkS('u1', mem, ['Usus'])().length === 2, 'tanda tangan yang diabaikan tidak tampil lagi');
ok(mkS('u1', mem, ['Usus', 'Basreng'])().length === 3, 'daftar item berubah -> peringatan muncul lagi');
ok(mkS('u2', mem, ['Usus'])().length === 3, 'pengguna lain di perangkat yang sama tetap melihatnya');

// ---- perubahan lain ----
ok(/tombol: A\.own\(\) \? 'Lengkapi di Resep' : ''/.test(src), "'Laba belum akurat': tombol Resep hanya untuk Owner/Admin");
ok(/data-act="dwskip"/.test(src), 'lembar peringatan punya tombol Abaikan');
console.log('Semua lulus (' + n + ' pemeriksaan)');
