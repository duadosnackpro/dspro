// Uji logika sinkronisasi klien v2.6.9 (src/app/02-api-sinkron.js) di sandbox vm: ops_ver pada verSync/dverKey, penyelarasan setelah tulis sendiri (opsSoon),
// toast hanya untuk perubahan perangkat lain, cache layar (vload) tidak dipakai setelah ops_ver berubah, dan kompatibilitas server lama.
const fs = require('fs'), vm = require('vm'), path = require('path');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('GAGAL: ' + m); } };
const full = fs.readFileSync(path.join(__dirname, '../src/app/02-api-sinkron.js'), 'utf8');
const code = full.slice(0, full.indexOf('let flushing = false'));   // bagian API + verSync + vload + Realtime + checkUpdates (tanpa antrean offline)

function make() {
  const sv = {cat: 'c1', stock: 's1', ops: '1', stamp: true, legacy: false, calls: []};
  const timers = []; let tid = 0, clock = 100000;
  const toasts = [], rc = {render: 0, grid: 0, stokList: 0};
  const S = {token: 't', queue: [], tab: 'dash', cat: 'Semua', dirty: false, data: null, rt: 'off'};
  const bootBody = () => ({cat_ver: sv.cat, stock_ver: sv.stock, ver: sv.cat + '~' + sv.stock, products: [], variants: [], outlet: {id: 'o1'}, user: {uid: 'u1'},
    ops_ver: sv.stamp ? sv.ops : undefined});
  const call = async (action, payload) => {
    sv.calls.push(action);
    if (action === 'ping') return sv.legacy ? {cat_ver: sv.cat, stock_ver: sv.stock, ver: sv.cat + '~' + sv.stock} : {cat_ver: sv.cat, stock_ver: sv.stock, ver: sv.cat + '~' + sv.stock, ops_ver: sv.ops};
    if (action === 'bootstrap') return bootBody();
    if (action === 'stock.get') return {stok: {}, stock_ver: sv.stock, ver: sv.cat + '~' + sv.stock};
    if (action === 'shift.list') return [{n: sv.ops}];
    return {ok: true};
  };
  const el = () => ({hidden: true, innerHTML: '', classList: {toggle() {}}, textContent: ''});
  const store = {};
  const ctx = {
    S, C: {}, window: {SBAPI: {enabled: () => true, call, realtime: null}}, document: {body: {classList: {toggle() {}}}, hidden: false}, navigator: {onLine: true},
    LS: {get: (k, d) => k in store ? store[k] : d, set: (k, v) => { store[k] = v; }, del: k => { delete store[k]; }},
    $: () => el(), toast: m => toasts.push(m), render: () => { rc.render++; }, grid: () => { rc.grid++; }, syncCart: () => {}, stokList: () => { rc.stokList++; }, own: () => false,
    today: () => '2026-11-05', badge() {}, bootOnce() {}, fotoWarm() {}, remoteLog() {}, renderLogin() {}, notifyConflicts() {}, refreshRc() {}, vById: () => null,
    setTimeout: (f, ms) => { const id = ++tid; timers.push({id, f, ms}); return id; }, clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    Date: {now: () => clock}, JSON, Object, Promise, Error, String, Number, Math, Array, console
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const ev = s => vm.runInContext(s, ctx);
  return {S, sv, ctx, ev, timers, toasts, rc, store, setClock: t => { clock = t; }, advance: t => { clock += t; }, fire: async () => { const ts = timers.splice(0); for (const t of ts) await t.f(); }};
}
const opsT = m => m.timers.filter(t => t.ms === 500).length;   // timer penyelarasan milik opsSoon (loadData juga menjadwalkan fotoWarm 1500 ms)
const nCalls = (m, a) => m.sv.calls.filter(c => c === a).length;

(async () => {
  // ---- dverKey ----
  let m = make(); m.S.data = {cat_ver: 'c1', stock_ver: 's1', ops_ver: '1'};
  ok(m.ev('dverKey()') === 'c1~s1~1', 'dverKey memuat ops_ver: ' + m.ev('dverKey()'));
  m.S.data = {cat_ver: 'c1', stock_ver: 's1'};
  ok(m.ev('dverKey()') === 'c1~s1', 'dverKey tanpa ops_ver (data dari server lama) = format lama');
  m.S.data = {ver: 'legacy'}; ok(m.ev('dverKey()') === 'legacy', 'dverKey format legacy tidak berubah');

  // ---- verSync: tidak ada perubahan ----
  m = make(); await m.ev('loadData()');
  ok(m.S.data.ops_ver === '1', 'loadData menyimpan ops_ver dari bootstrap');
  let n0 = nCalls(m, 'bootstrap');
  ok(await m.ev('verSync(0)') === '', 'versi sama => sudah terbaru');
  ok(nCalls(m, 'bootstrap') === n0, 'versi sama => tidak memuat ulang');

  // ---- ops_ver berubah (perangkat lain mengubah resep/bahan/retur) ----
  m.sv.ops = '2'; m.S.rhist = {uid: 'u1', d: {x: 1}}; m.S.expLoaded = true; m.ev("VC['k'] = {k: 'lama', v: 1}");
  ok(await m.ev('verSync(0)') === 'cat', 'ops_ver berubah => memuat ulang (cat)');
  ok(nCalls(m, 'bootstrap') === n0 + 1, 'ops_ver berubah => tepat satu bootstrap');
  ok(m.S.data.ops_ver === '2', 'ops_ver baru tersimpan di data');
  ok(m.S.rhist === null && m.S.expLoaded === false && m.ev('Object.keys(VC).length') === 0, 'cache Riwayat, Biaya, dan layar (VC) dikosongkan');
  n0 = nCalls(m, 'bootstrap');
  ok(await m.ev('verSync(0)') === '' && nCalls(m, 'bootstrap') === n0, 'sesudah selaras: ping berikutnya tidak memuat ulang');

  // ---- bootstrap tanpa stempel (ping gagal saat bootstrap): tidak memuat ulang terus-menerus ----
  m.sv.stamp = false; m.sv.ops = '3';
  ok(await m.ev('verSync(0)') === 'cat', 'ops_ver berubah (bootstrap tanpa stempel) => memuat ulang sekali');
  ok(m.S.data.ops_ver === '3', 'stempel diambil dari ping bila bootstrap tidak membawa');
  n0 = nCalls(m, 'bootstrap');
  ok(await m.ev('verSync(0)') === '' && nCalls(m, 'bootstrap') === n0, 'tanpa stempel dari bootstrap: tidak ada lingkaran muat ulang');
  m.sv.stamp = true;

  // ---- server lama: ping tanpa ops_ver ----
  m = make(); await m.ev('loadData()'); m.sv.legacy = true; m.sv.stamp = false; m.sv.ops = '99';
  m.S.data.ops_ver = undefined; n0 = nCalls(m, 'bootstrap');
  ok(await m.ev('verSync(0)') === '' && nCalls(m, 'bootstrap') === n0, 'server lama (tanpa ops_ver): ops diabaikan, tidak memuat ulang');

  // ---- perubahan stok saja tetap jalur ringan; katalog tetap muat penuh ----
  m = make(); await m.ev('loadData()'); n0 = nCalls(m, 'bootstrap'); m.sv.stock = 's2';
  ok(await m.ev('verSync(0)') === 'stock' && nCalls(m, 'stock.get') === 1 && nCalls(m, 'bootstrap') === n0, 'hanya stock_ver berubah => peta stok kecil, tanpa bootstrap');
  m.sv.cat = 'c2'; ok(await m.ev('verSync(0)') === 'cat' && nCalls(m, 'bootstrap') === n0 + 1, 'cat_ver berubah => muat penuh');

  // ---- api(): tulis data operasional menjadwalkan penyelarasan; baca dan penjualan biasa tidak ----
  m = make(); await m.ev('loadData()');
  await m.ev("api('sales.list', {})"); await m.ev("api('sale.create', {})"); await m.ev("api('report.get', {})"); await m.ev("api('shift.list', {})"); await m.ev("api('master.list', {})");
  ok(opsT(m) === 0, 'aksi baca dan penjualan biasa tidak menjadwalkan penyelarasan (kasir ramai tidak membebani)');
  const writes = ['sale.return', 'recipe.save', 'recipe.copy', 'master.save', 'master.remove', 'stock.adjust', 'purchase.create', 'purchase.cancel', 'production.create',
    'production.record', 'production.update', 'production.complete', 'production.cancel', 'transfer.create', 'transfer.action', 'expense.void', 'cash.move', 'shift.close', 'shift.reopen', 'shift.approve', 'data.reset', 'sale.review'];
  for (const a of writes) { m = make(); await m.ev('loadData()'); await m.ev("api('" + a + "', {})"); ok(opsT(m) === 1, a + ' menjadwalkan penyelarasan'); }
  m = make(); await m.ev('loadData()'); await m.ev("api('recipe.save', {})"); await m.ev("api('stock.adjust', {})"); await m.ev("api('purchase.create', {})");
  ok(opsT(m) === 1, 'beberapa tulisan beruntun digabung menjadi satu penyelarasan');

  // ---- selaras sendiri: tulis => ops_ver naik => penyelarasan memuat ulang diam-diam dan menggambar ulang ----
  m = make(); await m.ev('loadData()'); const r0 = m.rc.render;
  await m.ev("api('recipe.save', {})"); m.sv.ops = '5';
  await m.fire();
  ok(m.S.data.ops_ver === '5', 'selaras setelah tulis sendiri: ops_ver terbaru');
  ok(m.toasts.length === 0, 'tidak ada toast untuk perubahan dari tulisan sendiri');
  ok(m.rc.render === r0 + 1, 'layar digambar ulang dengan data terbaru');
  n0 = nCalls(m, 'bootstrap'); m.advance(1000);
  ok(await m.ev('checkUpdates(true)') === undefined && nCalls(m, 'bootstrap') === n0, 'sinyal Realtime yang menyusul tidak memuat ulang lagi (sudah selaras)');

  // ---- toast: perubahan dari perangkat lain diberitahukan; dari tulisan sendiri (<= 3 dtk) tidak ----
  m = make(); await m.ev('loadData()'); m.advance(10000);
  m.sv.ops = '6'; await m.ev('checkUpdates(true)');
  ok(m.toasts.length === 1 && /Data terbaru dimuat/.test(m.toasts[0]), 'perubahan dari perangkat lain => toast "Data terbaru dimuat"');
  m = make(); await m.ev('loadData()'); await m.ev("api('purchase.create', {})"); m.advance(1000); m.sv.ops = '7';
  await m.ev('checkUpdates(true)');
  ok(m.toasts.length === 0, 'sinyal 1 dtk setelah tulis sendiri => tanpa toast');
  m = make(); await m.ev('loadData()'); await m.ev("api('purchase.create', {})"); m.advance(5000); m.sv.ops = '8';
  await m.ev('checkUpdates(true)');
  ok(m.toasts.length === 1, 'perubahan dari perangkat lain 5 dtk sesudah tulisan sendiri tetap diberitahukan');

  // ---- cache layar (vload) tidak dipakai setelah ops_ver berubah ----
  m = make(); await m.ev('loadData()'); m.ctx.__p = [];
  const vl = () => m.ev("vload('shift.list', {}, (v, c) => globalThis.__p.push([v, c]))");
  const shiftCalls = () => nCalls(m, 'shift.list');
  await vl();
  ok(shiftCalls() === 1, 'vload pertama memanggil server');
  m.advance(20000); await vl();
  ok(shiftCalls() === 1, 'vload kedua (versi sama) memakai cache, tanpa panggilan server');
  m.advance(20000); m.sv.ops = '9'; await vl();
  ok(shiftCalls() === 2, 'ops_ver berubah => cache layar tidak dipakai, data diambil ulang');
  const lastP = m.ctx.__p[m.ctx.__p.length - 1];
  ok(JSON.stringify(lastP[0]) === '[{"n":"9"}]' && lastP[1] === false, 'layar menerima data baru, bukan cache lama: ' + JSON.stringify(lastP));

  // ---- tabel pembantu: format OPS_W tidak menyentuh aksi baca ----
  ok(!m.ev('OPS_W').test('sales.list') && !m.ev('OPS_W').test('production.list') && !m.ev('OPS_W').test('purchase.list') && !m.ev('OPS_W').test('purchase.last'), 'OPS_W tidak cocok dengan aksi baca');

  console.log(fail ? 'GAGAL: ' + fail + ' dari ' + (pass + fail) : 'Semua lulus (' + pass + ' pemeriksaan)'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
