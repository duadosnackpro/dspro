# Opsi Produk (v2.6.0): laporan pelaksanaan

Mengikuti `Framework-Opsi-Produk-Supabase.md`. Migrasi `20261101000032_opsi_produk.sql`, tes SQL `supabase/tests/011_opsi_produk.test.sql`.

## Penyesuaian terhadap framework (hasil membaca repo)
- Repo tidak punya `tenant_id`: katalog global, hak tulis Owner/Admin. Tabel opsi mengikuti pola `products` (tanpa `tenant_id`, seed dibuat di migrasi).
- Fungsi ada di skema `app.*` dengan pembungkus `public.rpc_*` (pola repo dipakai).
- `sale_create` menggabungkan baris per varian; kini per varian + opsi (harga bisa beda). Stok tetap dikurangi per varian (`stock_apply` tidak diubah).
- Retur dikunci per varian saja, sehingga dengan selisih harga akan salah nilai. Kini kunci = varian + opsi (`sale_items.option_key`), klien mengirim `opsi`.
- `data_reset` diganti agar menghapus `sale_item_options` (trigger anti-hapus dimatikan hanya di dalam fungsi, pola yang sama dengan ledger).
- Tautan produk-grup tetap dikirim bootstrap walau saklar mati (konfigurasi tidak hilang); Kasir hanya menampilkan bila `pakai_opsi`.
- Mengaktifkan saklar pada produk yang belum punya opsi mencentang semua grup pustaka (hapus yang tidak perlu): produk baru beropsi = 3 ketukan.

## Rollback
Matikan saklar per produk (opsi tetap tersimpan). Migrasi forward-only; klien lama tetap bisa menjual produk tanpa opsi.
