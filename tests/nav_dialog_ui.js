// Tes v2.6.13 (+ keluar dua kali v2.6.16) tanpa browser dan tanpa dependensi:
//  1) tidak ada confirm()/prompt()/alert() bawaan browser yang tersisa di kode (kecuali ev.prompt() pemasangan PWA),
//  2) durasi toast mengikuti panjang pesan,
//  3) logika tombol Back (src/app/015-navigasi.js) dengan session history palsu: tab, sheet, dialog, pemulihan entri.
const fs = require('fs'), path = require('path'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ===== 1. tanpa dialog bawaan =====
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\w])\/\/[^\n]*/g, '$1');
const files = fs.readdirSync(path.join(__dirname, '../src/app')).filter(f => /\.js$/.test(f)).map(f => 'src/app/' + f).concat(['web/js/modules.js']);
files.forEach(f => { const bad = strip(rd(f)).match(/(^|[^.\w$])(confirm|prompt|alert)\s*\(/g); ok(!bad, f + ' memakai dialog bawaan browser: ' + bad); });
ok(/ev\.prompt\(\)/.test(rd('src/app/13-aksi.js')), 'pemasangan PWA (ev.prompt) tetap ada: itu API yang sah, bukan dialog');
const built = rd('web/js/app.js'); ok(/APP[\s\S]{0,400}confirmBox: confirmBox, promptBox: promptBox, fieldErr: fieldErr/.test(built) || /confirmBox: confirmBox, promptBox: promptBox, fieldErr: fieldErr/.test(built), 'modules.js bisa memakai confirmBox/promptBox/fieldErr lewat APP');

// ===== 2. durasi toast =====
const inti = rd('src/app/01-inti.js'), tm = inti.match(/const toastMs = [^\n]*\n/); ok(tm, 'toastMs ada');
const toastMs = new Function(tm[0] + 'return toastMs;')();
ok(toastMs('') === 2600 && toastMs('Singkat') === 2600, 'pesan pendek: 2,6 dtk');
ok(toastMs('x'.repeat(60)) > 5000 && toastMs('x'.repeat(60)) < toastMs('x'.repeat(100)), 'makin panjang makin lama');
ok(toastMs('x'.repeat(500)) === 10000, 'dibatasi 10 dtk');

// ===== 3. riwayat Back =====
function boot(o) {
  o = o || {}; let m0;
  const hist = {stack: [null], i: 0, pops: 0, pushes: 0, exitTries: 0}, handlers = [], clock = {t: 100000}, toasts = [];
  const history = {get state() { return hist.stack[hist.i]; }, pushState(s) { hist.stack.length = hist.i + 1; hist.stack.push(s); hist.i++; hist.pushes++; }, replaceState(s) { hist.stack[hist.i] = s; },
    go(d) { setTimeout(() => { const to = hist.i + d; if (to < 0) { hist.exitTries++; return; } hist.i = Math.min(hist.stack.length - 1, to); handlers.forEach(h => h()); }, 0); }};
  const S = {token: 't', data: {}, tab: 'dash', cfmOpen: false, busyOn: false, dirty: false}, sheet = {hidden: true};
  const log = [], ctx = {window: {history, addEventListener: (t, h) => { if (t === 'popstate') handlers.push(h); }}, history: history, S: S, $: s => s === '#sheet' ? sheet : null,
    homeTab: () => 'dash', tabAllowed: () => true, render: () => { log.push('render:' + S.tab); ctx.__navTrack(); ctx.__navSync(); },
    requestCloseSheet: async () => { if (S.busyOn) return; if (o.dirty) { S.cfmOpen = true; ctx.__navSync(); return; } sheet.hidden = true; ctx.__navSync(); },
    confirmBox: async () => true, setTimeout: setTimeout, clearTimeout: clearTimeout, toast: m => toasts.push(m), Date: {now: () => clock.t}};
  const f = new Function('ctx', 'with (ctx) {\n' + rd('src/app/015-navigasi.js') + '\nctx.__navSync = navSync; ctx.__navTrack = navTrack; return {NAV, navSync, navTrack};\n}');
  const api = f(ctx); m0 = Object.assign({S, sheet, hist, ctx, log, toasts, clock, back: () => history.go(-1)}, api); m0.navSync(); return m0;
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));
(async () => {
  let m = boot(); ok(m.hist.pushes === 1 && m.NAV.depth === 1, 'awal: 1 entri penjaga (keluar dua kali)');
  m.S.tab = 'stok'; m.ctx.render(); ok(m.hist.pushes === 2 && m.NAV.depth === 2, 'tab selain beranda: +1 entri di atas penjaga');
  m.S.tab = 'menu'; m.ctx.render(); ok(m.hist.pushes === 2, 'pindah antar tab non-beranda tidak menambah entri');
  m.back(); await tick(); ok(m.S.tab === 'stok' && m.NAV.depth === 2, 'Back: ke tab sebelumnya (Stok), entri tetap 2');
  m.back(); await tick(); ok(m.S.tab === 'dash' && m.NAV.depth === 1 && m.toasts.length === 0, 'Back lagi: ke beranda, tanpa bolak-balik dan tanpa peringatan keluar');

  // --- keluar dua kali ---
  m.back(); await tick(40);
  ok(m.toasts.length === 1 && /sekali lagi/.test(m.toasts[0]), 'Back pertama di beranda: toast peringatan');
  ok(m.hist.exitTries === 0 && m.NAV.depth === 1 && m.hist.i === 1, 'Back pertama: aplikasi tetap terbuka dan penjaga dipasang lagi');
  m.clock.t += 1000; m.back(); await tick(40);
  ok(m.hist.exitTries === 1 && m.NAV.leaving === true, 'Back kedua dalam 2,5 dtk: benar-benar keluar (mundur satu langkah lagi)');
  await tick(900); ok(m.NAV.leaving === false && m.NAV.depth === 1, 'bila keluar tidak terjadi (tidak ada riwayat lagi), aplikasi hidup dan penjaga kembali');

  m = boot(); m.back(); await tick(40); m.clock.t += 3000; m.back(); await tick(40);
  ok(m.toasts.length === 2 && m.hist.exitTries === 0 && m.NAV.depth === 1, 'Back kedua setelah lewat 2,5 dtk: hanya peringatan lagi, tidak keluar');

  m = boot(); m.back(); await tick(40); m.S.tab = 'stok'; m.ctx.render(); m.back(); await tick(40);
  ok(m.S.tab === 'dash' && m.hist.exitTries === 0, 'Back yang menutup tab tidak dihitung sebagai tekan kedua untuk keluar');

  m = boot(); m.S.tab = 'stok'; m.ctx.render(); m.sheet.hidden = false; m.navSync(); ok(m.NAV.depth === 3, 'sheet di atas tab: 3 entri (penjaga + tab + sheet)');
  m.back(); await tick(); ok(m.sheet.hidden === true && m.S.tab === 'stok' && m.NAV.depth === 2 && m.toasts.length === 0, 'Back menutup sheet dulu, tab tetap');
  m.sheet.hidden = false; m.navSync(); m.sheet.hidden = true; m.navSync(); await tick(40);
  ok(m.NAV.depth === 2 && m.hist.i === 2, 'sheet ditutup lewat kode: entri dilepas (history.go), kembali sinkron');
  m.sheet.hidden = false; m.navSync(); m.sheet.hidden = true; m.navSync(); m.sheet.hidden = false; m.navSync(); await tick(40);
  ok(m.NAV.depth === 3 && m.hist.i === 3, 'tutup lalu buka lagi di putaran yang sama: entri tidak dibuang dan dibuat ulang');
  m.sheet.hidden = true; m.navSync(); await tick(40);

  m = boot(); m.S.tab = 'stok'; m.ctx.render(); m.sheet.hidden = false; m.navSync(); m.S.busyOn = true; m.back(); await tick(40);
  ok(m.sheet.hidden === false && m.NAV.depth === 3 && m.toasts.length === 0, 'Back saat menyimpan diabaikan dan entri dipasang kembali');

  m = boot({dirty: true}); m.sheet.hidden = false; m.navSync(); m.back(); await tick(40);
  ok(m.S.cfmOpen && m.sheet.hidden === false && m.NAV.depth === 3, 'sheet berisi isian: Back memunculkan konfirmasi (3 entri: penjaga + sheet + dialog)');

  m = boot(); m.S.tab = 'stok'; m.ctx.render(); m.S.token = null; m.navSync(); await tick(40);
  ok(m.NAV.depth === 1, 'keluar akun: entri tab dilepas, penjaga tetap');

  // entri sisa dari sesi sebelumnya (satu dokumen) tidak menahan keluar
  m = boot(); m.hist.stack.unshift({dsp: 9}, {dsp: 8}); m.hist.i += 2;
  m.back(); await tick(40); m.back(); await tick(60);
  ok(m.hist.exitTries === 1, 'entri sisa sesi lama dilewati saat keluar, sampai benar-benar habis');
  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.log('GAGAL: ' + (e && e.stack || e)); process.exit(1); });
