# Beranda (dashboard)

## Susunan (v2.6.10 dan v2.6.11)
1. **Kartu omzet:** omzet periode, pembanding, **laba kotor, laba bersih, margin**, rincian laba bersih (fee channel, biaya, kerugian stok; atau keterangan bahwa nilainya nol), lalu grafik harian berlabel nama hari. "Hari ini" tidak menampilkan grafik satu batang.
2. **Tiga angka:** Transaksi, Produk terjual (pcs), Rata-rata per transaksi, masing-masing dengan panah perubahan terhadap periode pembanding. Di bawahnya satu baris catatan **Diskon** dan **Retur** (hanya bila ada).
3. **Penjualan per** [Channel | Pembayaran].
4. **Produk terlaris** [Jumlah | Omzet | Laba]: 3 teratas, sisanya dilipat.
5. **Jam ramai:** 3 jam dengan transaksi terbanyak.
6. **Stok bahan perlu perhatian:** ringkasan "N habis / M menipis" (jumlah sebenarnya dari server), 3 teratas, sisanya dilipat, tombol Buka Stok.
Peringatan lain (stok minus, transaksi perlu ditinjau, HPP belum lengkap) tetap berada di ikon lonceng.

## Arti angka (migrasi 0041, `app.dashboard`)
- **Produk terjual (`cur.pcs`)** bersifat neto: retur mengurangi. Pembandingnya `prev.pcs`.
- **Diskon (`cur.diskon`)**: jumlah diskon pada penjualan (bukan retur). **Retur (`retur_n`, `retur_rp`)**: banyak transaksi retur dan nilainya; nilai ini **sudah mengurangi omzet**.
- **Per pembayaran (`metode`)**: jumlah pembayaran terkonfirmasi per metode, neto retur, urut terbesar. Angka ini mengikuti tabel pembayaran (sama dengan laporan "Pembayaran per metode"), jadi **dapat termasuk PPN** bila outlet memakainya, sedangkan omzet Beranda tanpa PPN.
- **Jam ramai (`jam`)**: hanya penjualan kasir (punya sesi kas), jam lokal outlet. Transaksi lama yang diinput belakangan **tidak dihitung** karena jam aslinya tidak tercatat.
- **Terlaris menurut omzet/laba (`top_om`, `top_laba`)**: laba = jumlah baris dikurangi HPP baris; baris tanpa HPP dihitung HPP 0, sehingga **laba produk bisa terlalu tinggi** bila HPP belum lengkap (Beranda memberi catatan saat peringatan HPP aktif).
- **Bahan habis/menipis (`low_habis`, `low_tipis`)**: jumlah sebenarnya; daftar `low` tetap dibatasi 10 bahan.

## Kompatibilitas
- Migrasi 0041 hanya **menambah** kunci pada keluaran (`create or replace app.dashboard`). Klien 2.6.10 dan sebelumnya tetap berjalan.
- Klien 2.6.11 tetap menampilkan Beranda dengan benar bila server belum memasang 0041 (kartu/tab baru tidak muncul). Karena itu `MIN_SCHEMA` tetap 0040. Cache Beranda memakai penanda `|v2` sehingga data lama tanpa kunci baru diambil ulang.

## Tes
`npm run test:dashui` (tampilan, tab, data lama/baru, mutasi teruji) dan `supabase/tests/018_dashboard_tahap2.test.sql` (angka server pada data uji: pcs neto, diskon, retur, per metode = total neto, jam, urutan, total bahan, hak akses).
