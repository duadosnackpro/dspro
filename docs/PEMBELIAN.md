# Pembelian bahan dan HPP manual (v2.6.6)

Kode: `src/app/09-stok-pembelian.js` (jangan ubah `web/js/app.js` langsung; jalankan `npm run build`). Tes: `npm run test:beli`.

## Anti-ganda (`request_id`)
`pbSave` mengirim `request_id`. Nilainya dibuat saat Simpan pertama kali dan **dipakai ulang** selama isian sama (ketuk dua kali, jaringan putus lalu coba lagi), jadi server (`idem_begin` scope `purchase`) mengembalikan hasil lama dan stok tidak bertambah dua kali. Isian berubah (tambah/hapus baris, supplier, ongkir) = `request_id` baru lewat `pbTouch()`. Setelah berhasil, `request_id` dikosongkan. Bila server menjawab `duplicate: true`, klien memuat ulang data (stok di jawaban duplikat adalah stok saat itu, bukan sekarang).

## Pembanding harga
Klien memanggil `purchase.last` (adapter: 40 pembelian terakhir yang tidak dibatalkan di outlet aktif, diambil lewat REST yang sama dengan `purchase.list`; tanpa migrasi). Ditampilkan sebagai keterangan dan placeholder kolom Harga satuan: harga beli terakhir (+ tanggal) dan, hanya untuk peran yang melihat biaya (owner/admin/auditor), HPP rata-rata. Peran supervisor dan stok **tidak menerima** `hpp_rata2` dari server (`rpc_bootstrap`), jadi mereka hanya melihat harga beli terakhir. Bahan yang tidak muncul di 40 pembelian terakhir tidak punya harga terakhir.

## Peringatan selisih
Saat "Tambah ke daftar", bila harga satuan menyimpang lebih dari `PB_WARN` (30%) dari pembanding, muncul konfirmasi. Pembanding: HPP rata-rata bila terlihat, selain itu harga beli terakhir. Tanpa pembanding, tidak ada peringatan. HPP rata-rata sudah memuat ongkir, jadi selisih kecil di bawah ambang itu wajar.

## Input per kemasan
Mode "Per kemasan": jumlah kemasan × isi per kemasan = jumlah (satuan bahan); harga kemasan ÷ isi = harga satuan (dibulatkan 4 desimal, sama dengan kolom `unit_price`). Server tetap menerima jumlah dan harga per satuan, tanpa perubahan kontrak. Nama dan isi kemasan diingat per bahan di perangkat (`LS` kunci `pbpack`).

## HPP manual di Penyesuaian stok
Server (`stock_adjust`, F-13) sudah menolak perubahan HPP yang sudah ada oleh peran non-supervisor. Klien kini mencerminkannya:
- Owner/admin/supervisor: begitu kolom HPP diisi pada item yang sudah punya HPP, muncul "Ini menimpa HPP rata-rata hasil pembelian" (produk jadi: "hasil produksi"), dan saat Simpan diminta konfirmasi yang menyebut HPP lama dan baru. Supervisor tidak melihat nilai HPP, jadi peringatannya bersyarat ("Bila bahan ini sudah punya HPP...").
- Stok/produksi: kolom HPP dikunci bila bahan terbukti punya riwayat pembelian; selain itu tetap terbuka untuk HPP awal dengan catatan.
