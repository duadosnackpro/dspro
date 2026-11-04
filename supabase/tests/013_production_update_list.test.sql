-- Tes migrasi 0036: ubah jumlah batch pada rencana, daftar produksi dengan filter tanggal + tanggal selesai.
-- Dijalankan setelah 012 (memakai t.ids: owner, ka, kit, r12_r resep 2 kg/batch hasil standar 10, r12_m bahan, r12_v varian).
\set ON_ERROR_STOP on

-- ===== U1 ubah batch pada rencana: hasil standar ikut, stok bahan tidak bergerak =====
do $$ declare c jsonb; u jsonb; mat0 numeric; begin
  perform t.login(t.id('owner'));
  select quantity into mat0 from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m');
  c := public.rpc_production_create(jsonb_build_object('kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 2, 'catatan', 'rencana awal'));
  u := public.rpc_production_update(jsonb_build_object('request_id', 'upd-0001-aaaa', 'id', c ->> 'id', 'jumlah_batch', 3, 'catatan', 'rencana diubah'));
  perform t.ok((u ->> 'jumlah_batch')::numeric = 3 and (u ->> 'qty_standar')::numeric = 30 and u ->> 'status' = 'planned', 'update: 3 batch, hasil standar 30, tetap rencana');
  perform t.ok((select batches = 3 and standard_qty = 30 and status = 'planned' and note = 'rencana diubah' from public.production_orders where id = (c ->> 'id')::uuid), 'update: baris tersimpan (batch, hasil standar, catatan)');
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m')) = mat0, 'update: stok bahan tidak berubah');
  perform t.logout();
  insert into t.ids values ('u_po', (c ->> 'id')::uuid);   -- tabel t.ids hanya bisa ditulis superuser
  perform t.ok(exists (select 1 from public.audit_logs where action = 'production_update' and entity_id = (c ->> 'id') and (before ->> 'batch')::numeric = 2 and (after ->> 'batch')::numeric = 3), 'update: tercatat di audit (2 -> 3)');
end $$;

-- ===== U2 kirim ulang: hasil pertama + duplicate; isi berbeda dengan request_id sama ditolak =====
do $$ declare u jsonb; e text; begin
  perform t.login(t.id('owner'));
  u := public.rpc_production_update(jsonb_build_object('request_id', 'upd-0001-aaaa', 'id', t.id('u_po'), 'jumlah_batch', 3, 'catatan', 'rencana diubah'));
  perform t.ok((u ->> 'duplicate')::boolean is true and (u ->> 'jumlah_batch')::numeric = 3, 'update ulang: duplicate = true dengan hasil pertama');
  perform t.ok((select count(*) from public.audit_logs where action = 'production_update' and entity_id = t.id('u_po')::text) = 1, 'update ulang: audit tidak ganda');
  e := t.err('rpc_production_update', jsonb_build_object('request_id', 'upd-0001-aaaa', 'id', t.id('u_po'), 'jumlah_batch', 4));
  perform t.ok(e like '23505%', 'request_id sama dengan isi berbeda ditolak: ' || coalesce(e, 'NULL'));
  -- tanpa catatan: catatan lama dipertahankan
  u := public.rpc_production_update(jsonb_build_object('request_id', 'upd-0002-aaaa', 'id', t.id('u_po'), 'jumlah_batch', 2.5));
  perform t.ok((u ->> 'qty_standar')::numeric = 25 and u ->> 'catatan' = 'rencana diubah', 'update tanpa catatan: catatan tetap, hasil standar 25 (2,5 batch)');
  perform t.logout();
end $$;

-- ===== U3 penolakan: batch tidak valid, wewenang, status selesai/batal, id tidak ada =====
do $$ declare e text; c jsonb; begin
  perform t.login(t.id('owner'));
  e := t.err('rpc_production_update', jsonb_build_object('id', t.id('u_po'), 'jumlah_batch', 0));
  perform t.ok(e like '22023%', 'batch 0 ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_update', jsonb_build_object('id', t.id('u_po')));
  perform t.ok(e like '22023%', 'batch kosong ditolak: ' || coalesce(e, 'NULL'));
  e := t.err('rpc_production_update', jsonb_build_object('id', gen_random_uuid(), 'jumlah_batch', 1));
  perform t.ok(e like 'P0002%', 'id tidak ada: ' || coalesce(e, 'NULL'));
  c := public.rpc_production_create(jsonb_build_object('kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1));
  perform public.rpc_production_cancel(jsonb_build_object('id', c ->> 'id'));
  e := t.err('rpc_production_update', jsonb_build_object('id', c ->> 'id', 'jumlah_batch', 2));
  perform t.ok(e like 'P0001%' and e like '%dibatalkan%', 'rencana batal tidak bisa diubah: ' || coalesce(e, 'NULL'));
  perform t.logout();
  perform t.login(t.id('ka'));
  e := t.err('rpc_production_update', jsonb_build_object('id', t.id('u_po'), 'jumlah_batch', 2));
  perform t.ok(e is not null, 'kasir ditolak mengubah rencana: ' || coalesce(e, 'NULL'));
  perform t.logout();
end $$;

-- ===== U4 selesaikan setelah diubah: bahan terpotong sesuai batch BARU; sesudah selesai tidak bisa diubah (request_id baru) tetapi kirim ulang yang lama tetap duplicate =====
do $$ declare mat0 numeric; r jsonb; e text; u jsonb; begin
  perform t.login(t.id('owner'));
  u := public.rpc_production_update(jsonb_build_object('request_id', 'upd-0003-aaaa', 'id', t.id('u_po'), 'jumlah_batch', 3));
  select quantity into mat0 from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m');
  r := public.rpc_production_complete(jsonb_build_object('request_id', 'cmp-u001-aaaa', 'id', t.id('u_po'), 'qty_hasil', 29, 'tenaga_kerja', 0, 'overhead', 0));
  perform t.ok((select quantity from public.inventory_material_balances where outlet_id = t.id('kit') and material_id = t.id('r12_m')) = mat0 - 6, 'selesai: bahan terpotong 3 batch x 2 kg = 6');
  e := t.err('rpc_production_update', jsonb_build_object('request_id', 'upd-0004-aaaa', 'id', t.id('u_po'), 'jumlah_batch', 1));
  perform t.ok(e like 'P0001%' and e like '%sudah selesai%', 'rencana selesai tidak bisa diubah: ' || coalesce(e, 'NULL'));
  u := public.rpc_production_update(jsonb_build_object('request_id', 'upd-0003-aaaa', 'id', t.id('u_po'), 'jumlah_batch', 3));
  perform t.ok((u ->> 'duplicate')::boolean is true, 'kirim ulang update lama setelah selesai => duplicate, bukan galat');
  perform t.logout();
end $$;

-- ===== L1 daftar: tanggal_selesai, filter tanggal (zona waktu outlet), rentang terbalik ditolak =====
do $$ declare tz_today date; l jsonb; n_all int; e text; begin
  select (now() at time zone timezone)::date into tz_today from public.outlets where id = t.id('kit');
  perform t.login(t.id('owner'));
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit')));
  n_all := jsonb_array_length(l);
  perform t.ok(exists (select 1 from jsonb_array_elements(l) x where x ->> 'id' = t.id('u_po')::text and x ->> 'status' = 'selesai' and x ->> 'tanggal_selesai' is not null), 'daftar: pesanan selesai punya tanggal_selesai');
  perform t.ok(exists (select 1 from jsonb_array_elements(l) x where x ->> 'status' = 'batal' and x ->> 'tanggal_selesai' is null), 'daftar: pesanan batal tanpa tanggal_selesai');
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit'), 'from', tz_today::text, 'to', tz_today::text));
  perform t.ok(jsonb_array_length(l) = n_all, 'filter hari ini: semua pesanan uji (dibuat dan selesai hari ini) tampil');
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit'), 'from', (tz_today + 1)::text));
  perform t.ok(jsonb_array_length(l) = 0, 'filter mulai besok: kosong');
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit'), 'to', (tz_today - 1)::text));
  perform t.ok(jsonb_array_length(l) = 0, 'filter sampai kemarin: kosong');
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit'), 'from', '', 'to', ''));
  perform t.ok(jsonb_array_length(l) = n_all, 'from/to kosong = tanpa filter');
  e := t.err('rpc_production_list', jsonb_build_object('outlet_id', t.id('kit'), 'from', (tz_today + 1)::text, 'to', tz_today::text));
  perform t.ok(e like '22023%', 'rentang terbalik ditolak: ' || coalesce(e, 'NULL'));
  perform t.logout();
end $$;

-- ===== L2 pesanan lama yang baru selesai hari ini tampil menurut tanggal selesai, bukan tanggal dibuat =====
do $$ declare c jsonb; tz_today date; l jsonb; begin
  select (now() at time zone timezone)::date into tz_today from public.outlets where id = t.id('kit');
  perform t.login(t.id('owner'));
  c := public.rpc_production_create(jsonb_build_object('kitchen_outlet_id', t.id('kit'), 'output_outlet_id', t.id('kit'), 'recipe_id', t.id('r12_r'), 'jumlah_batch', 1));
  perform t.logout();
  update public.production_orders set created_at = now() - interval '10 days' where id = (c ->> 'id')::uuid;   -- superuser: simulasi rencana lama
  perform t.login(t.id('owner'));
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit'), 'from', tz_today::text, 'to', tz_today::text));
  perform t.ok(not exists (select 1 from jsonb_array_elements(l) x where x ->> 'id' = c ->> 'id'), 'rencana lama (10 hari) belum selesai: tidak ada di filter hari ini');
  perform public.rpc_production_complete(jsonb_build_object('request_id', 'cmp-u002-aaaa', 'id', c ->> 'id', 'qty_hasil', 10, 'tenaga_kerja', 0, 'overhead', 0));
  l := public.rpc_production_list(jsonb_build_object('outlet_id', t.id('kit'), 'from', tz_today::text, 'to', tz_today::text));
  perform t.ok(exists (select 1 from jsonb_array_elements(l) x where x ->> 'id' = c ->> 'id' and x ->> 'tanggal_selesai' is not null), 'setelah selesai hari ini: tampil di filter hari ini lewat tanggal selesai');
  perform t.logout();
end $$;

select 'OK 013_production_update_list' as hasil;
