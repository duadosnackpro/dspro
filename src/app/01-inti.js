/* Duado Snack POS - frontend local-first. Sumber ada di src/app/*.js; tools/build.js menyambungnya menjadi web/js/app.js (jangan mengedit hasil bangun). Data master disimpan di perangkat; transaksi masuk antrean lalu disinkronkan. */
(function () {
'use strict';
const C = window.CONFIG || /** @type {Window['CONFIG']} */ ({});
const $ = s => document.querySelector(s);
const rp = n => 'Rp\u00a0' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = n => Math.round(Number(n) || 0).toLocaleString('id-ID');
/* angka dari keyboard Indonesia: "0,5" = 0.5; "1.250" = 1250; "1.250,5" = 1250.5; "0.125" = 0.125 */
function dnum(s) {
  if (typeof s === 'number') return s; s = String(s == null ? '' : s).trim().replace(/\s/g, ''); if (!s) return NaN;
  s = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) && !/^0\./.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'); return Number(s);
}
/* kolom uang bilangan bulat: tampil dengan pemisah ribuan (100.000) selagi mengetik; nilai tetap terbaca oleh dnum() dan pembersih \D */
const rpIn = v => { const d = String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=\d)/, ''); return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const qf = n => (Math.round(Number(n) * 1000) / 1000).toLocaleString('id-ID', {maximumFractionDigits: 3});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Nilai tampilan yang dihitung saat jalan (lebar/tinggi batang, lebar logo dan QR) tidak boleh memakai atribut style karena CSP tidak lagi mengizinkannya (style-src-attr dicabut).
   Markup menuliskannya di data-dw (lebar) atau data-dh (tinggi) berupa persen, mis. "42%"; dynStyle() memasangnya lewat CSSOM, yang tidak dibatasi CSP.
   Dipanggil oleh MutationObserver di 14-mulai.js untuk setiap simpul baru, sehingga innerHTML di mana pun otomatis tertangani sebelum layar digambar. */
const DYN_PCT = /^\d+(\.\d+)?%$/;
function dynStyle(root) {
  if (!root || root.nodeType !== 1) return;
  const set = el => { const w = el.getAttribute('data-dw'), h = el.getAttribute('data-dh'); if (w != null && DYN_PCT.test(w)) el.style.width = w; if (h != null && DYN_PCT.test(h)) el.style.height = h; };
  set(root); root.querySelectorAll('[data-dw],[data-dh]').forEach(set);
}
/* Penyimpanan lokal: IndexedDB (kapasitas besar, tidak memblokir layar) dengan cermin di memori agar pembacaan tetap sinkron.
   Cadangan ke localStorage bila IndexedDB tidak tersedia. Data lama di localStorage dimigrasi sekali. Kunci penting (antrean, keranjang) ditulis seketika; token sesi sengaja tidak dijurnal ke localStorage. */
const Store = (() => {
  const mem = {}, dirty = {}, CRIT = ['queue', 'cart', 'hideOut', 'metode', 'ch']   /* P1-4: 'token' TIDAK dijurnal ke localStorage (cukup ditulis ke IndexedDB; sesi dipulihkan lewat refresh token) */; let db = null, idb = false, timer = null, writing = Promise.resolve();
  const journal = (k, o) => { try { localStorage.setItem('j:' + k, JSON.stringify(o)); } catch (e) {} }; // jurnal sinkron: selamat walau halaman ditutup sebelum IndexedDB selesai menulis
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('duado', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
  const readAll = () => new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').openCursor(); q.onsuccess = () => { const c = q.result; if (c) { mem[c.key] = c.value; c.continue(); } else res(); }; q.onerror = () => rej(q.error); });
  function flushNow() {
    clearTimeout(timer); const keys = Object.keys(dirty); if (!idb || !keys.length) return writing;
    const batch = keys.map(k => [k, dirty[k]]); keys.forEach(k => delete dirty[k]);
    writing = writing.then(() => new Promise(res => {
      const undo = () => { batch.forEach(([k, op]) => { if (!(k in dirty)) dirty[k] = op; }); res(); };
      try { const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'); batch.forEach(([k, op]) => { if (op === 2) st.delete(k); else st.put(mem[k], k); }); tx.oncomplete = () => { batch.forEach(([k]) => { if (!(k in dirty)) { try { localStorage.removeItem('j:' + k); } catch (e) {} } }); res(); }; tx.onerror = tx.onabort = undo; } catch (e) { undo(); }
    }));
    return writing;
  }
  async function init() {
    try { if (window.indexedDB) { db = await open(); await readAll(); idb = true; } } catch (e) { idb = false; }
    try { // terapkan jurnal yang belum sempat masuk IndexedDB (mis. aplikasi ditutup tepat setelah transaksi)
      if (idb) Object.keys(localStorage).filter(k => k.indexOf('j:') === 0).forEach(jk => { const k = jk.slice(2); try { const o = JSON.parse(localStorage.getItem(jk)); if (o && o.x) { delete mem[k]; dirty[k] = 2; } else if (o && 'v' in o) { mem[k] = o.v; dirty[k] = 1; } } catch (e) {} });
      if (idb && Object.keys(dirty).length) await flushNow();
    } catch (e) {}
    try {
      const moved = []; Object.keys(localStorage).forEach(k => { if (k.indexOf('j:') !== 0 && !(k in mem)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v != null) { mem[k] = v; if (idb) dirty[k] = 1; moved.push(k); } } catch (e) {} } });
      if (idb && moved.length) { await flushNow(); if (!Object.keys(dirty).length) moved.forEach(k => localStorage.removeItem(k)); } // hapus salinan lama hanya setelah berhasil tertulis
    } catch (e) {}
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} // minta agar data tidak dibersihkan otomatis oleh browser
  }
  return {
    init: init, flush: flushNow, mode: () => idb ? 'IndexedDB' : 'localStorage',
    get: (k, d) => mem[k] == null ? d : mem[k],
    set: (k, v, now) => { mem[k] = v; if (idb) { if (CRIT.indexOf(k) >= 0) journal(k, {v: v}); dirty[k] = 1; if (now) flushNow(); else { clearTimeout(timer); timer = setTimeout(flushNow, 400); } } else { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Penyimpanan perangkat penuh'); } } },
    del: k => { delete mem[k]; if (idb) { if (CRIT.indexOf(k) >= 0) journal(k, {x: 1}); dirty[k] = 2; if (CRIT.indexOf(k) >= 0) flushNow(); else { clearTimeout(timer); timer = setTimeout(flushNow, 400); } } else { try { localStorage.removeItem(k); } catch (e) {} } }
  };
})();
const devId = () => { let d = LS.get('dev', ''); if (!/^[0-9a-f]{32}$/.test(d)) { const a = new Uint8Array(16); (window.crypto && window.crypto.getRandomValues) ? window.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }); d = Array.from(a, b => ('0' + b.toString(16)).slice(-2)).join(''); LS.set('dev', d); } return d; }; // id perangkat untuk penguncian login (server hanya menyimpan hash-nya)
const LS = {get: Store.get, set: (k, v) => Store.set(k, v, ['queue', 'cart', 'token', 'hideOut', 'metode', 'ch'].indexOf(k) >= 0), del: Store.del};
const T = v => String(v).toUpperCase() === 'TRUE';
const APP = window.APP = /** @type {any} */ ({views: {}});
const S = {token: null, data: null, queue: [], tab: 'kasir', ch: null, cat: 'Semua', q: '',
  cart: [], diskon: '', metode: 'tunai', terima: '', catatan: '', nomor: {}, mt: 'products', stab: 'varian', day: null, pb: {items: [], ongkir: '', sup: '', rid: '', mode: 'sat'}, pbLast: null, adj: null, rc: null,
  sq: '', scat: 'Semua', hideOut: false, dirty: false, sheetDirty: false, sheetTtl: '', cfmOpen: false, rcustom: false, installEv: null, opt: null, pus: null, pgid: ''};
/* P0-1: peran asli dari server dipakai apa adanya. Tampilan ditentukan oleh kemampuan (can), bukan oleh pemetaan peran ke 'owner'/'kasir'.
   Penegakan hak tetap di server (RLS/RPC); daftar ini hanya memilih layar. */
const ROLES = [['owner', 'Owner'], ['admin', 'Admin'], ['supervisor', 'Supervisor'], ['kasir', 'Kasir'], ['stok', 'Stok'], ['produksi', 'Produksi'], ['auditor', 'Auditor']];
/* F: penjelasan singkat hak tiap peran. Disusun dari aturan di server (supabase/migrations: require_role) dan CAPS di bawah; DRAF, mohon dikoreksi sesuai kebijakan usaha. */
const ROLE_INFO = {
  owner: 'Akses penuh: semua outlet, laporan, harga pokok, pengaturan, dan pengguna.',
  admin: 'Mengelola data, pengaturan, dan pengguna (kecuali Owner dan Admin lain). Melihat laporan dan harga pokok.',
  supervisor: 'Setujui diskon dan retur, mengelola stok dan produksi di outletnya. Tidak mengelola pengguna.',
  kasir: 'Menjual dan melihat transaksinya sendiri. Diskon besar dan retur perlu persetujuan.',
  stok: 'Mengelola stok, pembelian bahan, dan perpindahan stok. Tidak menjual.',
  produksi: 'Mencatat dan menyelesaikan produksi di dapur. Tidak menjual.',
  auditor: 'Hanya melihat transaksi, laporan, dan harga pokok. Tidak mengubah data.'
};
const roleName = r => { const x = ROLES.find(y => y[0] === r); return x ? x[1] : String(r || ''); };
/* F7: kapabilitas = cerminan matriks require_role di server (supabase/migrations). Layar mengikuti kapabilitas, bukan hanya own(). */
const CAPS = {manage: ['owner', 'admin'], users: ['owner', 'admin'], takeover: ['owner'], approve: ['owner', 'admin', 'supervisor'],
  sell: ['owner', 'admin', 'supervisor', 'kasir'], history: ['owner', 'admin', 'supervisor', 'kasir', 'auditor'], dash: ['owner', 'admin', 'auditor'],
  stockedit: ['owner', 'admin', 'supervisor', 'stok'], materials: ['owner', 'admin', 'supervisor', 'stok', 'produksi'], produce: ['owner', 'admin', 'supervisor', 'produksi'],
  transfer: ['owner', 'admin', 'supervisor', 'stok'], report: ['owner', 'admin', 'supervisor', 'auditor'], cost: ['owner', 'admin', 'auditor']};
const ASSIGNABLE = {owner: ROLES.map(r => r[0]), admin: ['supervisor', 'kasir', 'stok', 'produksi']};   // sama dengan aturan Edge Function admin-users dan rpc_membership_set
const can = (cap, role) => { const r = role || (S.data && S.data.user && S.data.user.role); return !!r && (CAPS[cap] || []).indexOf(r) >= 0; };
const own = () => can('manage');
/* Pembantu bertipe longgar (hindari galat tipe DOM baru di ratchet): nilai input berdasarkan id, dan dataset elemen. */
const vOf = id => { const e = /** @type {any} */ (document.getElementById(id)); return e ? String(e.value || '') : ''; };
const dsOf = el => /** @type {any} */ (el).dataset;
const TAB_CAP = {reset: 'takeover', dash: 'dash', kasir: 'sell', tutup: 'sell', riwayat: 'history', produksi: 'produce', laporan: 'report', transfer: 'transfer'};
const OWN_TABS = ['master', 'users', 'settings', 'resep', 'shopee', 'cek', 'outlets'];
const tabAllowed = t => OWN_TABS.indexOf(t) >= 0 ? own() : TAB_CAP[t] ? can(TAB_CAP[t]) : true;
const homeTab = () => ['dash', 'kasir', 'riwayat', 'stok'].filter(tabAllowed)[0] || 'menu';
/* v1.9.9: indeks Map (O(1)) menggantikan pencarian linear. Dibangun malas dan dibuang bila larik data diganti atau berubah panjang; perubahan di tempat (patchMaster) memanggil idxReset(). */
let IDX = null;
function idxReset() { IDX = null; }
function idx() {
  const d = S.data; if (IDX && IDX.d === d && IDX.v === d.variants && IDX.nv === d.variants.length && IDX.p === d.products && IDX.np === d.products.length && IDX.pr === d.prices && IDX.npr === d.prices.length && IDX.c === d.channels && IDX.nc === d.channels.length) return IDX;
  const v = new Map(), p = new Map(), pr = new Map(), c = new Map();
  d.variants.forEach(x => { if (!v.has(x.id)) v.set(x.id, x); }); d.products.forEach(x => { if (!p.has(x.id)) p.set(x.id, x); });
  d.prices.forEach(x => { const k = x.variant_id + '|' + x.channel_id; if (!pr.has(k)) pr.set(k, x); }); d.channels.forEach(x => { if (!c.has(x.id)) c.set(x.id, x); });
  return IDX = {d: d, v: d.variants, nv: d.variants.length, p: d.products, np: d.products.length, pr: d.prices, npr: d.prices.length, c: d.channels, nc: d.channels.length, mv: v, mp: p, mpr: pr, mc: c};
}
const vById = id => idx().mv.get(id);
const pById = id => idx().mp.get(id);
const vName = v => { const p = pById(v.product_id); return p ? p.nama : '(produk dihapus)'; };
const lvl = x => /^\d+$/.test(String(x).trim()) ? 'Level ' + String(x).trim() : x;
const vSub = v => [v.ukuran, v.level_pedas === '' || v.level_pedas == null ? '' : lvl(v.level_pedas)].filter(x => x !== '' && x != null).join(' · ');
const r6 = x => Math.round(Number(x) * 1e6) / 1e6;
const newReqId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2);   // request_id: sama selama isian tidak berubah (kirim ulang aman), baru bila isian berubah
const priceOf = (vid, ch) => { const x = idx().mpr.get(vid + '|' + ch); return x ? Number(x.harga_jual) : null; };
const chName = id => { const c = idx().mc.get(id); return c ? c.nama : '-'; };
const p2 = n => ('0' + n).slice(-2);
const fmtDT = d => { d = new Date(d); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const today = () => fmtDT(new Date()).slice(0, 10);
/* Daftar bertahap (v1.9.8): DOM hanya memuat sebagian baris; sisanya muncul saat digulir mendekati ujung (IntersectionObserver) atau lewat tombol. Mencegah layar macet pada >100 baris.
   LIM menyimpan jumlah baris yang sedang ditampilkan per daftar; bertambah satu halaman tiap kali, dan di-reset pemanggil saat filter/hari berganti. */
const PGN = {grid: 60, cart: 40, hist: 50, q: 30}, LIM = {}; let moreIO = null;
const lim = k => LIM[k] || PGN[k];
function moreBtn(k, total) { const n = total - lim(k); return n > 0 ? '<button class="btn sec lmore" data-act="more" data-k="' + k + '">Tampilkan ' + Math.min(n, PGN[k]) + ' lagi (sisa ' + n + ')</button>' : ''; }
function watchMore() {
  if (moreIO) { moreIO.disconnect(); moreIO = null; }
  const els = document.querySelectorAll('.lmore'); if (!els.length || !window.IntersectionObserver) return; // tanpa IntersectionObserver tombol tetap bisa diketuk
  moreIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.target.isConnected) { moreIO.unobserve(e.target); /** @type {HTMLElement} */ (e.target).click(); } }), {rootMargin: '300px'});
  els.forEach(e => moreIO.observe(e));
}
/* v2.6.13: lama toast mengikuti panjang pesan (dulu tetap 2,6 dtk sehingga pesan panjang hilang sebelum selesai dibaca): dasar 1,8 dtk + 55 ms per huruf, 2,6 sampai 10 dtk. */
const toastMs = s => Math.min(10000, Math.max(2600, 1800 + String(s).length * 55));
function toast(m) { const t = $('#toast'), s = String(m == null ? '' : m); t.textContent = s; t.className = 'show'; const tt = /** @type {any} */ (toast); clearTimeout(tt.t); tt.t = setTimeout(() => t.className = '', toastMs(s)); }
/* v2.6.13: galat validasi tampil DI BAWAH kolomnya (role=alert, tidak hilang sendiri), kolom diberi aria-invalid + aria-describedby dan langsung difokuskan.
   Hilang begitu kolom diubah. Target tidak ketemu (mis. layar sudah berganti) = jatuh ke toast, jadi pesan tidak pernah hilang tanpa terbaca. Selalu mengembalikan undefined supaya `return fieldErr(...)` tetap sama seperti `return toast(...)`. */
let ferrN = 0;
function fieldClear(/** @type {any} */ el) {
  if (!el || !el.getAttribute) return; el.removeAttribute('aria-invalid');
  const id = el.getAttribute('data-ferr'); if (!id) return; el.removeAttribute('data-ferr');
  const box = document.getElementById(id); if (box) box.remove();
  const rest = String(el.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== id).join(' ');
  if (rest) el.setAttribute('aria-describedby', rest); else el.removeAttribute('aria-describedby');
}
function fieldErr(/** @type {any} */ target, /** @type {string} */ msg) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el || !el.isConnected || !el.insertAdjacentElement) { toast(msg); return; }
  fieldClear(el);
  const id = 'ferr' + (++ferrN), box = document.createElement('div');
  box.id = id; box.className = 'ferr'; box.setAttribute('role', 'alert'); box.textContent = msg;
  (el.closest && el.closest('label') || el).insertAdjacentElement('afterend', box);
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('aria-invalid', 'true');
  el.setAttribute('data-ferr', id); el.setAttribute('aria-describedby', (String(el.getAttribute('aria-describedby') || '') + ' ' + id).trim());
  try { el.focus(); if (el.scrollIntoView) el.scrollIntoView({block: 'center'}); } catch (e) { /* fokus tidak wajib */ }
}
['input', 'change'].forEach(ev => document.addEventListener(ev, e => { const t = /** @type {any} */ (e.target); if (t && t.getAttribute && t.getAttribute('data-ferr')) fieldClear(t); }, true));
/* A: selama sheet terbuka, halaman di belakangnya tidak boleh terbaca pembaca layar maupun terjangkau Tab/ketuk (inert + aria-hidden). */
function bgInert(on) { ['app', 'upd'].forEach(id => { const e = document.getElementById(id); if (!e) return; if (on) { e.setAttribute('inert', ''); e.setAttribute('aria-hidden', 'true'); } else { e.removeAttribute('inert'); e.removeAttribute('aria-hidden'); } }); }
function sheet(html) {
  const b = $('#sheet'), opening = b.hidden; if (opening) { S.sheetFrom = document.activeElement; bgInert(true); }
  b.innerHTML = '<div class="sheet-bg" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div>'; b.hidden = false; navSync();
  const d = /** @type {HTMLElement|null} */ (b.querySelector('.sheet')), h = d && d.querySelector('h2');
  if (!d) return;
  { const ttl = h ? h.textContent || '' : ''; if (opening || ttl !== S.sheetTtl) S.sheetDirty = false; S.sheetTtl = ttl; } // re-render dialog yang sama (mis. tambah bahan di resep) tidak menghapus tanda "belum disimpan"
  if (h) { h.id = 'sheet-h'; d.setAttribute('aria-labelledby', 'sheet-h'); } else d.setAttribute('aria-label', 'Dialog'); // nama dialog = judulnya, bukan kata generik
  if (!opening) { d.style.animation = 'none'; const bg = /** @type {HTMLElement|null} */ (b.querySelector('.sheet-bg')); if (bg) bg.style.animation = 'none'; } // isi diperbarui (tambah/hapus bahan): jangan putar ulang animasi naik dari bawah
  if (opening) d.focus({preventScroll: true}); // fokus masuk ke dialog (wadah, bukan kolom isian: keyboard layar tidak muncul sendiri)
}
/* Tab tetap berputar di dalam dialog yang terbuka (aria-modal): tanpa ini Tab keluar ke halaman di belakang sheet. */
function trapTab(/** @type {KeyboardEvent} */ e) {
  const b = $('#sheet'); if (!b || b.hidden || S.busyOn) return;
  const d = /** @type {HTMLElement|null} */ (b.querySelector('.sheet')); if (!d) return;
  const f = /** @type {HTMLElement[]} */ (Array.from(d.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))).filter(x => x.offsetParent !== null);
  if (!f.length) { e.preventDefault(); d.focus(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!a || !d.contains(a) || a === d) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}
function closeSheet() { S.sheetDirty = false; S.sheetTtl = ''; if (S.opin) { const r = S.opin.res; S.opin = null; r(null); } const b = $('#sheet'); S.qopen = false; b.hidden = true; b.innerHTML = ''; bgInert(false); navSync(); try { const f = S.sheetFrom; S.sheetFrom = null; if (f && f.isConnected && f.focus) f.focus({preventScroll: true}); } catch (e) {} if (S.deferRender) { S.deferRender = false; render(); } if (S.conflictPending) setTimeout(notifyConflicts, 250); }

/* Pengaman form di dalam sheet: ketukan di luar kotak, tombol Esc, dan tombol Batal/Tutup tidak boleh membuang isian yang belum disimpan tanpa konfirmasi.
   Sheet dianggap "berisi isian" bila punya kolom input/select/textarea (kecuali kolom cari) dan sudah disentuh (diketik, diganti, atau ada tombol aksi diketuk di dalamnya).
   Keranjang kasir (#cl) dikecualikan: isinya tersimpan di perangkat dan tidak hilang saat ditutup. closeSheet() langsung tetap dipakai setelah simpan/berhasil.
   Kolom #wa (nomor WhatsApp tujuan kirim struk, opsional) juga dikecualikan: sheet struk (setelah bayar dan dari Riwayat) tidak punya data yang perlu disimpan, jadi mengetuk Cetak/Kirim/Salin lalu "Transaksi baru" tidak boleh memunculkan "Data belum disimpan". */
const SHEET_FIELD = 'input:not([type=hidden]):not([type=search]):not([data-rs]):not([data-in]):not(#wa),select,textarea';
function sheetHasForm() { const b = $('#sheet'), d = b && !b.hidden && !b.querySelector('#cl') ? b.querySelector('.sheet') : null; return !!(d && d.querySelector(SHEET_FIELD)); }
const sheetDirtyNow = () => !!S.sheetDirty && sheetHasForm();
function markSheetDirty(/** @type {Event} */ e) {
  const t = /** @type {HTMLElement|null} */ (e.target), b = $('#sheet'); if (!t || !t.closest || !b || b.hidden || !b.contains(t)) return;
  if (e.type === 'click') { const x = /** @type {HTMLElement|null} */ (t.closest('[data-act]')); if (!x || x.dataset.act === 'close' || !sheetHasForm()) return; S.sheetDirty = true; return; }
  if (t.matches('[data-rs],[data-in],[type=search]')) return; // kolom cari/filter bukan isian data
  S.sheetDirty = true;
}
['input', 'change', 'click'].forEach(ev => document.addEventListener(ev, markSheetDirty, true)); // fase tangkap: tertandai sebelum aksi tombol (mis. simpan) berjalan
/* Dialog di dalam aplikasi (pengganti confirm()/prompt() bawaan browser, yang di PWA/ponsel sering tidak tampil atau tampak seperti galat).
   confirmBox: resolve true = pilih "leave" (tindakan yang dilakukan), false = tetap. Ketuk latar atau Esc = false, jadi tidak pernah membuang data tanpa disengaja.
   promptBox (v2.6.13): sama, tetapi dengan kolom teks; resolve teks yang sudah dipangkas (minimal `min` huruf, salahnya tampil di bawah kolom dan dialog tetap terbuka) atau null bila dibatalkan.
   Dialog ini ditumpuk DI ATAS sheet yang sedang terbuka (tidak menggantikannya) dan juga muncul di atas overlay "memuat" bila dipanggil dari dalam busy().
   tone 'pri': tombol aksi berwarna utama (untuk tindakan yang tidak merusak); bawaan 'dan' (merah) dan tombol aman (stay) yang berwarna utama. */
function confirmBox(/** @type {{title:string,msg:string,stay:string,leave:string,tone?:string}} */ o) { return dlgBox(o, null); }
function promptBox(/** @type {{title:string,msg:string,stay:string,leave:string,label:string,min?:number,err?:string,tone?:string}} */ o) { return dlgBox(o, o); }
function dlgBox(/** @type {any} */ o, /** @type {any} */ fld) {
  return new Promise(res => {
    const none = fld ? null : false;
    if (S.cfmOpen) return res(none);
    S.cfmOpen = true; const prev = document.activeElement, sh = $('#sheet'), bz = $('#busy'), hideBusy = !!(bz && !bz.hidden), box = document.createElement('div'), pri = o.tone === 'pri', min = fld ? (fld.min == null ? 3 : fld.min) : 0;
    box.id = 'cfm'; box.className = 'cfm';
    box.innerHTML = '<div class="cfm-bg"></div><div class="cfm-box" role="' + (fld ? 'dialog' : 'alertdialog') + '" aria-modal="true" aria-labelledby="cfm-h" aria-describedby="cfm-p"><div class="cfm-ic" aria-hidden="true">!</div><h3 id="cfm-h">' + esc(o.title) + '</h3><p id="cfm-p">' + esc(o.msg) + '</p>' +
      (fld ? '<label class="cfm-f">' + esc(fld.label) + '<textarea class="inp ta" id="cfm-t" rows="3" maxlength="300" autocomplete="off"></textarea></label>' : '') +
      '<button class="btn ' + (pri ? 'sec' : 'pri') + '" data-cf="stay">' + esc(o.stay) + '</button><button class="btn ' + (pri ? 'pri' : 'dan') + '" data-cf="leave">' + esc(o.leave) + '</button></div>';
    document.body.appendChild(box); if (sh) sh.setAttribute('inert', ''); if (hideBusy && bz) bz.hidden = true;
    const ta = /** @type {any} */ (box.querySelector('textarea')), btns = /** @type {HTMLElement[]} */ (Array.from(box.querySelectorAll('textarea,button')));
    const done = (/** @type {any} */ v) => {
      document.removeEventListener('keydown', onKey, true); box.remove(); S.cfmOpen = false; S.cfmCancel = null; if (sh) sh.removeAttribute('inert'); if (hideBusy && bz && S.busyOn) bz.hidden = false;
      try { if (prev && /** @type {any} */ (prev).isConnected && /** @type {any} */ (prev).focus) /** @type {any} */ (prev).focus({preventScroll: true}); } catch (e) {}
      navSync(); res(v);
    };
    S.cfmCancel = () => done(none);
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(none); return; }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); const i = btns.indexOf(/** @type {HTMLElement} */ (document.activeElement)); btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('click', e => {
      const t = /** @type {HTMLElement} */ (e.target), b = t.closest && /** @type {HTMLElement|null} */ (t.closest('[data-cf]')); e.stopPropagation();
      if (!b) { if (t.classList.contains('cfm-bg')) done(none); return; }
      if (b.dataset.cf !== 'leave') return done(none);
      if (!fld) return done(true);
      const v = String(ta.value || '').trim(); if (v.length < min) return fieldErr(ta, fld.err || 'Wajib diisi (minimal ' + min + ' huruf).');
      done(v);
    });
    navSync(); (ta || btns[0]).focus();
  });
}
/* Tutup atas permintaan pengguna (ketuk latar, Esc, Batal/Tutup). Bila ada isian belum tersimpan: tampilkan peringatan dulu. */
async function requestCloseSheet() {
  if (S.busyOn || S.cfmOpen) return;
  if (sheetDirtyNow()) {
    const leave = await confirmBox({title: 'Data belum disimpan', msg: 'Isian yang sudah Anda masukkan akan hilang kalau Anda keluar sekarang.', stay: 'Lanjut mengisi', leave: 'Buang dan keluar'});
    if (!leave || S.busyOn || $('#sheet').hidden) return;
  }
  closeSheet();
}

