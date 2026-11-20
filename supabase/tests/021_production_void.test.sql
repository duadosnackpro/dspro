-- Tes migrasi 0044: batalkan produksi yang sudah selesai (production_void). Dijalankan setelah 020 (memakai t.ids: owner, ka, kit).
-- Memakai bahan, dua varian, dua resep, dan dua pengguna (supervisor, produksi) milik tes ini sendiri.
\set ON_ERROR_STOP on

-- ===== Data uji: bahan 40 kg @ 5000 di dapur; varian A dan B; resep 2 kg per batch, hasil standar 10 =====
do $$
declare pr uuid; va uuid; vb uuid; m uuid; ra uuid; rb uuid; sup uuid := gen_random_uuid(); prd uuid := gen_random_uuid();
begin
  select product_id into pr from public.product_variants where id = t.id('v1');
  insert into public.product_variants (product_id, sku, size, spice_level) values (pr, 'REC21-A', '100g', '5') returning id into va;
  insert into public.product_variants (product_id, sku, size, spice_level) values (pr, 'REC21-B', '100g', '5') returning id into vb;
  insert into public.materials (name, unit) values ('Tepung Rec021', 'kg') returning id into m;
  insert into public.recipes (variant_id, name, standard_yield) values (va, 'Resep Rec021 A', 10) returning id into ra;
  insert into public.recipes (variant_id, name, standard_yield) values (vb, 'Resep Rec021 B', 10) returning id into rb;
  insert into public.recipe_items (recipe_id, material_id, qty) values (ra, m, 2), (rb, m, 2);
  insert into auth.users (id, email) values (sup, 'sup21@t'), (prd, 'prd21@t');
  insert into public.profiles (id, username, full_name) values (sup, 'sup.021', 'Supervisor 021'), (prd, 'prd.021', 'Produksi 021');
  insert into public.memberships (user_id, outlet_id, role) values (sup, t.id('kit'), 'supervisor'), (prd, t.id('kit'), 'produksi');
  insert into t.ids values ('r21_va', va), ('r21_vb', vb), ('r21_m', m), ('r21_ra', ra), ('r21_rb', rb), ('r21_sup', sup), ('r21_prd', prd);
  perform t.login(t.id('owner'));
  perform public.rpc_purchase_create(jsonb_build_object('outlet_id', t.id('kit'), 'request_id', 'req-buy-rec021', 'ongkir', 0,
        'items', jsonb_build_array(jsonb_build_object('material_id', m, 'qty', 40, 'harga_satuan', 5000))));
  perform t.logout();
end $$;

-- ===== P1 (A, 1 batch, hasil 10, HPP 1000), P2 (A, 2 batch, hasil 19, biaya bahan 20000), P3 (B, 1 batch, hasil 10) =====
do $$ declare r jsonb; p1 uuid; p2 uuid; p3 uuid; begin
  perform t.login(t.id('owner'));
  r := public.rpc_production_record(jsonb_build_object('request_id', 'v21-p1-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r21_ra'), 'jumlah_batch', 1, 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  p1 := (r ->> 'id')::uuid;
  r := public.rpc_production_record(jsonb_build_object('request_id', 'v21-p2-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r21_ra'), 'jumlah_batch', 2, 'qty_hasil', 19, 'tenaga_kerja', 0, 'overhead', 0));
  p2 := (r ->> 'id')::uuid;
  r := public.rpc_production_record(jsonb_build_object('request_id', 'v21-p3-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r21_rb'), 'jumlah_batch', 1, 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  p3 := (r ->> 'id')::uuid;
  perform t.logout();
  insert into t.ids values ('r21_p1', p1), ('r21_p2', p2), ('r21_p3', p3);   -- tabel t.ids hanya bisa ditulis superuser
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_va')) = 29, 'siap: stok A 29');
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m')) = 32, 'siap: bahan 40 - 8 = 32');
  perform t.ok(abs((select avg_cost from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_va')) - 1034.4828) < 0.001, 'siap: HPP A 1034,4828 (30000 / 29)');
end $$;

-- ===== W1 wewenang dan masukan: produksi/kasir ditolak, alasan wajib, rencana ditolak, id asing =====
do $$ declare e text; c jsonb; n_mov int; begin
  select count(*) into n_mov from public.stock_movements where movement_type = 'void_reverse' and reference_type = 'production';
  perform t.login(t.id('r21_prd'));
  e := t.err('rpc_production_void', jsonb_build_object('id', t.id('r21_p2'), 'alasan', 'salah input hasil'));
  perform t.ok(e is not null, 'peran produksi ditolak membatalkan produksi selesai: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.login(t.id('ka'));
  e := t.err('rpc_production_void', jsonb_build_object('id', t.id('r21_p2'), 'alasan', 'salah input hasil'));
  perform t.ok(e is not null, 'kasir ditolak membatalkan produksi selesai: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.login(t.id('owner'));
  e := t.err('rpc_production_void', jsonb_build_object('id', t.id('r21_p2'), 'alasan', 'x '));
  perform t.ok(e like '22023%', 'alasan kurang dari 3 huruf ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_void', jsonb_build_object('id', t.id('r21_p2')));
  perform t.ok(e like '22023%', 'tanpa alasan ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_void', jsonb_build_object('id', gen_random_uuid(), 'alasan', 'tidak ada'));
  perform t.ok(e like 'P0002%', 'id tidak dikenal ditolak: ' || coalesce(e, 'NULL'));
  c := public.rpc_production_create(jsonb_build_object('kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r21_ra'), 'jumlah_batch', 1));
  e := t.err('rpc_production_void', jsonb_build_object('id', c ->> 'id', 'alasan', 'masih rencana'));
  perform t.ok(e like 'P0001%' and e like '%Batalkan rencana%', 'rencana ditolak (pakai Batalkan rencana): ' || coalesce(e, 'NULL'));
  perform public.rpc_production_cancel(jsonb_build_object('id', c ->> 'id'));
  e := t.err('rpc_production_void', jsonb_build_object('id', c ->> 'id', 'alasan', 'sudah batal'));
  perform t.ok(e like 'P0001%' and e like '%sudah dibatalkan%', 'rencana yang sudah batal: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.ok((select status from public.production_orders where id = t.id('r21_p2')) = 'done', 'penolakan: P2 tetap selesai');
  perform t.ok((select count(*) from public.stock_movements where movement_type = 'void_reverse' and reference_type = 'production') = n_mov, 'penolakan: tidak ada mutasi pembalik');
  perform t.ok(not exists (select 1 from app.idempotency_keys where scope = 'production_void'), 'penolakan wewenang/masukan tidak meninggalkan kunci idempotensi');
end $$;

-- ===== W2 hasil produksi sudah keluar (opname turun) => ditolak, tidak ada yang berubah =====
do $$ declare e text; mat0 numeric; vb0 numeric; loss0 int; begin
  perform t.login(t.id('owner'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', t.id('kit'), 'tipe', 'varian', 'id', t.id('r21_vb'), 'stok_baru', 9, 'alasan', 'rusak satu'));
  perform t.logout();
  select quantity into mat0 from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m');
  select quantity into vb0 from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_vb');
  select count(*) into loss0 from public.inventory_losses;
  perform t.login(t.id('owner'));
  e := t.err('rpc_production_void', jsonb_build_object('id', t.id('r21_p3'), 'alasan', 'salah resep'));
  perform t.logout();
  perform t.ok(e like 'P0001%' and e like '%sudah ada yang keluar%', 'sudah ada yang keluar: ditolak: ' || coalesce(e, 'NULL'));
  perform t.ok((select status from public.production_orders where id = t.id('r21_p3')) = 'done' and exists (select 1 from public.production_costs where production_id = t.id('r21_p3')), 'ditolak: P3 tetap selesai dan biayanya utuh');
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m')) = mat0, 'ditolak: stok bahan tidak berubah (bahan yang sempat dikembalikan ikut dibatalkan)');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_vb')) = vb0, 'ditolak: stok produk tidak berubah');
  perform t.ok((select count(*) from public.inventory_losses) = loss0, 'ditolak: kerugian persediaan tidak bertambah');
end $$;

-- ===== W3 harga bahan berubah setelah produksi: bahan kembali dengan harga saat dipakai (5000), bukan harga sekarang =====
do $$ begin
  perform t.login(t.id('owner'));
  perform public.rpc_purchase_create(jsonb_build_object('outlet_id', t.id('kit'), 'request_id', 'req-buy2-rec021', 'ongkir', 0,
        'items', jsonb_build_array(jsonb_build_object('material_id', t.id('r21_m'), 'qty', 8, 'harga_satuan', 9500))));
  perform t.logout();
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m')) = 40, 'siap W3: bahan 32 + 8 = 40');
  -- ubah resep supaya terbukti jumlah kembali dari ledger, bukan dari resep
  update public.recipe_items set qty = 7 where recipe_id = t.id('r21_ra');
end $$;

-- ===== W4 supervisor membatalkan P2 (hasil 19, bahan 4 kg): semua efek, ledger neto nol, bukan kerugian =====
do $$ declare r jsonb; loss0 int; mat0 numeric; avg0 numeric; begin
  select count(*) into loss0 from public.inventory_losses;
  select quantity, avg_cost into mat0, avg0 from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m');
  perform t.login(t.id('r21_sup'));
  r := public.rpc_production_void(jsonb_build_object('request_id', 'v21-void-p2-a', 'id', t.id('r21_p2'), 'alasan', 'salah input hasil'));
  perform t.logout();
  perform t.ok(r ->> 'status' = 'cancelled' and (r ->> 'qty_dikurangi')::numeric = 19 and (r -> 'variant' ->> 'stok')::numeric = 10, 'void: status cancelled, 19 dikurangi, stok A tinggal 10');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_va')) = 10, 'void: stok produk jadi A = 10 (hasil P1)');
  perform t.ok(abs((select avg_cost from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_va')) - 1000) < 0.01, 'void: HPP rata-rata A dihitung ulang tanpa P2 (kembali 1000)');
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m')) = mat0 + 4, 'void: bahan kembali 4 kg (dari ledger, bukan resep yang kini 7 kg/batch)');
  perform t.ok(abs((select avg_cost from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r21_m')) - ((mat0 * avg0 + 4 * 5000) / (mat0 + 4))) < 0.001, 'void: HPP bahan memakai harga saat dipakai (5000), bukan harga pembelian terbaru');
  perform t.ok((select status = 'cancelled' and cancelled_after_done and cancel_reason = 'salah input hasil' and cancelled_by = t.id('r21_sup') and cancelled_at is not null and actual_qty = 19 and completed_at is not null
                from public.production_orders where id = t.id('r21_p2')), 'void: status, alasan, pelaku, waktu tersimpan; hasil dan tanggal selesai lama dipertahankan');
  perform t.ok(not exists (select 1 from public.production_costs where production_id = t.id('r21_p2')), 'void: baris biaya dihapus (laporan tidak menghitungnya lagi)');
  perform t.ok((select coalesce(sum(quantity_delta), 0) from public.stock_movements where reference_type = 'production' and reference_id = t.id('r21_p2') and item_type = 'variant') = 0
           and (select coalesce(sum(quantity_delta), 0) from public.stock_movements where reference_type = 'production' and reference_id = t.id('r21_p2') and item_type = 'material') = 0
           and (select coalesce(sum(value), 0) from public.stock_movements where reference_type = 'production' and reference_id = t.id('r21_p2') and item_type = 'material') = 0, 'void: ledger neto nol (jumlah dan nilai bahan, jumlah produk)');
  perform t.ok((select count(*) from public.stock_movements where reference_type = 'production' and reference_id = t.id('r21_p2') and movement_type = 'void_reverse') = 2, 'void: dua mutasi pembalik (satu bahan, satu produk)');
  perform t.ok((select count(*) from public.inventory_losses) = loss0, 'void: bukan kerugian persediaan');
  perform t.ok(exists (select 1 from public.audit_logs where action = 'production_void' and entity_id = t.id('r21_p2')::text and (before ->> 'total')::numeric = 20000 and (before ->> 'qty')::numeric = 19
                         and after ->> 'alasan' = 'salah input hasil'), 'void: audit menyimpan biaya asli (total 20000) dan alasan');
end $$;

-- ===== W5 kirim ulang dan pembatalan ganda =====
do $$ declare r jsonb; e text; begin
  perform t.login(t.id('r21_sup'));
  r := public.rpc_production_void(jsonb_build_object('request_id', 'v21-void-p2-a', 'id', t.id('r21_p2'), 'alasan', 'salah input hasil'));
  perform t.ok((r ->> 'duplicate')::boolean is true and r ->> 'status' = 'cancelled', 'kirim ulang: duplicate = true dengan hasil pertama');
  e := t.err('rpc_production_void', jsonb_build_object('request_id', 'v21-void-p2-a', 'id', t.id('r21_p2'), 'alasan', 'alasan lain'));
  perform t.ok(e like '23505%', 'request_id sama dengan isi berbeda ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_void', jsonb_build_object('request_id', 'v21-void-p2-b', 'id', t.id('r21_p2'), 'alasan', 'coba lagi'));
  perform t.ok(e like 'P0001%' and e like '%sudah dibatalkan%', 'batal dua kali dengan request_id baru ditolak: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.ok((select count(*) from public.stock_movements where reference_type = 'production' and reference_id = t.id('r21_p2') and movement_type = 'void_reverse') = 2, 'ulang: tidak ada mutasi pembalik tambahan');
  perform t.ok((select count(*) from public.audit_logs where action = 'production_void' and entity_id = t.id('r21_p2')::text) = 1, 'ulang: audit tidak ganda');
  perform t.ok((select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_va')) = 10, 'ulang: stok A tetap 10');
end $$;

-- ===== W6 produksi sudah batal tidak bisa diselesaikan/diubah lagi; daftar menampilkan alasan =====
do $$ declare e text; l jsonb; x jsonb; begin
  perform t.login(t.id('owner'));
  e := t.err('rpc_production_complete', jsonb_build_object('id', t.id('r21_p2'), 'qty_hasil', 5));
  perform t.ok(e like 'P0001%', 'produksi batal tidak bisa diselesaikan: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_update', jsonb_build_object('id', t.id('r21_p2'), 'jumlah_batch', 3));
  perform t.ok(e like 'P0001%', 'produksi batal tidak bisa diubah: ' || coalesce(e, 'NULL'));
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit')));
  select e2 into x from jsonb_array_elements(l) e2 where e2 ->> 'id' = t.id('r21_p2')::text;
  perform t.ok(x ->> 'status' = 'batal' and (x ->> 'batal_setelah_selesai')::boolean is true and x ->> 'alasan_batal' = 'salah input hasil' and x ->> 'tanggal_batal' is not null
           and x -> 'total' = 'null'::jsonb, 'daftar: status batal, batal_setelah_selesai, alasan, tanggal batal; biaya kosong');
  select e2 into x from jsonb_array_elements(l) e2 where e2 ->> 'id' = t.id('r21_p1')::text;
  perform t.ok(x ->> 'status' = 'selesai' and (x ->> 'batal_setelah_selesai')::boolean is false and x -> 'alasan_batal' = 'null'::jsonb, 'daftar: produksi selesai biasa tanpa tanda batal');
  perform t.logout();
end $$;

-- ===== W7 membatalkan produksi lebih awal sesudah yang lebih baru dibatalkan: pembatalan produksi lain tidak dianggap "sudah keluar" =====
do $$ declare r jsonb; begin
  perform t.login(t.id('owner'));
  r := public.rpc_production_void(jsonb_build_object('id', t.id('r21_p1'), 'alasan', 'produksi pertama juga salah'));
  perform t.logout();
  perform t.ok(r ->> 'status' = 'cancelled' and (select quantity from public.inventory_balances where outlet_id = t.id('kit') and variant_id = t.id('r21_va')) = 0, 'P1 dibatalkan sesudah P2: stok A 0');
end $$;

-- ===== W8 produksi lama tanpa catatan ledger (impor) tidak bisa dibalik otomatis =====
do $$ declare pid uuid; e text; begin
  insert into public.production_orders (kitchen_outlet_id, output_outlet_id, recipe_id, variant_id, kind, batches, standard_qty, actual_qty, status, user_id, completed_at)
  values (t.id('kit'), t.id('kit'), t.id('r21_ra'), t.id('r21_va'), 'batch', 1, 10, 10, 'done', t.id('owner'), now()) returning production_orders.id into pid;
  perform t.login(t.id('owner'));
  e := t.err('rpc_production_void', jsonb_build_object('id', pid, 'alasan', 'impor lama'));
  perform t.logout();
  perform t.ok(e like 'P0001%' and e like '%catatan stok%', 'tanpa ledger ditolak dengan arahan ke opname: ' || coalesce(e, 'NULL'));
  perform t.ok((select status from public.production_orders where id = pid) = 'done', 'tanpa ledger: status tetap selesai');
end $$;

-- ===== W9 periode terkunci: produksi yang selesai pada tanggal terkunci tidak bisa dibatalkan =====
do $$ declare r jsonb; e text; pid uuid; lock0 text; begin
  perform t.login(t.id('owner'));
  r := public.rpc_production_record(jsonb_build_object('request_id', 'v21-p4-aaaa', 'kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'),
        'recipe_id', t.id('r21_rb'), 'jumlah_batch', 1, 'qty_hasil', 5, 'tenaga_kerja', 0, 'overhead', 0));
  pid := (r ->> 'id')::uuid;
  perform t.logout();
  select value into lock0 from public.settings where key = 'kunci_periode_sampai' and outlet_id is null;   -- baris bawaan dari seed; dikembalikan sesudah uji
  update public.settings set value = to_char(current_date + 1, 'YYYY-MM-DD') where key = 'kunci_periode_sampai' and outlet_id is null;
  perform t.login(t.id('owner'));
  e := t.err('rpc_production_void', jsonb_build_object('id', pid, 'alasan', 'periode terkunci'));
  perform t.logout();
  update public.settings set value = coalesce(lock0, '') where key = 'kunci_periode_sampai' and outlet_id is null;
  perform t.ok(e like 'P0001%' and e like '%dikunci%', 'periode terkunci ditolak: ' || coalesce(e, 'NULL'));
  perform t.ok((select status from public.production_orders where id = pid) = 'done', 'periode terkunci: status tetap selesai');
  perform t.login(t.id('owner'));
  r := public.rpc_production_void(jsonb_build_object('id', pid, 'alasan', 'periode sudah dibuka'));
  perform t.logout();
  perform t.ok(r ->> 'status' = 'cancelled', 'periode dibuka: pembatalan berhasil');
end $$;

select 'Tes pembatalan produksi selesai (021) selesai' as hasil;
