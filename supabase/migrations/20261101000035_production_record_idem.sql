-- 0035 Produksi: (1) anti-ganda lewat request_id, (2) "Catat produksi selesai" sekali jalan.
--
-- 1) production_create dan production_complete menerima request_id (opsional, agar klien lama tetap jalan). Dengan request_id, kirim ulang
--    (jaringan putus, ketuk dua kali) mengembalikan hasil pertama (duplicate: true), tidak membuat rencana kedua dan tidak memotong bahan dua kali.
--    Tanpa request_id perilaku sama seperti sebelumnya.
-- 2) production_record = production_create + production_complete dalam SATU transaksi dengan request_id wajib. Bila penyelesaian gagal
--    (stok bahan kurang, bahan tanpa harga) seluruhnya dibatalkan: tidak ada rencana yang tertinggal.
-- Isi fungsi lama disalin dari 0024 lalu ditambah penanganan request_id. Stok, HPP, dan audit tidak berubah.

create or replace function app.production_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_k public.outlets; v_out public.outlets; v_r public.recipes; v_b numeric := app.num(p, 'jumlah_batch'); v_id uuid; v_kind text := coalesce(p ->> 'jenis', 'batch');
        v_req text := nullif(trim(coalesce(p ->> 'request_id', '')), ''); v_dup jsonb; v_res jsonb;
begin
  v_k := app.active_outlet(nullif(p ->> 'kitchen_outlet_id', '')::uuid);
  v_out := app.active_outlet(coalesce(nullif(p ->> 'output_outlet_id', '')::uuid, v_k.id));
  perform app.require_role(v_k.id, array['owner','admin','supervisor','produksi']);
  -- F-11: mengisi stok outlet lain butuh wewenang di outlet tujuan (atau gunakan transfer).
  if v_out.id <> v_k.id then perform app.require_role(v_out.id, array['owner','admin','supervisor']); end if;
  if v_req is not null then
    v_dup := app.idem_begin('production_create', v_req, p);   -- kirim ulang => id rencana yang sama
    if v_dup is not null then return v_dup; end if;
  end if;
  select * into v_r from public.recipes where id = nullif(p ->> 'recipe_id', '')::uuid and active;
  if not found then raise exception 'Resep tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_b is null or v_b <= 0 then raise exception 'Jumlah batch harus lebih dari 0.' using errcode = '22023'; end if;
  if v_kind not in ('batch','pesanan','repack') then v_kind := 'batch'; end if;
  insert into public.production_orders (kitchen_outlet_id, output_outlet_id, recipe_id, variant_id, kind, batches, standard_qty, note, user_id)
  values (v_k.id, v_out.id, v_r.id, v_r.variant_id, v_kind, v_b, v_r.standard_yield * v_b, nullif(p ->> 'catatan', ''), (select auth.uid())) returning id into v_id;
  perform app.audit(v_k.id, 'production_create', 'production_orders', v_id::text, null, jsonb_build_object('batch', v_b));
  v_res := jsonb_build_object('id', v_id, 'status', 'planned');
  if v_req is not null then return app.idem_finish('production_create', v_req, v_res); end if;
  return v_res;
end $$;

create or replace function app.production_complete(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.production_orders; v_r public.recipes; v_qty numeric := app.num(p, 'qty_hasil'); v_m record;
  v_bahan numeric := 0; v_kem numeric := 0; v_tk numeric; v_oh numeric; v_total numeric; v_unit numeric; v_c numeric; v_mats jsonb := '[]'::jsonb;
  v_new numeric; v_vnew numeric; v_vcost numeric; v_dup jsonb; v_nocost text; v_res jsonb;
  v_req text := nullif(trim(coalesce(p ->> 'request_id', '')), '');
begin
  select * into v from public.production_orders where id = nullif(p ->> 'id', '')::uuid for update;   -- kunci: tidak bisa diselesaikan dua kali
  if not found then raise exception 'Produksi tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v.kitchen_outlet_id, array['owner','admin','supervisor','produksi']);
  if v.output_outlet_id <> v.kitchen_outlet_id then perform app.require_role(v.output_outlet_id, array['owner','admin','supervisor']); end if;
  if v_req is not null then
    v_dup := app.idem_begin('production_complete', v_req, p);   -- kirim ulang setelah berhasil => hasil pertama, bukan galat "sudah berstatus"
    if v_dup is not null then return v_dup; end if;
  end if;
  if v.status <> 'planned' then raise exception 'Produksi ini sudah berstatus %.', v.status using errcode = 'P0001'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Hasil aktual harus lebih dari 0.' using errcode = '22023'; end if;
  perform app.active_outlet(v.kitchen_outlet_id); perform app.active_outlet(v.output_outlet_id);
  select * into v_r from public.recipes where id = v.recipe_id;

  -- F-08: bahan tanpa harga (HPP 0) membuat HPP produk terlalu rendah. Ditolak, kecuali supervisor/owner sengaja mengizinkan (izinkan_bahan_tanpa_harga).
  if not (lower(coalesce(p ->> 'izinkan_bahan_tanpa_harga', '')) in ('true', '1', 'ya') and app.has_role(v.kitchen_outlet_id, array['owner','admin','supervisor'])) then
    select string_agg(distinct m.name, ', ') into v_nocost
      from public.recipe_items ri join public.materials m on m.id = ri.material_id
      left join public.inventory_material_balances b on b.outlet_id = v.kitchen_outlet_id and b.material_id = ri.material_id
     where ri.recipe_id = v.recipe_id and coalesce(b.avg_cost, 0) <= 0;
    if v_nocost is not null then
      raise exception 'Bahan belum punya harga (HPP 0): %. Catat pembelian atau isi HPP lewat Stok, agar HPP produk tidak terlalu rendah.', v_nocost
        using errcode = 'P0001', hint = 'MATERIAL_NO_COST';
    end if;
  end if;

  for v_m in
    select ri.material_id, sum(ri.qty * v.batches) as need, m.type, m.name
    from public.recipe_items ri join public.materials m on m.id = ri.material_id
    where ri.recipe_id = v.recipe_id group by ri.material_id, m.type, m.name order by ri.material_id
  loop
    v_new := app.stock_apply(v.kitchen_outlet_id, 'material', v_m.material_id, -v_m.need, 'production_use', 'production', v.id, null, false, null);
    select avg_cost into v_c from public.inventory_material_balances where outlet_id = v.kitchen_outlet_id and material_id = v_m.material_id;
    if v_m.type = 'kemasan' then v_kem := v_kem + v_m.need * v_c; else v_bahan := v_bahan + v_m.need * v_c; end if;
    v_mats := v_mats || jsonb_build_array(jsonb_build_object('id', v_m.material_id, 'stok', v_new));
  end loop;

  v_tk := coalesce(app.num(p, 'tenaga_kerja'), v_r.labor_cost * v.batches);
  v_oh := coalesce(app.num(p, 'overhead'), case when app.setting(v.kitchen_outlet_id, 'metode_overhead', 'per_unit') = 'per_batch'
                    then coalesce(nullif(app.setting(v.kitchen_outlet_id, 'overhead_per_batch', '0'), '')::numeric, 0) * v.batches
                    else coalesce(nullif(app.setting(v.kitchen_outlet_id, 'overhead_per_unit', '0'), '')::numeric, 0) * v_qty end);
  if v_tk < 0 or v_oh < 0 then raise exception 'Biaya tidak valid.' using errcode = '22023'; end if;
  v_total := round(v_bahan + v_kem + v_tk + v_oh, 2); v_unit := round(v_total / v_qty, 4);

  v_vnew := app.stock_apply(v.output_outlet_id, 'variant', v.variant_id, v_qty, 'production_in', 'production', v.id, v_unit, true, null);
  select avg_cost into v_vcost from public.inventory_balances where outlet_id = v.output_outlet_id and variant_id = v.variant_id;

  insert into public.production_costs (production_id, materials_cost, packaging_cost, labor_cost, overhead_cost, total, unit_cost)
  values (v.id, round(v_bahan, 2), round(v_kem, 2), v_tk, v_oh, v_total, v_unit);
  update public.production_orders set status = 'done', actual_qty = v_qty, completed_at = now() where id = v.id;
  perform app.audit(v.kitchen_outlet_id, 'production_complete', 'production_orders', v.id::text, null,
                    jsonb_build_object('qty', v_qty, 'total', v_total, 'hpp_unit', v_unit));
  v_res := jsonb_build_object('id', v.id, 'status', 'done', 'qty_hasil', v_qty,
    'costs', jsonb_build_object('bahan', v_bahan, 'kemasan', v_kem, 'tenaga_kerja', v_tk, 'overhead', v_oh, 'total', v_total, 'hpp_per_unit', v_unit),
    'materials', v_mats, 'variant', jsonb_build_object('id', v.variant_id, 'stok', v_vnew, 'hpp_rata2', v_vcost));
  if v_req is not null then return app.idem_finish('production_complete', v_req, v_res); end if;
  return v_res;
end $$;

-- Catat produksi selesai sekali jalan. p = parameter production_create + production_complete (qty_hasil, tenaga_kerja, overhead,
-- izinkan_bahan_tanpa_harga) + request_id WAJIB. Satu transaksi: gagal di tengah = tidak ada yang tersimpan.
create or replace function app.production_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_req text := nullif(trim(coalesce(p ->> 'request_id', '')), ''); v_k public.outlets; v_dup jsonb; v_c jsonb; v_res jsonb;
begin
  v_k := app.active_outlet(nullif(p ->> 'kitchen_outlet_id', '')::uuid);
  perform app.require_role(v_k.id, array['owner','admin','supervisor','produksi']);   -- wewenang dicek sebelum kunci idempotensi dibuat
  if v_req is null then raise exception 'request_id wajib (minimal 8 karakter).' using errcode = '22023'; end if;
  v_dup := app.idem_begin('production_record', v_req, p);
  if v_dup is not null then return v_dup; end if;
  v_c := app.production_create(p - 'request_id');   -- tanpa request_id: tidak ada kunci bersarang
  v_res := app.production_complete((p - 'request_id') || jsonb_build_object('id', v_c ->> 'id'));
  return app.idem_finish('production_record', v_req, v_res);
end $$;
revoke all on function app.production_record(jsonb) from public, anon;
grant execute on function app.production_record(jsonb) to authenticated;

create or replace function public.rpc_production_record(p jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select app.production_record(p) $$;
revoke all on function public.rpc_production_record(jsonb) from public, anon;
grant execute on function public.rpc_production_record(jsonb) to authenticated;
