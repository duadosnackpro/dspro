// Uji butir 6 dan 7 (tanpa browser, tanpa dependensi):
//  6) Pengaturan dilipat per kelompok: 12 kartu masuk tepat satu kelompok, keadaan buka/tutup diingat, temuan Overhead membuka kelompok Stok & HPP.
//  7) Tabel harga jual: satu kartu per varian x channel, hanya sel yang berubah disimpan, isian salah menahan seluruh simpan, sel gagal tetap tampil.
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const menu = rd('src/app/10-menu-master-pengaturan.js'), inti = rd('src/app/01-inti.js'), hs = rd('src/app/1396-harga.js'), css = rd('web/css/app.css'), mod = rd('web/js/modules.js');

// ===== 6. Pengaturan dilipat =====
const vs = menu.slice(menu.indexOf('function vSettings()'), menu.indexOf('async function sSave()'));
const cards = (vs.match(/\bcd\.[a-z]+ = /g) || []).map(x => x.slice(3, -3));
ok(cards.length === 12 && new Set(cards).size === 12, '12 kartu pengaturan, masing-masing didefinisikan sekali: ' + cards);
const groups = [...vs.matchAll(/grp\('(\w+)', '[^']+', '[^']+', ([^\n]*?)\) \+/g)].map(m => ({id: m[1], cards: m[2].split(' + ').map(x => x.replace(/^cd\./, ''))}));
ok(groups.length === 4, '4 kelompok');
const used = groups.flatMap(g => g.cards).sort();
ok(JSON.stringify(used) === JSON.stringify(cards.slice().sort()), 'setiap kartu ada di tepat satu kelompok (tidak ada yang hilang atau ganda): ' + used);
ok(/<details class="set-grp" data-g="'/.test(vs) && /<summary>/.test(vs), 'kelompok memakai <details>/<summary> bawaan (bisa dipakai keyboard dan pembaca layar)');
ok(/S\.sOpen = S\.sOpen \|\| \{struk: true\}/.test(vs), 'bawaan: hanya kelompok pertama terbuka');
ok(/\(sOpen\[id\] \? ' open' : ''\)/.test(vs), 'keadaan terbuka dibaca dari S.sOpen saat digambar ulang (simpan tidak menutup kelompok)');
ok(/id="ssavebtn"/.test(vs) && /<\/div><div class="savebar">/.test(vs), 'tombol Simpan tetap di luar kelompok, jadi selalu terlihat');
ok(/document\.querySelectorAll\('#sf \[data-f\]'\)/.test(menu), 'penyimpanan dan penanda "berubah" membaca semua [data-f] di #sf, termasuk di kelompok yang tertutup');
{ // pendengar toggle
  const m = menu.match(/document\.addEventListener\('toggle', (e => [\s\S]*?), true\);/); ok(m, 'pendengar toggle ada (fase tangkap)');
  const S = {}; const h = new Function('S', 'return ' + m[1].replace(/\/\*\* @type \{any\} \*\//g, ''))(S);
  const el = (g, open) => ({classList: {contains: c => c === 'set-grp'}, dataset: {g: g}, open: open});
  h({target: el('jual', true)}); ok(S.sOpen.jual === true, 'membuka kelompok tercatat'); h({target: el('jual', false)}); ok(S.sOpen.jual === false, 'menutup tercatat');
  h({target: {classList: {contains: () => false}, dataset: {}}}); ok(Object.keys(S.sOpen).length === 1, '<details> lain (mis. .more) diabaikan');
}
ok(/\.set-grp>summary\{[^}]*min-height:56px/.test(css), 'judul kelompok cukup besar untuk disentuh (>= 44 px)');
ok(/cekgo: el => \{ const t = el\.dataset\.t; if \(t === 'settings'\) S\.sOpen = Object\.assign\(S\.sOpen \|\| \{struk: true\}, \{stok: true\}\)/.test(mod), 'temuan Overhead membuka kelompok Stok & HPP');
ok(/id="oh-hint"/.test(vs) && /HPP & Overhead/.test(vs) && groups.find(g => g.id === 'stok').cards.indexOf('hpp') >= 0, 'kartu HPP & Overhead memang berada di kelompok "stok"');

// ===== 7. Tabel harga jual =====
ok(/if \(S\.mt === 'channel_prices'\) \{ \$\('#main'\)\.innerHTML = head \+ hargaBody\(\); hgCount\(\); return; \}/.test(menu), 'tab Harga jual di Data Master menampilkan tabel');
const grab = re => inti.match(re)[0];
const base = grab(/function dnum[\s\S]*?\n}\n/) + grab(/const rpIn = [^\n]*\n/) + grab(/const esc = [^\n]*\n/) + grab(/const num = [^\n]*\n/);
function mk(o) {
  const log = {api: [], toast: [], render: 0, load: 0}, dom = {'#hg_save': {disabled: true, textContent: ''}};
  const S = {tab: 'master', mt: 'channel_prices', data: Object.assign({channels: [{id: 'c1', nama: 'Offline'}, {id: 's1', nama: 'Shopee'}], products: [], settings: {},
    variants: [{id: 'v1', product_id: 'p1', ukuran: '100 g'}, {id: 'v2', product_id: 'p1', ukuran: '250 g'}, {id: 'v3', product_id: 'p2', ukuran: ''}],
    prices: [{id: 'v1:c1', variant_id: 'v1', channel_id: 'c1', harga_jual: 10000}, {id: 'v1:s1', variant_id: 'v1', channel_id: 's1', harga_jual: 12000}, {id: 'v2:c1', variant_id: 'v2', channel_id: 'c1', harga_jual: 20000}]}, o || {})};
  const api = async (a, p) => { log.api.push([a, p.data]); if (S.fail && S.fail(p.data)) throw Object.assign(new Error(S.fail(p.data)), S.auth ? {auth: true} : {}); return {id: p.data.variant_id + ':' + p.data.channel_id, variant_id: p.data.variant_id, channel_id: p.data.channel_id, harga_jual: p.data.harga_jual}; };
  const priceOf = (v, c) => { const x = S.data.prices.find(p => p.variant_id === v && p.channel_id === c); return x ? Number(x.harga_jual) : null; };
  const patchMaster = (t, rec) => { const i = S.data.prices.findIndex(x => x.id === rec.id); if (i >= 0) S.data.prices[i] = Object.assign({}, S.data.prices[i], rec); else S.data.prices.push(rec); return true; };
  const ACT = {}, listeners = {};
  const document = {addEventListener: (t, f) => listeners[t] = f, querySelector: () => null};
  const f = new Function('S', '$', 'priceOf', 'vName', 'vSub', 'emptyState', 'MT', 'toast', 'busy', 'api', 'patchMaster', 'loadData', 'vMaster', 'document', 'navigator', 'ACT',
    base + hs + '\nreturn {HGR, hgChanges, hgCount, hargaBody, hgSave};')(S, sel => dom[sel] || null, priceOf, v => ({v1: 'Basreng', v2: 'Basreng', v3: 'Keripik'}[v.id]), v => v.ukuran || '',
      (ic, t) => '<empty>' + t + '</empty>', {channel_prices: {t: r => 'harga ' + r.id}}, m => log.toast.push(m), (l, fn) => fn(), api, patchMaster, async () => { log.load++; }, () => { log.render++; }, document, {onLine: true}, ACT);
  return Object.assign({S, log, dom, listeners, ACT}, f);
}
let t = mk(); let h = t.hargaBody();
ok((h.match(/<input /g) || []).length === 6, '3 varian x 2 channel = 6 isian dalam satu layar (dulu 6 baris + form satu per satu)');
ok((h.match(/class="hg-h"/g) || []).length === 2 && /<h3 class="hg-h">Basreng<\/h3>/.test(h), 'varian dikelompokkan per produk (nama produk tidak diulang)');
ok(/value="10\.000"/.test(h) && /value="12\.000"/.test(h) && /placeholder="belum ada" value=""/.test(h), 'harga tersimpan tampil berformat; kombinasi yang belum ada kosong dengan petunjuk');
ok(/data-act="medit" data-id="v1:c1"/.test(h), 'daftar satu per satu (untuk menghapus) tetap tersedia');
ok(/Satu ukuran/.test(h), 'varian tanpa ukuran diberi label');
ok(t.hgChanges().length === 0, 'belum ada perubahan: tidak ada yang disimpan'); t.hgCount(); ok(t.dom['#hg_save'].disabled && /Ubah harga dulu/.test(t.dom['#hg_save'].textContent), 'tombol simpan nonaktif');
t.S.data.variants = []; ok(/Belum ada varian/.test(t.hargaBody()), 'tanpa varian: ajakan yang jelas'); t = mk(); t.S.data.channels = []; ok(/Belum ada channel/.test(t.hargaBody()), 'tanpa channel: ajakan yang jelas');

// perubahan: hanya sel yang berbeda
t = mk(); const inp = t.listeners.input, put = (k, v) => inp({target: {dataset: {hg: k}, value: v}});
put('v1|c1', '10.000'); ok(t.hgChanges().length === 0, 'nilai sama dengan yang tersimpan (setelah format) bukan perubahan');
put('v1|c1', '11.000'); put('v3|s1', '5.000'); put('v2|s1', ''); ok(t.hgChanges().length === 2, 'berubah: 1 harga lama + 1 harga baru; kosong untuk yang belum ada dilewati');
t.hgCount(); ok(!t.dom['#hg_save'].disabled && /Simpan 2 harga/.test(t.dom['#hg_save'].textContent), 'tombol simpan menghitung sel yang berubah');
put('v1|c1', '10.000'); ok(t.hgChanges().length === 1, 'mengetik kembali nilai asli membatalkan perubahan itu');
put('v2|c1', ''); ok(t.hgChanges().some(x => x.k === 'v2|c1' && /tidak boleh kosong/.test(x.bad)), 'mengosongkan harga yang sudah ada = galat (bukan hapus diam-diam)');
put('v2|c1', 'abc'); ok(t.hgChanges().some(x => x.k === 'v2|c1' && /tidak valid/.test(x.bad)), 'isian bukan angka = galat');

(async () => {
  // simpan dengan isian salah: tidak ada panggilan sama sekali
  t.S.data.prices.length; await t.hgSave(); ok(t.log.api.length === 0, 'ada isian salah: tidak ada yang tersimpan (tidak setengah-setengah)');
  ok(/perlu diperbaiki/.test(t.log.toast.pop()) && /tidak valid/.test(t.HGR.f['v2|c1']), 'pesan galat melekat pada selnya');
  // simpan benar
  t = mk(); const put2 = (k, v) => t.listeners.input({target: {dataset: {hg: k}, value: v}});
  put2('v1|c1', '11.000'); put2('v3|s1', '5.000');
  await t.hgSave();
  ok(t.log.api.length === 2 && t.log.api.every(c => c[0] === 'master.save'), 'satu panggilan master.save per sel yang berubah (bukan semua sel)');
  const byK = Object.fromEntries(t.log.api.map(c => [c[1].variant_id + '|' + c[1].channel_id, c[1]]));
  ok(byK['v1|c1'].harga_jual === 11000 && byK['v3|s1'].harga_jual === 5000 && Object.keys(t.log.api[0][1]).sort().join() === 'channel_id,harga_jual,variant_id', 'nilai dikirim sebagai angka bulat; "11.000" terbaca 11000, bukan 11');
  ok(t.S.data.prices.find(p => p.id === 'v1:c1').harga_jual === 11000 && t.S.data.prices.some(p => p.id === 'v3:s1'), 'data lokal diperbarui: harga lama berubah, harga baru ditambahkan');
  ok(Object.keys(t.HGR.v).length === 0 && /2 harga tersimpan/.test(t.log.toast.pop()), 'isian dibersihkan dan jumlah dilaporkan');
  // satu sel gagal: sel lain tetap tersimpan, yang gagal tetap tampil dengan pesannya
  t = mk(); t.S.fail = d => d.channel_id === 's1' ? 'Ditolak server' : ''; const put3 = (k, v) => t.listeners.input({target: {dataset: {hg: k}, value: v}});
  put3('v1|c1', '11.000'); put3('v3|s1', '5.000'); await t.hgSave();
  ok(t.log.api.length === 2 && t.HGR.f['v3|s1'] === 'Ditolak server' && !('v1|c1' in t.HGR.v) && 'v3|s1' in t.HGR.v, 'sel gagal tetap ada isiannya dengan pesan; sel berhasil keluar dari daftar');
  ok(/1 harga tersimpan, 1 gagal/.test(t.log.toast.pop()), 'ringkasan jujur: berhasil dan gagal disebut');
  ok(/Ditolak server/.test(t.hargaBody()), 'pesan galat tampil di bawah selnya saat digambar ulang');
  const before = t.log.api.length; await t.hgSave(); ok(t.log.api.length === before + 1, 'mengulang simpan hanya mengirim sel yang masih gagal');
  // galat biasa tidak menghentikan sel lain; sesi berakhir menghentikan sisanya
  t = mk(); t.S.fail = () => 'x'; const put4 = (k, v) => t.listeners.input({target: {dataset: {hg: k}, value: v}}); put4('v1|c1', '1'); put4('v3|s1', '2');
  await t.hgSave(); ok(t.log.api.length === 2, 'galat biasa tidak menghentikan sel lain');
  t = mk(); t.S.fail = () => 'x'; t.S.auth = true; const put5 = (k, v) => t.listeners.input({target: {dataset: {hg: k}, value: v}}); put5('v1|c1', '1'); put5('v3|s1', '2');
  await t.hgSave(); ok(t.log.api.length === 1 && /Sesi berakhir/.test(t.HGR.f['v1|c1']) && /Sesi berakhir/.test(t.log.toast.pop()), 'sesi berakhir: berhenti di sel pertama, pesan jelas');
  console.log('OK ' + n + ' pemeriksaan');
})().catch(e => { console.error(e); process.exit(1); });
