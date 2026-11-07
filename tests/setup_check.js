// Uji v2.6.19: Pemeriksaan data tidak boleh bilang "lengkap" saat katalog kosong, cek stok awal dan overhead, kartu "Perlu dilengkapi" di Beranda,
// menu Biaya operasional, dan jenis laporan tanpa duplikat.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'web/js/modules.js'), 'utf8');
const menuSrc = fs.readFileSync(path.join(__dirname, '..', 'src/app/10-menu-master-pengaturan.js'), 'utf8');
const aksiSrc = fs.readFileSync(path.join(__dirname, '..', 'src/app/13-aksi.js'), 'utf8');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; };

// 1. jenis laporan unik
const rt = src.match(/const RTYPES_ALL = (\[\[.*\]\]);/)[1], keys = eval(rt).map(x => x[0]);
ok(keys.length === new Set(keys).size, 'jenis laporan tidak ada yang kembar: ' + keys.filter((k, i) => keys.indexOf(k) !== i));

// 2. checks() dan vCek()
const a = src.indexOf('const priceOf'), b = src.indexOf('async function stockAudit');
const cardA = src.indexOf('A.setupCard = '), cardB = src.indexOf('A.issueCount = ');
const dom = {main: {innerHTML: ''}}; const S = {data: null}; let own = true;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const A = {vName: v => v.nama || v, vSub: v => v.sub || '', own: () => own};
const f = new Function('S', 'A', '$', 'esc', 'set', 'skel', 'num', 'dec', 'rp', 'api',
  src.slice(a, b) + '\n' + src.slice(cardA, cardB) + '\nreturn {checks, vCek};');
const m = f(S, A, sel => dom[sel.slice(1)], esc, k => S.data.settings[k], () => '', String, String, String, async () => ({}));
const mk = o => Object.assign({products: [], variants: [], channels: [{id: 'c1', nama: 'Offline'}], prices: [], materials: [], recipes: [], recipe_items: [], settings: {}}, o);
const titles = () => m.checks().map(x => x.title);

S.data = mk({});
ok(titles().indexOf('Belum ada produk (Kasir masih kosong)') >= 0, 'katalog kosong terdeteksi sebagai hal yang harus diperbaiki');
m.vCek(); ok(!/Semua data lengkap/.test(dom.main.innerHTML), 'katalog kosong: halaman TIDAK menjawab "Semua data lengkap"');
ok(/Belum ada produk\./.test(dom.main.innerHTML) || /perlu diperbaiki/.test(dom.main.innerHTML), 'katalog kosong: ada pesan yang jujur');

const full = () => mk({products: [{id: 'p1', nama: 'Basreng', kategori: 'Snack'}], variants: [{id: 'v1', product_id: 'p1', nama: 'Basreng', sub: '100 g', sku: 'B1', stok: 10, hpp_rata2: 5000}],
  prices: [{variant_id: 'v1', channel_id: 'c1', harga_jual: 10000}], materials: [{id: 'm1', nama: 'Ikan', stok: 5, hpp_rata2: 100}], recipes: [{id: 'r1', nama: 'R', variant_id: 'v1'}], recipe_items: [{recipe_id: 'r1', material_id: 'm1', qty: 1}], settings: {overhead_per_unit: 200}});
S.data = full(); ok(m.checks().length === 0, 'data lengkap: tidak ada temuan: ' + titles());
m.vCek(); ok(/Semua data lengkap/.test(dom.main.innerHTML), 'data lengkap: baru boleh bilang lengkap');

// 3. stok awal
S.data = full(); S.data.variants[0].stok = 0; S.data.variants[0].hpp_rata2 = 0; S.data.materials[0].stok = 0; S.data.materials[0].hpp_rata2 = 0;
let t = m.checks().find(x => /Stok awal belum diisi/.test(x.title));
ok(t && t.lv === 'err' && t.items.length === 2 && t.go === 'stokawal', 'semua item kosong: "Stok awal belum diisi" level Perbaiki, tujuan layar Stok awal');
S.data = full(); S.data.materials[0].stok = 0; S.data.materials[0].hpp_rata2 = 0;
t = m.checks().find(x => /belum punya stok awal/.test(x.title)); ok(t && t.lv === 'info' && t.items.length === 1, 'sebagian kosong: hanya catatan Info, memuat item yang kosong saja');
S.data = full(); S.data.variants[0].stok = 0;   // habis terjual tapi HPP ada: bukan stok awal yang belum diisi
ok(!titles().some(x => /stok awal/i.test(x)), 'stok 0 dengan HPP terisi (habis terjual) tidak dituduh belum diisi');

// 4. overhead
S.data = full(); S.data.settings = {}; t = m.checks().find(x => /^Overhead belum diisi/.test(x.title)); ok(t && t.lv === 'info' && t.go === 'settings', 'overhead 0: catatan Info mengarah ke Pengaturan');
S.data = mk({settings: {}}); ok(!titles().some(x => /^Overhead/.test(x)), 'katalog kosong: tidak menambah catatan overhead');

// 5. kartu Beranda
const card = new Function('A', 'S', 'esc', 'checks', src.slice(cardA, cardB) + '\nreturn A.setupCard;');
const A2 = {own: () => true}; const sc = card(A2, S, esc, () => [{lv: 'err', title: 'A'}, {lv: 'err', title: 'B'}, {lv: 'err', title: 'C'}, {lv: 'err', title: 'D'}, {lv: 'info', title: 'Catatan biasa'}, {lv: 'info', title: 'Overhead belum diisi'}]);
let h = sc(); ok(/Perlu dilengkapi/.test(h) && /<li>A<\/li>/.test(h) && !/<li>D<\/li>/.test(h) && /dan 2 lainnya/.test(h), 'kartu: 3 judul tampil, sisanya diringkas (info biasa tidak dihitung)');
ok(/data-act="go_cek"/.test(h), 'kartu punya tombol ke Pemeriksaan data');
A2.own = () => false; ok(sc() === '', 'bukan Owner: tidak ada kartu');
A2.own = () => true; ok(card(A2, S, esc, () => [])() === '', 'tidak ada yang perlu dilengkapi: tidak ada kartu');
ok(card(A2, S, esc, () => { throw new Error('x'); })() === '', 'galat di pemeriksaan tidak merusak Beranda');
ok(/A\.setupCard \? A\.setupCard\(\) : ''/.test(src), 'drawDash memanggil kartu lewat guard (tes Beranda lama tetap jalan)');

// 6. menu dan aksi Biaya operasional
ok(/\(o \? mi\('go_biaya', 'laporan', 'Biaya operasional'/.test(menuSrc), 'menu Operasional memuat Biaya operasional hanya untuk Owner');
ok(/go_biaya: \(\) => \{ S\.mt = 'expenses'; S\.tab = 'master'; render\(\); \}/.test(aksiSrc), 'aksi go_biaya membuka tab Biaya di Data Master');
ok(/S\.mt === 'expenses' \? '<p class="muted note">Biaya masuk ke laporan/.test(menuSrc), 'tab Biaya punya teks bantu');
const built = fs.readFileSync(path.join(__dirname, '..', 'web/js/app.js'), 'utf8'); ok(/go_biaya/.test(built), 'app.js hasil build memuat go_biaya');
console.log('Semua lulus (' + pass + ' pemeriksaan)');
