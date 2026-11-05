-- 0039 Input transaksi lama: dukung OPSI PRODUK (cara masak, level pedas) per item.
--
-- Sebelumnya (0038) rpc_sale_backdate mengabaikan opsi, sehingga produk beropsi (mis. "Pangsit Kuah Pedas" + Rebus/Goreng + Level 1-3) tercatat tanpa pilihan
-- dan laporan opsi (report_option_sales) serta Retur per baris tidak cocok dengan transaksi Kasir. Kini items[].opsi diterima persis seperti sale_create (0032):
--   * opsi = larik id item opsi (satu per grup); disalin sebagai snapshot ke sale_item_options, label ke sale_items.option_label/option_key.
--   * Harga: bila items[].harga diisi, itu HARGA SATUAN AKHIR (sudah termasuk tambahan opsi, sesuai yang tertulis di catatan). Bila kosong:
--     harga channel saat ini + jumlah selisih harga opsi (dihitung server).
--   * Baris dengan varian sama tetapi opsi berbeda TIDAK digabung (stok tetap dipotong per varian).
--   * Grup opsi WAJIB harus dipilih untuk produk yang memakai opsi (sama seperti Kasir). Item opsi yang kini nonaktif tetap boleh: ini data historis.
--   * Item opsi harus milik produk tersebut (tertaut), satu pilihan per grup.
-- Tanpa items[].opsi perilaku sama seperti 0038 (kecuali produk beropsi kini menuntut pilihan wajib). Forward-only: hanya create or replace app.sale_backdate.
-- Klien 2.6.7 yang mengirim tanpa opsi tetap berjalan untuk produk tanpa opsi; klien 2.6.8 butuh skema ini (MIN_SCHEMA).

create or replace function app.sale_backdate(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_o public.outlets; v_ch public.channels; v_req text := p ->> 'request_id'; v_dup jsonb; v_res jsonb;
  v_method text := lower(coalesce(nullif(p ->> 'metode_bayar', ''), 'tunai'));
  v_stok boolean := lower(coalesce(p ->> 'potong_stok', 'true')) in ('true', '1', 'ya');
  v_sold timestamptz; v_local timestamp; v_l record; v_price numeric; v_sub numeric := 0; v_disc numeric; v_base numeric; v_rate numeric; v_tax numeric := 0; v_total numeric; v_fee numeric;
  v_sale uuid := gen_random_uuid(); v_seq int; v_no text; v_ref text := nullif(left(trim(coalesce(p ->> 'referensi_bayar', '')), 60), ''); v_note text := nullif(left(trim(coalesce(p ->> 'catatan', '')), 200), '');
  v_stock jsonb := '{}'::jsonb; v_new numeric;
begin
  if v_uid is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  if (p ->> 'outlet_id') is null or (p ->> 'outlet_id') !~* '^[0-9a-f-]{36}$' then raise exception 'Outlet wajib dipilih.' using errcode = '22023'; end if;
  v_o := app.active_outlet((p ->> 'outlet_id')::uuid, 'store');
  perform app.require_role(v_o.id, array['owner','admin']);
  v_dup := app.idem_begin('sale_backdate', v_req, p);
  if v_dup is not null then return v_dup; end if;

  if v_method not in ('tunai','transfer','qris') or not app.setting_bool(v_o.id, 'bayar_' || v_method, true) then
    raise exception 'Metode bayar "%" tidak diizinkan.', v_method using errcode = 'P0001';
  end if;
  select * into v_ch from public.channels where id = nullif(p ->> 'channel_id', '')::uuid and active;
  if not found then raise exception 'Channel tidak valid.' using errcode = 'P0001'; end if;

  -- waktu transaksi (waktu lokal outlet)
  if coalesce(p ->> 'tanggal', '') !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$' then
    raise exception 'Tanggal dan jam transaksi tidak valid (format YYYY-MM-DD HH:MM).' using errcode = '22023';
  end if;
  begin v_sold := replace(p ->> 'tanggal', 'T', ' ')::timestamp at time zone v_o.timezone; exception when others then
    raise exception 'Tanggal dan jam transaksi tidak valid.' using errcode = '22023'; end;
  if v_sold >= now() then raise exception 'Tanggal transaksi lama harus di masa lalu. Untuk transaksi hari ini gunakan kasir.' using errcode = 'P0001'; end if;
  if v_sold < timestamptz '2000-01-01' then raise exception 'Tanggal transaksi tidak masuk akal.' using errcode = '22023'; end if;
  v_local := v_sold at time zone v_o.timezone;
  perform app.period_assert(v_local::date, 'Transaksi lama');

  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then raise exception 'Belum ada item.' using errcode = '22023'; end if;
  if jsonb_array_length(p -> 'items') > 100 then raise exception 'Terlalu banyak baris item (maks. 100).' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') e
             where coalesce(e ->> 'variant_id', '') !~* '^[0-9a-f-]{36}$'
                or coalesce(e ->> 'qty', '') !~ '^[0-9]+(\.[0-9]{1,4})?$' or (e ->> 'qty')::numeric <= 0 or (e ->> 'qty')::numeric > 100000
                or (nullif(e ->> 'harga', '') is not null and (e ->> 'harga' !~ '^[0-9]+(\.[0-9]{1,2})?$'))) then
    raise exception 'Item tidak valid (varian, jumlah, atau harga).' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') e where e ? 'opsi' and jsonb_typeof(e -> 'opsi') not in ('array', 'null')) then
    raise exception 'Opsi item tidak valid.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') e, jsonb_array_elements_text(case when jsonb_typeof(e -> 'opsi') = 'array' then e -> 'opsi' else '[]'::jsonb end) x
             where x !~* '^[0-9a-f-]{36}$') then
    raise exception 'Opsi item tidak valid (id).' using errcode = '22023';
  end if;

  -- Opsi produk (sama dengan sale_create 0032): uraikan per baris, validasi set-based, selisih harga dihitung SERVER.
  create temp table if not exists _bq (ln int, variant_id uuid, qty numeric, harga numeric, item_id uuid) on commit drop;
  create temp table if not exists _br (ln int, variant_id uuid, qty numeric, harga numeric, product_id uuid, use_opt boolean, item_id uuid, group_id uuid, gname text, iname text, delta numeric, gsort int, linked boolean) on commit drop;
  create temp table if not exists _bn (ln int, variant_id uuid, qty numeric, harga numeric, okey text, delta numeric, label text) on commit drop;
  create temp table if not exists _bri (variant_id uuid, okey text, group_id uuid, item_id uuid, gname text, iname text, delta numeric) on commit drop;
  create temp table if not exists _bd (variant_id uuid, okey text, qty numeric, price numeric, sku text, nm text, label text) on commit drop;
  truncate _bq, _br, _bn, _bri, _bd;
  insert into _bq (ln, variant_id, qty, harga, item_id)
  select e.ord::int, (e.v ->> 'variant_id')::uuid, (e.v ->> 'qty')::numeric, nullif(e.v ->> 'harga', '')::numeric, o.item_id
  from jsonb_array_elements(p -> 'items') with ordinality e(v, ord)
  left join lateral (select distinct lower(x)::uuid as item_id
                     from jsonb_array_elements_text(case when jsonb_typeof(e.v -> 'opsi') = 'array' then e.v -> 'opsi' else '[]'::jsonb end) x) o on true;
  insert into _br
  select q.ln, q.variant_id, q.qty, q.harga, v.product_id, coalesce(pr.use_options, false), q.item_id, i.group_id, g.name, i.name, i.price_delta, g.sort, l.group_id is not null
  from _bq q
  left join public.product_variants v on v.id = q.variant_id
  left join public.products pr on pr.id = v.product_id
  left join public.option_items i on i.id = q.item_id
  left join public.option_groups g on g.id = i.group_id
  left join public.product_option_groups l on l.product_id = v.product_id and l.group_id = i.group_id;

  if exists (select 1 from _br where item_id is not null and group_id is null) then
    raise exception 'Opsi tidak dikenal. Muat ulang data lalu pilih ulang.' using errcode = 'P0001', hint = 'OPTION_UNKNOWN';
  end if;
  if exists (select 1 from _br where item_id is not null and not linked) then
    raise exception 'Opsi "%" bukan milik produk ini.', (select iname from _br where item_id is not null and not linked limit 1)
      using errcode = 'P0001', hint = 'OPTION_FOREIGN';
  end if;
  if exists (select 1 from _br where item_id is not null group by ln, group_id having count(*) > 1) then
    raise exception 'Hanya boleh satu pilihan per grup opsi.' using errcode = 'P0001', hint = 'OPTION_DUP_GROUP';
  end if;
  -- grup wajib yang belum dipilih (hanya produk yang saat ini memakai opsi)
  if exists (select 1 from (select distinct ln, product_id from _br where use_opt) b
             join public.product_option_groups l on l.product_id = b.product_id and l.required and l.active
             join public.option_groups g on g.id = l.group_id and g.active
             where not exists (select 1 from _br s where s.ln = b.ln and s.group_id = l.group_id and s.item_id is not null)) then
    raise exception 'Pilih semua opsi wajib (%).',
      (select string_agg(distinct g.name, ', ') from (select distinct ln, product_id from _br where use_opt) b
         join public.product_option_groups l on l.product_id = b.product_id and l.required and l.active
         join public.option_groups g on g.id = l.group_id and g.active
        where not exists (select 1 from _br s where s.ln = b.ln and s.group_id = l.group_id and s.item_id is not null))
      using errcode = 'P0001', hint = 'OPTION_REQUIRED';
  end if;

  insert into _bn (ln, variant_id, qty, harga, okey, delta, label)
  select ln, variant_id, max(qty), max(harga),
         coalesce(string_agg(item_id::text, ',' order by item_id::text) filter (where item_id is not null), ''),
         coalesce(sum(delta) filter (where item_id is not null), 0),
         string_agg(iname, ' · ' order by gsort, gname) filter (where item_id is not null)
  from _br group by ln, variant_id;
  insert into _bri (variant_id, okey, group_id, item_id, gname, iname, delta)
  select distinct n.variant_id, n.okey, s.group_id, s.item_id, s.gname, s.iname, s.delta
  from _br s join _bn n on n.ln = s.ln where s.item_id is not null;

  -- Baris digabung per varian + kombinasi opsi (harga rata-rata tertimbang bila beberapa baris memberi harga).
  for v_l in
    select i.variant_id, i.okey, i.qty, i.harga, i.delta, i.label, v.sku, v.active as vactive, pr.active as pactive,
           trim(coalesce(pr.name, '') || ' ' || coalesce(v.size, '') || case when v.spice_level is null or v.spice_level = '' then '' else ' ' || v.spice_level end) as nm
    from (select n.variant_id, n.okey, sum(n.qty) as qty, max(n.delta) as delta, max(n.label) as label,
                 round(sum(n.qty * n.harga) filter (where n.harga is not null) / nullif(sum(n.qty) filter (where n.harga is not null), 0), 2) as harga
          from _bn n group by n.variant_id, n.okey) i
    left join public.product_variants v on v.id = i.variant_id
    left join public.products pr on pr.id = v.product_id
    order by i.variant_id, i.okey
  loop
    if v_l.sku is null then raise exception 'Varian tidak ditemukan.' using errcode = 'P0001'; end if;
    if not v_l.vactive or not v_l.pactive then raise exception 'Varian nonaktif: %', v_l.sku using errcode = 'P0001'; end if;
    -- harga yang ditulis di catatan = harga satuan akhir; bila kosong: harga channel + selisih opsi (server)
    v_price := coalesce(v_l.harga, app.price_of(v_o.id, v_l.variant_id, v_ch.id) + v_l.delta);
    if v_price is null or v_price < 0 then raise exception 'Harga belum diatur: % di %', v_l.sku, v_ch.name using errcode = 'P0001'; end if;
    insert into _bd values (v_l.variant_id, v_l.okey, v_l.qty, v_price, v_l.sku, v_l.nm, v_l.label);
    v_sub := v_sub + round(v_l.qty * v_price, 2);
  end loop;

  v_disc := least(greatest(coalesce(app.num(p, 'diskon', 0), 0), 0), v_sub);
  v_base := v_sub - v_disc; v_total := v_base;
  v_rate := coalesce(nullif(app.setting(v_o.id, 'ppn_persen', '0'), '')::numeric, 0);
  if app.setting_bool(v_o.id, 'ppn_aktif', false) and v_rate > 0 then
    if app.setting_bool(v_o.id, 'ppn_inklusif', false) then v_tax := round(v_base * v_rate / (100 + v_rate));
    else v_tax := round(v_base * v_rate / 100); v_total := v_base + v_tax; end if;
  else v_rate := 0; end if;
  v_fee := round(case v_ch.fee_basis when 'subtotal' then v_sub when 'omzet' then v_total - v_tax else v_total end * v_ch.fee_percent / 100) + v_ch.fee_fixed;

  if v_stok then   -- stok per varian (opsi tidak mengubah stok)
    for v_l in select variant_id, sku, sum(qty) as qty from _bd group by variant_id, sku order by variant_id loop
      v_new := app.stock_apply(v_o.id, 'variant', v_l.variant_id, -v_l.qty, 'sale', 'sale', v_sale, null, true, 'Transaksi lama');
      v_stock := v_stock || jsonb_build_object(v_l.variant_id::text, v_new);
    end loop;
  end if;

  v_seq := app.next_seq(v_o.id, 'sale', v_local::date);
  v_no := v_o.code || '-' || to_char(v_local, 'YYMMDD') || '-' || app.seq_text(v_seq);

  insert into public.sales (id, outlet_id, receipt_no, request_id, kind, channel_id, cashier_id, cash_session_id, status,
                            subtotal, discount, fee_channel, tax_rate, tax_amount, total, payment_method, sold_at, note)
  values (v_sale, v_o.id, v_no, v_req, 'sale', v_ch.id, v_uid, null, 'completed',
          v_sub, v_disc, v_fee, v_rate, v_tax, v_total, v_method, v_sold, trim('Transaksi lama' || coalesce(' · ' || v_note, '')));
  with ins as (
    insert into public.sale_items (sale_id, outlet_id, variant_id, sku_snapshot, name_snapshot, qty, unit_price, hpp_snapshot, option_label, option_key)
    select v_sale, v_o.id, s.variant_id, s.sku, s.nm, s.qty, s.price, nullif(coalesce(b.avg_cost, 0), 0), s.label, s.okey
    from _bd s left join public.inventory_balances b on b.outlet_id = v_o.id and b.variant_id = s.variant_id
    returning id, variant_id, option_key)
  insert into public.sale_item_options (sale_item_id, group_id, item_id, group_name, item_name, price_delta)
  select ins.id, r.group_id, r.item_id, r.gname, r.iname, r.delta
  from ins join _bri r on r.variant_id = ins.variant_id and r.okey = ins.option_key;
  insert into public.payments (sale_id, outlet_id, cash_session_id, method, amount, received, change_given, reference)
  values (v_sale, v_o.id, null, v_method, v_total, v_total, 0, case when v_method <> 'tunai' then v_ref end);

  perform app.audit(v_o.id, 'sale_backdate', 'sales', v_sale::text, null,
                    jsonb_build_object('nomor', v_no, 'total', v_total, 'metode', v_method, 'tanggal', to_char(v_local, 'YYYY-MM-DD HH24:MI:SS'), 'potong_stok', v_stok));
  v_res := jsonb_build_object('sale', jsonb_build_object('id', v_sale, 'nomor', v_no, 'outlet_id', v_o.id, 'tanggal', to_char(v_local, 'YYYY-MM-DD HH24:MI:SS'),
                              'subtotal', v_sub, 'diskon', v_disc, 'ppn_nominal', v_tax, 'total', v_total, 'metode', v_method),
                              'stok', v_stock, 'potong_stok', v_stok);
  return app.idem_finish('sale_backdate', v_req, v_res);
end $$;
