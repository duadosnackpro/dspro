# Duado POS: sistem desain "Dapur Pedas"

Sumber kebenaran untuk tampilan aplikasi kasir. Berkas ini dirujuk dari `web/css/app.css` (baris 5). Bila dokumen dan CSS berbeda, **CSS yang benar**: perbarui dokumen ini dalam perubahan yang sama.

Aplikasi dipakai kasir sambil berdiri, satu tangan, di HP kecil sampai tablet, sering di bawah lampu dapur yang terang. Karena itu aturannya: sasaran ketuk besar, kontras tinggi, angka rata, dan status tidak pernah hanya berupa warna.

## 1. Cara kerja

- Semua gaya ada di satu berkas, `web/css/app.css`. Kelas HTML ditentukan oleh JS (`src/app/*.js`, `web/js/modules.js`); CSS hanya mengatur tampilan.
- Urutan berkas: token, dasar, kerangka, kontrol, permukaan, Kasir, lapisan (sheet/toast), struk, login, interaksi pointer, tablet, gerak berkurang, utilitas.
- Font memakai berkas lokal (`web/fonts/baloo2-600.woff2`, `baloo2-800.woff2`); tidak ada permintaan ke Google Fonts.
- Hanya ada satu blok `:root` (dijaga `tests/release_check.js`).

## 2. Aturan menulis gaya (ditegakkan tes)

1. **Warna hanya di token.** Di luar blok `:root` tidak boleh ada `#hex` atau `rgba()`; tulis `var(--nama)`. Di JS tidak boleh ada `#hex` di markup. Pengecualian yang disengaja: kanvas logo/QR/foto untuk printer termal (hitam-putih mutlak, `fillStyle`).
2. **Tidak ada atribut `style`.** CSP `style-src 'self'` tidak mengizinkannya, dan `setAttribute('style', ...)` juga diblokir. Gunakan kelas.
3. **Jarak dan perataan satu-kali** memakai utilitas di bagian 13 CSS (`u-mt8`, `u-blk`, `u-f1`, `u-tc`, `u-err`, `u-ok`, `li-flat`, ...). Utilitas memakai `!important` agar sama dengan perilaku gaya inline lama. Bila pola yang sama muncul tiga kali atau lebih, buat kelas bernama untuk komponennya (contoh: `bt-acts`, `sc-scroll`, `ul-s`).
4. **Nilai yang dihitung saat jalan** (lebar/tinggi batang, lebar logo dan QR dalam persen) ditulis di markup sebagai `data-dw` (lebar) atau `data-dh` (tinggi), mis. `data-dw="42%"`. Fungsi `dynStyle()` di `src/app/01-inti.js` memasangnya lewat CSSOM, dipanggil oleh `MutationObserver` di `14-mulai.js` untuk setiap simpul baru. Hanya nilai berbentuk persen yang diterima.
5. **Warna yang dipilih berdasarkan data** dipetakan ke kelas, bukan ke warna: palet grafik `ch1`..`ch5`, nada foto produk `tn0`..`tn5`, status angka `u-ok` / `u-err`, batang Beranda `bc-o` / `bc-l` / `bc-t`.
6. Jangan mengedit `web/js/app.js` langsung; ubah `src/app/*.js` lalu `npm run build`.

## 3. Token warna

Nama yang dipakai kode lama (`--mar`, `--mar-d`, `--mar-l`, `--org`, `--bg`, `--surf`, `--sh`) adalah alias; kode baru memakai nama di bawah.

| Token | Nilai | Pakai untuk |
|---|---|---|
| `--brand` | `#5B1A14` | kepala, tombol utama gelap, teks tautan, batang laba |
| `--brand-hi` / `--brand-deep` | `#7A271D` / `#3A0F0B` | tekan tombol gelap / bilah keranjang, toast |
| `--yel` / `--yel-press` | `#FFC52E` / `#F0B000` | tombol utama (CTA), tab aktif, tanda di atas `--brand` |
| `--hot` | `#E4570E` | **hanya grafis, ikon, garis** (3,5:1 di kertas). Jangan untuk teks |
| `--hot-ink` | `#B14507` | oranye yang aman untuk teks (5,3:1) |
| `--paper` / `--surface` / `--sunk` | `#FBF7F0` / `#fff` / `#F4EEE4` | latar halaman / kartu dan kolom isian / area cekung |
| `--line` / `--field` | `#E8DFD2` / `#8C7B6E` | garis halus / tepi kolom isian (4,1:1 di atas putih) |
| `--ink` / `--ink-2` / `--mut` | `#241714` / `#4F3F39` / `#6A5851` | teks utama (16,3:1) / sekunder (9,4:1) / redup (6,3:1) |
| `--ok`, `--ok-bg`, `--ok-ink` | `#14703A`, `#E4F5E9`, `#14532D` | sukses; teks di atas `--ok-bg` 8,0:1 |
| `--warn`, `--warn-bg`, `--warn-ink` | `#9A4A00`, `#FFF1D6`, `#7A3B00` | peringatan; 7,7:1 |
| `--err`, `--err-bg`, `--err-ink` | `#B3261E`, `#FDE4E1`, `#8F1D14` | galat; 7,4:1 |
| `--amber` | `#B45309` | tag, stok rendah, lonceng; teks putih di atasnya 5,0:1 |
| `--alert` | `#B91C1C` | angka di lonceng peringatan |
| `--wa` | `#15803D` | tombol WhatsApp |

Token turunan (semuanya di blok `:root`):

- **Teks di atas permukaan gelap:** `--on-brand` (`#fff`, 13,1:1 di `--brand`), `--on-brand-2` (`#EBD6C5`, 9,3:1), `--on-brand-3` (`#F1DCC8`, 9,9:1).
- **Lencana:** `--wait-bg/-ink` (8,5:1), `--off-bg/-ink` (9,0:1), `--q-bg/-ink` (6,9:1), `--qoff-bg`, `--qoff-dot`.
- **Kolom dan saklar:** `--ph-ink` (placeholder, 4,6:1), `--knob`, `--sw-off`.
- **Ikon dan garis redup:** `--ico-soft`, `--ico-chev`, `--heat-off`, `--plus-dis`, `--grab`, `--hover-row`, `--hover-line`, `--sk-a`, `--sk-b`.
- **Lapisan:** `--scrim`, `--scrim-2`, `--ring` (cincin fokus kolom), bayangan `--sh-sm`, `--sh-knob`, `--sh-sheet`, `--sh-card`, `--sh-dlg`, `--sh-logo`, `--sh-text`, `--float`; pudar tepi `--paper-0`, `--sunk-0`.
- **Kartu Beranda (di atas `--brand`):** `--hero-bar`, `--hero-bar-i`, `--hero-bar-ti`, `--hero-chip`, `--cb-i`, `--ini`, `--heat-bg`, `--login-glow`.
- **Grafik:** `--ch1`..`--ch5` = maroon, cabai, kuning, hijau, abu hangat (rujuk token di atas).
- **Foto produk:** `--tn0-a/-b` .. `--tn5-a/-b`, enam pasang gradien yang dipilih dari hash id produk.
- **Struk:** `--rc-paper` (`#fff`) dan `--rc-ink` (`#000`).

## 4. Tipografi

- Judul dan angka besar: **Baloo 2** 600/800 (`--head`), cadangan `Arial Rounded MT Bold`, `system-ui`.
- Isi: font sistem (`--body`).
- Dasar 16px / 1.45. Kolom isian 16px (mencegah zoom otomatis iOS). Teks bantu `.muted` 14px; teks terkecil yang diizinkan 12px (nama hari di grafik, label KPI), selebihnya 13px ke atas.
- **Angka uang selalu `tabular-nums`** (daftar kelas di bagian "Dasar" CSS) agar kolom rapi dibaca sekilas. Format `Rp 1.250.000` lewat `rp()`.
- Huruf besar semua hanya untuk subjudul login; jangan dipakai untuk label data.

## 5. Jarak, bentuk, gerak

- Jarak: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32 px. Tepi halaman `--px` 16 px.
- Sudut: `--r-sm` 10, `--r-md` 14, `--r-lg` 20 px. Pil 999px.
- Navigasi bawah `--nav-h` 68 px (di luar area aman).
- Durasi: `--t-fast` 120, `--t-med` 200, `--t-slow` 280 ms; kurva `--ease`.
- Lebar: satu kolom maksimum 640 px. Mulai 768 px, Kasir terbagi dua panel (kolom pesanan 340 px; 400 px mulai 900 px).
- `prefers-reduced-motion: reduce` mematikan animasi; hanya pemuat dan bilah kemajuan yang tetap berputar.

## 6. Komponen

| Komponen | Kelas utama | Catatan |
|---|---|---|
| Tombol | `.btn` + `.pri` (kuning), `.dark`, `.sec` (garis), `.dan` (bahaya), `.wa`; `.big`, `.sm` | tinggi 52 px; `.big` 56; `.sm` 44. Nonaktif: `disabled` atau `aria-disabled="true"` |
| Kolom isian | `.inp`, `textarea.ta`, `label` | tinggi 52 px; galat: `aria-invalid="true"` memberi tepi `--err` |
| Pil filter | `.chips` > `.chip` (`.on`) | tinggi 44 px; pudar tepi lewat `.chips-wrap` |
| Segmen | `.seg` > `button` (`.on`) | tab channel; bisa digeser dengan `.seg-wrap` |
| Saklar | `.sw` > `input` + `.sw-t` | `.sm` untuk baris padat |
| Lencana | `.badge` (`.ok`, `.wait`, `.off`, `.warn`, `.role`, `.spin`), `.tag`, `.bdg`, `.badge-out` | selalu teks + titik atau ikon, bukan warna saja |
| Daftar | `.li`, `.kv`, `.mi` (menu), `.card`, `.set-card`, `.card-s` | `.li-flat` untuk `<button class="li">` |
| Beranda | `.hero`, `.hbars`, `.kpi`/`.kgrid`, `.bar`, `.stack`, `.lgd`, `.bchart` | batang di atas `--brand` memakai token `--hero-*` |
| Kasir | `.kasir-top`, `.card.pc`, `.ph`, `.cartbar`, `.paybox`, `.kright` | produk habis diredupkan hanya pada foto dan inisial; lencana HABIS tetap penuh |
| Lapisan | `.sheet`, `.sheet-bg`, `.cfm-box`, `#toast`, `#busy`, `#upd` | sheet mengunci fokus dan mengembalikannya ke tombol asal |
| Struk | `pre.rc`, `.lg-paper`, `#rtxt` | **fungsional**: jangan ubah ukuran atau lebar karakter |

## 7. Aksesibilitas (batas minimum)

- Sasaran ketuk minimal 44 x 44 px (tombol 52, bar navigasi 56).
- Kontras teks minimal 4,5:1; ikon, garis kolom, dan grafis minimal 3:1. Pasangan token di bagian 3 sudah dihitung; hitung ulang bila menambah pasangan baru.
- Fokus terlihat: `:focus-visible` memakai garis 3 px `--brand` (`--yel` di atas permukaan gelap). Kolom isian memakai tepi `--brand` + cincin `--ring`.
- Status tidak hanya warna: lencana punya teks dan penanda; selisih kas memakai tanda `+`/`-` dan angka, bukan hanya hijau/merah.
- Pengumuman: `#toast`, `#busy`, `#sann` memakai `aria-live="polite"`; galat penting memakai `role="alert"`.
- Elemen interaktif memakai `<button>` atau `role="button"` + `tabindex`; ikon dekoratif `aria-hidden="true"`.

## 8. Kesiapan mode gelap

**Belum ada mode gelap** (`<meta name="color-scheme" content="light">`). Yang sudah siap setelah semua `#hex` dipindah ke token:

- Satu blok token mengendalikan seluruh warna; mode gelap cukup menambah `@media (prefers-color-scheme: dark){ :root{ ... } }` dan mengubah meta `color-scheme` menjadi `light dark`.
- Token yang **harus** diberi nilai gelap: `--paper`, `--surface`, `--sunk`, `--line`, `--field`, `--ink`, `--ink-2`, `--mut`, pasangan `*-bg/*-ink` (ok, warn, err, wait, off, q), `--ph-ink`, `--ico-*`, `--hover-*`, `--sk-*`, `--paper-0`, `--sunk-0` (harus ikut `--paper`/`--sunk` dengan alfa 0), `--scrim*`, bayangan.
- Token yang **tidak boleh** berubah: `--rc-paper` dan `--rc-ink` (struk selalu kertas putih, juga saat dicetak), `--tn*` (gradien foto), serta ketiganya di kanvas logo/QR.
- Perlu diputuskan: `--brand` sebagai latar kepala/hero tetap gelap, jadi `--on-brand*` dan `--yel` bisa dibiarkan; periksa ulang kontras `--brand` sebagai **teks** di atas `--paper` gelap (tidak lulus; butuh token teks tautan terpisah).
- Di luar CSS: `theme-color` di `index.html` dan `manifest.webmanifest` (`#5B1A14`), serta ikon PNG.
- Uji visual di perangkat belum dilakukan; dokumen ini hanya menyiapkan jalannya.

## 9. Memeriksa perubahan

```
npm run build        # bangun web/js/app.js dari src/app/*.js
npm run lint
npm run typecheck
npm test             # termasuk tests/release_check.js (CSP, tanpa style/#hex, berkas ini ada)
```

Setelah mengubah berkas di `web/`, naikkan versi (`package.json`, `web/js/config.js`, `web/sw.js`, judul `supabase/README.md`); service worker memakai cache per versi sehingga perangkat lama tidak menerima CSS/JS baru tanpa itu.
