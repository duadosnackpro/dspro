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

## Peringatan "perlu ditinjau" di Beranda (migrasi 0043)
- Angka **N transaksi perlu ditinjau** menghitung semua nota outlet yang bertanda `review_flag`, dari tanggal mana pun. Itu **bukan** antrean di perangkat (yang ada di "Menunggu kirim"). Tanda hanya hilang bila Owner/Admin/Supervisor menekan **Tandai ditinjau** pada nota itu; membuka Riwayat tidak menghapusnya.
- Riwayat harian hanya menampilkan satu hari, jadi nota bertanda yang lama sulit dicari. Tombol peringatan kini **Lihat transaksi**: membuka daftar semua nota bertanda (terbaru dulu, maks. 50, dengan nomor, tanggal, jam, alasan server), tiap baris punya **Lihat nota** dan **Tandai ditinjau**. Auditor hanya bisa melihat (tombol tandai tidak tampil, ada penjelasan).
- RPC baru `sales_review_list` (pembungkus `rpc_sales_review_list`; hak `authenticated`; peran owner/admin/supervisor/auditor). Hanya menambah fungsi.
- **Urutan rilis:** pasang migrasi 0043 dulu, baru unggah klien. `MIN_SCHEMA` tetap 0042: di skema lama tombol **Lihat transaksi** membuka Riwayat dengan petunjuk, tidak macet.
- Tes: `supabase/tests/020_review_list.test.sql` (SQL) dan `tests/review_list.js` (`npm run test:revlist`).

