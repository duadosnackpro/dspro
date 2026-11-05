# Produksi: catat sekali jalan dan anti-ganda (v2.6.2, migrasi 0035)

## Yang berubah
- **Catat produksi selesai** (tombol utama di tab Produksi): satu lembar berisi jenis, resep, jumlah batch, hasil aktual (kosong = sesuai standar), tenaga kerja, overhead (kosong = otomatis), dan catatan. Pratinjau biaya, kekurangan bahan, dan perubahan HPP rata-rata tampil sebelum disimpan. Server menjalankan rencana + penyelesaian dalam SATU transaksi (`production_record`): bila gagal (stok bahan kurang, bahan tanpa harga) tidak ada rencana yang tertinggal.
- **Buat rencana** tetap ada untuk produksi yang dijadwalkan dulu, lalu diselesaikan dari detail.
- **Anti-ganda**: `production_create`, `production_complete`, dan `production_record` menerima `request_id`. Kirim ulang (jaringan putus, ketuk dua kali) mengembalikan hasil pertama dengan `duplicate: true`; bahan tidak terpotong dua kali dan tidak muncul rencana kedua. `request_id` dibuat baru oleh klien setiap isian berubah, jadi koreksi isian dihitung sebagai permintaan baru. `production_record` mewajibkan `request_id`; dua fungsi lain tetap menerima panggilan tanpa `request_id` (klien lama).
- Bahan tanpa harga (F-08): supervisor/owner tetap bisa melanjutkan dengan konfirmasi, baik di jalur sekali jalan maupun dua tahap.

## Rollback
Migrasi forward-only. Klien 2.6.1 tetap bisa memakai `production_create`/`production_complete` seperti sebelumnya. Klien 2.6.2 mensyaratkan skema 20261101000035 (`MIN_SCHEMA`): pasang migrasi dulu, baru unggah klien.

# Produksi: ubah batch, pintasan pembelian, pencarian resep, filter tanggal (v2.6.3, migrasi 0036)

## Yang berubah
- **Ubah jumlah batch pada rencana** (detail rencana, tombol "Ubah jumlah batch"; catatan ikut bisa diubah). Server (`production_update`) hanya menerima status rencana, mengunci barisnya, lalu mengubah `batches` dan hasil standar (hasil standar per batch tetap seperti saat rencana dibuat). **Stok dan bahan tidak tersentuh**: keduanya baru bergerak saat produksi diselesaikan, dengan jumlah batch yang baru. Perubahan tercatat di audit (batch lama → baru). Rencana yang sudah selesai atau dibatalkan ditolak dengan pesan jelas (galat P0001).
  - `request_id` sama dengan `production_create`: kirim ulang dengan isi sama mengembalikan hasil pertama (`duplicate: true`, pesan "Perubahan ini sudah tersimpan sebelumnya"); isi berbeda dengan `request_id` sama ditolak (23505). Klien membuat `request_id` baru setiap isian berubah.
- **Pintasan ke Pembelian** saat bahan kurang (lembar Catat produksi selesai, Buat rencana, Selesaikan produksi, Ubah jumlah batch). Tombol "Catat pembelian bahan kurang" membuka lembar Pembelian dengan bahan yang kurang sebagai pilihan cepat (jumlah kekurangan dibulatkan ke atas, 3 desimal). **Harga beli tidak diisi otomatis**; pengguna mengisinya. Setelah pembelian tersimpan, lembar produksi tadi dibuka lagi dengan isian terjaga dan pratinjau stok sudah diperbarui. Hanya peran yang boleh mencatat pembelian (owner, admin, supervisor, stok) yang melihat tombolnya; peran produksi melihat petunjuk "Minta bagian Stok mencatat pembelian bahan ini".
- **Pencarian dan ingatan resep.** Kotak "Cari resep" (nama resep atau produk) muncul bila resep untuk jenis itu ada 6 atau lebih. Resep terakhir yang berhasil disimpan (rencana atau catat selesai) diingat per pengguna dan per kelompok (batch/pesanan vs repack) di perangkat itu, dan dipilih otomatis saat lembar dibuka. Bila resep itu sudah dihapus, yang dipilih resep pertama.
- **Filter tanggal riwayat + tanggal selesai.** Dua kolom tanggal dan tombol Semua / Hari ini / 7 hari di atas daftar produksi. Tanggal yang disaring adalah **tanggal selesai bila sudah selesai, selain itu tanggal dibuat** (zona waktu outlet, dihitung di server lewat `from`/`to` pada `production_list`). Baris selesai menampilkan "selesai YYYY-MM-DD"; detail menampilkan tanggal dibuat dan selesai. Daftar dibatasi 200 baris terbaru (urut tanggal dibuat); bila penuh, muncul petunjuk untuk mempersempit filter.
- Daftar produksi sekarang dimuat ulang paksa setelah buat rencana, ubah, batalkan, dan selesai. Rencana tidak menaikkan versi data, jadi sebelumnya daftar yang di-cache bisa tidak menampilkan perubahan itu.

## Rollback
Migrasi forward-only dan hanya menambah (fungsi baru + kolom `tanggal_selesai` pada daftar); klien 2.6.2 tetap berjalan di atas skema 0036. Klien 2.6.3 mensyaratkan skema 20261102000036 (`MIN_SCHEMA`): pasang migrasi dulu, baru unggah klien.

## Belum dikerjakan
Nomor lot/kedaluwarsa. Pencarian teks pada daftar riwayat produksi (yang ada baru pencarian resep di lembar input). Mengubah resep pada rencana yang sudah dibuat (saat ini batalkan lalu buat ulang).
