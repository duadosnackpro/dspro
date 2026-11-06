// Tes v2.6.13 tanpa browser dan tanpa dependensi:
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
  o = o || {};
  const hist = {stack: [null], i: 0, pops: 0, pushes: 0}, handlers = [];
  const history = {get state() { return hist.stack[hist.i]; }, pushState(s) { hist.stack.length = hist.i + 1; hist.stack.push(s); hist.i++; hist.pushes++; }, replaceState(s) { hist.stack[hist.i] = s; },
    go(d) { setTimeout(() => { hist.i = Math.max(0, Math.min(hist.stack.length - 1, hist.i + d)); handlers.forEach(h => h()); }, 0); }};
  const S = {token: 't', data: {}, tab: 'dash', cfmOpen: false, busyOn: false, dirty: false}, sheet = {hidden: true};
  const log = [], ctx = {window: {history, addEventListener: (t, h) => { if (t === 'popstate') handlers.push(h); }}, history: history, S: S, $: s => s === '#sheet' ? sheet : null,
    homeTab: () => 'dash', tabAllowed: () => true, render: () => { log.push('render:' + S.tab); ctx.__navTrack(); ctx.__navSync(); },
    requestCloseSheet: async () => { if (S.busyOn) return; if (o.dirty) { S.cfmOpen = true; ctx.__navSync(); return; } sheet.hidden = true; ctx.__navSync(); },
    confirmBox: async () => true, setTimeout: setTimeout, clearTimeout: clearTimeout};
  const f = new Function('ctx', 'with (ctx) {\n' + rd('src/app/015-navigasi.js') + '\nctx.__navSync = navSync; ctx.__navTrack = navTrack; return {NAV, navSync, navTrack};\n}');
  const api = f(ctx); return Object.assign({S, sheet, hist, ctx, log, back: () => history.go(-1)}, api);
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));
(async () => {
  let m = boot(); ok(m.hist.pushes === 0, 'awal: tidak ada entri');
  m.S.tab = 'stok'; m.ctx.render(); ok(m.hist.pushes === 1 && m.NAV.depth === 1, 'tab selain beranda: 1 entri');
  m.S.tab = 'menu'; m.ctx.render(); ok(m.hist.pushes === 1, 'pindah antar tab non-beranda tidak menambah entri');
  m.back(); await tick(); ok(m.S.tab === 'stok' && m.NAV.depth === 1, 'Back: ke tab sebelumnya (Stok), entri tetap 1');
  m.back(); await tick(); ok(m.S.tab === 'dash' && m.NAV.depth === 0, 'Back lagi: ke beranda, tanpa bolak-balik');
  m.back(); await tick(); ok(m.S.tab === 'dash', 'Back di beranda: tidak melakukan apa-apa (aplikasi yang keluar)');

  m = boot(); m.S.tab = 'stok'; m.ctx.render(); m.sheet.hidden = false; m.navSync(); ok(m.NAV.depth === 2, 'sheet di atas tab: 2 entri');
  m.back(); await tick(); ok(m.sheet.hidden === true && m.S.tab === 'stok' && m.NAV.depth === 1, 'Back menutup sheet dulu, tab tetap');
  m.sheet.hidden = false; m.navSync(); m.sheet.hidden = true; m.navSync(); await tick(40);
  ok(m.NAV.depth === 1 && m.hist.i === 1, 'sheet ditutup lewat kode: entri dilepas (history.go), kembali sinkron');
  m.sheet.hidden = false; m.navSync(); m.sheet.hidden = true; m.navSync(); m.sheet.hidden = false; m.navSync(); await tick(40);
  ok(m.NAV.depth === 2 && m.hist.i === 2, 'tutup lalu buka lagi di putaran yang sama: entri tidak dibuang dan dibuat ulang');
  m.sheet.hidden = true; m.navSync(); await tick(40);

  m = boot(); m.S.tab = 'stok'; m.ctx.render(); m.sheet.hidden = false; m.navSync(); m.S.busyOn = true; m.back(); await tick(40);
  ok(m.sheet.hidden === false && m.NAV.depth === 2, 'Back saat menyimpan diabaikan dan entri dipasang kembali');

  m = boot({dirty: true}); m.sheet.hidden = false; m.navSync(); m.back(); await tick(40);
  ok(m.S.cfmOpen && m.sheet.hidden === false && m.NAV.depth === 2, 'sheet berisi isian: Back memunculkan konfirmasi (2 entri: sheet + dialog)');

  m = boot(); m.S.tab = 'stok'; m.ctx.render(); m.S.token = null; m.navSync(); await tick(40);
  ok(m.NAV.depth === 0, 'keluar akun: entri tab dilepas');
  console.log('Semua lulus (' + n + ' pemeriksaan)');
})().catch(e => { console.log('GAGAL: ' + (e && e.stack || e)); process.exit(1); });
