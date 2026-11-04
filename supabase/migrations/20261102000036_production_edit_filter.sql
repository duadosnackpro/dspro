-- 0036 Produksi: (1) ubah jumlah batch pada rencana yang belum selesai, (2) daftar produksi dengan filter tanggal + tanggal selesai.
--
-- 1) production_update: hanya untuk status 'planned'. Mengubah batches dan standard_qty (hasil standar per batch tetap seperti saat rencana dibuat,
--    jadi yang berubah hanya jumlah batch) dan, bila dikirim, catatan. Bahan dan stok TIDAK tersentuh: keduanya baru bergerak saat production_complete.
--    request_id opsional (sama seperti production_create); kirim ulang dengan isi sama mengembalikan hasil pertama (duplicate: true),
--    isi berbeda dengan request_id sama ditolak (23505). Pesanan yang sudah selesai/batal ditolak dengan pesan yang jelas.
-- 2) production_list menerima from/to (YYYY-MM-DD, zona waktu outlet, keduanya opsional) dan mengembalikan tanggal_selesai.
--    Tanggal yang disaring = tanggal selesai bila sudah selesai, selain itu tanggal dibuat. Tanpa from/to hasilnya sama seperti sebelumnya
--    (200 terbaru, urut tanggal dibuat); kolom tanggal_selesai hanya tambahan, klien lama mengabaikannya.
-- Forward-only. Tidak perlu menaikkan min_client.

create or replace function app.production_update(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.production_orders; v_b numeric := app.num(p, 'jumlah_batch'); v_std numeric; v_note text;
  v_req text := nullif(trim(coalesce(p ->> 'request_id', '')), ''); v_dup jsonb; v_res jsonb;
begin
  select * into v from public.production_orders where id = nullif(p ->> 'id', '')::uuid for update;   -- kunci: tidak bisa bersamaan dengan selesai/batal
  if not found then raise exception 'Produksi tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v.kitchen_outlet_id, array['owner','admin','supervisor','produksi']);
  if v_req is not null then
    v_dup := app.idem_begin('production_update', v_req, p);   -- kirim ulang sesudah berhasil => hasil pertama, bukan galat status
    if v_dup is not null then return v_dup; end if;
  end if;
  if v.status <> 'planned' then
    raise exception 'Hanya rencana produksi yang belum selesai yang bisa diubah (produksi ini %).', case v.status when 'done' then 'sudah selesai' else 'sudah dibatalkan' end
      using errcode = 'P0001';
  end if;
  if v_b is null or v_b <= 0 then raise exception 'Jumlah batch harus lebih dari 0.' using errcode = '22023'; end if;
  if v_b >= 1000000 then raise exception 'Jumlah batch terlalu besar.' using errcode = '22023'; end if;
  perform app.active_outlet(v.kitchen_outlet_id); perform app.active_outlet(v.output_outlet_id);

  v_std := round(v.standard_qty / v.batches * v_b, 4);   -- hasil standar per batch dari rencana asli
  v_note := case when p ? 'catatan' then nullif(trim(coalesce(p ->> 'catatan', '')), '') else v.note end;
  update public.production_orders set batches = v_b, standard_qty = v_std, note = v_note where id = v.id;
  perform app.audit(v.kitchen_outlet_id, 'production_update', 'production_orders', v.id::text,
                    jsonb_build_object('batch', v.batches, 'catatan', v.note), jsonb_build_object('batch', v_b, 'catatan', v_note));
  v_res := jsonb_build_object('id', v.id, 'status', 'planned', 'jumlah_batch', v_b, 'qty_standar', v_std, 'catatan', v_note);
  if v_req is not null then return app.idem_finish('production_update', v_req, v_res); end if;
  return v_res;
end $$;
revoke all on function app.production_update(jsonb) from public, anon;
grant execute on function app.production_update(jsonb) to authenticated;

create or replace function public.rpc_production_update(p jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select app.production_update(p) $$;
revoke all on function public.rpc_production_update(jsonb) from public, anon;
grant execute on function public.rpc_production_update(jsonb) to authenticated;

-- ---------- Daftar produksi: filter tanggal + tanggal selesai ----------
create or replace function app.production_list(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_o public.outlets; v_cost boolean; v_rows jsonb; v_from date := nullif(p ->> 'from', '')::date; v_to date := nullif(p ->> 'to', '')::date;
begin
  select * into v_o from public.outlets where id = nullif(p ->> 'outlet_id', '')::uuid;
  if not found then raise exception 'Outlet tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v_o.id, array['owner','admin','supervisor','produksi','stok','auditor']);
  if v_from is not null and v_to is not null and v_from > v_to then
    raise exception 'Tanggal awal tidak boleh setelah tanggal akhir.' using errcode = '22023';
  end if;
  v_cost := app.has_role(v_o.id, array['owner','admin','auditor']);
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'variant_id', q.variant_id, 'recipe_id', q.recipe_id, 'jenis', q.kind,
      'jumlah_batch', q.batches, 'tanggal', to_char(q.created_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS'),
      'tanggal_selesai', case when q.completed_at is not null then to_char(q.completed_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS') end,
      'status', case q.status when 'done' then 'selesai' when 'planned' then 'rencana' else 'batal' end,
      'qty_standar', q.standard_qty, 'qty_hasil', q.actual_qty, 'catatan', q.note,
      'bahan', case when v_cost then q.materials_cost end, 'kemasan', case when v_cost then q.packaging_cost end,
      'tenaga_kerja', case when v_cost then q.labor_cost end, 'overhead', case when v_cost then q.overhead_cost end,
      'total', case when v_cost then q.total end, 'hpp_per_unit', case when v_cost then q.unit_cost end) order by q.created_at desc), '[]'::jsonb)
    into v_rows from (
      select po.*, pc.materials_cost, pc.packaging_cost, pc.labor_cost, pc.overhead_cost, pc.total, pc.unit_cost
      from public.production_orders po left join public.production_costs pc on pc.production_id = po.id
      where (po.kitchen_outlet_id = v_o.id or po.output_outlet_id = v_o.id)
        and (v_from is null or (coalesce(po.completed_at, po.created_at) at time zone v_o.timezone)::date >= v_from)
        and (v_to is null or (coalesce(po.completed_at, po.created_at) at time zone v_o.timezone)::date <= v_to)
      order by po.created_at desc limit 200) q;
  return v_rows;
end $$;
