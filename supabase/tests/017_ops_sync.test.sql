-- Tes migrasi 0040: ops_ver di app.ping + sinyal 'ops' untuk data operasional. Dijalankan setelah 001-016 (memakai t.ids: owner, ka, kit, o1, ch, v2).
\set ON_ERROR_STOP on

-- Pembantu: baca ops_ver sebagai angka lewat rpc_ping (sebagai pengguna yang sedang login).
create or replace function t.ops(o text default 'o1') returns bigint language sql as $$
  select (public.rpc_ping(jsonb_build_object('outlet_id', t.id($1))) ->> 'ops_ver')::bigint $$;

-- ===== O1 ping memuat ops_ver (angka), kunci lama tetap ada =====
do $$ declare r jsonb; begin
  perform t.login(t.id('owner'));
  r := public.rpc_ping(jsonb_build_object('outlet_id', t.id('o1')));
  perform t.logout();
  perform t.ok(r ? 'ops_ver' and (r ->> 'ops_ver') ~ '^\d+$', 'ping memuat ops_ver berupa angka: ' || r::text);
  perform t.ok(r ? 'cat_ver' and r ? 'stock_ver' and r ? 'ver', 'ping tetap memuat ver, cat_ver, stock_ver (klien lama aman)');
  perform t.login(t.id('ka'));
  r := public.rpc_ping(jsonb_build_object('outlet_id', t.id('o1')));
  perform t.logout();
  perform t.ok(r ? 'ops_ver', 'kasir juga menerima ops_ver');
end $$;

-- ===== O2 sync_events menerima jenis ops, menolak jenis lain =====
do $$ begin
  insert into public.sync_events (outlet_id, kind) values (null, 'ops');
  perform t.ok(true, 'kind ops diterima');
  begin insert into public.sync_events (outlet_id, kind) values (null, 'sembarang'); perform t.ok(false, 'kind sembarang seharusnya ditolak');
  exception when check_violation then perform t.ok(true, 'kind sembarang ditolak oleh batasan'); end;
end $$;

-- ===== O3 resep dan bahan memicu ops (ops_ver naik + sinyal ops global) =====
do $$ declare a bigint; b bigint; n int; pr uuid; v uuid; m uuid; r uuid; begin
  perform t.login(t.id('owner')); a := t.ops(); perform t.logout();
  delete from public.sync_events;
  select product_id into pr from public.product_variants where id = t.id('v1');
  insert into public.product_variants (product_id, sku, size, spice_level) values (pr, 'OPS17-100', '100g', '5') returning id into v;
  insert into public.materials (name, unit) values ('Bahan Ops017', 'kg') returning id into m;
  insert into public.recipes (variant_id, name, standard_yield) values (v, 'Resep Ops017', 10) returning id into r;
  insert into public.recipe_items (recipe_id, material_id, qty) values (r, m, 2);
  insert into t.ids values ('o17_v', v), ('o17_m', m), ('o17_r', r);
  perform t.login(t.id('owner')); b := t.ops(); perform t.logout();
  perform t.ok(b >= a + 3, 'bahan + resep + item resep menaikkan ops_ver (>= 3 perubahan): ' || a || ' -> ' || b);
  select count(*) into n from public.sync_events where kind = 'ops' and outlet_id is null;
  perform t.ok(n >= 1, 'perubahan resep/bahan menghasilkan sinyal ops global (n=' || n || ')');

  -- ubah resep (sunting): ops_ver naik lagi
  a := b; update public.recipes set name = 'Resep Ops017 v2', updated_at = now() where id = r;
  perform t.login(t.id('owner')); b := t.ops(); perform t.logout();
  perform t.ok(b = a + 1, 'sunting resep menaikkan ops_ver tepat 1: ' || a || ' -> ' || b);
end $$;

-- ===== O4 pembelian bahan (stok bahan berubah) menaikkan ops_ver =====
do $$ declare a bigint; b bigint; begin
  perform t.login(t.id('owner')); a := t.ops();
  perform public.rpc_purchase_create(jsonb_build_object('outlet_id', t.id('kit'), 'request_id', 'req-buy-ops017', 'ongkir', 0,
        'items', jsonb_build_array(jsonb_build_object('material_id', t.id('o17_m'), 'qty', 10, 'harga_satuan', 4000))));
  b := t.ops(); perform t.logout();
  perform t.ok(b > a, 'pembelian bahan menaikkan ops_ver: ' || a || ' -> ' || b);
  -- penyesuaian stok bahan juga
  a := b; perform t.login(t.id('owner'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', t.id('kit'), 'tipe', 'bahan', 'id', t.id('o17_m'), 'stok_baru', 8, 'alasan', 'uji ops017'));
  b := t.ops(); perform t.logout();
  perform t.ok(b > a, 'penyesuaian stok bahan menaikkan ops_ver: ' || a || ' -> ' || b);
end $$;

-- ===== O5 produksi menaikkan ops_ver =====
do $$ declare a bigint; b bigint; begin
  perform t.login(t.id('owner')); a := t.ops();
  perform public.rpc_production_record(jsonb_build_object('request_id', 'rec-ops017-a', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('o17_r'), 'jumlah_batch', 1, 'jenis', 'batch', 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  b := t.ops(); perform t.logout();
  perform t.ok(b > a, 'produksi menaikkan ops_ver: ' || a || ' -> ' || b);
end $$;

-- ===== O6 penjualan biasa TIDAK menaikkan ops_ver; retur (termasuk tanpa restock) menaikkannya =====
do $$ declare s jsonb; r jsonb; a bigint; b bigint; sid uuid; begin
  perform t.login(t.id('owner'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', t.id('o1'), 'tipe', 'varian', 'id', t.id('v2'), 'stok_baru', 50, 'hpp', 5000, 'alasan', 'stok uji ops017'));
  -- pemanasan: sesi kas otomatis terbuka pada penjualan pertama (itu memang mengubah ops)
  s := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-ops017-s0', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v2'), 'qty', 1))));
  a := t.ops();
  s := public.rpc_sale_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-ops017-s1', 'channel_id', t.id('ch'), 'metode_bayar', 'tunai',
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v2'), 'qty', 1))));
  b := t.ops();
  perform t.ok(b = a, 'penjualan biasa tidak menaikkan ops_ver (kasir ramai tidak memicu pemuatan ulang): ' || a || ' -> ' || b);
  sid := (s -> 'sale' ->> 'id')::uuid;
  a := b;
  r := public.rpc_sale_return(jsonb_build_object('request_id', 'req-ops017-r1', 'id', sid, 'alasan', 'rusak ops017', 'restock', false,
        'items', jsonb_build_array(jsonb_build_object('variant_id', t.id('v2'), 'qty', 1))));
  b := t.ops(); perform t.logout();
  perform t.ok(b > a, 'retur tanpa restock menaikkan ops_ver: ' || a || ' -> ' || b);
end $$;

-- ===== O7 biaya dan kas menaikkan ops_ver =====
do $$ declare a bigint; b bigint; begin
  perform t.login(t.id('owner')); a := t.ops();
  perform public.rpc_expense_create(jsonb_build_object('outlet_id', t.id('o1'), 'request_id', 'req-ops017-x1', 'kategori', 'Gas', 'nominal', 12000));
  b := t.ops(); perform t.logout();
  perform t.ok(b > a, 'biaya baru menaikkan ops_ver: ' || a || ' -> ' || b);
end $$;

-- ===== O8 penggabungan sinyal: ops_ver naik per perubahan, sinyal digabung dalam 200 ms =====
do $$ declare a bigint; b bigint; n int; m uuid; begin
  perform t.login(t.id('owner')); a := t.ops(); perform t.logout();
  delete from public.sync_events;
  insert into public.materials (name, unit) values ('Gabung 1', 'kg') returning id into m;
  update public.materials set min_stock = 1 where id = m;
  update public.materials set min_stock = 2 where id = m;
  perform t.login(t.id('owner')); b := t.ops(); perform t.logout();
  select count(*) into n from public.sync_events where kind = 'ops' and outlet_id is null;
  perform t.ok(b = a + 3, 'tiga perubahan beruntun = ops_ver naik 3: ' || a || ' -> ' || b);
  perform t.ok(n >= 1 and n <= 3, 'sinyal digabung (n=' || n || ', bukan lebih dari jumlah perubahan)');
  -- sinyal lama (> 200 ms) tidak menggabung: sinyal baru tetap dibuat
  update public.sync_events set created_at = clock_timestamp() - interval '1 second';
  select count(*) into n from public.sync_events where kind = 'ops';
  update public.materials set min_stock = 3 where id = m;
  perform t.ok((select count(*) from public.sync_events where kind = 'ops') = n + 1, 'sinyal yang sudah lewat 200 ms tidak menggabung perubahan baru');
end $$;

-- ===== O9 RLS: kasir melihat sinyal ops global, tidak bisa menulisnya =====
do $$ begin
  perform t.login(t.id('ka'));
  perform t.ok((select count(*) from public.sync_events where kind = 'ops' and outlet_id is null) >= 1, 'kasir melihat sinyal ops global (RLS)');
  begin insert into public.sync_events (outlet_id, kind) values (null, 'ops'); perform t.ok(false, 'klien tidak boleh INSERT sinyal ops');
  exception when insufficient_privilege then perform t.ok(true, 'klien tidak bisa INSERT sinyal ops'); end;
  perform t.logout();
end $$;

-- ===== O10 trigger memakai pola indeks yang benar =====
do $$ declare src text := pg_get_functiondef('app.trg_sync_ops()'::regprocedure); begin
  perform t.ok(src ~* 'v_cut' and src !~* 'created_at\s*>\s*clock_timestamp\(\)', 'trg_sync_ops membandingkan created_at dengan variabel (indeks terpakai)');
  perform t.ok((select count(*) from pg_trigger where tgrelid = 'public.cash_sessions'::regclass and tgname = 'sync_ops_signal' and (tgtype & 4) = 0) = 1,
               'cash_sessions: trigger ops tidak aktif pada INSERT (sesi otomatis penjualan pertama tidak memicu muat ulang)');
  perform t.ok(src ~* 'e\.outlet_id is null', 'trg_sync_ops memakai IS NULL untuk outlet global');
end $$;

select 'Tes sinkronisasi operasional selesai' as hasil;
