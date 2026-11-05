-- 0037 Kemasan beli per bahan (pack_unit, pack_size) di Data Master.
--
-- Stok, opname, HPP, dan laporan tetap memakai satuan utama bahan (materials.unit). Dua kolom ini hanya MEMBANTU:
--   pack_unit : nama kemasan beli (mis. 'pack', 'karung', 'dus')
--   pack_size : isi satu kemasan dalam satuan utama bahan (mis. 24 untuk satuan pcs)
-- Dipakai klien untuk (1) mengisi otomatis form Pembelian "Per kemasan" di semua perangkat, (2) menampilkan "≈ N pack" di daftar stok.
-- Keduanya opsional dan tidak mengubah stok, HPP, atau RPC mana pun selain app.bootstrap (yang kini ikut mengirim pack_nama dan pack_isi).
-- Forward-only. Klien lama mengabaikan kunci tambahan, jadi min_client tidak dinaikkan.

alter table public.materials add column if not exists pack_unit text;
alter table public.materials add column if not exists pack_size numeric(16,4);

do $$ begin
  alter table public.materials add constraint materials_pack_chk check (
    (pack_unit is null and pack_size is null)
    or (pack_unit is not null and length(btrim(pack_unit)) between 1 and 30 and pack_size is not null and pack_size > 0 and pack_size < 1000000));
exception when duplicate_object then null; end $$;

-- bootstrap: sama seperti 0032, ditambah pack_nama dan pack_isi pada 'materials'.
create or replace function app.bootstrap(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_prof public.profiles; v_outlets jsonb; v_out uuid; v_role text; v_cost boolean; v_back boolean; v_full boolean;
  v_set jsonb; v_res jsonb; v_ver jsonb; v_act public.outlets;
begin
  if v_uid is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  select * into v_prof from public.profiles where id = v_uid and status = 'active';
  if not found then raise exception 'Sesi berakhir: akun tidak aktif.' using errcode = '28000'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'kind', o.kind, 'status', o.status,
           'timezone', o.timezone, 'address', o.address, 'role', r.role) order by o.code), '[]'::jsonb)
    into v_outlets
    from public.outlets o
    cross join lateral (select m.role from public.memberships m
                        where m.user_id = v_uid and m.status = 'active' and (m.outlet_id is null or m.outlet_id = o.id)
                        order by array_position(array['owner','admin','supervisor','stok','produksi','kasir','auditor'], m.role) limit 1) r;

  v_out := coalesce(
    (select (e ->> 'id')::uuid from jsonb_array_elements(v_outlets) e where (e ->> 'id') = p ->> 'outlet_id' and e ->> 'status' = 'active'),
    (select (e ->> 'id')::uuid from jsonb_array_elements(v_outlets) e where (e ->> 'id') = v_prof.default_outlet_id::text and e ->> 'status' = 'active'),
    (select (e ->> 'id')::uuid from jsonb_array_elements(v_outlets) e where e ->> 'status' = 'active' and e ->> 'kind' = 'store' limit 1),
    (select (e ->> 'id')::uuid from jsonb_array_elements(v_outlets) e where e ->> 'status' = 'active' limit 1));

  v_res := jsonb_build_object('server_time', to_char(now() at time zone app.outlet_tz(v_out), 'YYYY-MM-DD HH24:MI:SS'),
    'user', jsonb_build_object('uid', v_uid, 'nama', v_prof.full_name, 'username', v_prof.username), 'outlets', v_outlets);
  if v_out is null then
    return v_res || jsonb_build_object('outlet', null, 'channels', '[]'::jsonb, 'products', '[]'::jsonb, 'variants', '[]'::jsonb, 'prices', '[]'::jsonb, 'settings', '{}'::jsonb);
  end if;

  select * into v_act from public.outlets where id = v_out;
  v_role := app.role_at(v_out);
  v_cost := v_role in ('owner','admin','auditor');
  v_back := v_role in ('owner','admin','supervisor','stok','produksi');
  v_full := v_role in ('owner','admin');
  v_ver := app.ping(jsonb_build_object('outlet_id', v_out));

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_set from (
    select distinct on (key) key, value from public.settings
    where (outlet_id is null or outlet_id = v_out) and key <> 'logo_data_raw' and (v_full or key = any (app.public_setting_keys()))
    order by key, (outlet_id is null)) s;
  v_set := v_set || jsonb_build_object('blokir_stok_minus', coalesce(v_set ->> 'block_negative_stock', 'true'));

  v_res := v_res || jsonb_build_object('outlet', to_jsonb(v_act) - 'legacy_id' - 'created_by', 'role', v_role,
    'ver', v_ver ->> 'ver', 'cat_ver', v_ver ->> 'cat_ver', 'stock_ver', v_ver ->> 'stock_ver', 'settings', v_set,
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nama', c.name, 'fee_persen', c.fee_percent, 'fee_tetap', c.fee_fixed,
                  'basis_fee', c.fee_basis, 'aktif', true) order by c.name), '[]'::jsonb) from public.channels c where c.active),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'nama', pr.name, 'kategori', pr.category, 'aktif', true, 'foto_url', pr.photo_url, 'pakai_opsi', pr.use_options)
                  order by pr.name), '[]'::jsonb) from public.products pr where pr.active),
    'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'product_id', v.product_id, 'sku', v.sku, 'ukuran', v.size,
                  'level_pedas', v.spice_level, 'aktif', true, 'stok', coalesce(b.quantity, 0))
                  || case when v_cost then jsonb_build_object('hpp_rata2', coalesce(b.avg_cost, 0)) else '{}'::jsonb end order by v.sku), '[]'::jsonb)
                 from public.product_variants v join public.products pr on pr.id = v.product_id and pr.active
                 left join public.inventory_balances b on b.outlet_id = v_out and b.variant_id = v.id where v.active),
    'prices', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'channel_id', c.id, 'harga_jual', app.price_of(v_out, v.id, c.id))), '[]'::jsonb)
               from public.product_variants v join public.products pr on pr.id = v.product_id and pr.active
               cross join public.channels c where v.active and c.active and app.price_of(v_out, v.id, c.id) is not null));

  -- Opsi produk (0032): hanya yang aktif, satu payload.
  v_res := v_res || jsonb_build_object(
    'option_groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'nama', g.name, 'urutan', g.sort) order by g.sort, g.name), '[]'::jsonb)
                      from public.option_groups g where g.active),
    'option_items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'group_id', i.group_id, 'nama', i.name, 'selisih_harga', i.price_delta, 'urutan', i.sort)
                      order by i.sort, i.name), '[]'::jsonb)
                     from public.option_items i join public.option_groups g on g.id = i.group_id and g.active where i.active),
    'product_options', (select coalesce(jsonb_agg(jsonb_build_object('product_id', l.product_id, 'group_id', l.group_id, 'wajib', l.required,
                        'default_item_id', l.default_item_id, 'urutan', l.sort) order by l.sort), '[]'::jsonb)
                        from public.product_option_groups l join public.products pr on pr.id = l.product_id and pr.active
                        join public.option_groups g on g.id = l.group_id and g.active where l.active));
  if v_back then
    v_res := v_res || jsonb_build_object(
      'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nama', m.name, 'tipe', m.type, 'satuan', m.unit, 'stok', coalesce(b.quantity, 0),
                      'stok_minimum', m.min_stock, 'aktif', true, 'satuan_kecil', m.small_unit, 'faktor_kecil', m.small_factor,
                      'pack_nama', m.pack_unit, 'pack_isi', m.pack_size)
                      || case when v_cost then jsonb_build_object('hpp_rata2', coalesce(b.avg_cost, 0)) else '{}'::jsonb end order by m.name), '[]'::jsonb)
                    from public.materials m left join public.inventory_material_balances b on b.outlet_id = v_out and b.material_id = m.id where m.active),
      'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nama', s.name, 'kontak', s.contact, 'catatan', s.notes, 'aktif', true) order by s.name), '[]'::jsonb)
                    from public.suppliers s where s.active),
      'recipes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'variant_id', r.variant_id, 'nama', r.name, 'hasil_standar', r.standard_yield,
                    'jenis', r.kind, 'aktif', true, 'tenaga_kerja', r.labor_cost)), '[]'::jsonb) from public.recipes r where r.active),
      'recipe_items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'recipe_id', i.recipe_id, 'material_id', i.material_id, 'qty', i.qty)), '[]'::jsonb)
                       from public.recipe_items i join public.recipes r on r.id = i.recipe_id and r.active));
  end if;
  return v_res;
end $$;
