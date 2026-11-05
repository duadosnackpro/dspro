# Input transaksi lama (v2.6.7, migrasi 0038)

Untuk memasukkan penjualan yang terjadi **sebelum** aplikasi dipakai (mis. dari buku catatan) dengan **tanggal asli**. Penjualan lewat Kasir tetap selalu bertanggal saat diinput.
Kode: `src/app/139-transaksi-lama.js` (jangan ubah `web/js/app.js` langsung; jalankan `npm run build`), server `app.sale_backdate` / `rpc_sale_backdate`. Tes: `npm run test:lama`, `supabase/tests/015_sale_backdate.test.sql`.

Layar: Menu, Data, **Input transaksi lama** (hanya Owner/Admin).

## Cara pakai
1. Pilih tanggal, jam, channel (otomatis memilih channel bernama "Offline" bila ada), dan metode bayar (tunai, QRIS, transfer; mengikuti Pengaturan).
2. Tambah item: produk, jumlah, dan harga satuan. Harga dikosongkan = harga channel saat ini; isi bila harga saat itu berbeda.
3. **Simpan transaksi.** Tanggal, channel, dan metode dipertahankan untuk transaksi berikutnya; hanya item yang dikosongkan. Daftar "Tersimpan di sesi ini" menampilkan nomor struk dan total.
4. Kirim ulang setelah koneksi putus aman: `request_id` sama selama isian tidak berubah, sehingga server mengembalikan hasil pertama (tidak ganda). Mengubah isian apa pun membuat `request_id` baru.

## Aturan server
- Hanya owner/admin pada outlet toko aktif. Tanggal (waktu lokal outlet) harus **di masa lalu** dan **tidak di periode terkunci** (ditolak, tidak digeser).
- Total, PPN, dan fee channel dihitung server dengan rumus yang sama seperti `sale_create`. Diskon opsional diterima server (dibatasi sampai subtotal) tetapi layar belum menyediakannya.
- **Tidak memakai sesi kasir** (`cash_session_id` kosong): transaksi tidak masuk laci, buka/tutup kasir, atau selisih kas hari ini.
- Nomor struk memakai tanggal transaksi (`OUT-001-261031-001`). Catatan otomatis diawali "Transaksi lama". Tercatat di audit (`sale_backdate`).
- Laporan (penjualan, laba rugi, pembayaran per metode) memakai `sold_at`, jadi transaksi jatuh di hari yang benar.

## Kurangi stok?
Kotak "Kurangi stok" (bawaan **mati**).
- **Mati**: stok tidak berubah. Pakai ini bila stok akhir nanti dihitung fisik, karena angka fisik sudah memuat penjualan tersebut. Urutan input stok dan transaksi lama jadi tidak penting.
- **Nyala**: stok berkurang seperti penjualan biasa (boleh minus). Pakai bila stok awal sebelum tanggal transaksi sudah dimasukkan; sesudahnya sesuaikan stok ke hitungan fisik.

## Hal yang perlu diketahui
- **HPP** baris = HPP rata-rata saat ini. Bila belum ada (0), HPP baris kosong dan Beranda menampilkan peringatan HPP kosong; isi HPP bahan/produk dulu, lalu jalankan perbaikan HPP (Owner/Admin, maksimal 400 hari per rentang). Hasilnya pendekatan, bukan HPP historis.
- **QRIS/Transfer tanpa referensi** muncul di laporan Pembayaran per metode sebagai "tanpa referensi" bila ambang `bayar_referensi_min` terlampaui. Itu hanya penanda rekonsiliasi.
- Produk dengan **opsi** (pakai_opsi) dicatat tanpa pilihan opsi.
- Salah input: belum ada pembatalan khusus. Gunakan Retur dari Riwayat, atau (sebelum go-live) Reset data transaksi.
- Migrasi forward-only, hanya menambah fungsi baru. Klien 2.6.6 tetap berjalan; klien 2.6.7 butuh skema 0038 (`MIN_SCHEMA`).
