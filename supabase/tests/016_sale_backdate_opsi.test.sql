-- Tes migrasi 0039: input transaksi lama dengan OPSI PRODUK (cara masak, level). Dijalankan setelah 001-015.
\set ON_ERROR_STOP on

-- ===== Data uji: produk beropsi (Level + Cara masak wajib) dan produk tanpa opsi =====
do $$
declare pr uuid; va uuid; vb uuid; g_lv uuid; g_cm uuid; g_x uuid; i_x uuid; vn uuid; prn uuid;
begin
  select id into g_lv from public.option_groups where lower(name) = 'level' and active;
  select id into g_cm from public.option_groups where lower(name) = 'cara masak' and active;
  insert into public.option_groups (name, sort) values ('Topping Lama', 9) returning id into g_x;
  insert into public.option_items (group_id, name) values (g_x, 'Keju Lama') returning id into i_x;
  insert into public.products (name, category, use_options) values ('Pangsit Opsi Lama', 'Snack', true) returning id into pr;
  insert into public.product_variants (product_id, sku, size) values (pr, 'PGS-650', '650 ml') returning id into va;
  insert into public.product_variants (product_id, sku, size) values (pr, 'PGS-300', '300 ml') returning id into vb;
  insert into public.channel_prices (variant_id, channel_id, price) values (va, t.id('ch'), 20000), (vb, t.id('ch'), 12000);
  insert into public.product_option_groups (product_id, group_id, required, sort) values (pr, g_lv, true, 1), (pr, g_cm, true, 2);
  insert into public.products (name, category) values ('Keripik Polos Lama', 'Snack') returning id into prn;
  insert into public.product_variants (product_id, sku, size) values (prn, 'KRP-LAMA', '100g') returning id into vn;
  insert into public.channel_prices (variant_id, channel_id, price) values (vn, t.id('ch'), 7000);
  insert into t.ids values ('bo_pr', pr), ('bo_va', va), ('bo_vb', vb), ('bo_vn', vn), ('bo_glv', g_lv), ('bo_gcm', g_cm), ('bo_gx', g_x), ('bo_ix', i_x),
    ('bo_l1', (select id from public.option_items where group_id = g_lv and name = 'Level 1')),
    ('bo_l3', (select id from public.option_items where group_id = g_lv and name = 'Level 3')),
    ('bo_gr', (select id from public.option_items where group_id = g_cm and name = 'Goreng')),
    ('bo_rb', (select id from public.option_items where group_id = g_cm and name = 'Rebus'));
end $$;

do $$
declare
  o uuid := t.id('o1'); ch uuid := t.id('ch'); va uuid := t.id('bo_va'); vb uuid := t.id('bo_vb'); vn uuid := t.id('bo_vn');
  l1 uuid := t.id('bo_l1'); l3 uuid := t.id('bo_l3'); gr uuid := t.id('bo_gr'); rb uuid := t.id('bo_rb'); ix uuid := t.id('bo_ix');
  e text; r jsonb; sid uuid; base jsonb; s0 numeric; s1 numeric; d3 numeric; tot numeric;
begin
  select price_delta into d3 from public.option_items where id = l3;   -- selisih harga Level 3 dibaca dari tabel (tes sebelumnya dapat mengubahnya)
  perform t.ok(d3 > 0, 'selisih harga Level 3 > 0 untuk menguji harga opsi: ' || d3);
  tot := 3 * (20000 + d3) + 1 * 20000 + 2 * 7000;
  base := jsonb_build_object('outlet_id', o, 'channel_id', ch, 'tanggal', '2026-11-01 11:00:00', 'metode_bayar', 'tunai', 'potong_stok', false);
  perform t.login(t.id('owner'));

  -- validasi opsi
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bo-tanpaopsi01', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 1))));
  perform t.ok(e like 'P0001%' and e like '%opsi wajib%', 'produk beropsi tanpa pilihan wajib ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bo-setengah001', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', jsonb_build_array(l1)))));
  perform t.ok(e like 'P0001%' and e like '%Cara masak%', 'hanya Level tanpa Cara masak ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bo-asing-00001', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', jsonb_build_array(l1, gr, ix)))));
  perform t.ok(e like 'P0001%' and e like '%bukan milik produk%', 'opsi milik grup yang tidak tertaut ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bo-ganda-00001', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', jsonb_build_array(l1, l3, gr)))));
  perform t.ok(e like 'P0001%' and e like '%satu pilihan per grup%', 'dua pilihan dalam satu grup ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bo-takdikenal1', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', jsonb_build_array(gen_random_uuid(), gr)))));
  perform t.ok(e like 'P0001%' and e like '%tidak dikenal%', 'id opsi tidak dikenal ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_backdate', base || jsonb_build_object('request_id', 'bo-formatsalah', 'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', 'bukan-larik'))));
  perform t.ok(e like '22023%', 'format opsi salah ditolak: ' || coalesce(e, 'NULL'));
  perform t.ok((select count(*) from public.sales where request_id like 'bo-%') = 0, 'semua penolakan tidak meninggalkan transaksi');

  -- harga kosong: harga channel + selisih opsi Level 3; baris varian sama dengan opsi berbeda TIDAK digabung; opsi sama digabung
  r := public.rpc_sale_backdate(base || jsonb_build_object('request_id', 'bo-campur-0001', 'items', jsonb_build_array(
         jsonb_build_object('variant_id', va, 'qty', 2, 'opsi', jsonb_build_array(l3, gr)),
         jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', jsonb_build_array(gr, l3)),
         jsonb_build_object('variant_id', va, 'qty', 1, 'opsi', jsonb_build_array(l1, rb)),
         jsonb_build_object('variant_id', vn, 'qty', 2))));
  sid := (r -> 'sale' ->> 'id')::uuid;
  perform t.ok((r -> 'sale' ->> 'total')::numeric = tot, 'total = 3 x (20.000 + selisih Level 3) + 20.000 + 2 x 7.000 = ' || tot || ', hasil ' || (r -> 'sale' ->> 'total'));
  perform t.logout();
  perform t.ok((select count(*) from public.sale_items where sale_id = sid) = 3, 'dua kombinasi opsi + satu produk tanpa opsi = 3 baris (opsi sama digabung, beda opsi terpisah)');
  perform t.ok((select qty = 3 and unit_price = 20000 + d3 and option_label = 'Level 3 · Goreng' from public.sale_items where sale_id = sid and option_label = 'Level 3 · Goreng'), 'label opsi urut grup (Level, Cara masak), jumlah digabung 3, harga = channel + selisih');
  perform t.ok((select qty = 1 and unit_price = 20000 and option_label = 'Level 1 · Rebus' from public.sale_items where sale_id = sid and option_label = 'Level 1 · Rebus'), 'Level 1 Rebus tanpa tambahan harga');
  perform t.ok((select option_key = '' and option_label is null from public.sale_items where sale_id = sid and variant_id = vn), 'produk tanpa opsi: option_key kosong, label NULL');
  perform t.ok((select count(*) = 4 from public.sale_item_options o join public.sale_items i on i.id = o.sale_item_id where i.sale_id = sid), 'snapshot sale_item_options: 2 baris beropsi x 2 grup = 4');
  perform t.ok((select price_delta = d3 and group_name = 'Level' and item_name = 'Level 3' from public.sale_item_options o join public.sale_items i on i.id = o.sale_item_id where i.sale_id = sid and o.item_id = l3), 'snapshot menyimpan nama grup, nama item, dan selisih harga');
  perform t.ok((select subtotal = tot and total = tot from public.sales where id = sid), 'subtotal dan total transaksi sesuai');

  -- harga manual = harga satuan akhir (sudah termasuk opsi); kirim ulang aman (request_id sama)
  perform t.login(t.id('owner'));
  base := base || jsonb_build_object('request_id', 'bo-manual-0001', 'items', jsonb_build_array(jsonb_build_object('variant_id', vb, 'qty', 2, 'harga', 11000, 'opsi', jsonb_build_array(l3, gr))));
  r := public.rpc_sale_backdate(base);
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 22000, 'harga manual dipakai apa adanya sebagai harga satuan akhir: 2 x 11.000');
  sid := (r -> 'sale' ->> 'id')::uuid;
  perform t.ok((public.rpc_sale_backdate(base) -> 'sale' ->> 'id')::uuid = sid, 'kirim ulang dengan opsi yang sama tidak membuat transaksi ganda');
  perform t.logout();
  perform t.ok((select count(*) from public.sales where request_id = 'bo-manual-0001') = 1, 'hanya satu transaksi untuk request_id yang sama');

  -- stok dipotong per varian (jumlah semua kombinasi opsi), bukan per opsi
  s0 := coalesce((select quantity from public.inventory_balances where outlet_id = o and variant_id = va), 0);   -- varian baru belum punya baris saldo
  perform t.login(t.id('owner'));
  r := public.rpc_sale_backdate(jsonb_build_object('outlet_id', o, 'channel_id', ch, 'tanggal', '2026-11-01 12:00:00', 'metode_bayar', 'qris', 'request_id', 'bo-stok-000001',
         'items', jsonb_build_array(jsonb_build_object('variant_id', va, 'qty', 2, 'opsi', jsonb_build_array(l1, gr)), jsonb_build_object('variant_id', va, 'qty', 3, 'opsi', jsonb_build_array(l3, rb)))));
  perform t.logout();
  s1 := coalesce((select quantity from public.inventory_balances where outlet_id = o and variant_id = va), 0);
  perform t.ok(s1 = s0 - 5, 'stok varian berkurang 5 (2 + 3 lintas opsi): ' || s0 || ' -> ' || s1);
  perform t.ok((select count(*) = 1 and sum(abs(quantity_delta)) = 5 from public.stock_movements where reference_id = (r -> 'sale' ->> 'id')::uuid and movement_type = 'sale'), 'satu mutasi stok per varian');
end $$;
select 'Tes transaksi lama beropsi selesai' as hasil;
