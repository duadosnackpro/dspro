-- Tes migrasi 0038: input transaksi penjualan lama (bertanggal lampau). Dijalankan setelah 001-014.
\set ON_ERROR_STOP on
-- Tes ini menguji perilaku TANPA opsi. Produk uji dari 011 beropsi (wajib dipilih sejak 0039), jadi opsinya dimatikan di sini; pengujian opsi ada di 016.
update public.products set use_options = false where id in (select product_id from public.product_variants where id in (t.id('v1'), t.id('v2')));
do $$
declare
  o uuid := t.id('o1'); ch uuid := t.id('ch'); v1 uuid := t.id('v1'); v2 uuid := t.id('v2');
  e text; r jsonb; r2 jsonb; s0 numeric; s1 numeric; sid uuid; n0 bigint; tz text; no1 text; no2 text;
  base jsonb;
begin
  select timezone into tz from public.outlets where id = o;
  base := jsonb_build_object('outlet_id', o, 'channel_id', ch, 'tanggal', '2026-10-31 14:05:00', 'metode_bayar', 'tunai', 'potong_stok', false,
                             'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 3, 'harga', 9000)));

  -- hak: hanya owner/admin
  perform t.login(t.id('ka'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-kasir-0001'));
  perform t.ok(e like '42501%', 'kasir tidak boleh input transaksi lama: ' || coalesce(e, 'NULL'));
  perform t.logout(); perform t.login(t.id('ks'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-stok-00001'));
  perform t.ok(e like '42501%', 'peran stok tidak boleh input transaksi lama: ' || coalesce(e, 'NULL'));
  perform t.logout();

  perform t.login(t.id('owner'));
  -- validasi
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-masadepan1', 'tanggal', '2999-01-01 10:00:00'));
  perform t.ok(e like 'P0001%', 'tanggal masa depan ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-formatsalah', 'tanggal', '31/10/2026'));
  perform t.ok(e like '22023%', 'format tanggal salah ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-metodelain1', 'metode_bayar', 'lain'));
  perform t.ok(e like 'P0001%', 'metode lain ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-chinvalid01', 'channel_id', gen_random_uuid()));
  perform t.ok(e like 'P0001%', 'channel tidak valid ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-kosong00001', 'items', '[]'::jsonb));
  perform t.ok(e like '22023%', 'tanpa item ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bd-qtynol00001', 'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 0))));
  perform t.ok(e like '22023%', 'jumlah 0 ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base);
  perform t.ok(e like '22023%', 'tanpa request_id ditolak: ' || coalesce(e, 'NULL'));

  -- transaksi tunai tanpa potong stok: tanggal asli, tanpa sesi kasir, stok tidak berubah
  select coalesce(quantity, 0) into s0 from public.inventory_balances where outlet_id = o and variant_id = v1;
  select count(*) into n0 from public.audit_logs where action = 'sale_backdate';
  r := public.rpc_sale_backdate(base || jsonb_build_object('request_id', 'bd-tunai-00001', 'catatan', 'buku catatan'));
  sid := (r -> 'sale' ->> 'id')::uuid; no1 := r -> 'sale' ->> 'nomor';
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 27000, 'total = 3 x 9.000');
  perform t.ok((select (sold_at at time zone tz)::date = date '2026-10-31' and cash_session_id is null and payment_method = 'tunai' and kind = 'sale' and status = 'completed'
                  and note like 'Transaksi lama%buku catatan' from public.sales where id = sid), 'tanggal asli (zona outlet), tanpa sesi kasir, tercatat sebagai penjualan selesai');
  perform t.ok(no1 like (select code from public.outlets where id = o) || '-261031-%', 'nomor struk memakai tanggal transaksi: ' || no1);
  perform t.ok((select count(*) = 1 and bool_and(unit_price = 9000 and qty = 3) from public.sale_items where sale_id = sid), 'baris item memakai harga yang dikirim');
  perform t.ok((select method = 'tunai' and amount = 27000 and cash_session_id is null from public.payments where sale_id = sid), 'pembayaran tercatat tanpa sesi kasir');
  select coalesce(quantity, 0) into s1 from public.inventory_balances where outlet_id = o and variant_id = v1;
  perform t.ok(s1 = s0, 'potong_stok = false: stok tidak berubah');
  perform t.ok((select count(*) from public.audit_logs where action = 'sale_backdate') = n0 + 1, 'tercatat di audit');

  -- anti-ganda: request_id sama + isi sama => hasil pertama
  r2 := public.rpc_sale_backdate(base || jsonb_build_object('request_id', 'bd-tunai-00001', 'catatan', 'buku catatan'));
  perform t.ok((r2 -> 'sale' ->> 'id')::uuid = sid and (select count(*) from public.sales where request_id = 'bd-tunai-00001') = 1, 'kirim ulang tidak membuat transaksi ganda');

  -- nomor struk berurutan pada tanggal yang sama
  r2 := public.rpc_sale_backdate(base || jsonb_build_object('request_id', 'bd-tunai-00002', 'tanggal', '2026-10-31 18:30'));
  no2 := r2 -> 'sale' ->> 'nomor';
  perform t.ok(no2 <> no1 and no2 like (select code from public.outlets where id = o) || '-261031-%', 'nomor struk kedua pada tanggal sama berbeda: ' || no2);

  -- QRIS, harga channel (tanpa harga), baris varian sama digabung, stok dipotong
  select coalesce(quantity, 0) into s0 from public.inventory_balances where outlet_id = o and variant_id = v1;
  r := public.rpc_sale_backdate(jsonb_build_object('outlet_id', o, 'channel_id', ch, 'tanggal', '2026-11-01 10:00:00', 'metode_bayar', 'qris', 'request_id', 'bd-qris-000001',
         'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 1), jsonb_build_object('variant_id', v1, 'qty', 2))));
  sid := (r -> 'sale' ->> 'id')::uuid;
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 30000, 'harga channel dipakai bila harga kosong: 3 x 10.000');
  perform t.ok((select count(*) = 1 and sum(qty) = 3 from public.sale_items where sale_id = sid), 'baris varian sama digabung');
  perform t.ok((select method = 'qris' from public.payments where sale_id = sid), 'metode QRIS tercatat');
  select coalesce(quantity, 0) into s1 from public.inventory_balances where outlet_id = o and variant_id = v1;
  perform t.ok(s1 = s0 - 3, 'potong_stok bawaan (true): stok berkurang 3, boleh minus: ' || s0 || ' -> ' || s1);
  perform t.ok((select count(*) = 1 from public.stock_movements where reference_id = sid and movement_type = 'sale'), 'mutasi stok tercatat sebagai penjualan');

  -- HPP baris: kosong (NULL) bila HPP rata-rata 0
  -- avg_cost tidak boleh dibaca role authenticated (lihat grant kolom), jadi baca sebagai superuser
  perform t.logout();
  perform t.ok((select hpp_snapshot is not distinct from nullif((select avg_cost from public.inventory_balances where outlet_id = o and variant_id = v1), 0) from public.sale_items where sale_id = sid limit 1), 'HPP baris = HPP rata-rata saat ini (NULL bila 0)');
end $$;
select 'Tes transaksi lama selesai' as hasil;
