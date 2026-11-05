// Tes lembar Pembelian bahan dan Penyesuaian stok (src/app/09-stok-pembelian.js) tanpa browser:
// request_id anti-ganda, pembanding harga, peringatan selisih >30%, input per kemasan, dan peringatan menimpa HPP.
// Berkas sumber dimuat apa adanya di sandbox dengan DOM palsu; dnum dan CAPS/can diambil dari 01-inti.js agar sama dengan aplikasi.
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const inti = rd('src/app/01-inti.js'), stok = rd('src/app/09-stok-pembelian.js');
const pick = re => { const m = inti.match(re); assert(m, 'tidak ditemukan di 01-inti.js: ' + re); return m[0]; };
const shared = pick(/function dnum\(s\) \{[\s\S]*?\n\}/) + '\n' + pick(/const CAPS = \{[\s\S]*?\};\n/) + '\n' + pick(/const can = [^\n]*\n/);

function boot(role, o) {
  o = o || {};
  const els = {}, calls = [], toasts = [], store = {}, confirms = [];
  const $ = sel => els[sel] || (els[sel] = {innerHTML: '', value: '', textContent: '', placeholder: '', disabled: false, hidden: false, dataset: {}, focus() {}});
  const S = {data: {user: {role: role}, settings: {}, suppliers: [], variants: [{id: 'v1', stok: 5, hpp_rata2: 1000}],
      materials: [{id: 'm1', nama: 'Tepung', satuan: 'kg', stok: 10, tipe: 'bahan'}, {id: 'm2', nama: 'Gula', satuan: 'kg', stok: 0, tipe: 'bahan'}]},
    pb: {items: [], ongkir: '', sup: '', rid: '', mode: 'sat'}, pbLast: null, adj: null, stab: 'bahan', sq: '', scat: 'Semua'};
  if (o.hpp !== undefined) S.data.materials[0].hpp_rata2 = o.hpp;
  if (o.last) S.pbLast = o.last;
  const ctx = {S: S, $: $, document: {querySelectorAll: () => []}, esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    rp: x => 'Rp ' + Math.round(Number(x) || 0), num: x => String(x), qf: x => String(Math.round(Number(x) * 1000) / 1000).replace('.', ','), r6: x => Math.round(Number(x) * 1e6) / 1e6,
    svg: () => '', cfg: () => '', pById: () => null, vById: id => S.data.variants.find(v => v.id === id), vName: () => 'Basreng', vSub: () => '100g', lvText: () => '', wrapChips: h => '<div class="chips">' + h + '</div>', emptyState: () => '',
    skel: () => '', sheet: h => { ctx.__sheet = h; }, closeSheet: () => { ctx.__closed = true; }, render: () => {}, toast: m => toasts.push(m), busy: (l, fn) => fn(),
    LS: {get: (k, d) => k in store ? store[k] : d, set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }},
    api: async (op, body) => { calls.push({op: op, body: JSON.parse(JSON.stringify(body || {}))}); const r = ctx.__reply[op]; return typeof r === 'function' ? r(body) : r; },
    loadData: async () => { calls.push({op: 'loadData'}); }, newReqId: (() => { let i = 0; return () => 'rid-test-' + (++i); })(),
    confirmBox: async o2 => { confirms.push(o2); return ctx.__confirmAnswer; }, __reply: {}, __confirmAnswer: true};
  const fn = new Function('ctx', 'with (ctx) {\n' + shared + '\n' + stok + '\nreturn {pbAdd, pbSave, pbSheet, pbTouch, pbRead, pbSetMode, pbRefUpd, pbLastLoad, adjSheet, adjSave, adjHppUpd, pbBase, pbRef, PB_WARN, pbPackOf, stPack, stokList};\n}');
  return Object.assign({S: S, els: els, $: $, calls: calls, toasts: toasts, store: store, confirms: confirms, ctx: ctx}, fn(ctx));
}
const setSat = (m, id, q, h) => { m.$('#pb_m').value = id; m.$('#pb_q').value = q; m.$('#pb_h').value = h; };
const setKem = (m, id, nk, nm, isi, hk) => { m.S.pb.mode = 'kem'; m.$('#pb_m').value = id; m.$('#pk_n').value = nk; m.$('#pk_nm').value = nm; m.$('#pk_i').value = isi; m.$('#pk_h').value = hk; };

(async () => {
  // ===== 1. request_id anti-ganda =====
  let m = boot('owner'); m.S.pb.items = [{id: 'm1', qty: 2, harga: 16000}];
  let attempt = 0; m.ctx.__reply['purchase.create'] = () => { if (++attempt === 1) throw new Error('Tidak ada koneksi ke server'); return {id: 'p1', total: 32000, materials: [{id: 'm1', stok: 12}]}; };
  await m.pbSave();
  const rid1 = m.calls[0].body.request_id;
  ok(rid1 && String(rid1).length >= 8, 'pbSave mengirim request_id (server mensyaratkan minimal 8 karakter)');
  ok(m.S.pb.rid === rid1 && m.S.pb.items.length === 1, 'gagal jaringan: daftar dan request_id dipertahankan untuk kirim ulang');
  await m.pbSave();
  ok(m.calls.filter(c => c.op === 'purchase.create')[1].body.request_id === rid1, 'kirim ulang isian yang sama memakai request_id yang sama (tidak menggandakan stok)');
  ok(m.S.pb.items.length === 0 && m.S.pb.rid === '', 'berhasil: daftar dan request_id dikosongkan untuk pembelian berikutnya');
  ok(m.S.data.materials[0].stok === 12, 'berhasil: stok bahan diperbarui dari jawaban server');
  ok(m.calls.some(c => c.op === 'loadData'), 'peran pembaca biaya: data dimuat ulang agar HPP baru terbaca (jawaban server hanya memuat stok)');

  m = boot('stok'); m.S.pb.items = [{id: 'm1', qty: 1, harga: 1000}]; m.ctx.__reply['purchase.create'] = {id: 'p1', total: 1000, materials: [{id: 'm1', stok: 11}]};
  await m.pbSave(); ok(!m.calls.some(c => c.op === 'loadData'), 'peran tanpa akses biaya: tidak perlu memuat ulang seluruh data');

  m = boot('owner'); m.S.pb.items = [{id: 'm1', qty: 1, harga: 1000}]; m.S.pb.rid = 'rid-lama-1234'; m.pbTouch(); ok(m.S.pb.rid === '', 'isian berubah (pbTouch) menghapus request_id supaya yang berikutnya baru');
  m.S.pb.items = [{id: 'm1', qty: 1, harga: 1000}]; m.ctx.__reply['purchase.create'] = {duplicate: true, id: 'p1', total: 1000, materials: [{id: 'm1', stok: 999}]};
  await m.pbSave(); ok(m.S.data.materials[0].stok === 10, 'jawaban duplikat tidak menimpa stok dengan angka lama');
  ok(m.calls.some(c => c.op === 'loadData') && /sudah tercatat/.test(m.toasts[m.toasts.length - 1]), 'jawaban duplikat: data disegarkan dan pengguna diberi tahu');
  ok(m.calls.filter(c => c.op === 'purchase.create')[0].body.request_id.indexOf('rid-test-') === 0, 'request_id dibuat bila belum ada');

  m = boot('owner'); m.S.pb.items = []; await m.pbSave(); ok(!m.calls.length && /kosong/.test(m.toasts[0]), 'daftar kosong tidak dikirim');

  const built = rd('web/js/app.js');
  ok(/pbdel: el => \{[^}]*pbTouch\(\)/.test(built), 'menghapus baris pembelian mengganti request_id');
  ok(/k === 'pbsup'\) \{[^}]*pbTouch\(\)/.test(built) && /k === 'pbongkir'\) \{[^}]*pbTouch\(\)/.test(built), 'mengubah supplier atau ongkir mengganti request_id');

  // ===== 2. pembanding harga (placeholder + keterangan) =====
  m = boot('owner', {hpp: 15800, last: {m1: {harga: 16000, waktu: '2026-11-04T08:00:00Z'}}}); m.pbSheet();
  ok(/placeholder="16000"/.test(m.ctx.__sheet), 'placeholder Harga satuan = harga beli terakhir');
  ok(/Terakhir beli Rp.16\.000\/kg \(04\/11\)/.test(m.ctx.__sheet) && /HPP rata-rata Rp.15\.800\/kg/.test(m.ctx.__sheet), 'keterangan menampilkan harga terakhir (dengan tanggal) dan HPP rata-rata');
  m = boot('stok', {last: {m1: {harga: 16000, waktu: '2026-11-04T08:00:00Z'}}}); m.pbSheet();
  ok(/Terakhir beli/.test(m.ctx.__sheet) && !/HPP rata-rata Rp/.test(m.ctx.__sheet), 'peran tanpa akses biaya hanya melihat harga beli terakhir, bukan HPP');
  m = boot('owner', {hpp: 15800}); m.pbSheet(); ok(/placeholder="15800"/.test(m.ctx.__sheet), 'tanpa riwayat pembelian: placeholder memakai HPP rata-rata');
  m = boot('stok'); m.S.pbLast = {}; m.pbSheet(); ok(/Belum ada riwayat pembelian/.test(m.ctx.__sheet), 'riwayat sudah dimuat tapi kosong: dinyatakan belum ada riwayat');
  m = boot('stok'); m.ctx.__reply['purchase.last'] = {m1: {harga: 2500.5, waktu: '2026-11-04T08:00:00Z'}}; m.pbSheet(); m.$('#pb_m').value = 'm1'; await m.pbLastLoad();
  ok(m.$('#pb_h').placeholder === '2500,5' && /Terakhir beli Rp.2\.500,5/.test(m.$('#pb_ref').textContent), 'pembanding dimuat setelah lembar terbuka dan memperbarui tanpa menggambar ulang (harga desimal tetap)');
  m = boot('stok'); m.ctx.__reply['purchase.last'] = () => { throw new Error('Tidak ada koneksi ke server'); }; m.pbSheet(); await m.pbLastLoad(); ok(m.S.pbLast === null, 'offline: pembanding kosong saja, tidak ada galat yang tampil');

  // ===== 3. peringatan selisih harga > 30% =====
  m = boot('owner', {hpp: 16000});
  setSat(m, 'm1', '2', '17000'); await m.pbAdd(); ok(m.S.pb.items.length === 1 && !m.confirms.length, 'selisih kecil (6%): langsung masuk daftar tanpa konfirmasi');
  m.confirms.length = 0; setSat(m, 'm1', '1', '20800'); await m.pbAdd(); ok(m.S.pb.items.length === 2 && !m.confirms.length, 'tepat 30%: belum memicu peringatan');
  setSat(m, 'm1', '1', '160000'); m.ctx.__confirmAnswer = false; await m.pbAdd();
  ok(m.confirms.length === 1 && /900%/.test(m.confirms[0].msg) && /lebih tinggi/.test(m.confirms[0].msg) && /HPP rata-rata/.test(m.confirms[0].msg), 'salah ketik nol (10x): konfirmasi menyebut 900% lebih tinggi dari HPP rata-rata');
  ok(m.S.pb.items.length === 2, 'konfirmasi ditolak: baris tidak ditambahkan');
  m.ctx.__confirmAnswer = true; await m.pbAdd(); ok(m.S.pb.items.length === 3 && m.S.pb.items[2].harga === 160000, 'konfirmasi disetujui: baris ditambahkan');
  m.confirms.length = 0; setSat(m, 'm1', '1', '8000'); await m.pbAdd(); ok(m.confirms.length === 1 && /lebih rendah 50%/.test(m.confirms[0].msg), 'harga jauh lebih rendah juga dikonfirmasi');
  m.confirms.length = 0; setSat(m, 'm1', '1', '0'); await m.pbAdd(); ok(m.confirms.length === 1, 'harga 0 pada bahan yang punya pembanding dikonfirmasi');
  m = boot('stok', {last: {m1: {harga: 16000, waktu: '2026-11-04T08:00:00Z'}}}); setSat(m, 'm1', '1', '160000'); await m.pbAdd();
  ok(m.confirms.length === 1 && /harga beli terakhir/.test(m.confirms[0].msg), 'peran tanpa akses biaya: pembanding = harga beli terakhir');
  m = boot('stok'); setSat(m, 'm1', '1', '160000'); await m.pbAdd(); ok(!m.confirms.length && m.S.pb.items.length === 1, 'tanpa pembanding sama sekali: tidak ada peringatan');
  m = boot('owner', {hpp: 15800, last: {m1: {harga: 16000, waktu: ''}}}); ok(m.pbBase(m.pbRef('m1')).nm === 'HPP rata-rata', 'bila HPP terlihat, HPP rata-rata jadi pembanding utama peringatan');
  m = boot('owner', {hpp: 16000}); setSat(m, 'm1', '', ''); await m.pbAdd(); ok(/Isi jumlah dan harga/.test(m.toasts[0]) && !m.S.pb.items.length, 'isian kosong ditolak');
  m = boot('owner', {hpp: 16000}); m.S.pb.rid = 'rid-lama-1234'; setSat(m, 'm1', '1', '16000'); await m.pbAdd(); ok(m.S.pb.rid === '', 'menambah baris mengganti request_id');

  // ===== 4. input per kemasan =====
  m = boot('owner', {hpp: 16000}); m.pbSetMode('kem');
  setKem(m, 'm1', '2', 'karung', '25', '400.000'); const r = m.pbRead();
  ok(r.ok && r.q === 50 && r.h === 16000 && /2 karung × 25 kg/.test(r.label), '2 karung × 25 kg @ Rp 400.000 = 50 kg × Rp 16.000/kg');
  await m.pbAdd(); const it = m.S.pb.items[0]; ok(it.qty === 50 && it.harga === 16000 && it.kem === '2 karung × 25 kg' && !m.confirms.length, 'baris tersimpan sebagai jumlah dan harga per satuan (server tidak berubah), harga wajar tanpa konfirmasi');
  ok(JSON.stringify(m.store.pbpack) === '{"m1":{"nm":"karung","isi":25}}', 'nama dan isi kemasan diingat per bahan');
  setKem(m, 'm1', '1', 'karung', '3', '400000'); ok(m.pbRead().h === 133333.3333, 'harga per satuan dibulatkan 4 desimal (sesuai kolom server)');
  setKem(m, 'm1', '1', 'karung', '25', '4000000'); m.ctx.__confirmAnswer = false; m.confirms.length = 0; await m.pbAdd(); ok(m.confirms.length === 1 && /900%/.test(m.confirms[0].msg), 'salah nol pada harga kemasan juga tertangkap peringatan');
  setKem(m, 'm1', '1', 'karung', '', '400000'); m.toasts.length = 0; await m.pbAdd(); ok(/isi per kemasan/.test(m.toasts[0]), 'isi per kemasan kosong ditolak dengan pesan yang jelas');
  setKem(m, 'm1', '1', '', '25', '400000'); ok(m.pbRead().label === '1 kemasan × 25 kg', 'nama kemasan kosong memakai kata "kemasan"');
  m.pbSheet(); ok(/id="pb_kem">/.test(m.ctx.__sheet) && /id="pb_sat" hidden>/.test(m.ctx.__sheet), 'mode kemasan: bagian kemasan tampil, bagian per satuan tersembunyi');
  ok(/placeholder="karung"/.test(m.ctx.__sheet) && /value="karung"/.test(m.ctx.__sheet) && /value="25"/.test(m.ctx.__sheet), 'form kemasan terisi nama dan isi yang diingat');
  m.S.pb.mode = 'sat'; m.pbSheet(); ok(/id="pb_kem" hidden>/.test(m.ctx.__sheet), 'mode per satuan: bagian kemasan tersembunyi');
  m.S.pb.items = [{id: 'm1', qty: 50, harga: 16000, kem: '2 karung × 25 kg'}]; m.pbSheet(); ok(/2 karung × 25 kg = 50 kg @ Rp.16\.000/.test(m.ctx.__sheet), 'daftar belanja menampilkan asal kemasan dan hasil konversinya');

  // ===== 5. HPP manual di Penyesuaian stok =====
  // owner, bahan punya HPP -> peringatan muncul begitu kolom diisi, konfirmasi sebelum menimpa
  m = boot('owner', {hpp: 16000}); m.adjSheet('bahan', 'm1'); m.$('#a_h').value = '';
  m.adjHppUpd(); ok(m.$('#a_hw').innerHTML === '', 'kolom HPP kosong: tanpa peringatan');
  m.$('#a_h').value = '20000'; m.adjHppUpd(); ok(/Ini menimpa HPP rata-rata hasil pembelian/.test(m.$('#a_hw').innerHTML) && /role="alert"/.test(m.$('#a_hw').innerHTML), 'HPP diisi pada bahan yang sudah punya HPP: muncul "Ini menimpa HPP rata-rata hasil pembelian"');
  m.$('#a_s').value = '10'; m.$('#a_r').value = 'koreksi'; m.ctx.__confirmAnswer = false; await m.adjSave('bahan', 'm1');
  ok(m.confirms.length === 1 && /16\.000/.test(m.confirms[0].msg) && /20\.000/.test(m.confirms[0].msg) && !m.calls.some(c => c.op === 'stock.adjust'), 'simpan: konfirmasi menyebut HPP lama dan baru; ditolak = tidak ada pengiriman');
  m.ctx.__confirmAnswer = true; m.ctx.__reply['stock.adjust'] = {stok: 10, hpp_rata2: 20000}; await m.adjSave('bahan', 'm1');
  ok(m.calls.some(c => c.op === 'stock.adjust' && c.body.hpp === 20000), 'konfirmasi disetujui: HPP dikirim');
  m = boot('owner', {hpp: 16000}); m.adjSheet('bahan', 'm1'); m.$('#a_h').value = '16000'; m.$('#a_s').value = '10'; m.$('#a_r').value = 'cek'; m.ctx.__reply['stock.adjust'] = {stok: 10, hpp_rata2: 16000}; await m.adjSave('bahan', 'm1');
  ok(!m.confirms.length, 'HPP yang diisi sama dengan yang ada: tidak perlu konfirmasi');
  m = boot('owner', {hpp: 16000}); m.adjSheet('bahan', 'm1'); m.$('#a_s').value = '8'; m.$('#a_r').value = 'opname'; m.ctx.__reply['stock.adjust'] = {stok: 8, hpp_rata2: 16000}; await m.adjSave('bahan', 'm1');
  ok(!m.confirms.length && m.calls.find(c => c.op === 'stock.adjust').body.hpp === '', 'koreksi stok saja (HPP kosong): tanpa konfirmasi, HPP tidak dikirim');
  m = boot('owner', {hpp: 0}); m.adjSheet('bahan', 'm1'); m.$('#a_h').value = '5000'; m.adjHppUpd(); ok(m.$('#a_hw').innerHTML === '', 'bahan belum punya HPP (stok awal): tidak ada peringatan');
  m = boot('owner', {hpp: 0}); m.S.pbLast = {m1: {harga: 1, waktu: ''}}; m.adjSheet('bahan', 'm1'); m.$('#a_h').value = '5000'; m.adjHppUpd(); ok(/hasil pembelian/.test(m.$('#a_hw').innerHTML), 'riwayat pembelian ada: peringatan tetap muncul walau HPP tersimpan 0');
  m = boot('owner'); m.adjSheet('varian', 'v1'); m.$('#a_h').value = '2000'; m.adjHppUpd(); ok(/hasil produksi/.test(m.$('#a_hw').innerHTML), 'produk jadi: peringatan menyebut hasil produksi');
  // supervisor: boleh, tapi HPP tidak terlihat -> peringatan bersyarat
  m = boot('supervisor'); m.adjSheet('bahan', 'm1'); m.$('#a_h').value = '5000'; m.adjHppUpd(); ok(/Bila bahan ini sudah punya HPP/.test(m.$('#a_hw').innerHTML) && !m.$('#a_h').disabled, 'supervisor (HPP tidak terlihat, stok ada): peringatan bersyarat, kolom tetap bisa diisi');
  // stok: dikunci bila terbukti punya riwayat pembelian
  m = boot('stok'); m.ctx.__reply['purchase.last'] = {m1: {harga: 16000, waktu: '2026-11-04T08:00:00Z'}}; m.adjSheet('bahan', 'm1'); m.$('#a_h').value = '5000'; await m.pbLastLoad(); m.adjHppUpd();
  ok(m.$('#a_h').disabled && m.$('#a_h').value === '' && /perlu supervisor atau owner/.test(m.$('#a_hw').innerHTML), 'peran stok + bahan sudah punya riwayat pembelian: kolom HPP dikunci dan dikosongkan, dengan penjelasan');
  m = boot('stok'); m.S.pbLast = {}; m.adjSheet('bahan', 'm2'); ok(!m.$('#a_h').disabled && /hanya untuk HPP awal/.test(m.$('#a_hw').innerHTML), 'peran stok + bahan tanpa riwayat: kolom tetap terbuka untuk HPP awal, dengan catatan');
  m = boot('stok'); m.S.pbLast = {m1: {harga: 1, waktu: ''}}; m.adjSheet('bahan', 'm1'); m.ctx.__reply['stock.adjust'] = {stok: 9, hpp_rata2: 1}; m.$('#a_s').value = '9'; m.$('#a_r').value = 'opname'; await m.adjSave('bahan', 'm1');
  ok(m.calls.find(c => c.op === 'stock.adjust').body.hpp === '' && !m.confirms.length, 'peran stok yang terkunci tetap bisa koreksi stok (HPP tidak dikirim)');
  m = boot('owner', {hpp: 16000}); m.adjSheet('bahan', 'm1'); m.$('#a_h').value = 'abc'; await m.adjSave('bahan', 'm1'); ok(/tidak valid/.test(m.toasts[0]) && !m.calls.some(c => c.op === 'stock.adjust'), 'HPP bukan angka ditolak sebelum dikirim');

  // ===== 5. kemasan beli di Data Master (0037): isi otomatis dan tampilan "≈ N pack" =====
  m = boot('owner'); Object.assign(m.S.data.materials[0], {nama: 'Plastik', satuan: 'pcs', stok: 72, pack_nama: 'pack', pack_isi: 24});
  ok(JSON.stringify(m.pbPackOf('m1')) === '{"nm":"pack","isi":24,"master":true}', 'pbPackOf memakai kemasan dari Data Master');
  m.store.pbpack = {m1: {nm: 'dus', isi: 10}}; ok(m.pbPackOf('m1').nm === 'pack', 'Data Master menang atas ingatan perangkat');
  ok(JSON.stringify(m.pbPackOf('m2')) === '{"nm":"","isi":0,"master":false}', 'bahan tanpa kemasan di mana pun: kosong');
  m.pbSetMode('kem'); m.$('#pb_m').value = 'm1'; m.pbSetMode('kem'); ok(m.$('#pk_nm').value === 'pack' && m.$('#pk_i').value === '24', 'mode per kemasan terisi dari Data Master');
  setKem(m, 'm1', '3', 'pack', '24', '48000'); const rk = m.pbRead(); ok(rk.q === 72 && rk.h === 2000, '3 pack × 24 pcs @ Rp 48.000 = 72 pcs × Rp 2.000/pcs');
  await m.pbAdd(); ok(JSON.stringify(m.store.pbpack) === '{"m1":{"nm":"dus","isi":10}}', 'ingatan perangkat tidak ditimpa bila Data Master sudah punya kemasan');
  m = boot('owner'); setKem(m, 'm2', '1', 'karung', '25', '400000'); await m.pbAdd(); ok(m.store.pbpack && m.store.pbpack.m2.isi === 25, 'tanpa kemasan di Data Master: tetap diingat di perangkat (cadangan)');
  m = boot('owner'); Object.assign(m.S.data.materials[0], {satuan: 'pcs', stok: 72, pack_nama: 'pack', pack_isi: 24});
  ok(/≈ 3 pack/.test(m.stPack(m.S.data.materials[0])), '72 pcs dengan isi 24 tampil ≈ 3 pack');
  m.S.data.materials[0].stok = 80; ok(/≈ 3,3 pack/.test(m.stPack(m.S.data.materials[0])), 'pecahan dibulatkan 1 desimal');
  m.S.data.materials[0].stok = 0; ok(m.stPack(m.S.data.materials[0]) === '', 'stok 0: tanpa tampilan pack');
  m.S.data.materials[0].stok = 72; m.stokList(); ok(/≈ 3 pack/.test(m.$('#slist').innerHTML) && !/≈/.test(m.$('#slist').innerHTML.split('Tepung')[0]), 'daftar stok bahan menampilkan ≈ N pack hanya untuk bahan yang punya kemasan');
  m.S.data.materials[0].pack_isi = null; ok(m.stPack(m.S.data.materials[0]) === '', 'tanpa isi kemasan: tidak ada tampilan pack');

  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.error('GAGAL:', e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); });
