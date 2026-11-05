# Pembelian bahan dan HPP manual (v2.6.6; kemasan di Data Master v2.6.7)

Kode: `src/app/09-stok-pembelian.js` (jangan ubah `web/js/app.js` langsung; jalankan `npm run build`). Tes: `npm run test:beli`.

## Anti-ganda (`request_id`)
`pbSave` mengirim `request_id`. Nilainya dibuat saat Simpan pertama kali dan **dipakai ulang** selama isian sama (ketuk dua kali, jaringan putus lalu coba lagi), jadi server (`idem_begin` scope `purchase`) mengembalikan hasil lama dan stok tidak bertambah dua kali. Isian berubah (tambah/hapus baris, supplier, ongkir) = `request_id` baru lewat `pbTouch()`. Setelah berhasil, `request_id` dikosongkan. Bila server menjawab `duplicate: true`, klien memuat ulang data (stok di jawaban duplikat adalah stok saat itu, bukan sekarang).

## Pembanding harga
Klien memanggil `purchase.last` (adapter: 40 pembelian terakhir yang tidak dibatalkan di outlet aktif, diambil lewat REST yang sama dengan `purchase.list`; tanpa migrasi). Ditampilkan sebagai keterangan dan placeholder kolom Harga satuan: harga beli terakhir (+ tanggal) dan, hanya untuk peran yang melihat biaya (owner/admin/auditor), HPP rata-rata. Peran supervisor dan stok **tidak menerima** `hpp_rata2` dari server (`rpc_bootstrap`), jadi mereka hanya melihat harga beli terakhir. Bahan yang tidak muncul di 40 pembelian terakhir tidak punya harga terakhir.

## Peringatan selisih
Saat "Tambah ke daftar", bila harga satuan menyimpang lebih dari `PB_WARN` (30%) dari pembanding, muncul konfirmasi. Pembanding: HPP rata-rata bila terlihat, selain itu harga beli terakhir. Tanpa pembanding, tidak ada peringatan. HPP rata-rata sudah memuat ongkir, jadi selisih kecil di bawah ambang itu wajar.

## Input per kemasan
Mode "Per kemasan": jumlah kemasan × isi per kemasan = jumlah (satuan bahan); harga kemasan ÷ isi = harga satuan (dibulatkan 4 desimal, sama dengan kolom `unit_price`). Server tetap menerima jumlah dan harga per satuan, tanpa perubahan kontrak. Nama dan isi kemasan diambil dari Data Master bila ada (lihat bagian berikut); bila belum, diingat per bahan di perangkat (`LS` kunci `pbpack`) sebagai cadangan.

## HPP manual di Penyesuaian stok
Server (`stock_adjust`, F-13) sudah menolak perubahan HPP yang sudah ada oleh peran non-supervisor. Klien kini mencerminkannya:
- Owner/admin/supervisor: begitu kolom HPP diisi pada item yang sudah punya HPP, muncul "Ini menimpa HPP rata-rata hasil pembelian" (produk jadi: "hasil produksi"), dan saat Simpan diminta konfirmasi yang menyebut HPP lama dan baru. Supervisor tidak melihat nilai HPP, jadi peringatannya bersyarat ("Bila bahan ini sudah punya HPP...").
- Stok/produksi: kolom HPP dikunci bila bahan terbukti punya riwayat pembelian; selain itu tetap terbuka untuk HPP awal dengan catatan.

## Kemasan beli di Data Master (v2.6.7, migrasi 0037)
Dua kolom opsional pada `materials`: `pack_unit` (nama kemasan, mis. `pack`) dan `pack_size` (isi satu kemasan dalam **satuan utama bahan**, mis. 24 untuk satuan `pcs`). Diisi di Data Master > Bahan dan kemasan ("Nama kemasan beli" dan "Isi 1 kemasan"). Keduanya harus terisi berdua atau kosong berdua (dijaga klien dan constraint `materials_pack_chk`; isi harus > 0).
- **Stok, opname, HPP, laporan tidak berubah.** Tetap satuan utama. Kolom ini hanya tampilan dan kemudahan input; tidak ada RPC stok yang disentuh. Satu-satunya fungsi yang berubah adalah `app.bootstrap`, yang kini ikut mengirim `pack_nama` dan `pack_isi` pada daftar bahan (hanya untuk peran backoffice, seperti sebelumnya).
- **Pembelian > Per kemasan**: nama dan isi terisi otomatis dari Data Master di semua perangkat. Pengguna masih bisa mengubah isi untuk satu pembelian. Ingatan per perangkat (`pbpack`) hanya dipakai bila Data Master belum punya kemasan bahan itu, dan tidak lagi menimpa apa pun bila sudah ada.
- **Daftar stok (Bahan dan kemasan)**: baris bahan yang punya kemasan menampilkan "≈ N pack" (stok ÷ isi, 1 desimal; tidak tampil bila stok 0). Hanya tampilan; angka utama tetap dalam satuan bahan.
- Klien 2.6.6 tetap berjalan di atas skema 0037 (kunci tambahan diabaikan). Klien 2.6.7 butuh skema 0037 atau lebih baru (`MIN_SCHEMA`, kini 0038).
- Tes: `npm run test:beli` (klien) dan `supabase/tests/014_material_pack.test.sql` (database; dijalankan lewat `supabase/tests/run.sh`).
