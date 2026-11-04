-- Tes migrasi 0035: produksi anti-ganda (request_id) dan "Catat produksi selesai" sekali jalan. Dijalankan setelah 001-011 (memakai t.ids: owner, ka, kit, v1).
\set ON_ERROR_STOP on

-- ===== Data uji sendiri: bahan, varian, resep (dibuat sebagai superuser), stok bahan 20 kg @ 5000 di dapur =====
do $$
declare pr uuid; v uuid; m uuid; r uuid;
begin
  select product_id into pr from public.product_variants where id = t.id('v1');
  insert into public.product_variants (product_id, sku, size, spice_level) values (pr, 'REC12-100', '100g', '5') returning id into v;
  insert into public.materials (name, unit) values ('Tepung Rec012', 'kg') returning id into m;
  insert into public.recipes (variant_id, name, standard_yield) values (v, 'Resep Rec012', 10) returning id into r;
  insert into public.recipe_items (recipe_id, material_id, qty) values (r, m, 2);   -- 2 kg per batch, hasil standar 10
  insert into t.ids values ('r12_v', v), ('r12_m', m), ('r12_r', r);
  perform t.login(t.id('owner'));
  perform public.rpc_purchase_create(jsonb_build_object('outlet_id', t.id('kit'), 'request_id', 'req-buy-rec012', 'ongkir', 0,
        'items', jsonb_build_array(jsonb_build_object('material_id', m, 'qty', 20, 'harga_satuan', 5000))));
  perform t.logout();
end $$;

-- ===== R1 catat sekali jalan: rencana + selesai dalam satu panggilan =====
do $$ declare r jsonb; begin
  perform t.login(t.id('owner'));
  r := public.rpc_production_record(jsonb_build_object('request_id', 'rec-0001-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r12_r'), 'jumlah_batch', 2, 'jenis', 'batch', 'catatan', 'uji sekali jalan', 'qty_hasil', 19, 'tenaga_kerja', 0, 'overhead', 0));
  perform t.logout();
  perform t.ok(r ->> 'status' = 'done' and (r ->> 'qty_hasil')::numeric = 19, 'record: status done, hasil 19');
  perform t.ok((r -> 'costs' ->> 'total')::numeric = 20000, 'record: biaya bahan 4 kg x 5000 = 20000');
  perform t.ok((select count(*) from public.production_orders where variant_id = t.id('r12_v') and status = 'done' and note = 'uji sekali jalan' and actual_qty = 19) = 1, 'record: satu pesanan produksi berstatus done, catatan tersimpan');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r12_v')) = 19, 'record: stok produk jadi 19');
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m')) = 16, 'record: bahan terpakai 4 kg (20 -> 16)');
end $$;

-- ===== R2 kirim ulang dengan request_id sama => hasil lama, tidak ada efek ganda; payload beda => ditolak =====
do $$ declare r jsonb; e text; begin
  perform t.login(t.id('owner'));
  r := public.rpc_production_record(jsonb_build_object('request_id', 'rec-0001-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r12_r'), 'jumlah_batch', 2, 'jenis', 'batch', 'catatan', 'uji sekali jalan', 'qty_hasil', 19, 'tenaga_kerja', 0, 'overhead', 0));
  perform t.ok((r ->> 'duplicate')::boolean is true and r ->> 'status' = 'done', 'kirim ulang: duplicate = true dengan hasil pertama');
  perform t.ok((select count(*) from public.production_orders where variant_id = t.id('r12_v')) = 1, 'kirim ulang: tetap satu pesanan produksi');
  perform t.ok((select count(*) from public.stock_movements where reference_type = 'production' and movement_type = 'production_in' and item_id = t.id('r12_v')) = 1, 'kirim ulang: satu mutasi masuk');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r12_v')) = 19
           and (select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m')) = 16, 'kirim ulang: stok tidak bergerak');
  e := t.err('rpc_production_record', jsonb_build_object('request_id', 'rec-0001-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r12_r'), 'jumlah_batch', 3, 'qty_hasil', 30));
  perform t.ok(e like '23505%', 'request_id sama dengan isi berbeda ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_record', jsonb_build_object('kitchen_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1, 'qty_hasil', 10));
  perform t.ok(e like '22023%', 'record tanpa request_id ditolak: ' || coalesce(e, 'NULL'));
  perform t.logout();
end $$;

-- ===== R3 atomik: stok bahan kurang => tidak ada rencana yang tertinggal =====
do $$ declare e text; n int; begin
  perform t.login(t.id('owner'));
  select count(*) into n from public.production_orders where variant_id = t.id('r12_v');
  e := t.err('rpc_production_record', jsonb_build_object('request_id', 'rec-0002-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r12_r'), 'jumlah_batch', 100, 'qty_hasil', 1000));
  perform t.ok(e like '%tidak cukup%', 'bahan kurang => record gagal: ' || coalesce(e, 'NULL'));
  perform t.ok((select count(*) from public.production_orders where variant_id = t.id('r12_v')) = n, 'gagal: tidak ada rencana yang tertinggal');
  perform t.logout();   -- app.idempotency_keys tabel privat: dibaca sebagai superuser
  perform t.ok(not exists (select 1 from app.idempotency_keys where scope = 'production_record' and key = 'rec-0002-aaaa'), 'gagal: kunci idempotensi ikut dibatalkan (boleh dicoba lagi)');
end $$;

-- ===== R4 wewenang: kasir tidak boleh mencatat produksi =====
do $$ declare e text; begin
  perform t.login(t.id('ka'));
  e := t.err('rpc_production_record', jsonb_build_object('request_id', 'rec-0003-aaaa', 'kitchen_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1, 'qty_hasil', 10));
  perform t.ok(e is not null, 'kasir ditolak mencatat produksi: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.ok(not exists (select 1 from app.idempotency_keys where scope = 'production_record' and key = 'rec-0003-aaaa'), 'penolakan wewenang tidak meninggalkan kunci idempotensi');
end $$;

-- ===== R5 jalur dua tahap: create dan complete idempoten; klien lama (tanpa request_id) tetap jalan =====
do $$ declare c1 jsonb; c2 jsonb; r1 jsonb; r2 jsonb; e text; mat numeric; begin
  perform t.login(t.id('owner'));
  c1 := public.rpc_production_create(jsonb_build_object('request_id', 'cre-0001-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1));
  c2 := public.rpc_production_create(jsonb_build_object('request_id', 'cre-0001-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1));
  perform t.ok(c1 ->> 'id' = c2 ->> 'id' and (c2 ->> 'duplicate')::boolean is true, 'create dua kali dengan request_id sama => id yang sama');
  perform t.ok((select count(*) from public.production_orders where id = (c1 ->> 'id')::uuid) = 1, 'create: satu baris');
  r1 := public.rpc_production_complete(jsonb_build_object('request_id', 'cmp-0001-aaaa', 'id', c1 ->> 'id', 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  select quantity into mat from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m');
  r2 := public.rpc_production_complete(jsonb_build_object('request_id', 'cmp-0001-aaaa', 'id', c1 ->> 'id', 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  perform t.ok((r2 ->> 'duplicate')::boolean is true and r2 ->> 'status' = 'done', 'complete dikirim ulang => hasil pertama, bukan galat sudah berstatus');
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m')) = mat and mat = 14, 'complete ulang tidak memotong bahan lagi (16 -> 14 sekali saja)');
  e := t.err('rpc_production_complete', jsonb_build_object('request_id', 'cmp-0002-aaaa', 'id', c1 ->> 'id', 'qty_hasil', 10));
  perform t.ok(e like '%sudah berstatus%', 'request_id baru pada pesanan yang sudah selesai tetap ditolak');
  -- klien lama: tanpa request_id
  c1 := public.rpc_production_create(jsonb_build_object('kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1));
  r1 := public.rpc_production_complete(jsonb_build_object('id', c1 ->> 'id', 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  perform t.ok(r1 ->> 'status' = 'done' and r1 ->> 'duplicate' is null, 'tanpa request_id: perilaku lama tetap (tanpa penanda duplicate)');
  perform t.logout();
end $$;

select 'OK 012_production_record' as hasil;
