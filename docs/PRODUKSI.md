# Produksi: catat sekali jalan dan anti-ganda (v2.6.2, migrasi 0035)

## Yang berubah
- **Catat produksi selesai** (tombol utama di tab Produksi): satu lembar berisi jenis, resep, jumlah batch, hasil aktual (kosong = sesuai standar), tenaga kerja, overhead (kosong = otomatis), dan catatan. Pratinjau biaya, kekurangan bahan, dan perubahan HPP rata-rata tampil sebelum disimpan. Server menjalankan rencana + penyelesaian dalam SATU transaksi (`production_record`): bila gagal (stok bahan kurang, bahan tanpa harga) tidak ada rencana yang tertinggal.
- **Buat rencana** tetap ada untuk produksi yang dijadwalkan dulu, lalu diselesaikan dari detail.
- **Anti-ganda**: `production_create`, `production_complete`, dan `production_record` menerima `request_id`. Kirim ulang (jaringan putus, ketuk dua kali) mengembalikan hasil pertama dengan `duplicate: true`; bahan tidak terpotong dua kali dan tidak muncul rencana kedua. `request_id` dibuat baru oleh klien setiap isian berubah, jadi koreksi isian dihitung sebagai permintaan baru. `production_record` mewajibkan `request_id`; dua fungsi lain tetap menerima panggilan tanpa `request_id` (klien lama).
- Bahan tanpa harga (F-08): supervisor/owner tetap bisa melanjutkan dengan konfirmasi, baik di jalur sekali jalan maupun dua tahap.

## Rollback
Migrasi forward-only. Klien 2.6.1 tetap bisa memakai `production_create`/`production_complete` seperti sebelumnya. Klien 2.6.2 mensyaratkan skema 20261101000035 (`MIN_SCHEMA`): pasang migrasi dulu, baru unggah klien.

## Belum dikerjakan (usulan lanjutan)
Edit jumlah batch pada rencana, pintasan ke Pembelian saat bahan kurang, pencarian dan ingatan resep terakhir, filter tanggal riwayat dan tanggal selesai, nomor lot/kedaluwarsa.
