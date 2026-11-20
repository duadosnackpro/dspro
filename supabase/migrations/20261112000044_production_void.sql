-- 0044 Batalkan produksi yang SUDAH SELESAI (production_void).
--
-- Latar belakang: production_cancel hanya menerima status 'planned' (0007). Produksi yang sudah selesai (salah input hasil/batch/resep) tidak punya
-- jalan balik selain opname manual, yang mengotori laporan kerugian persediaan (inventory_losses) dan tidak mengembalikan bahan.
-- production_void membalik produksi selesai dalam SATU transaksi, memakai pola yang sama dengan purchase_cancel (0024):
--   1. Bahan dikembalikan ke dapur sebesar yang tercatat di ledger (production_use, bukan dari resep yang mungkin sudah berubah) dengan harga saat
--      dipakai, mutasi 'void_reverse'. HPP rata-rata bahan dihitung ulang oleh stock_apply (rata-rata tertimbang).
--   2. Stok produk jadi dikurangi sebesar hasil produksi (mutasi 'void_reverse') dan HPP rata-rata produk dihitung ulang tanpa produksi itu.
--   3. TIDAK dicatat sebagai kerugian persediaan (inventory_losses): ini koreksi salah input, bukan selisih fisik.
--   4. Baris biaya (production_costs) dihapus supaya "Total biaya" di laporan tidak menghitungnya lagi; nilai aslinya disimpan di audit (before).
--   5. Status menjadi 'cancelled' dengan cancelled_at, cancelled_by, cancel_reason, cancelled_after_done = true.
-- Syarat (semua dicek di server; gagal = tidak ada yang berubah):
--   - Hanya owner/admin/supervisor (peran produksi dan stok tidak bisa; mereka diarahkan meminta atasan). Alasan minimal 3 huruf.
--   - Status harus 'done'. Rencana tetap dibatalkan lewat production_cancel.
--   - Tanggal selesai tidak berada di periode yang sudah dikunci (app.period_assert).
--   - Produk hasilnya belum keluar: tidak boleh ada mutasi pengurang pada produk itu (penjualan, transfer, opname turun, dst.) sesudah produksi,
--     dan stok saat ini harus cukup untuk dikurangi. Bila sudah ada yang keluar, koreksi lewat opname (Stok, Penyesuaian).
--   - Produksi harus punya catatan ledger (produksi hasil impor lama tanpa ledger tidak bisa dibalik otomatis).
-- request_id opsional (anti-ganda, sama seperti production_update): kirim ulang mengembalikan hasil pertama (duplicate: true).
-- production_list menambah kolom alasan_batal, batal_setelah_selesai, tanggal_batal (hanya tambahan; klien lama mengabaikannya).
-- Kompatibilitas: forward-only, hanya menambah. Klien lama tetap berjalan. Klien yang memakai tombol "Batalkan produksi" butuh migrasi ini;
-- bila belum terpasang, klien menampilkan pesan "butuh migrasi 0044" (MIN_SCHEMA tidak dinaikkan).

alter table public.production_orders
  add column cancelled_at timestamptz,
  add column cancelled_by uuid,
  add column cancel_reason text,
  add column cancelled_after_done boolean not null default false;

create function app.production_void(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v public.production_orders; v_why text := trim(coalesce(p ->> 'alasan', ''));
  v_req text := nullif(trim(coalesce(p ->> 'request_id', '')), ''); v_dup jsonb;
  v_c public.production_costs; v_in public.stock_movements; v_m record; v_mats jsonb := '[]'::jsonb; v_new numeric;
  v_bal numeric; v_avg numeric; v_rest numeric; v_newavg numeric; v_qty numeric; v_vname text; v_vnew numeric; v_vcost numeric; v_res jsonb;
begin
  if v_uid is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  select * into v from public.production_orders where id = nullif(p ->> 'id', '')::uuid for update;   -- kunci: tidak bisa bersamaan dengan selesai/batal/ubah
  if not found then raise exception 'Produksi tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v.kitchen_outlet_id, array['owner','admin','supervisor']);
  if v.output_outlet_id <> v.kitchen_outlet_id then perform app.require_role(v.output_outlet_id, array['owner','admin','supervisor']); end if;
  if v_req is not null then
    v_dup := app.idem_begin('production_void', v_req, p);   -- kirim ulang sesudah berhasil => hasil pertama, bukan galat status
    if v_dup is not null then return v_dup; end if;
  end if;
  if v.status = 'cancelled' then raise exception 'Produksi ini sudah dibatalkan.' using errcode = 'P0001'; end if;
  if v.status <> 'done' then
    raise exception 'Hanya produksi yang sudah selesai yang bisa dibatalkan di sini. Rencana dibatalkan lewat "Batalkan rencana".' using errcode = 'P0001';
  end if;
  if length(v_why) < 3 then raise exception 'Alasan pembatalan wajib diisi (minimal 3 huruf).' using errcode = '22023'; end if;
  perform app.active_outlet(v.kitchen_outlet_id); perform app.active_outlet(v.output_outlet_id);
  perform app.period_assert((v.completed_at at time zone app.outlet_tz(v.kitchen_outlet_id))::date, 'Produksi');

  select * into v_in from public.stock_movements
   where reference_type = 'production' and reference_id = v.id and movement_type = 'production_in' and item_type = 'variant'
     and outlet_id = v.output_outlet_id order by id limit 1;
  if not found then
    raise exception 'Produksi ini tidak punya catatan stok (kemungkinan hasil impor lama), jadi tidak bisa dibatalkan otomatis. Koreksi lewat Stok, Penyesuaian.'
      using errcode = 'P0001', hint = 'PRODUCTION_NO_LEDGER';
  end if;
  v_qty := v_in.quantity_delta;
  select * into v_c from public.production_costs where production_id = v.id;

  -- 1) Bahan kembali ke dapur: jumlah dan harga dari ledger saat produksi (urutan kunci sama dengan production_complete: bahan dulu, lalu produk jadi).
  for v_m in
    select sm.item_id, sum(-sm.quantity_delta) as qty, sum(-sm.value) as val, m.name
      from public.stock_movements sm join public.materials m on m.id = sm.item_id
     where sm.reference_type = 'production' and sm.reference_id = v.id and sm.movement_type = 'production_use'
       and sm.item_type = 'material' and sm.outlet_id = v.kitchen_outlet_id
     group by sm.item_id, m.name order by sm.item_id
  loop
    v_new := app.stock_apply(v.kitchen_outlet_id, 'material', v_m.item_id, v_m.qty, 'void_reverse', 'production', v.id,
                             round(v_m.val / v_m.qty, 4), false, 'Batal produksi: ' || left(v_why, 200));
    v_mats := v_mats || jsonb_build_array(jsonb_build_object('id', v_m.item_id, 'nama', v_m.name, 'qty', v_m.qty, 'stok', v_new));
  end loop;

  -- 2) Produk jadi: tolak bila hasilnya sudah ada yang keluar (apa pun penyebabnya) atau stok tidak cukup. Pembatalan produksi lain tidak dihitung.
  select b.quantity, b.avg_cost into v_bal, v_avg from public.inventory_balances b
   where b.outlet_id = v.output_outlet_id and b.variant_id = v.variant_id for update;
  if exists (select 1 from public.stock_movements sm
              where sm.outlet_id = v.output_outlet_id and sm.item_type = 'variant' and sm.item_id = v.variant_id
                and sm.id > v_in.id and sm.quantity_delta < 0
                and not (sm.movement_type = 'void_reverse' and sm.reference_type = 'production'))
     or coalesce(v_bal, 0) + 0.0001 < v_qty then
    select coalesce(p.name, '?') || ' ' || pv.sku into v_vname from public.product_variants pv left join public.products p on p.id = pv.product_id where pv.id = v.variant_id;
    raise exception 'Produksi tidak dapat dibatalkan: hasilnya (%) sudah ada yang keluar (stok kini %, hasil produksi %). Koreksi lewat Stok, Penyesuaian.',
      coalesce(v_vname, '?'), coalesce(v_bal, 0), v_qty using errcode = 'P0001', hint = 'PRODUCTION_OUTPUT_USED';
  end if;
  v_vnew := app.stock_apply(v.output_outlet_id, 'variant', v.variant_id, -v_qty, 'void_reverse', 'production', v.id, v_in.unit_cost, false,
                            'Batal produksi: ' || left(v_why, 200));
  v_rest := v_bal - v_qty;
  if v_rest > 0.0001 then   -- HPP rata-rata dihitung ulang tanpa produksi ini; stok nol: HPP dibiarkan sampai produksi berikutnya menimpanya
    v_newavg := round((v_bal * v_avg - v_qty * coalesce(v_in.unit_cost, v_avg)) / v_rest, 4);
    if v_newavg >= 0 then
      update public.inventory_balances set avg_cost = v_newavg, updated_at = now() where outlet_id = v.output_outlet_id and variant_id = v.variant_id;
    end if;
  end if;
  select avg_cost into v_vcost from public.inventory_balances where outlet_id = v.output_outlet_id and variant_id = v.variant_id;

  -- 3) Biaya dihapus agar laporan tidak menghitungnya; nilai asli ada di audit. Status menjadi batal.
  delete from public.production_costs where production_id = v.id;
  update public.production_orders set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = left(v_why, 300), cancelled_after_done = true
   where id = v.id;
  perform app.audit(v.kitchen_outlet_id, 'production_void', 'production_orders', v.id::text,
    jsonb_build_object('status', 'done', 'qty', v.actual_qty, 'selesai', v.completed_at, 'bahan', v_c.materials_cost, 'kemasan', v_c.packaging_cost,
                       'tenaga_kerja', v_c.labor_cost, 'overhead', v_c.overhead_cost, 'total', v_c.total, 'hpp_unit', v_c.unit_cost),
    jsonb_build_object('status', 'cancelled', 'alasan', left(v_why, 300), 'qty_dikurangi', v_qty, 'bahan_dikembalikan', v_mats));
  v_res := jsonb_build_object('id', v.id, 'status', 'cancelled', 'qty_dikurangi', v_qty, 'materials', v_mats,
                              'variant', jsonb_build_object('id', v.variant_id, 'stok', v_vnew, 'hpp_rata2', v_vcost));
  if v_req is not null then return app.idem_finish('production_void', v_req, v_res); end if;
  return v_res;
end $$;

-- ---------- Daftar produksi: tambah alasan_batal, batal_setelah_selesai, tanggal_batal (isi lain sama seperti 0036) ----------
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
      'batal_setelah_selesai', q.cancelled_after_done, 'alasan_batal', q.cancel_reason,
      'tanggal_batal', case when q.cancelled_at is not null then to_char(q.cancelled_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS') end,
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

-- ---------- Pembungkus RPC publik + hak eksekusi ----------
create or replace function public.rpc_production_void(p jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select app.production_void(p) $$;
revoke all on function public.rpc_production_void(jsonb) from public, anon;
grant execute on function public.rpc_production_void(jsonb) to authenticated;
revoke all on function app.production_void(jsonb) from public, anon;
grant execute on function app.production_void(jsonb) to authenticated;
