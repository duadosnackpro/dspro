# Riwayat: pencarian dan detail nota (v2.7.0, migrasi 0042)

## Pemakaian
- Kolom cari di atas daftar Riwayat. Hasil muncul setelah jeda ketik singkat; kolom dikosongkan = kembali ke daftar harian.
- Rentang: Hari terpilih, 7, 30, atau 90 hari ke belakang dari tanggal yang dipilih (server membatasi 92 hari). Dipaginasi 50 per halaman.
- Aturan kata kunci (dipisah spasi, maksimal 4 kata, semua kata harus cocok):
  - **Angka saja** (`12`, `0012`, `12.500`): nomor urut nota atau total nota (retur dicari lewat nilai mutlak). Angka 6 digit ke atas juga dicari sebagai potongan nomor (mis. `261107`).
  - **Teks**: potongan nomor nota; bila mengandung huruf juga dicari di nama produk, SKU, dan label opsi.
  - Nomor penjualan lengkap hanya cocok dengan nota penjualan itu. Untuk retur ketik lengkap dengan `RT-` (urutan retur terpisah dari penjualan).
  - Jika kata kunci lebih dari satu kata, angka juga dicari di nama produk/label opsi (mis. `level 3`).
- Ketuk baris nota untuk membuka struk lengkap dari server: bagikan, salin, cetak (diberi tanda SALINAN STRUK), WhatsApp, Retur, Tandai ditinjau, serta tautan nota asal/retur terkait.
- Kasir hanya melihat dan mencari nota miliknya. Butuh koneksi internet; transaksi yang belum terkirim tetap di bagian "Menunggu kirim" pada daftar harian.

## Teknis
- RPC baru `sales_search` dan `sale_receipt` (pembungkus `rpc_*`, hak `authenticated`; `anon` ditolak). Fungsi lama tidak diubah.
- **Urutan rilis:** pasang migrasi 0042 dulu, baru unggah klien 2.7.0 (`MIN_SCHEMA` = 0042; `deploy.yml` sudah berurutan). Klien 2.6.19 tetap berjalan di skema baru; `min_client` tidak naik.
- Tes: `supabase/tests/019_riwayat_cari.test.sql` (SQL) dan `tests/riwayat_ui.js` (`npm run test:riw`).
