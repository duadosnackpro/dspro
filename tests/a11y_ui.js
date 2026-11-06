// Tes v2.6.14 tanpa browser dan tanpa dependensi: judul layar + fokus, radiogroup metode bayar, tabel laporan, lencana menu, label Transfer.
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ker = rd('src/app/06-kerangka.js');

// ===== 1. judul layar dan fokus sesudah render =====
const grab = re => { const m = ker.match(re); ok(m, 'potongan kode ada: ' + re); return m[0]; };
const code = grab(/const TAB_TITLE = [^\n]*\n/) + grab(/const RF = [^\n]*\n/) + grab(/function screenFocus[\s\S]*?\nfunction announce[^\n]*\n/);
function mk(opt) {
  opt = opt || {}; const log = [], els = {}, el = (id, extra) => els[id] = Object.assign({textContent: '', hidden: false, focus: o => log.push(id), id: id}, extra);
  el('#stitle'); el('#sann'); el('#sheet', {hidden: !opt.sheetOpen}); ['dash', 'kasir', 'menu'].forEach(t => el('#app .nav [data-t="' + t + '"]'));
  const S = {tab: opt.tab || 'kasir', data: {settings: {nama_usaha: 'Duado Snack'}}}, document = {title: ''};
  const f = new Function('S', '$', 'document', 'setTimeout', code + '\nreturn {screenFocus, RF, TAB_TITLE};')(S, s => els[s] || null, document, fn => fn());
  f.RF.tab = opt.prev === undefined ? 'dash' : opt.prev; return {f, log, els, S, document};
}
{ const t = mk(); t.f.screenFocus('', true, false); ok(t.log.join() === '#stitle', 'layar berganti lewat jalan lain (bukan tombol nav): fokus ke <h1>'); ok(t.els['#stitle'].textContent === 'Kasir', '<h1> berisi judul layar'); ok(t.document.title === 'Kasir · Duado Snack', 'document.title mengikuti layar'); ok(t.f.RF.tab === 'kasir', 'layar terakhir tercatat'); }
{ const t = mk(); t.f.screenFocus('kasir', true, false); ok(t.log.join() === '#app .nav [data-t="kasir"]', 'tombol nav yang ditekan dapat fokusnya kembali (bukan jatuh ke body)'); ok(t.els['#sann'].textContent === 'Kasir', 'pindah layar diumumkan lewat region status'); }
{ const t = mk({prev: 'kasir'}); t.f.screenFocus('kasir', false, false); ok(t.log.join() === '#app .nav [data-t="kasir"]' && t.els['#sann'].textContent === '', 'render ulang di layar yang sama: fokus nav dipulihkan, tanpa pengumuman'); }
{ const t = mk({prev: 'kasir'}); t.f.screenFocus('', false, false); ok(t.log.length === 0, 'render ulang di layar yang sama tanpa fokus di nav: fokus tidak direbut'); }
{ const t = mk({prev: ''}); t.f.screenFocus('', true, true); ok(t.log.length === 0 && t.document.title === 'Kasir · Duado Snack', 'muat awal: fokus tidak direbut, judul tetap diisi'); }
{ const t = mk({sheetOpen: true}); t.f.screenFocus('', true, false); ok(t.log.length === 0, 'lembar (sheet) terbuka: fokus tidak ditarik keluar dari lembar'); }
{ const t = mk({tab: 'tidak_dikenal'}); t.f.screenFocus('', true, false); ok(t.els['#stitle'].textContent === 'tidak_dikenal', 'tab tak terdaftar: judul cadangan = nama tab, tidak kosong'); }
// setiap layar yang bisa dibuka punya judul
const allSrc = fs.readdirSync(path.join(__dirname, '../src/app')).map(f => rd('src/app/' + f)).join('\n');
const tabs = new Set(['dash', 'kasir', 'riwayat', 'stok', 'produksi', 'menu']);
(ker.match(/const MENU_TABS = \[([^\]]*)\]/)[1].match(/'(\w+)'/g) || []).forEach(x => tabs.add(x.replace(/'/g, '')));
(allSrc.match(/(?:MENU_TABS|OWN_TABS)\.push\('(\w+)'\)/g) || []).forEach(x => tabs.add(x.match(/'(\w+)'/)[1]));
{ const T = mk().f.TAB_TITLE; tabs.forEach(t => ok(T[t], 'judul layar untuk tab "' + t + '"')); }
ok(/<h1 class="sr" id="stitle" tabindex="-1"><\/h1><main id="main">/.test(ker), 'render() memasang <h1> tersembunyi sebelum <main>');
ok(/id="sann"[^>]*aria-live="polite"/.test(rd('web/index.html')), 'index.html punya region status #sann di luar #app (tidak ikut terganti saat render)');

// ===== 2. chip metode bayar = radiogroup =====
const kas = rd('src/app/07-kasir-foto.js'), mcode = kas.match(/const methodChips = \(\) => \{[\s\S]*?\n {2}return [^\n]*\n/);
ok(mcode, 'methodChips ada');
const chips = (S, L) => new Function('S', 'payMethods', mcode[0] + '\nreturn methodChips();')(S, () => L);
{ const h = chips({metode: 'qris'}, ['tunai', 'qris', 'transfer']), b = h.match(/<button[^>]*>/g);
  ok(b.length === 3 && b.every(x => /role="radio"/.test(x) && /aria-checked="(true|false)"/.test(x)) && !/aria-pressed/.test(h), 'tiap chip role=radio + aria-checked (bukan aria-pressed)');
  ok(b.filter(x => /tabindex="0"/.test(x)).length === 1 && /aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/.test(b[1]) , 'hanya chip terpilih di urutan Tab (roving tabindex)'); }
{ const b = chips({metode: 'hilang'}, ['tunai', 'qris']).match(/<button[^>]*>/g); ok(/tabindex="0"/.test(b[0]) && /tabindex="-1"/.test(b[1]), 'metode tersimpan tak valid: chip pertama tetap bisa dijangkau keyboard'); }
ok(/id="mchips" role="radiogroup" aria-label="Metode pembayaran"/.test(kas), 'wadah chip role=radiogroup berlabel');
const aks = rd('src/app/13-aksi.js');
ok(/matches\('#mchips \[role="radio"\]'\)/.test(aks) && /Arrow\(Left\|Right\|Up\|Down\)/.test(aks), 'panah memilih metode berikutnya/sebelumnya');
ok(/\[aria-checked="true"\]'\)\); if \(b\) b\.focus/.test(aks), 'fokus dikembalikan ke chip terpilih setelah daftar chip digambar ulang');

// ===== 3. tabel laporan, lencana menu, label Transfer =====
const mod = rd('web/js/modules.js');
ok(/<table><caption class="sr">/.test(mod), 'tabel laporan punya <caption>');
ok(/<th scope="col"/.test(mod) && !/<th class=/.test(mod), 'semua <th> bertanda scope="col"');
ok(/class="tw" role="region" tabindex="0" aria-label="Tabel /.test(mod), 'wilayah gulir tabel bisa difokus keyboard dan berlabel');
const men = rd('src/app/10-menu-master-pengaturan.js');
ok(!/<span class="mi-b"[^>]*aria-label/.test(men) && /<span class="mi-b" aria-hidden="true">' \+ bd \+ '<\/span><span class="sr"> ' \+ bd \+ ' masalah<\/span>/.test(men), 'lencana masalah: angka disembunyikan, teks "N masalah" lewat .sr');
ok(/data-tf="qty"[^>]*aria-label="Jumlah item yang dikirim"/.test(rd('src/app/136-transfer.js')), 'kolom jumlah Transfer berlabel jelas');
console.log('Semua lulus (' + n + ' pemeriksaan)');
