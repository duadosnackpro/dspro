-- Tes migrasi 0032: Opsi Produk (level pedas, cara masak). Dijalankan setelah 001-010 (memakai t.ids: owner, ka, kb, o1, ch, v1).
\set ON_ERROR_STOP on
update public.settings set value = 'false' where key = 'wajib_buka_kasir' and outlet_id is null;

-- ===== Data uji: produk beropsi (v1,v2 = Basreng) dan produk tanpa opsi (Keripik/v3) =====
do $$
declare pr2 uuid; v3 uuid; g_lv uuid; g_cm uuid; g_x uuid; i_l3 uuid; i_l1 uuid; i_gr uuid; i_rb uuid; i_x uuid;
begin
  perform t.ok((select count(*) from public.option_groups where lower(name) in ('level', 'cara masak') and active) = 2, 'seed: grup Level dan Cara masak ada');
  perform t.ok((select count(*) from public.option_items i join public.option_groups g on g.id = i.group_id where lower(g.name) = 'level') = 3, 'seed: Level 1-3');
  perform t.ok((select count(*) from public.option_items i join public.option_groups g on g.id = i.group_id where lower(g.name) = 'cara masak') = 3, 'seed: Rebus, Goreng, Mix');
  insert into public.products (name, category) values ('Keripik Tanpa Opsi', 'Snack') returning id into pr2;
  insert into public.product_variants (product_id, sku, size) values (pr2, 'KRP-100', '100g') returning id into v3;
  insert into public.channel_prices (variant_id, channel_id, price) values (v3, t.id('ch'), 7000);
  insert into public.option_groups (name, sort) values ('Topping', 3) returning id into g_x;
  insert into public.option_items (group_id, name) values (g_x, 'Keju') returning id into i_x;
  select id into g_lv from public.option_groups where lower(name) = 'level';
  select id into g_cm from public.option_groups where lower(name) = 'cara masak';
  select id into i_l3 from public.option_items where group_id = g_lv and name = 'Level 3';
  select id into i_l1 from public.option_items where group_id = g_lv and name = 'Level 1';
  select id into i_gr from public.option_items where group_id = g_cm and name = 'Goreng';
  select id into i_rb from public.option_items where group_id = g_cm and name = 'Rebus';
  insert into t.ids values ('v3', v3), ('pr2', pr2), ('g_lv', g_lv), ('g_cm', g_cm), ('g_x', g_x), ('i_l3', i_l3), ('i_l1', i_l1), ('i_gr', i_gr), ('i_rb', i_rb), ('i_x', i_x),
    ('pr1', (select product_id from public.product_variants where id = t.id('v1')));
end $$;

-- ===== O1 hak akses: kasir tidak bisa menulis opsi (RPC maupun tabel langsung) =====
do $$ declare e text; begin
  perform t.login(t.id('ka'));
  e := t.err('rpc_option_group_save', jsonb_build_object('nama', 'Saus'));
  perform t.ok(e like '42501%', 'kasir tidak boleh menyimpan grup opsi: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_product_options_set', jsonb_build_object('product_id', t.id('pr1'), 'pakai_opsi', false));
  perform t.ok(e like '42501%', 'kasir tidak boleh mengatur opsi produk: ' || coalesce(e, 'NULL'));
  begin
    insert into public.option_items (group_id, name) values (t.id('g_lv'), 'Level 9');
    perform t.ok(false, 'kasir berhasil insert langsung ke option_items');
  exception when insufficient_privilege then null; end;
  begin
    update public.products set use_options = true where id = t.id('pr1');
    perform t.ok((select use_options from public.products where id = t.id('pr1')) = false, 'kasir mengubah use_options lewat update langsung');
  exception when insufficient_privilege then null; end;
  perform t.ok((select count(*) from public.option_groups) >= 3, 'kasir boleh membaca pustaka opsi');
  perform t.logout();
end $$;

-- ===== O2 pustaka dan tautan produk (owner) =====
do $$ declare e text; r jsonb; begin
  perform t.login(t.id('owner'));
  r := public.rpc_option_group_save(jsonb_build_object('id', t.id('g_lv'), 'items',
        jsonb_build_array(jsonb_build_object('id', t.id('i_l3'), 'selisih_harga', 500))));
  perform t.ok((select price_delta from public.option_items where id = t.id('i_l3')) = 500, 'selisih harga Level 3 = 500');
  e := t.err('rpc_option_group_save', jsonb_build_object('id', t.id('g_lv'), 'items', jsonb_build_array(jsonb_build_object('id', t.id('i_l3'), 'selisih_harga', -1))));
  perform t.ok(e like '22023%', 'selisih negatif ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_option_group_save', jsonb_build_object('id', t.id('g_lv'), 'items', jsonb_build_array(jsonb_build_object('nama', 'level 1'))));
  perform t.ok(e like 'P0001%', 'nama item ganda (tanpa beda huruf besar) ditolak: ' || coalesce(e, 'NULL'));

  e := t.err('rpc_product_options_set', jsonb_build_object('product_id', t.id('pr1'), 'pakai_opsi', true));
  perform t.ok(e like 'P0001%', 'mengaktifkan opsi tanpa grup ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_product_options_set', jsonb_build_object('product_id', t.id('pr1'), 'pakai_opsi', true,
        'tautan', jsonb_build_array(jsonb_build_object('group_id', t.id('g_lv'), 'default_item_id', t.id('i_gr')))));
  perform t.ok(e like 'P0001%', 'default dari grup lain ditolak: ' || coalesce(e, 'NULL'));
  r := public.rpc_product_options_set(jsonb_build_object('product_id', t.id('pr1'), 'pakai_opsi', true, 'tautan', jsonb_build_array(
        jsonb_build_object('group_id', t.id('g_lv'), 'wajib', true, 'urutan', 1, 'default_item_id', t.id('i_l1')),
        jsonb_build_object('group_id', t.id('g_cm'), 'wajib', true, 'urutan', 2))));
  perform t.ok((r ->> 'pakai_opsi')::boolean and jsonb_array_length(r -> 'tautan') = 2, 'produk beropsi dengan 2 grup');
  perform t.ok((select count(*) from public.audit_logs where action in ('option_group_save', 'product_options_set')) >= 2, 'perubahan opsi tercatat di audit');
  perform t.logout();

  -- bootstrap membawa opsi aktif dalam satu payload
  perform t.login(t.id('ka'));
  r := public.rpc_bootstrap(jsonb_build_object('outlet_id', t.id('o1')));
  perform t.ok(jsonb_array_length(r -> 'option_groups') >= 2 and jsonb_array_length(r -> 'product_options') = 2, 'bootstrap: grup dan tautan aktif');
  perform t.ok((select (pe ->> 'pakai_opsi')::boolean from jsonb_array_elements(r -> 'products') pe where pe ->> 'id' = t.id('pr1')::text), 'bootstrap: pakai_opsi produk');
  perform t.logout();

  -- stok awal untuk uji penjualan
  perform t.login(t.id('owner'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', t.id('o1'), 'tipe', 'varian', 'id', t.id('v1'), 'stok_baru', 100, 'hpp', 6000, 'alasan', 'uji opsi'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', t.id('o1'), 'tipe', 'varian', 'id', t.id('v3'), 'stok_baru', 100, 'hpp', 3000, 'alasan', 'uji opsi'));
  perform t.logout();
end $$;

-- ===== O3 penjualan: harga server, label, snapshot, netral stok =====
do $$ declare r jsonb; sid uuid; s0 numeric; m0 bigint; begin
  select quantity into s0 from public.inventory_balances where outlet_id = t.id('o1') and variant_id = t.id('v1');
  select count(*) into m0 from public.stock_movements where movement_type = 'sale';
  perform t.login(t.id('ka'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0001', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 2, 'opsi', jsonb_build_array(t.id('i_l3'), t.id('i_gr')))),
        'total_klien', 21000, 'amount_received', 30000));
  perform t.logout();
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 21000, 'total = 2 x (10000 + 500): ' || (r -> 'sale' ->> 'total'));
  perform t.ok(not (r ->> 'price_changed')::boolean, 'price_changed salah bila total klien sama');
  select id into sid from public.sale_items where sale_id = (r -> 'sale' ->> 'id')::uuid;
  perform t.ok((select unit_price from public.sale_items where id = sid) = 10500, 'unit_price sudah termasuk selisih opsi');
  perform t.ok((select option_label from public.sale_items where id = sid) = 'Level 3 · Goreng', 'label berurut menurut sort grup: ' || coalesce((select option_label from public.sale_items where id = sid), 'NULL'));
  perform t.ok((select name_snapshot from public.sale_items where id = sid) = 'Basreng 100g 2', 'name_snapshot tetap nama dasar: ' || (select name_snapshot from public.sale_items where id = sid));
  perform t.ok((select count(*) from public.sale_item_options where sale_item_id = sid) = 2, 'dua snapshot opsi tersimpan');
  perform t.ok((select price_delta from public.sale_item_options where sale_item_id = sid and group_name = 'Level') = 500, 'snapshot selisih harga');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('o1') and variant_id = t.id('v1')) = s0 - 2, 'stok berkurang hanya sebesar qty');
  perform t.ok((select count(*) from public.stock_movements where movement_type = 'sale') = m0 + 1, 'satu mutasi stok; opsi tidak membuat mutasi');
  perform t.ok((select hpp_snapshot from public.sale_items where id = sid) = 6000, 'HPP tidak terpengaruh opsi');

  -- mengubah harga/nama opsi tidak mengubah riwayat
  perform t.login(t.id('owner'));
  perform public.rpc_option_group_save(jsonb_build_object('id', t.id('g_lv'), 'items', jsonb_build_array(jsonb_build_object('id', t.id('i_l3'), 'selisih_harga', 900, 'nama', 'Level 3 Pedas'))));
  perform t.logout();
  perform t.ok((select price_delta from public.sale_item_options where sale_item_id = sid and group_name = 'Level') = 500
           and (select item_name from public.sale_item_options where sale_item_id = sid and group_name = 'Level') = 'Level 3', 'riwayat tidak berubah setelah opsi diubah');
  perform t.login(t.id('owner'));
  perform public.rpc_option_group_save(jsonb_build_object('id', t.id('g_lv'), 'items', jsonb_build_array(jsonb_build_object('id', t.id('i_l3'), 'selisih_harga', 500, 'nama', 'Level 3'))));
  perform t.logout();
end $$;

-- ===== O4 validasi =====
do $$ declare e text; s0 numeric; n0 bigint; base jsonb; begin
  select quantity into s0 from public.inventory_balances where outlet_id = t.id('o1') and variant_id = t.id('v1');
  select count(*) into n0 from public.sales;
  perform t.login(t.id('ka'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0002', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'))))));
  perform t.ok(e like 'P0001%' and e like '%opsi wajib%', 'grup wajib kosong ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0003', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1))));
  perform t.ok(e like 'P0001%' and e like '%opsi wajib%', 'produk beropsi tanpa opsi ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0004', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'), t.id('i_gr'), t.id('i_x'))))));
  perform t.ok(e like 'P0001%' and e like '%bukan milik produk%', 'item grup yang tidak ditautkan ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0005', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'), t.id('i_l1'), t.id('i_gr'))))));
  perform t.ok(e like 'P0001%' and e like '%satu pilihan per grup%', 'dua item satu grup ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0006', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(gen_random_uuid(), t.id('i_gr'))))));
  perform t.ok(e like 'P0001%' and e like '%tidak dikenal%', 'id opsi tidak dikenal ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0007', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array('bukan-uuid')))));
  perform t.ok(e like '22023%', 'id opsi tidak valid ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0008', 'channel_id', t.id('ch'), 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v3'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'))))));
  perform t.ok(e like 'P0001%' and e like '%bukan milik produk%', 'opsi milik produk lain ditolak: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.ok((select count(*) from public.sales) = n0, 'penolakan tidak meninggalkan data parsial');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('o1') and variant_id = t.id('v1')) = s0, 'stok tidak berubah setelah penolakan');
end $$;

-- ===== O5 produk tanpa opsi: jalur biasa; varian sama beda opsi = dua baris, satu mutasi stok =====
do $$ declare r jsonb; sid uuid; m0 bigint; s0 numeric; begin
  perform t.login(t.id('ka'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0010', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v3'), 'qty', 3)), 'total_klien', 21000, 'amount_received', 21000));
  perform t.logout();
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 21000, 'produk tanpa opsi tetap 7000 x 3');
  select id into sid from public.sale_items where sale_id = (r -> 'sale' ->> 'id')::uuid;
  perform t.ok((select option_label is null and option_key = '' from public.sale_items where id = sid) and not exists (select 1 from public.sale_item_options where sale_item_id = sid), 'tanpa label dan tanpa baris opsi');

  select quantity into s0 from public.inventory_balances where outlet_id = t.id('o1') and variant_id = t.id('v1');
  select count(*) into m0 from public.stock_movements where movement_type = 'sale';
  perform t.login(t.id('ka'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0011', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(
          jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'), t.id('i_gr'))),
          jsonb_build_object('variant_id', t.id('v1'), 'qty', 2, 'opsi', jsonb_build_array(t.id('i_gr'), t.id('i_l3'))),   -- urutan id berbeda = baris yang sama
          jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l1'), t.id('i_rb')))),
        'total_klien', 41500, 'amount_received', 50000));
  perform t.logout();
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 3 * 10500 + 10000, 'harga per baris opsi: ' || (r -> 'sale' ->> 'total'));
  perform t.ok((select count(*) from public.sale_items where sale_id = (r -> 'sale' ->> 'id')::uuid) = 2, 'opsi sama digabung; opsi berbeda terpisah');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('o1') and variant_id = t.id('v1')) = s0 - 4, 'stok varian berkurang 4');
  perform t.ok((select count(*) from public.stock_movements where movement_type = 'sale') = m0 + 1, 'mutasi stok: satu untuk v1 (gabungan) dan tidak per opsi');
end $$;

-- ===== O6 transaksi tertunda (offline): item nonaktif diterima dan ditandai; online ditolak =====
do $$ declare e text; r jsonb; ts bigint := (extract(epoch from now() - interval '10 minutes') * 1000)::bigint; begin
  perform t.login(t.id('owner'));
  perform public.rpc_option_group_save(jsonb_build_object('id', t.id('g_cm'), 'items', jsonb_build_array(jsonb_build_object('id', t.id('i_rb'), 'aktif', false))));
  perform t.logout();
  perform t.login(t.id('ka'));
  e := t.err('rpc_sale_create', jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0020', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l1'), t.id('i_rb'))))));
  perform t.ok(e like 'P0001%' and e like '%tidak aktif%', 'item nonaktif ditolak untuk transaksi online: ' || coalesce(e, 'NULL'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0021', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'offline', true, 'client_ts', ts, 'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l1'), t.id('i_rb')))),
        'total_klien', 9000, 'amount_received', 20000));
  perform t.logout();
  perform t.ok((r ->> 'review')::boolean and (r ->> 'price_changed')::boolean, 'transaksi tertunda diterima dengan tanda tinjau dan price_changed (harga server 10000)');
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 10000, 'dihitung dengan harga saat sinkron');
  perform t.login(t.id('owner'));
  perform public.rpc_option_group_save(jsonb_build_object('id', t.id('g_cm'), 'items', jsonb_build_array(jsonb_build_object('id', t.id('i_rb'), 'aktif', true))));
  perform t.logout();
end $$;

-- ===== O7 idempotensi request_id =====
do $$ declare r1 jsonb; r2 jsonb; p jsonb; n0 bigint; n1 bigint; begin
  p := jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0030', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l1'), t.id('i_gr')))), 'amount_received', 10000);
  perform t.login(t.id('ka'));
  r1 := public.rpc_sale_create(p);
  select count(*) into n0 from public.sale_item_options;
  r2 := public.rpc_sale_create(p);
  perform t.logout();
  select count(*) into n1 from public.sale_item_options;
  perform t.ok((r2 ->> 'duplicate')::boolean and (r1 -> 'sale' ->> 'id') = (r2 -> 'sale' ->> 'id') and n0 = n1, 'percobaan ulang tidak menggandakan baris opsi');
end $$;

-- ===== O8 retur menyalin opsi; kunci retur per baris (varian + opsi) =====
do $$ declare r jsonb; rs jsonb; e text; sid uuid; rid uuid; begin
  perform t.login(t.id('ka'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0040', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'), t.id('i_gr'))),
                                   jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l1'), t.id('i_gr')))), 'amount_received', 30000));
  sid := (r -> 'sale' ->> 'id')::uuid;
  rs := public.rpc_sale_detail(jsonb_build_object('id', sid));
  perform t.logout();
  perform t.ok(jsonb_array_length(rs -> 'items') = 2, 'detail memisahkan baris per opsi');
  perform t.ok(exists (select 1 from jsonb_array_elements(rs -> 'items') pe where pe ->> 'label' = 'Level 3 · Goreng' and jsonb_array_length(pe -> 'opsi') = 2 and (pe ->> 'harga')::numeric = 10500), 'detail membawa label, id opsi, dan harga per baris');

  perform t.login(t.id('owner'));
  e := t.err('rpc_sale_return', jsonb_build_object('id', sid, 'request_id', 'req-opsi-0041', 'alasan', 'uji retur', 'restock', true,
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1))));
  perform t.ok(e like 'P0001%' and e like '%tidak ada di transaksi asal%', 'retur tanpa menyebut opsi untuk baris beropsi ditolak: ' || coalesce(e, 'NULL'));
  r := public.rpc_sale_return(jsonb_build_object('id', sid, 'request_id', 'req-opsi-0042', 'alasan', 'uji retur', 'restock', true,
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1, 'opsi', jsonb_build_array(t.id('i_l3'), t.id('i_gr'))))));
  perform t.logout();
  perform t.ok((r ->> 'refund')::numeric = 10500, 'refund memakai harga baris yang diretur (10500), bukan baris lain: ' || (r ->> 'refund'));
  rid := (r -> 'sale' ->> 'id')::uuid;
  perform t.ok((select option_label from public.sale_items where sale_id = rid) = 'Level 3 · Goreng', 'baris retur menyalin label');
  perform t.ok((select count(*) from public.sale_item_options o join public.sale_items i on i.id = o.sale_item_id where i.sale_id = rid) = 2, 'baris retur menyalin snapshot opsi');
  perform t.login(t.id('owner'));
  r := public.rpc_sale_return(jsonb_build_object('id', sid, 'request_id', 'req-opsi-0043', 'alasan', 'sisanya', 'restock', true, 'semua', true));
  perform t.logout();
  perform t.ok((select count(*) from public.sale_items where sale_id = (r -> 'sale' ->> 'id')::uuid and option_label = 'Level 1 · Goreng') = 1, 'retur semua menyalin opsi baris tersisa');
end $$;

-- ===== O9 ledger opsi tidak bisa diubah =====
do $$ declare e text; begin
  begin update public.sale_item_options set item_name = 'x'; e := null; exception when others then e := sqlstate; end;
  perform t.ok(e = '23000', 'update sale_item_options ditolak: ' || coalesce(e, 'NULL'));
  begin delete from public.sale_item_options; e := null; exception when others then e := sqlstate; end;
  perform t.ok(e = '23000', 'delete sale_item_options ditolak: ' || coalesce(e, 'NULL'));
end $$;

-- ===== O10 laporan per opsi + rekonsiliasi =====
do $$ declare r jsonb; g record; begin
  perform t.login(t.id('owner'));
  r := public.rpc_report_option_sales(jsonb_build_object('outlet_id', t.id('o1'), 'product_id', t.id('pr1')));
  perform t.logout();
  perform t.ok((r ->> 'qty_varian')::numeric > 0, 'laporan: ada penjualan varian');
  for g in select e ->> 'grup' as grup, sum((e ->> 'qty')::numeric) as q from jsonb_array_elements(r -> 'baris') e group by 1 loop
    perform t.ok(g.q = (r ->> 'qty_varian')::numeric, 'rekonsiliasi grup wajib ' || g.grup || ': ' || g.q || ' = ' || (r ->> 'qty_varian'));
  end loop;
  perform t.login(t.id('ka'));
  perform t.ok(t.err('rpc_report_option_sales', jsonb_build_object('outlet_id', t.id('o1'), 'product_id', t.id('pr1'))) like '42501%', 'kasir tidak boleh membuka laporan per opsi');
  perform t.logout();
  perform t.login(t.id('kb'));
  perform t.ok(t.err('rpc_report_option_sales', jsonb_build_object('outlet_id', t.id('o1'), 'product_id', t.id('pr1'))) like '42501%', 'kasir outlet lain ditolak');
  perform t.logout();
end $$;

-- ===== O11 saklar mati tidak menghapus opsi =====
do $$ declare r jsonb; begin
  perform t.login(t.id('owner'));
  r := public.rpc_product_options_set(jsonb_build_object('product_id', t.id('pr1'), 'pakai_opsi', false));
  perform t.logout();
  perform t.ok(not (r ->> 'pakai_opsi')::boolean and jsonb_array_length(r -> 'tautan') = 2, 'saklar mati; tautan tetap tersimpan');
  perform t.login(t.id('ka'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-opsi-0050', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v1'), 'qty', 1)), 'amount_received', 10000));
  perform t.logout();
  perform t.ok((r -> 'sale' ->> 'total')::numeric = 10000, 'saklar mati: produk dijual tanpa opsi seperti biasa');
  perform t.login(t.id('owner'));
  perform public.rpc_product_options_set(jsonb_build_object('product_id', t.id('pr1'), 'pakai_opsi', true));
  perform t.logout();
end $$;

select 'OK 011_opsi_produk' as hasil;
