# Sinkronisasi data operasional (v2.6.9, migrasi 0040)

## Masalah yang diperbaiki
Sebelumnya sidik versi yang diperiksa tiap perangkat (`app.ping`) hanya mencakup katalog/harga/pengaturan (`cat_ver`) dan stok **produk jadi** (`stock_ver`). Perubahan **resep, bahan dan stok bahan, pembelian, produksi, retur tanpa restock, biaya, transfer, dan sesi kas** tidak mengubah sidik itu. Akibatnya perangkat lain, dan cache layar/Riwayat di perangkat yang sama, tetap memakai data lama sampai halaman dimuat ulang.

## Cara kerja sekarang
- **Server (0040):** urutan `app.ops_seq` naik pada setiap perubahan data operasional (trigger per perintah). `app.ping` mengembalikan `ops_ver` (nilai urutan terakhir). Trigger juga memasukkan sinyal `ops` ke `sync_events` (digabung bila beruntun dalam 200 ms) sehingga Realtime memicu pemeriksaan.
  - Dihitung: resep, item resep, bahan, pemasok, saldo bahan, pembelian, produksi, transfer, biaya, kas keluar/masuk, tutup/buka-ulang/persetujuan sesi kas, retur baru, perubahan status atau penandaan tinjau pada penjualan, penghapusan (reset data).
  - **Tidak** dihitung: penjualan biasa (sudah tercakup `stock_ver`) dan pembukaan sesi kas otomatis oleh penjualan pertama kasir. Kasir ramai tidak memicu muat ulang di semua perangkat.
- **Klien:** `ops_ver` ikut dalam sidik data (`dverKey`), sehingga cache layar (`vload`) dan cache Riwayat otomatis tidak dipakai begitu `ops_ver` berubah. Bila `ops_ver` di server berbeda dengan yang dipegang perangkat, klien memuat ulang data (bootstrap) dan mengosongkan cache.
  - `bootstrap` distempel dengan `ops_ver` (ping dibaca **sebelum** bootstrap, jadi stempel tidak pernah lebih baru daripada data).
  - Setelah perangkat **sendiri** menulis (aksi daftar `OPS_W` di `src/app/02-api-sinkron.js`), klien menyelaraskan diri dalam 0,5 detik, diam-diam; toast "Data terbaru dimuat" hanya muncul untuk perubahan dari perangkat lain.
  - Retur menyelaraskan versi sebelum Riwayat dibaca ulang (sebelumnya Riwayat bisa menampilkan cache sebelum retur).
- Kasir offline tidak berubah: transaksi antre di perangkat dan terkirim saat online; sinkronisasi memakai mekanisme yang sama begitu tersambung.

## Kompatibilitas dan rollback
- Migrasi forward-only dan hanya menambah (sequence, trigger, batasan `kind` yang dilonggarkan, `create or replace app.ping` dengan kunci tambahan). Klien 2.6.8 tetap berjalan: ia mengabaikan `ops_ver`.
- Klien 2.6.9 mensyaratkan skema 20261105000040 (`MIN_SCHEMA`): pasang migrasi dulu, baru unggah klien. Pipeline `deploy.yml` sudah berurutan seperti itu.
- Klien 2.6.9 terhadap server lama (tanpa `ops_ver`) tidak memuat ulang berulang-ulang: perbandingan `ops_ver` dilewati bila ping tidak membawanya.

## Batasan yang perlu diketahui
- `ops_ver` bersifat **global** (bukan per outlet): perubahan di satu outlet membuat perangkat outlet lain memuat ulang sekali. Itu murah untuk jumlah outlet sekarang; bila outlet bertambah banyak, pertimbangkan versi per outlet.
- Urutan memakai `nextval` (tidak transaksional): transaksi yang dibatalkan paling jauh menyebabkan satu muat ulang yang tidak perlu.
- Penyelarasan setelah tulis sendiri hanya satu kali; bila ping yang sedang berjalan lebih tua daripada tulisan, perubahan akan tertangkap pada pemeriksaan berikutnya (Realtime atau polling 45 detik / 3 menit).
- **Realtime belum diuji di Supabase sungguhan** (lihat `SISA-PEKERJAAN.md` bagian C). Bila tidak tersambung, sinkronisasi antar perangkat bergantung pada polling dan paling lambat terlihat setelah 45 detik.
- `staleSoon()`/`seenV` di `02-api-sinkron.js` adalah kode lama yang tidak dipanggil di mana pun; tidak diubah di sini.

## Tes
`npm run test:ops` (logika klien: `verSync`, `dverKey`, penyelarasan, toast, cache `vload`), `tests/fe_sb.js` (stempel bootstrap), `supabase/tests/017_ops_sync.test.sql` (ops_ver, sinyal, RLS, penggabungan).
