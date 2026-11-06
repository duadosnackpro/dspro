/* ---------- Login ---------- */
function renderLogin(msg) {
  RF.tab = 'login'; document.title = 'Masuk · Duado Snack';
  $('#app').innerHTML = '<div class="login"><div class="lg-hero"><img src="icons/icon-192.png" alt="Duado Snack" width="116" height="116"><h1 class="wordmark">DUADO SNACK</h1><p>Jajanan Cemilan Pedas</p></div><form class="lg-card" id="lf" novalidate>' +
    '<label>Username<input id="lu" class="inp" autocomplete="username" autocapitalize="none" enterkeyhint="next" aria-describedby="lerr" value="' + esc(LS.get('lastUser', '')) + '"></label>' +
    '<div class="pw"><label>PIN atau kata sandi<input id="lp" class="inp" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-describedby="lerr"></label>' +
    '<button type="button" class="pwt" data-act="pinvis" aria-pressed="false" aria-controls="lp" aria-label="Tampilkan PIN"><span class="pw-on">' + svg('eye') + '</span><span class="pw-off">' + svg('eyeoff') + '</span></button></div>' +
    '<div class="err" id="lerr" role="alert">' + esc(msg || '') + '</div>' +
    '<label class="sw"><input type="checkbox" id="lsh"' + (LS.get('shared', false) ? ' checked' : '') + '><span class="sw-t" aria-hidden="true"></span><span class="sw-l"><b>Perangkat bersama</b><small>Hapus data lokal saat keluar</small></span></label>' +
    '<button class="btn pri big" type="submit">Masuk</button>' +
    '<p class="muted lg-help">Lupa PIN? Hubungi Owner outlet.</p>' +
    (S.queue.length ? '<div class="muted">' + S.queue.length + ' transaksi menunggu dikirim setelah masuk.</div>' : '') + '</form></div>';
  navSync();
  /* v2.6.18: fokus awal: PIN bila username terakhir sudah terisi, selain itu username. */
  try { const f = /** @type {HTMLInputElement|null} */ ($(LS.get('lastUser', '') ? '#lp' : '#lu')); if (f) f.focus(); } catch (x) { /* fokus tidak wajib */ }
}
/* v2.6.17: galat login tampil di antara kolom PIN dan tombol (tetap terlihat saat keyboard layar terbuka), kolom yang bermasalah diberi aria-invalid
   dan fokus pindah ke sana. Pesan dan tanda hilang begitu pengguna mengetik lagi (loginClear, dipasang di 13-aksi.js). */
function loginClear() {
  const e = $('#lerr'); if (e) e.textContent = '';
  ['#lu', '#lp'].forEach(q => { const f = $(q); if (f) f.removeAttribute('aria-invalid'); });
}
function loginErr(/** @type {string} */ msg, /** @type {string[]} */ bad, /** @type {string} */ focus) {
  loginClear();
  const e = $('#lerr'); if (e) e.textContent = msg;
  bad.forEach(q => { const f = $(q); if (f) f.setAttribute('aria-invalid', 'true'); });
  const f = /** @type {HTMLInputElement|null} */ ($(focus));
  try { if (f) { f.focus(); if (f.scrollIntoView) f.scrollIntoView({block: 'center'}); } } catch (x) { /* fokus tidak wajib */ }
}
/* v2.6.18: tombol mata. aria-pressed menandai PIN sedang terlihat; label tombol tetap "Tampilkan PIN" (pola tombol toggle standar). */
function pinToggle(/** @type {HTMLElement} */ btn) {
  const f = /** @type {HTMLInputElement|null} */ ($('#lp')); if (!f) return;
  const show = f.type === 'password'; f.type = show ? 'text' : 'password'; btn.setAttribute('aria-pressed', show ? 'true' : 'false');
}
/* v2.6.18: galat login dalam bahasa kasir. Detail teknis (e.message, stack) hanya ke log lokal lewat logErr, tidak pernah ke layar.
   e.limit = pembatasan percobaan, e.cred = username/PIN salah (keduanya dari sb-adapter.js), e.server = pesan bisnis yang sudah ramah. */
function loginFail(/** @type {any} */ e) {
  if (e && e.limit) return loginErr('Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi. Jika masih terkunci, hubungi Owner.', [], '#lp');
  if (e && e.server) return loginErr(e.message, e.cred ? ['#lu', '#lp'] : [], '#lp');
  logErr(e, 'login');
  const net = (typeof navigator !== 'undefined' && navigator.onLine === false) || /Tidak ada koneksi/.test(String((e && e.message) || ''));
  return loginErr(net ? 'Tidak ada koneksi. Periksa internet lalu coba lagi.' : 'Terjadi masalah di aplikasi. Coba lagi. Jika berulang, hubungi Owner.', [], '#lp');
}
async function doLogin() {
  const u = $('#lu').value.trim(), p = $('#lp').value;
  if (!u || !p) { const bad = []; if (!u) bad.push('#lu'); if (!p) bad.push('#lp'); return loginErr('Isi username dan PIN.', bad, bad[0]); }
  loginClear();
  await busy('Masuk…', async () => { try {
    const r = await api('login', {username: u, pin: p, dev: devId()}); S.token = r.token;
    /* Penguncian ganti user: antrean pengguna lain yang belum terkirim tidak boleh tertinggal atau tercampur. */
    const other = S.queue.filter(q => q.uid !== r.uid);
    if (other.length) {
      if (can('takeover', r.role) && await confirmBox({title: 'Ada antrean pengguna lain', msg: 'Ada ' + other.length + ' transaksi pengguna lain yang belum terkirim di perangkat ini. Kirim atas nama mereka sekarang (diambil alih Owner)? Pilih "Batalkan login" untuk membatalkan masuk.', stay: 'Batalkan login', leave: 'Ambil alih dan kirim'})) other.forEach(q => { q.by = r.uid; });
      else { try { await api('logout', {}, {silent: true}); } catch (e) {} S.token = null; throw Object.assign(new Error(can('takeover', r.role) ? 'Login dibatalkan. Antrean pengguna lain belum terkirim.' : 'Masih ada ' + other.length + ' transaksi pengguna lain yang belum terkirim di perangkat ini. Masuk sebagai pengguna tersebut dulu agar antrean terkirim, atau hubungi Owner.'), {server: true}); }
      LS.set('queue', S.queue);
    }
    LS.set('token', r.token); LS.set('lastUser', u); LS.set('shared', !!($('#lsh') && $('#lsh').checked));
    await loadData(); await shiftCheck(); S.tab = homeTab(); render(); flush();
    if (r.pin_lemah) setTimeout(() => toast(own() ? 'PIN Anda lemah. Ganti di Menu, Pengguna.' : 'PIN Anda lemah. Minta Owner menggantinya.'), 900);
  } catch (e) { S.token = null; loginFail(e); } });
}

