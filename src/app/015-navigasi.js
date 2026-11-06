/* ---------- Tombol Back (v2.6.13, keluar dua kali v2.6.16) ----------
   Di PWA tombol atau geser Back menutup aplikasi bila halaman tidak punya riwayat sendiri. Kini setiap "lapisan" yang bisa ditutup memegang SATU entri riwayat:
     dialog konfirmasi, sheet, dan tab selain tab beranda (homeTab). Back menutup lapisan paling atas: dialog, lalu sheet, lalu kembali ke tab sebelumnya (atau beranda).
   Prinsip: jumlah entri riwayat milik kita (NAV.depth) selalu disamakan dengan jumlah lapisan yang sedang terbuka (navWant). Semua kode yang membuka atau menutup lapisan
   cukup memanggil navSync() (sheet(), closeSheet(), dialog, render()), jadi penutupan lewat tombol, Esc, atau kode tidak perlu tahu soal riwayat.
   - Menambah entri: langsung (pushState). Mengurangi entri: ditunda satu putaran (setTimeout 0) dan dihitung ulang saat jalan, sehingga closeSheet() yang disusul sheet() baru
     di putaran yang sama tidak membuang lalu membuat entri lagi.
   - history.go() berjalan tak-sinkron; selama menunggu popstate-nya (NAV.popping) tidak ada pushState baru, supaya tidak salah menghapus entri.
   - Back saat sheet berisi isian belum disimpan: lewat requestCloseSheet(), jadi konfirmasi "Data belum disimpan" yang sama muncul. Saat sedang menyimpan (busy), Back diabaikan.
   - Keluar aplikasi (v2.6.16): ada SATU entri "penjaga" di dasar tumpukan, selalu terpasang (di layar masuk maupun setelah login). Back di beranda tanpa lapisan terbuka hanya melepas penjaga itu:
     aplikasi tetap terbuka, muncul toast "Tekan Kembali sekali lagi untuk keluar", dan penjaga dipasang lagi. Back kedua dalam NAV_EXIT_MS (2,5 dtk) baru benar-benar keluar (history.go(-1)).
     Kasir yang salah tekan Back sekali tidak lagi terlempar dari aplikasi.
   - Setelah muat ulang halaman, entri lama dari sesi sebelumnya bisa tertinggal di belakang; Back pertama di beranda lalu memuat ulang aplikasi alih-alih keluar. Tidak merusak data. */
const NAV_EXIT_MS = 2500;
const NAV = {depth: 0, popping: false, rt: 0, safeT: 0, prev: '', last: '', byBack: false, exitAt: 0, leaving: false, leaveN: 0, leaveT: 0};
const navOK = () => !!(window.history && history.pushState && history.go);
if (navOK()) { try { if (history.state && history.state.dsp) history.replaceState(null, ''); } catch (e) { /* abaikan */ } }
function navWant() {
  return 1 + navLayers(); // 1 = entri penjaga (keluar dua kali)
}
function navLayers() { // lapisan yang bisa ditutup dengan Back: tab selain beranda, sheet, dialog konfirmasi
  const sh = $('#sheet');
  return (S.token && S.data && S.tab !== homeTab() ? 1 : 0) + (sh && !sh.hidden ? 1 : 0) + (S.cfmOpen ? 1 : 0);
}
function navSync() {
  if (!navOK() || NAV.popping || NAV.leaving) return;
  const want = navWant();
  while (NAV.depth < want) { history.pushState({dsp: NAV.depth + 1}, ''); NAV.depth++; }
  if (NAV.depth > want) { clearTimeout(NAV.rt); NAV.rt = setTimeout(navTrim, 0); }
}
function navTrim() {
  if (!navOK() || NAV.popping || NAV.leaving) return;
  const n = NAV.depth - navWant(); if (n <= 0) return;
  NAV.popping = true; NAV.depth -= n; clearTimeout(NAV.safeT); NAV.safeT = setTimeout(navPopDone, 700); // pengaman bila popstate tidak pernah datang
  history.go(-n);
}
function navPopDone() { clearTimeout(NAV.safeT); if (!NAV.popping) return; NAV.popping = false; navSync(); }
/* Dicatat di render(): tab asal untuk Back. Berpindah lewat Back tidak mencatat asal baru (cegah bolak-balik antara dua tab). */
function navTrack() { if (S.tab !== NAV.last) { NAV.prev = NAV.byBack ? '' : NAV.last; NAV.last = S.tab; } NAV.byBack = false; }
async function navTabBack() {
  if (S.busyOn || !S.token || !S.data) return;
  const home = homeTab(); if (S.tab === home) return;
  const to = NAV.prev && NAV.prev !== S.tab && tabAllowed(NAV.prev) ? NAV.prev : home;
  if (S.dirty && S.tab === 'settings') { // sama dengan penjaga di klik tab: perubahan pengaturan tidak hilang diam-diam
    const ok = await confirmBox({title: 'Perubahan belum disimpan', msg: 'Perubahan pengaturan akan hilang kalau Anda keluar sekarang.', stay: 'Lanjut mengisi', leave: 'Buang dan keluar'});
    if (!ok) return; S.dirty = false;
  }
  NAV.byBack = true; S.tab = to; render();
}
/* Back di beranda tanpa lapisan: pertama = peringatan, kedua (dalam NAV_EXIT_MS) = keluar. Mengembalikan true bila sedang keluar. */
function navExitCheck() {
  if (navLayers() > 0) { NAV.exitAt = 0; return false; }
  const now = Date.now();
  if (NAV.exitAt && now - NAV.exitAt < NAV_EXIT_MS) { NAV.exitAt = 0; navLeave(); return true; }
  NAV.exitAt = now; try { toast('Tekan Kembali sekali lagi untuk keluar'); } catch (e) { /* toast tidak boleh memutus Back */ }
  return false;
}
function navLeave() { // penjaga sudah terlepas; satu langkah mundur lagi = keluar dari aplikasi
  NAV.leaving = true; NAV.leaveN = 0; clearTimeout(NAV.leaveT);
  NAV.leaveT = setTimeout(navStay, 800); // pengaman: kalau tidak ada yang bisa dimundurkan (mis. tab satu-satunya), aplikasi tetap hidup dan penjaga dipasang lagi
  history.go(-1);
}
function navStay() { clearTimeout(NAV.leaveT); NAV.leaving = false; NAV.leaveN = 0; NAV.exitAt = 0; navSync(); }
async function navBack() {
  if (NAV.leaving) return;
  if (navOK() && !S.busyOn && navExitCheck()) return;
  try {
    const sh = $('#sheet');
    if (S.cfmOpen) { if (S.cfmCancel) S.cfmCancel(); }
    else if (sh && !sh.hidden) await requestCloseSheet();
    else await navTabBack();
  } catch (e) { /* Back tidak boleh memutus aplikasi */ }
  navSync(); // lapisan yang tidak jadi ditutup (menyimpan, atau pengguna memilih tetap) mendapat entrinya kembali
}
window.addEventListener('popstate', () => {
  if (NAV.leaving) { // entri sisa dari sesi sebelumnya (satu dokumen) tidak boleh menahan kasir yang memang mau keluar
    clearTimeout(NAV.leaveT); NAV.leaveT = setTimeout(navStay, 800);
    if (++NAV.leaveN < 50) history.go(-1);
    return;
  }
  if (NAV.popping) { navPopDone(); return; } // pop yang kita minta sendiri
  if (NAV.depth > 0) NAV.depth--;            // Back dari pengguna: entri teratas sudah dilepas browser
  navBack();
});
