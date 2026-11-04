-- 0032 Opsi Produk (level pedas, cara masak): pilihan setelah produk masuk keranjang, tersimpan sebagai sub-nama pada baris penjualan.
--
-- NETRAL stok dan HPP: stock_apply, produksi, HPP, dan logika laba TIDAK diubah. Pilihan yang memakai bahan/biaya berbeda tetap varian/produk terpisah.
-- Server menghitung harga: unit_price = harga channel + jumlah selisih harga opsi. Klien hanya mengirim id item opsi (items[].opsi).
-- Snapshot, bukan rujukan: pilihan disalin ke sale_item_options (tetap, dilindungi forbid_mutation).
-- Katalog repo ini global (tanpa tenant_id), sehingga tabel opsi mengikuti pola products: baca anggota, tulis hanya lewat RPC (owner/admin).
-- Fungsi yang diganti (create or replace, isi lama disalin lalu diubah): sale_create (0024), sale_return (0023), sale_detail (0008),
-- bootstrap (0024), ping (0008), data_reset (0025).

-- ---------- Skema ----------
alter table public.products add column use_options boolean not null default false;
alter table public.sale_items add column option_label text;                    -- mis. 'Level 3 · Goreng'
alter table public.sale_items add column option_key text not null default '';  -- id item opsi terurut, dipisah koma; '' = tanpa opsi (kunci retur per baris)

create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index option_groups_name_uq on public.option_groups (lower(name)) where active;

create table public.option_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups(id),
  name text not null check (length(trim(name)) between 1 and 40),
  price_delta numeric(14,2) not null default 0 check (price_delta >= 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, id)
);
create unique index option_items_name_uq on public.option_items (group_id, lower(name)) where active;
create index option_items_group_idx on public.option_items (group_id);

create table public.product_option_groups (
  product_id uuid not null references public.products(id),
  group_id uuid not null references public.option_groups(id),
  required boolean not null default true,
  default_item_id uuid,
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (product_id, group_id),
  foreign key (group_id, default_item_id) references public.option_items (group_id, id)   -- default harus item dari grup yang sama
);
create index pog_group_idx on public.product_option_groups (group_id);

create table public.sale_item_options (
  sale_item_id uuid not null references public.sale_items(id),
  group_id uuid not null,
  item_id uuid not null,
  group_name text not null,
  item_name text not null,
  price_delta numeric(14,2) not null check (price_delta >= 0),
  primary key (sale_item_id, group_id)          -- satu pilihan per grup dijamin DB
);
create index sio_item_idx on public.sale_item_options (item_id);

create trigger sale_item_options_immutable before update or delete on public.sale_item_options
  for each row execute function app.forbid_mutation();

create trigger option_groups_touch before update on public.option_groups for each row execute function app.touch_updated_at();
create trigger option_items_touch before update on public.option_items for each row execute function app.touch_updated_at();
create trigger pog_touch before update on public.product_option_groups for each row execute function app.touch_updated_at();

-- Sinyal sinkron katalog (Realtime) + versi katalog (ping memasukkan tabel ini).
do $$ declare t text; begin
  foreach t in array array['option_groups', 'option_items', 'product_option_groups'] loop
    execute format('create trigger sync_cat_signal after insert or update or delete on public.%I for each statement execute function app.trg_sync_cat()', t);
  end loop;
end $$;

-- ---------- RLS: baca anggota, tulis hanya lewat RPC ----------
alter table public.option_groups enable row level security;
alter table public.option_items enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.sale_item_options enable row level security;
create policy option_groups_read on public.option_groups for select to authenticated using ((select app.is_member_any()));
create policy option_items_read on public.option_items for select to authenticated using ((select app.is_member_any()));
create policy pog_read on public.product_option_groups for select to authenticated using ((select app.is_member_any()));
create policy sio_read on public.sale_item_options for select to authenticated
  using (exists (select 1 from public.sale_items i where i.id = sale_item_options.sale_item_id));
revoke all on public.option_groups, public.option_items, public.product_option_groups, public.sale_item_options from public, anon, authenticated;
grant select on public.option_groups, public.option_items, public.product_option_groups, public.sale_item_options to authenticated;
grant select (option_label, option_key) on public.sale_items to authenticated;

-- ---------- RPC: pustaka opsi ----------
-- p: {id?, nama, urutan?, aktif?, items: [{id?, nama, selisih_harga?, urutan?, aktif?}]}. Item yang tidak disebut tidak disentuh (hapus = aktif:false).
create function app.option_group_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_gid uuid := nullif(p ->> 'id', '')::uuid; v_name text := trim(coalesce(p ->> 'nama', ''));
  v_it jsonb; v_iid uuid; v_iname text; v_delta numeric; v_new boolean := false; v_act boolean;
  v_items jsonb; v_g jsonb;
begin
  perform app.require_role(null, array['owner','admin']);
  v_act := case lower(coalesce(p ->> 'aktif', '')) when 'true' then true when 'false' then false end;
  if p ? 'items' and jsonb_typeof(p -> 'items') not in ('array', 'null') then
    raise exception 'Daftar item opsi tidak valid.' using errcode = '22023';
  end if;
  begin
    if v_gid is null then
      if length(v_name) not between 1 and 40 then raise exception 'Nama grup wajib diisi (maksimal 40 huruf).' using errcode = '22023'; end if;
      insert into public.option_groups (name, sort, active) values (v_name, coalesce(app.num(p, 'urutan'), 0)::int, coalesce(v_act, true)) returning id into v_gid;
      v_new := true;
    else
      perform 1 from public.option_groups where id = v_gid for update;
      if not found then raise exception 'Grup opsi tidak ditemukan.' using errcode = 'P0002'; end if;
      if v_name <> '' and length(v_name) > 40 then raise exception 'Nama grup maksimal 40 huruf.' using errcode = '22023'; end if;
      update public.option_groups set name = coalesce(nullif(v_name, ''), name), sort = coalesce(app.num(p, 'urutan')::int, sort),
             active = coalesce(v_act, active), updated_at = now() where id = v_gid;
    end if;
    if jsonb_typeof(p -> 'items') = 'array' then
      for v_it in select e from jsonb_array_elements(p -> 'items') e loop
        v_iid := nullif(v_it ->> 'id', '')::uuid; v_iname := trim(coalesce(v_it ->> 'nama', '')); v_delta := app.num(v_it, 'selisih_harga');
        if v_delta is not null and v_delta < 0 then raise exception 'Selisih harga tidak boleh negatif.' using errcode = '22023'; end if;
        if v_iid is null then
          if length(v_iname) not between 1 and 40 then raise exception 'Nama item opsi wajib diisi (maksimal 40 huruf).' using errcode = '22023'; end if;
          insert into public.option_items (group_id, name, price_delta, sort, active)
          values (v_gid, v_iname, coalesce(v_delta, 0), coalesce(app.num(v_it, 'urutan'), 0)::int,
                  coalesce(case lower(coalesce(v_it ->> 'aktif', '')) when 'true' then true when 'false' then false end, true));
        else
          if v_iname <> '' and length(v_iname) > 40 then raise exception 'Nama item opsi maksimal 40 huruf.' using errcode = '22023'; end if;
          update public.option_items set name = coalesce(nullif(v_iname, ''), name), price_delta = coalesce(v_delta, price_delta),
                 sort = coalesce(app.num(v_it, 'urutan')::int, sort),
                 active = coalesce(case lower(coalesce(v_it ->> 'aktif', '')) when 'true' then true when 'false' then false end, active),
                 updated_at = now()
           where id = v_iid and group_id = v_gid;
          if not found then raise exception 'Item opsi tidak ditemukan di grup ini.' using errcode = 'P0002'; end if;
        end if;
      end loop;
    end if;
  exception when unique_violation then
    raise exception 'Nama opsi sudah dipakai di daftar yang aktif.' using errcode = 'P0001', hint = 'OPTION_NAME_DUP';
  end;
  select to_jsonb(g) into v_g from public.option_groups g where g.id = v_gid;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.sort, i.name), '[]'::jsonb) into v_items from public.option_items i where i.group_id = v_gid;
  perform app.audit(null, 'option_group_save', 'option_groups', v_gid::text, null, jsonb_build_object('grup', v_g, 'items', v_items, 'baru', v_new));
  return jsonb_build_object('id', v_gid, 'baru', v_new, 'grup', v_g, 'items', v_items);
end $$;

-- p: {product_id, pakai_opsi, tautan?: [{group_id, wajib?, default_item_id?, urutan?, aktif?}]}.
-- tautan menggantikan SELURUH tautan produk (yang tidak disebut menjadi nonaktif, bukan dihapus). Tanpa tautan: hanya saklar.
create function app.product_options_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pid uuid := nullif(p ->> 'product_id', '')::uuid; v_pr public.products; v_use boolean; v_l jsonb; v_gid uuid; v_def uuid; v_gids uuid[] := '{}'; v_n int; v_before jsonb; v_after jsonb;
begin
  perform app.require_role(null, array['owner','admin']);
  select * into v_pr from public.products where id = v_pid for update;
  if not found then raise exception 'Produk tidak ditemukan.' using errcode = 'P0002'; end if;
  v_use := case lower(coalesce(p ->> 'pakai_opsi', '')) when 'true' then true when 'false' then false else v_pr.use_options end;
  if p ? 'tautan' and jsonb_typeof(p -> 'tautan') not in ('array', 'null') then raise exception 'Daftar tautan tidak valid.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort), '[]'::jsonb) into v_before from public.product_option_groups l where l.product_id = v_pid and l.active;

  if jsonb_typeof(p -> 'tautan') = 'array' then
    for v_l in select e from jsonb_array_elements(p -> 'tautan') e loop
      v_gid := nullif(v_l ->> 'group_id', '')::uuid; v_def := nullif(v_l ->> 'default_item_id', '')::uuid;
      if v_gid is null then raise exception 'Grup opsi wajib dipilih.' using errcode = '22023'; end if;
      if v_gid = any (v_gids) then raise exception 'Grup opsi yang sama dipilih dua kali.' using errcode = '22023'; end if;
      if not exists (select 1 from public.option_groups g where g.id = v_gid and g.active) then
        raise exception 'Grup opsi tidak ditemukan atau nonaktif.' using errcode = 'P0001';
      end if;
      if v_def is not null and not exists (select 1 from public.option_items i where i.id = v_def and i.group_id = v_gid and i.active) then
        raise exception 'Pilihan bawaan harus item aktif dari grup yang sama.' using errcode = 'P0001', hint = 'OPTION_DEFAULT';
      end if;
      v_gids := v_gids || v_gid;
      insert into public.product_option_groups (product_id, group_id, required, default_item_id, sort, active)
      values (v_pid, v_gid, coalesce(case lower(coalesce(v_l ->> 'wajib', '')) when 'true' then true when 'false' then false end, true), v_def,
              coalesce(app.num(v_l, 'urutan'), 0)::int,
              coalesce(case lower(coalesce(v_l ->> 'aktif', '')) when 'true' then true when 'false' then false end, true))
      on conflict (product_id, group_id) do update
        set required = excluded.required, default_item_id = excluded.default_item_id, sort = excluded.sort, active = excluded.active, updated_at = now();
    end loop;
    update public.product_option_groups set active = false, updated_at = now()
     where product_id = v_pid and active and group_id <> all (v_gids);
  end if;

  select count(*) into v_n from public.product_option_groups l join public.option_groups g on g.id = l.group_id and g.active
   where l.product_id = v_pid and l.active;
  if v_use and v_n = 0 then raise exception 'Pilih minimal satu grup opsi sebelum mengaktifkan opsi.' using errcode = 'P0001', hint = 'OPTION_NONE'; end if;
  update public.products set use_options = v_use, updated_at = now() where id = v_pid;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort), '[]'::jsonb) into v_after from public.product_option_groups l where l.product_id = v_pid and l.active;
  perform app.audit(null, 'product_options_set', 'products', v_pid::text,
                    jsonb_build_object('pakai_opsi', v_pr.use_options, 'tautan', v_before), jsonb_build_object('pakai_opsi', v_use, 'tautan', v_after));
  return jsonb_build_object('product_id', v_pid, 'pakai_opsi', v_use, 'tautan', v_after);
end $$;

-- p: {outlet_id, product_id, dari?, sampai?} (tanggal lokal outlet). Jumlah bersih (penjualan dikurangi retur) per item opsi.
-- qty_varian = jumlah bersih seluruh varian produk pada periode; untuk grup WAJIB, jumlah per item dalam satu grup = qty_varian.
create function app.report_option_sales(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_o public.outlets; v_pid uuid := nullif(p ->> 'product_id', '')::uuid; v_from date; v_to date; v_f timestamptz; v_t timestamptz; v_rows jsonb; v_tot numeric; v_pr public.products;
begin
  select * into v_o from public.outlets where id = nullif(p ->> 'outlet_id', '')::uuid;
  if not found then raise exception 'Outlet tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v_o.id, array['owner','admin','supervisor','auditor']);
  select * into v_pr from public.products where id = v_pid;
  if not found then raise exception 'Produk tidak ditemukan.' using errcode = 'P0002'; end if;
  v_from := coalesce(nullif(p ->> 'dari', '')::date, (now() at time zone v_o.timezone)::date);
  v_to := coalesce(nullif(p ->> 'sampai', '')::date, v_from);
  if v_to < v_from then raise exception 'Tanggal akhir lebih awal dari tanggal awal.' using errcode = '22023'; end if;
  v_f := v_from::timestamp at time zone v_o.timezone; v_t := (v_to + 1)::timestamp at time zone v_o.timezone;

  select coalesce(sum(i.qty), 0) into v_tot
    from public.sale_items i join public.sales s on s.id = i.sale_id join public.product_variants v on v.id = i.variant_id
   where v.product_id = v_pid and s.outlet_id = v_o.id and s.status = 'completed' and s.sold_at >= v_f and s.sold_at < v_t;

  select coalesce(jsonb_agg(jsonb_build_object('group_id', x.group_id, 'grup', x.group_name, 'item_id', x.item_id, 'item', x.item_name,
                                               'qty', x.qty, 'omzet', x.omzet) order by x.group_name, x.item_name), '[]'::jsonb)
    into v_rows from (
      select o.group_id, o.group_name, o.item_id, o.item_name, sum(i.qty) as qty, sum(i.line_total) as omzet
        from public.sale_item_options o
        join public.sale_items i on i.id = o.sale_item_id
        join public.sales s on s.id = i.sale_id
        join public.product_variants v on v.id = i.variant_id
       where v.product_id = v_pid and s.outlet_id = v_o.id and s.status = 'completed' and s.sold_at >= v_f and s.sold_at < v_t
       group by o.group_id, o.group_name, o.item_id, o.item_name) x;
  return jsonb_build_object('produk', v_pr.name, 'product_id', v_pid, 'dari', v_from, 'sampai', v_to, 'qty_varian', v_tot, 'baris', v_rows);
end $$;

-- ---------- Seed (dapat diubah owner di Pustaka opsi) ----------
do $$ declare g uuid; begin
  if not exists (select 1 from public.option_groups where lower(name) = 'level') then
    insert into public.option_groups (name, sort) values ('Level', 1) returning id into g;
    insert into public.option_items (group_id, name, sort) values (g, 'Level 1', 1), (g, 'Level 2', 2), (g, 'Level 3', 3);
  end if;
  if not exists (select 1 from public.option_groups where lower(name) = 'cara masak') then
    insert into public.option_groups (name, sort) values ('Cara masak', 2) returning id into g;
    insert into public.option_items (group_id, name, sort) values (g, 'Rebus', 1), (g, 'Goreng', 2), (g, 'Mix', 3);
  end if;
end $$;

-- ---------- Fungsi lama yang diubah ----------
-- sale_create: terima items[].opsi, validasi set-based, harga server = harga channel + selisih opsi, simpan snapshot.
create or replace function app.sale_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_appr app.approvals; v_approver uuid;
  v_outlet public.outlets;
  v_req text := p ->> 'request_id';
  v_dup jsonb;
  v_cashier uuid := v_uid;
  v_channel public.channels;
  v_method text := lower(coalesce(nullif(p ->> 'metode_bayar', ''), 'tunai'));
  v_l record;
  v_price numeric; v_cost numeric; v_new numeric;
  v_subtotal numeric := 0; v_discount numeric; v_base numeric;
  v_rate numeric; v_tax numeric := 0; v_total numeric; v_fee numeric; v_maxpct numeric;
  v_ctotal numeric := app.num(p, 'total_klien'); v_recv numeric; v_change numeric := 0;
  v_session uuid; v_sale uuid := gen_random_uuid(); v_no text; v_seq int;
  v_sold timestamptz := now(); v_cts timestamptz; v_local timestamp;
  v_stock jsonb := '{}'::jsonb; v_res jsonb; v_noneg boolean; v_n int := 0; v_note text := nullif(trim(p ->> 'catatan'), '');
  v_accept boolean := false; v_review boolean := false; v_rnote text := '';
  v_off boolean := lower(coalesce(p ->> 'offline', '')) in ('true', '1', 'ya');
  v_ref text := nullif(left(trim(coalesce(p ->> 'referensi_bayar', '')), 60), ''); v_min numeric; v_ses public.cash_sessions;
begin
  if v_uid is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  if (p ->> 'outlet_id') is null or (p ->> 'outlet_id') !~* '^[0-9a-f-]{36}$' then
    raise exception 'Outlet wajib dipilih.' using errcode = '22023';
  end if;
  v_outlet := app.active_outlet((p ->> 'outlet_id')::uuid, 'store');
  perform app.require_role(v_outlet.id, array['owner','admin','supervisor','kasir']);

  v_dup := app.idem_begin('sale', v_req, p - 'client_ts');   -- retry dengan payload sama => hasil lama
  if v_dup is not null then return v_dup; end if;

  -- Owner/admin/supervisor boleh mengirim antrean milik kasir lain (mis. persetujuan diskon di atas batas).
  if (p ->> 'kasir_id') is not null and (p ->> 'kasir_id')::uuid <> v_uid then
    perform app.require_role(v_outlet.id, array['owner','admin','supervisor']);
    if not exists (select 1 from public.memberships m join public.profiles pr on pr.id = m.user_id
                   where m.user_id = (p ->> 'kasir_id')::uuid and m.status = 'active' and pr.status = 'active'
                     and (m.outlet_id is null or m.outlet_id = v_outlet.id)) then
      raise exception 'Kasir asal transaksi tidak ditemukan atau tidak ditugaskan di outlet ini.' using errcode = 'P0001';
    end if;
    v_cashier := (p ->> 'kasir_id')::uuid;
  end if;

  if v_method not in ('tunai','transfer','qris') or not app.setting_bool(v_outlet.id, 'bayar_' || v_method, true) then
    raise exception 'Metode bayar "%" tidak diizinkan.', v_method using errcode = 'P0001';
  end if;

  select * into v_channel from public.channels where id = nullif(p ->> 'channel_id', '')::uuid and active;
  if not found then raise exception 'Channel tidak valid.' using errcode = 'P0001'; end if;

  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Keranjang kosong.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') e
             where coalesce(e ->> 'variant_id', '') !~* '^[0-9a-f-]{36}$'
                or coalesce(e ->> 'qty', '') !~ '^[0-9]+(\.[0-9]{1,4})?$'
                or (e ->> 'qty')::numeric <= 0) then
    raise exception 'Item keranjang tidak valid (varian atau jumlah).' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') e
             where e ? 'opsi' and jsonb_typeof(e -> 'opsi') not in ('array', 'null')) then
    raise exception 'Opsi item tidak valid.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') e, jsonb_array_elements_text(case when jsonb_typeof(e -> 'opsi') = 'array' then e -> 'opsi' else '[]'::jsonb end) x
             where x !~* '^[0-9a-f-]{36}$') then
    raise exception 'Opsi item tidak valid (id).' using errcode = '22023';
  end if;

  v_noneg := app.setting_bool(v_outlet.id, 'block_negative_stock', true);

  -- Waktu transaksi dari perangkat dipakai hanya bila masuk akal (antrean offline), selain itu waktu server.
  begin
    if jsonb_typeof(p -> 'client_ts') = 'number' then v_cts := to_timestamp((p ->> 'client_ts')::numeric / 1000.0);
    elsif (p ->> 'client_ts') is not null then v_cts := (p ->> 'client_ts')::timestamptz; end if;
  exception when others then v_cts := null; end;
  -- F-15: waktu perangkat dipercaya HANYA bila klien menandai transaksi tertunda (offline=true); selain itu waktu server.
  if v_cts is not null and v_off and v_cts <= now() + interval '5 minutes' and v_cts >= now() - interval '72 hours' then
    v_sold := least(v_cts, now());
  elsif v_cts is not null and v_off then
    v_note := trim(coalesce(v_note, '') || ' [waktu perangkat tidak valid, dipakai waktu server]');
  end if;
  -- P0-3 (F-04): transaksi yang tertunda (waktu perangkat valid tetapi lebih dari 3 menit lalu, mis. dibuat saat offline) atau yang kasirnya sengaja memilih
  -- "terima harga server" TIDAK ditolak bila total/stok berbeda: uang dan barang sudah berpindah. Dicatat dengan harga SERVER (klien tidak pernah dipercaya
  -- untuk harga), diberi tanda review_flag, dan total klien tersimpan di client_total untuk ditinjau Owner.
  v_accept := lower(coalesce(p ->> 'terima_selisih', '')) in ('true', '1', 'ya')
              or (v_off and v_cts is not null and v_cts <= now() + interval '5 minutes' and v_cts >= now() - interval '72 hours' and v_cts < now() - interval '3 minutes');

  -- 0a) Opsi produk (0032): uraikan opsi per baris keranjang, validasi set-based, hitung selisih harga di SERVER.
  create temp table if not exists _sq (ln int, variant_id uuid, qty numeric, item_id uuid) on commit drop;
  create temp table if not exists _sr (ln int, variant_id uuid, qty numeric, product_id uuid, use_opt boolean, item_id uuid, group_id uuid,
                                       gname text, iname text, delta numeric, gsort int, i_active boolean, g_active boolean, linked boolean, l_active boolean) on commit drop;
  create temp table if not exists _sln (ln int, variant_id uuid, qty numeric, okey text, delta numeric, label text) on commit drop;
  create temp table if not exists _sri (variant_id uuid, okey text, group_id uuid, item_id uuid, gname text, iname text, delta numeric) on commit drop;
  truncate _sq, _sr, _sln, _sri;
  insert into _sq (ln, variant_id, qty, item_id)
  select e.ord::int, (e.v ->> 'variant_id')::uuid, (e.v ->> 'qty')::numeric, o.item_id
  from jsonb_array_elements(p -> 'items') with ordinality e(v, ord)
  left join lateral (select distinct lower(x)::uuid as item_id
                     from jsonb_array_elements_text(case when jsonb_typeof(e.v -> 'opsi') = 'array' then e.v -> 'opsi' else '[]'::jsonb end) x) o on true;
  insert into _sr
  select q.ln, q.variant_id, q.qty, v.product_id, coalesce(pr.use_options, false), q.item_id, i.group_id, g.name, i.name, i.price_delta, g.sort,
         i.active, g.active, l.group_id is not null, coalesce(l.active, false)
  from _sq q
  left join public.product_variants v on v.id = q.variant_id
  left join public.products pr on pr.id = v.product_id
  left join public.option_items i on i.id = q.item_id
  left join public.option_groups g on g.id = i.group_id
  left join public.product_option_groups l on l.product_id = v.product_id and l.group_id = i.group_id;

  if exists (select 1 from _sr where item_id is not null and group_id is null) then
    raise exception 'Opsi tidak dikenal. Muat ulang data lalu pilih ulang.' using errcode = 'P0001', hint = 'OPTION_UNKNOWN';
  end if;
  if exists (select 1 from _sr where item_id is not null and not linked) then
    raise exception 'Opsi "%" bukan milik produk ini.', (select iname from _sr where item_id is not null and not linked limit 1)
      using errcode = 'P0001', hint = 'OPTION_FOREIGN';
  end if;
  if exists (select 1 from _sr where item_id is not null group by ln, group_id having count(*) > 1) then
    raise exception 'Hanya boleh satu pilihan per grup opsi.' using errcode = 'P0001', hint = 'OPTION_DUP_GROUP';
  end if;
  if exists (select 1 from _sr where item_id is not null and (not i_active or not g_active or not l_active or not use_opt)) and not v_off then
    raise exception 'Opsi "%" sudah tidak aktif. Pilih ulang.', (select iname from _sr where item_id is not null and (not i_active or not g_active or not l_active or not use_opt) limit 1)
      using errcode = 'P0001', hint = 'OPTION_INACTIVE';
  end if;
  if exists (select 1 from _sr where item_id is not null and (not i_active or not g_active or not l_active or not use_opt)) then
    v_review := true; v_rnote := trim(v_rnote || ' Transaksi tertunda memakai opsi yang kini nonaktif.');
  end if;
  -- grup wajib yang belum dipilih
  if exists (select 1 from (select distinct ln, product_id from _sr where use_opt) b
             join public.product_option_groups l on l.product_id = b.product_id and l.required and l.active
             join public.option_groups g on g.id = l.group_id and g.active
             where not exists (select 1 from _sr s where s.ln = b.ln and s.group_id = l.group_id and s.item_id is not null)) then
    if v_off or v_accept then
      v_review := true; v_rnote := trim(v_rnote || ' Ada pilihan opsi wajib yang belum diisi pada transaksi tertunda.');
    else
      raise exception 'Pilih semua opsi wajib (%).',
        (select string_agg(distinct g.name, ', ') from (select distinct ln, product_id from _sr where use_opt) b
           join public.product_option_groups l on l.product_id = b.product_id and l.required and l.active
           join public.option_groups g on g.id = l.group_id and g.active
          where not exists (select 1 from _sr s where s.ln = b.ln and s.group_id = l.group_id and s.item_id is not null))
        using errcode = 'P0001', hint = 'OPTION_REQUIRED';
    end if;
  end if;

  insert into _sln (ln, variant_id, qty, okey, delta, label)
  select ln, variant_id, max(qty),
         coalesce(string_agg(item_id::text, ',' order by item_id::text) filter (where item_id is not null), ''),
         coalesce(sum(delta) filter (where item_id is not null), 0),
         string_agg(iname, ' · ' order by gsort, gname) filter (where item_id is not null)
  from _sr group by ln, variant_id;
  insert into _sri (variant_id, okey, group_id, item_id, gname, iname, delta)
  select distinct n.variant_id, n.okey, s.group_id, s.item_id, s.gname, s.iname, s.delta
  from _sr s join _sln n on n.ln = s.ln where s.item_id is not null;

  -- 1) Baris dikunci berurutan per varian (hindari deadlock antar kasir) dan total dihitung SERVER.
  --    Baris dengan varian sama tetapi opsi berbeda tetap terpisah (harga bisa berbeda); stok tetap per varian.
  create temp table if not exists _slo (variant_id uuid, okey text, qty numeric, price numeric, sku text, nm text, label text) on commit drop;
  truncate _slo;
  for v_l in
    select i.variant_id, i.okey, i.qty, i.delta, i.label, v.sku, v.active as vactive, pr.active as pactive,
           trim(coalesce(pr.name, '') || ' ' || coalesce(v.size, '') ||
                case when v.spice_level is null or v.spice_level = '' then '' else ' ' || v.spice_level end) as nm
    from (select n.variant_id, n.okey, sum(n.qty) as qty, max(n.delta) as delta, max(n.label) as label
          from _sln n group by n.variant_id, n.okey) i
    left join public.product_variants v on v.id = i.variant_id
    left join public.products pr on pr.id = v.product_id
    order by i.variant_id, i.okey
  loop
    if v_l.sku is null then raise exception 'Varian tidak ditemukan.' using errcode = 'P0001'; end if;
    if not v_l.vactive or not v_l.pactive then raise exception 'Varian nonaktif: %', v_l.sku using errcode = 'P0001'; end if;
    v_price := app.price_of(v_outlet.id, v_l.variant_id, v_channel.id);
    if v_price is null then raise exception 'Harga belum diatur: % di %', v_l.sku, v_channel.name using errcode = 'P0001'; end if;
    v_price := v_price + v_l.delta;   -- selisih opsi dihitung server; klien tidak pernah dipercaya untuk harga
    insert into _slo values (v_l.variant_id, v_l.okey, v_l.qty, v_price, v_l.sku, v_l.nm, v_l.label);
    v_subtotal := v_subtotal + round(v_l.qty * v_price, 2);
  end loop;

  v_discount := least(greatest(coalesce(app.num(p, 'diskon', 0), 0), 0), v_subtotal);
  v_base := v_subtotal - v_discount;
  v_maxpct := coalesce(nullif(app.setting(v_outlet.id, 'diskon_maks_persen', '10'), '')::numeric, 100);
  if v_discount > v_subtotal * v_maxpct / 100 + 0.5 and not app.has_role(v_outlet.id, array['owner','admin','supervisor']) then
    -- P1-5: persetujuan yang diterbitkan supervisor/owner (rpc_approval_issue) untuk request_id ini, sekali pakai, masih berlaku, dan penerbitnya
    -- masih berwenang di outlet ini. Tidak ada JWT approver yang perlu disimpan di antrean perangkat.
    if nullif(p ->> 'approval_id', '') is not null and (p ->> 'approval_id') ~* '^[0-9a-f-]{36}$' then
      select * into v_appr from app.approvals
       where id = (p ->> 'approval_id')::uuid and kind = 'diskon' and request_id = v_req and outlet_id = v_outlet.id
         and used_at is null and expires_at > now() and amount + 0.5 >= v_discount for update;
      if found and exists (select 1 from public.memberships m join public.profiles pr on pr.id = m.user_id
                           where m.user_id = v_appr.approver_id and m.status = 'active' and pr.status = 'active'
                             and m.role in ('owner','admin','supervisor') and (m.outlet_id is null or m.outlet_id = v_outlet.id)) then
        v_approver := v_appr.approver_id;
        update app.approvals set used_at = now() where id = v_appr.id;
      end if;
    end if;
    if v_approver is null then
      raise exception 'Diskon Rp% melebihi batas % persen dari subtotal. Perlu supervisor/owner.', v_discount, v_maxpct using errcode = 'P0001';
    end if;
  end if;

  v_rate := coalesce(nullif(app.setting(v_outlet.id, 'ppn_persen', '0'), '')::numeric, 0);
  v_total := v_base;
  if app.setting_bool(v_outlet.id, 'ppn_aktif', false) and v_rate > 0 then
    if app.setting_bool(v_outlet.id, 'ppn_inklusif', false) then v_tax := round(v_base * v_rate / (100 + v_rate));
    else v_tax := round(v_base * v_rate / 100); v_total := v_base + v_tax; end if;
  else v_rate := 0; end if;

  if v_ctotal is not null and abs(v_ctotal - v_total) > 0.5 and app.setting_bool(v_outlet.id, 'tolak_selisih_total', true) then
    if not v_accept then
      raise exception 'Total struk Rp% berbeda dari server Rp% (harga atau pengaturan berubah). Muat ulang data lalu ulangi.', v_ctotal, v_total
        using errcode = 'P0001', hint = 'TOTAL_MISMATCH';
    end if;
    v_review := true;
    v_rnote := trim(v_rnote || ' Total di struk Rp' || v_ctotal || ' berbeda dari harga server Rp' || v_total || ' (harga/pengaturan berubah saat transaksi tertunda); dicatat dengan harga server.');
  end if;

  v_fee := round(case v_channel.fee_basis when 'subtotal' then v_subtotal when 'omzet' then v_total - v_tax else v_total end
                 * v_channel.fee_percent / 100) + v_channel.fee_fixed;

  if v_method = 'tunai' then
    v_recv := coalesce(app.num(p, 'amount_received'), v_total);
    if v_recv < v_total then raise exception 'Uang diterima (Rp%) kurang dari total (Rp%).', v_recv, v_total using errcode = 'P0001'; end if;
    v_change := v_recv - v_total;
  else v_recv := v_total; end if;

  -- F-10: referensi pembayaran non-tunai (wajib di atas ambang bayar_referensi_min; transaksi tertunda tetap diterima tetapi ditandai).
  v_min := app.setting_num(v_outlet.id, 'bayar_referensi_min');
  if v_method <> 'tunai' and v_ref is null and v_min is not null and v_total >= v_min then
    if v_accept then
      v_review := true; v_rnote := trim(v_rnote || ' Nomor referensi ' || upper(v_method) || ' belum diisi.');
    else
      raise exception 'Isi nomor referensi % (transaksi Rp% ke atas wajib punya referensi).', upper(v_method), v_min using errcode = 'P0001', hint = 'REFERENCE_REQUIRED';
    end if;
  end if;
  if v_ref is not null and v_method <> 'tunai' and exists (select 1 from public.payments pm where pm.outlet_id = v_outlet.id and pm.method = v_method and pm.reference = v_ref) then
    v_review := true; v_rnote := trim(v_rnote || ' Nomor referensi ' || v_ref || ' sudah pernah dipakai pada transaksi lain.');
  end if;

  v_session := app.ensure_session(v_outlet.id, v_cashier);
  -- F-15: waktu transaksi tidak boleh lebih awal dari buka kasir (kecuali sesi otomatis) dan tidak boleh jatuh di periode terkunci.
  select * into v_ses from public.cash_sessions where id = v_session;
  if not v_ses.auto_opened and v_sold < v_ses.opened_at then
    v_sold := v_ses.opened_at; v_review := true;
    v_rnote := trim(v_rnote || ' Waktu perangkat lebih awal dari buka kasir; dipakai waktu buka kasir.');
  end if;
  if (v_sold at time zone v_outlet.timezone)::date <= coalesce(app.period_lock(), date '0001-01-01') then
    v_sold := now(); v_review := true;
    v_rnote := trim(v_rnote || ' Tanggal transaksi jatuh pada periode terkunci; dicatat dengan waktu server.');
  end if;

  -- 2) Stok berkurang + ledger (menolak stok minus bila dilarang).
  for v_l in select s.variant_id, s.sku, sum(s.qty) as qty from _slo s group by s.variant_id, s.sku order by s.variant_id loop
    v_new := app.stock_apply(v_outlet.id, 'variant', v_l.variant_id, -v_l.qty, 'sale', 'sale', v_sale,
                             null, (not v_noneg) or v_accept, null);
    if v_new < 0 and v_noneg then
      v_review := true;
      v_rnote := trim(v_rnote || ' Stok server kurang untuk ' || v_l.sku || '; stok menjadi minus (perlu opname).');
    end if;
    v_stock := v_stock || jsonb_build_object(v_l.variant_id::text, v_new);
  end loop;

  -- 3) Nomor struk: kode outlet + tanggal lokal outlet + urutan.
  v_local := v_sold at time zone v_outlet.timezone;
  v_seq := app.next_seq(v_outlet.id, 'sale', v_local::date);
  v_no := v_outlet.code || '-' || to_char(v_local, 'YYMMDD') || '-' || app.seq_text(v_seq);

  insert into public.sales (id, outlet_id, receipt_no, request_id, kind, channel_id, cashier_id, cash_session_id, status,
                            subtotal, discount, fee_channel, tax_rate, tax_amount, total, payment_method,
                            client_total, client_ts, sold_at, note, approved_by, review_flag, review_note)
  values (v_sale, v_outlet.id, v_no, v_req, 'sale', v_channel.id, v_cashier, v_session, 'completed',
          v_subtotal, v_discount, v_fee, v_rate, v_tax, v_total, v_method, v_ctotal, v_cts, v_sold, v_note,
          coalesce(v_approver, case when v_cashier <> v_uid then v_uid end), v_review, nullif(v_rnote, ''));

  with ins as (
    insert into public.sale_items (sale_id, outlet_id, variant_id, sku_snapshot, name_snapshot, qty, unit_price, hpp_snapshot, option_label, option_key)
    select v_sale, v_outlet.id, s.variant_id, s.sku, s.nm, s.qty, s.price, nullif(b.avg_cost, 0), s.label, s.okey
    from _slo s join public.inventory_balances b on b.outlet_id = v_outlet.id and b.variant_id = s.variant_id
    returning id, variant_id, option_key)
  insert into public.sale_item_options (sale_item_id, group_id, item_id, group_name, item_name, price_delta)
  select ins.id, r.group_id, r.item_id, r.gname, r.iname, r.delta
  from ins join _sri r on r.variant_id = ins.variant_id and r.okey = ins.option_key;

  insert into public.payments (sale_id, outlet_id, cash_session_id, method, amount, received, change_given, reference)
  values (v_sale, v_outlet.id, v_session, v_method, v_total, v_recv, v_change, case when v_method <> 'tunai' then v_ref end);

  perform app.audit(v_outlet.id, 'sale', 'sales', v_sale::text, null,
                    jsonb_build_object('nomor', v_no, 'total', v_total, 'metode', v_method, 'kasir', v_cashier, 'review', v_review));

  v_res := jsonb_build_object(
    'sale', jsonb_build_object('id', v_sale, 'nomor', v_no, 'outlet_id', v_outlet.id,
                               'tanggal', to_char(v_local, 'YYYY-MM-DD HH24:MI:SS'),
                               'subtotal', v_subtotal, 'diskon', v_discount, 'ppn_nominal', v_tax, 'total', v_total),
    'stok', v_stock, 'diterima', v_recv, 'kembalian', v_change, 'sesi', v_session, 'review', v_review,
    'price_changed', v_ctotal is not null and abs(v_ctotal - v_total) > 0.5);
  if v_review then v_res := v_res || jsonb_build_object('peringatan', 'Transaksi tercatat dengan tanda "perlu ditinjau":' || ' ' || v_rnote); end if;
  return app.idem_finish('sale', v_req, v_res);
end $$;

-- sale_return: kunci baris retur = varian + opsi; salinan opsi dan label dari baris asal.
create or replace function app.sale_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_req text := p ->> 'request_id'; v_dup jsonb;
  v_o public.sales; v_outlet public.outlets;
  v_alasan text := trim(coalesce(p ->> 'alasan', ''));
  v_l record; v_sale uuid := gen_random_uuid(); v_no text; v_seq int; v_local timestamp;
  v_all boolean := coalesce((p ->> 'semua')::boolean, false);
  v_def boolean := case lower(coalesce(p ->> 'restock', '')) when 'true' then true when 'false' then false else null end;
  v_bruto numeric := 0; v_f numeric; v_subR numeric; v_disR numeric; v_taxR numeric; v_feeR numeric; v_totR numeric;
  v_excl boolean; v_final boolean := true; v_stock jsonb := '{}'::jsonb; v_new numeric;
  v_method text; v_session uuid; v_scash uuid; v_res jsonb; v_buang int := 0; v_loss numeric := 0; v_priv boolean;
  v_appr app.approvals; v_approver uuid; v_pref uuid := nullif(p ->> 'sesi_id', '')::uuid; v_nid uuid;
begin
  if v_uid is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  select * into v_o from public.sales where id = nullif(p ->> 'id', '')::uuid for update;   -- serialisasi retur pada transaksi yang sama
  if not found then raise exception 'Penjualan asal tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v_o.outlet_id, array['owner','admin','supervisor','kasir']);
  v_outlet := app.active_outlet(v_o.outlet_id, 'store');
  v_dup := app.idem_begin('sale_return', v_req, p);
  if v_dup is not null then return v_dup; end if;

  -- Wewenang: supervisor/owner/admin langsung; kasir hanya bila retur_kasir aktif atau membawa persetujuan sekali pakai.
  v_priv := app.has_role(v_o.outlet_id, array['owner','admin','supervisor']);
  if not v_priv and not app.setting_bool(v_o.outlet_id, 'retur_kasir', false) then
    if (p ->> 'approval_id') ~* '^[0-9a-f-]{36}$' then
      select * into v_appr from app.approvals
       where id = (p ->> 'approval_id')::uuid and kind = 'retur' and request_id = v_req and outlet_id = v_o.outlet_id
         and ref_id = v_o.id and used_at is null and expires_at > now() for update;
      if found and app.approver_ok(v_appr.approver_id, v_o.outlet_id) then v_approver := v_appr.approver_id; end if;
    end if;
    if v_approver is null then
      raise exception 'Retur memerlukan persetujuan supervisor/owner.' using errcode = '42501', hint = 'RETUR_APPROVAL';
    end if;
  end if;

  if length(v_alasan) < 3 then raise exception 'Alasan retur wajib diisi.' using errcode = '22023'; end if;
  if v_o.kind <> 'sale' or v_o.status <> 'completed' then raise exception 'Hanya transaksi penjualan selesai yang bisa diretur.' using errcode = 'P0001'; end if;

  create temp table if not exists _rl (variant_id uuid, okey text, olabel text, remaining numeric, price numeric, hpp numeric, sku text, nm text, want numeric, restock boolean) on commit drop;
  truncate _rl;
  insert into _rl (variant_id, okey, olabel, remaining, price, hpp, sku, nm)
  select i.variant_id, i.option_key, max(i.option_label), sum(i.qty), max(i.unit_price) filter (where i.qty > 0), max(i.hpp_snapshot) filter (where i.qty > 0),
         max(i.sku_snapshot), max(i.name_snapshot)
  from public.sale_items i join public.sales s on s.id = i.sale_id
  where s.id = v_o.id or (s.ref_sale_id = v_o.id and s.status = 'completed')
  group by i.variant_id, i.option_key;

  if v_all then
    update _rl set want = remaining, restock = v_def where remaining > 0;
  else
    if jsonb_typeof(p -> 'items') <> 'array' then raise exception 'Pilih minimal satu item yang diretur.' using errcode = '22023'; end if;
    update _rl r set want = x.q, restock = coalesce(x.rs, v_def) from (
      select (e ->> 'variant_id')::uuid as vid,
             coalesce((select string_agg(lower(y), ',' order by lower(y)) from jsonb_array_elements_text(case when jsonb_typeof(e -> 'opsi') = 'array' then e -> 'opsi' else '[]'::jsonb end) y), '') as ok,
             sum((e ->> 'qty')::numeric) as q,
             bool_and(case lower(coalesce(e ->> 'restock', '')) when 'true' then true when 'false' then false end) as rs   -- campuran => false (dibuang)
      from jsonb_array_elements(p -> 'items') e where (e ->> 'qty')::numeric > 0 group by 1, 2) x
    where r.variant_id = x.vid and r.okey = x.ok;
    if exists (select 1 from jsonb_array_elements(p -> 'items') e
               where not exists (select 1 from _rl r where r.variant_id = (e ->> 'variant_id')::uuid
                                  and r.okey = coalesce((select string_agg(lower(y), ',' order by lower(y)) from jsonb_array_elements_text(case when jsonb_typeof(e -> 'opsi') = 'array' then e -> 'opsi' else '[]'::jsonb end) y), ''))) then
      raise exception 'Item tidak ada di transaksi asal.' using errcode = 'P0001';
    end if;
  end if;
  if not exists (select 1 from _rl where want > 0) then raise exception 'Pilih minimal satu item yang diretur.' using errcode = '22023'; end if;
  if exists (select 1 from _rl where want > remaining + 0.0001) then
    raise exception 'Jumlah retur melebihi sisa yang bisa diretur.' using errcode = 'P0001';
  end if;
  if exists (select 1 from _rl where want > 0 and restock is null) then
    raise exception 'Pilih tindakan barang retur: kembali ke stok atau rusak/dibuang.' using errcode = '22023', hint = 'RESTOCK_REQUIRED';
  end if;

  select coalesce(sum(price * want), 0) into v_bruto from _rl where want > 0;
  if v_approver is not null then
    if v_appr.amount + 0.5 < v_bruto then
      raise exception 'Nilai retur Rp% melebihi yang disetujui (Rp%).', v_bruto, v_appr.amount using errcode = '42501', hint = 'RETUR_APPROVAL';
    end if;
    update app.approvals set used_at = now() where id = v_appr.id;
  end if;
  v_excl := v_o.tax_amount > 0 and abs(v_o.total - (v_o.subtotal - v_o.discount)) > 0.5;
  v_final := not exists (select 1 from _rl where abs(remaining - coalesce(want, 0)) > 0.0001);
  if v_final then -- sisa terakhir: ambil sisa nilai agar seluruh retur persis menghapus transaksi asal
    select v_o.subtotal - coalesce(sum(-subtotal), 0), v_o.discount - coalesce(sum(-discount), 0),
           v_o.tax_amount - coalesce(sum(-tax_amount), 0), v_o.total - coalesce(sum(-total), 0), v_o.fee_channel - coalesce(sum(-fee_channel), 0)
      into v_subR, v_disR, v_taxR, v_totR, v_feeR
      from public.sales where ref_sale_id = v_o.id and status = 'completed';
  else
    v_f := case when v_o.subtotal > 0 then v_bruto / v_o.subtotal else 0 end;
    v_subR := round(v_bruto); v_disR := round(v_o.discount * v_f); v_taxR := round(v_o.tax_amount * v_f);
    v_feeR := round(v_o.fee_channel * v_f); v_totR := (v_subR - v_disR) + case when v_excl then v_taxR else 0 end;
  end if;

  v_method := case when lower(coalesce(p ->> 'refund_method', '')) in ('tunai','transfer','qris','lain')
                   then lower(p ->> 'refund_method') else v_o.payment_method end;
  v_session := app.return_session(v_o.outlet_id, v_uid, v_o.cashier_id, v_priv, v_pref);
  select cs.cashier_id into v_scash from public.cash_sessions cs where cs.id = v_session;
  v_local := now() at time zone v_outlet.timezone;
  v_seq := app.next_seq(v_o.outlet_id, 'return', v_local::date);
  v_no := 'RT-' || v_outlet.code || '-' || to_char(v_local, 'YYMMDD') || '-' || app.seq_text(v_seq);

  insert into public.sales (id, outlet_id, receipt_no, request_id, kind, ref_sale_id, channel_id, cashier_id, cash_session_id,
                            status, subtotal, discount, fee_channel, tax_rate, tax_amount, total, payment_method, note, reason, approved_by)
  values (v_sale, v_o.outlet_id, v_no, v_req, 'return', v_o.id, v_o.channel_id, coalesce(v_scash, v_uid), v_session, 'completed',
          -v_subR, -v_disR, -v_feeR, v_o.tax_rate, -v_taxR, -v_totR, v_method,
          left('RETUR ' || v_o.receipt_no || ': ' || v_alasan, 300), v_alasan, coalesce(v_approver, v_uid));

  for v_l in select * from _rl where want > 0 order by variant_id, okey loop
    -- HPP asal tetap dibalik pada baris retur; bila barang tidak kembali ke stok, nilainya diakui sebagai kerugian persediaan (bukan hilang diam-diam).
    insert into public.sale_items (sale_id, outlet_id, variant_id, sku_snapshot, name_snapshot, qty, unit_price, hpp_snapshot, option_label, option_key)
    values (v_sale, v_o.outlet_id, v_l.variant_id, v_l.sku, v_l.nm, -v_l.want, v_l.price, v_l.hpp, v_l.olabel, v_l.okey)
    returning id into v_nid;
    insert into public.sale_item_options (sale_item_id, group_id, item_id, group_name, item_name, price_delta)
    select v_nid, o.group_id, o.item_id, o.group_name, o.item_name, o.price_delta
      from public.sale_item_options o
     where o.sale_item_id = (select i.id from public.sale_items i where i.sale_id = v_o.id and i.variant_id = v_l.variant_id and i.option_key = v_l.okey limit 1);
    if v_l.restock then
      v_new := app.stock_apply(v_o.outlet_id, 'variant', v_l.variant_id, v_l.want, 'return_in', 'sale', v_sale, v_l.hpp, true, null);
      v_stock := v_stock || jsonb_build_object(v_l.variant_id::text, v_new);
    else
      v_buang := v_buang + 1;
      perform app.loss_record(v_o.outlet_id, 'variant', v_l.variant_id, 'retur_rusak', v_l.want, v_l.hpp, 'sale', v_sale, v_alasan);
    end if;
  end loop;
  select coalesce(sum(l.value), 0) into v_loss from public.inventory_losses l where l.ref_type = 'sale' and l.ref_id = v_sale;

  insert into public.payments (sale_id, outlet_id, cash_session_id, method, amount)
  values (v_sale, v_o.outlet_id, v_session, v_method, -v_totR);

  perform app.audit(v_o.outlet_id, 'return', 'sales', v_sale::text, jsonb_build_object('nomor', v_o.receipt_no),
                    jsonb_build_object('nomor', v_no, 'total', -v_totR, 'alasan', v_alasan, 'item_dibuang', v_buang, 'kerugian', v_loss,
                                       'sesi', v_session, 'kasir', coalesce(v_scash, v_uid), 'disetujui_oleh', v_approver));

  v_res := jsonb_build_object('sale', jsonb_build_object('id', v_sale, 'nomor', v_no, 'subtotal', -v_subR, 'diskon', -v_disR,
                                'ppn_nominal', -v_taxR, 'total', -v_totR),
                              'refund', v_totR, 'metode', v_method, 'stok', v_stock, 'restock', v_buang = 0, 'buang', v_buang,
                              'kerugian', v_loss, 'sesi', v_session);
  return app.idem_finish('sale_return', v_req, v_res);
end $$;

-- sale_detail: baris dipisah per varian + opsi; menyertakan label dan id opsi (dipakai layar Retur).
create or replace function app.sale_detail(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.sales; v_lines jsonb;
begin
  select * into v from public.sales where id = nullif(p ->> 'id', '')::uuid;
  if not found then raise exception 'Penjualan tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v.outlet_id, array['owner','admin','supervisor','kasir','auditor']);
  if not app.has_role(v.outlet_id, array['owner','admin','supervisor','auditor']) and v.cashier_id <> (select auth.uid()) then
    raise exception 'Akses ditolak.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'jual', jual, 'kembali', kembali, 'sisa', jual - kembali, 'harga', harga, 'sku', sku, 'nama', nm,
                          'label', nullif(olabel, ''), 'opsi', case when okey = '' then '[]'::jsonb else to_jsonb(string_to_array(okey, ',')) end)), '[]'::jsonb)
    into v_lines from (
      select i.variant_id, sum(i.qty) filter (where i.qty > 0) as jual, coalesce(-sum(i.qty) filter (where i.qty < 0), 0) as kembali,
             max(i.unit_price) as harga, max(i.sku_snapshot) as sku, max(i.name_snapshot) as nm,
             i.option_key as okey, max(i.option_label) as olabel
      from public.sale_items i join public.sales s on s.id = i.sale_id
      where s.id = v.id or (s.ref_sale_id = v.id and s.status = 'completed') group by i.variant_id, i.option_key) l;
  return jsonb_build_object('sale', to_jsonb(v), 'items', case when v.kind = 'return' then '[]'::jsonb else v_lines end);
end $$;


-- bootstrap: pakai_opsi per produk + grup, item, dan tautan aktif dalam satu payload.
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
                      'stok_minimum', m.min_stock, 'aktif', true, 'satuan_kecil', m.small_unit, 'faktor_kecil', m.small_factor)
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


-- ping: versi katalog ikut berubah saat opsi berubah.
create or replace function app.ping(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_o uuid := nullif(p ->> 'outlet_id', '')::uuid; v_cat text; v_stk text;
begin
  if (select auth.uid()) is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  if v_o is not null then perform app.require_role(v_o, array['owner','admin','supervisor','kasir','stok','produksi','auditor']); end if;
  v_cat := md5(concat_ws('|',
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.products),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.product_variants),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.channels),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.channel_prices),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.settings),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.option_groups),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.option_items),
    (select count(*) || ':' || coalesce(max(updated_at)::text, '') from public.product_option_groups),
    (select count(*) || ':' || coalesce(max(effective_from)::text, '') from public.outlet_prices where outlet_id = v_o)));
  select count(*) || ':' || coalesce(max(updated_at)::text, '') into v_stk from public.inventory_balances where outlet_id = v_o;
  return jsonb_build_object('ver', v_cat || '~' || coalesce(v_stk, ''), 'cat_ver', v_cat, 'stock_ver', coalesce(v_stk, ''), 'time', now());
end $$;

-- data_reset: sale_item_options dihapus lebih dulu (trigger anti-hapus dimatikan hanya di dalam transaksi fungsi ini).
create or replace function app.data_reset(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_o     public.outlets;
  v_apply boolean := lower(coalesce(p ->> 'terapkan', 'false')) in ('true', 't', '1');
  v_mode  text := lower(coalesce(nullif(trim(p ->> 'stok'), ''), 'nol'));
  v_why   text := trim(coalesce(p ->> 'alasan', ''));
  v_req   text := nullif(trim(coalesce(p ->> 'request_id', '')), '');
  v_dup   jsonb; v_lock date; v_fly int; v_block text; v_n jsonb; v_res jsonb;
begin
  if v_uid is null then raise exception 'Sesi berakhir, silakan masuk lagi.' using errcode = '28000'; end if;
  if not app.is_owner() then
    raise exception 'Hanya Owner yang dapat mereset data transaksi.' using errcode = '42501';
  end if;
  if v_mode not in ('nol', 'pertahankan') then
    raise exception 'Pilihan stok tidak dikenal (nol atau pertahankan).' using errcode = '22023';
  end if;
  select * into v_o from public.outlets where id = nullif(p ->> 'outlet_id', '')::uuid;
  if not found then raise exception 'Outlet tidak ditemukan.' using errcode = 'P0002'; end if;

  select count(*) into v_fly from public.stock_transfers t
   where (t.from_outlet_id = v_o.id or t.to_outlet_id = v_o.id) and t.status in ('submitted', 'approved', 'sent');
  v_lock := app.period_lock();
  v_block := case
    when v_fly > 0 then format('Masih ada %s transfer stok yang belum selesai. Selesaikan atau batalkan dulu.', v_fly)
    when v_lock is not null then format('Periode sudah dikunci sampai %s. Buka kunci periode di Pengaturan dulu.', to_char(v_lock, 'DD-MM-YYYY'))
  end;

  v_n := jsonb_build_object(
    'penjualan',  (select count(*) from public.sales where outlet_id = v_o.id),
    'total_rp',   (select coalesce(sum(total), 0) from public.sales where outlet_id = v_o.id and status = 'completed'),
    'pembayaran', (select count(*) from public.payments where outlet_id = v_o.id),
    'impor',      (select count(*) from public.external_orders where outlet_id = v_o.id),
    'sesi_kas',   (select count(*) from public.cash_sessions where outlet_id = v_o.id),
    'mutasi_kas', (select count(*) from public.cash_movements where outlet_id = v_o.id),
    'biaya',      (select count(*) from public.expenses where outlet_id = v_o.id),
    'pembelian',  (select count(*) from public.purchases where outlet_id = v_o.id),
    'produksi',   (select count(*) from public.production_orders where kitchen_outlet_id = v_o.id or output_outlet_id = v_o.id),
    'transfer',   (select count(*) from public.stock_transfers where from_outlet_id = v_o.id or to_outlet_id = v_o.id),
    'kerugian',   (select count(*) from public.inventory_losses where outlet_id = v_o.id),
    'mutasi_stok',(select count(*) from public.stock_movements where outlet_id = v_o.id),
    'saldo_stok', (select count(*) from public.inventory_balances where outlet_id = v_o.id and quantity <> 0)
                + (select count(*) from public.inventory_material_balances where outlet_id = v_o.id and quantity <> 0));

  if not v_apply then
    return jsonb_build_object('terapkan', false, 'blokir', v_block, 'jumlah', v_n,
      'outlet', jsonb_build_object('id', v_o.id, 'kode', v_o.code, 'nama', v_o.name));
  end if;

  if v_block is not null then raise exception '%', v_block using errcode = 'P0001'; end if;
  if upper(trim(coalesce(p ->> 'konfirmasi', ''))) <> upper(v_o.code) then
    raise exception 'Kode konfirmasi tidak cocok. Ketik kode outlet % persis seperti tertulis.', v_o.code using errcode = '22023';
  end if;
  if length(v_why) < 3 then raise exception 'Alasan reset wajib diisi (minimal 3 huruf).' using errcode = '22023'; end if;
  v_dup := app.idem_begin('data_reset', v_req, p);
  if v_dup is not null then return v_dup; end if;

  -- Kunci saldo outlet ini: penjualan yang sedang berjalan menunggu sampai reset selesai, bukan menulis di tengah penghapusan.
  perform 1 from public.inventory_balances where outlet_id = v_o.id for update;
  perform 1 from public.inventory_material_balances where outlet_id = v_o.id for update;

  -- Anak dulu, induk kemudian.
  delete from public.external_orders where outlet_id = v_o.id;
  delete from public.import_batches where outlet_id = v_o.id;
  delete from public.payments where outlet_id = v_o.id;
  alter table public.sale_item_options disable trigger sale_item_options_immutable;
  delete from public.sale_item_options o using public.sale_items i where i.id = o.sale_item_id and i.outlet_id = v_o.id;
  alter table public.sale_item_options enable trigger sale_item_options_immutable;
  delete from public.sale_items where outlet_id = v_o.id;
  delete from public.sales where outlet_id = v_o.id;          -- baris retur dan penjualan asalnya dihapus dalam satu perintah
  delete from public.cash_movements where outlet_id = v_o.id; -- sebelum biaya (cash_movements.expense_id) dan sesi kas
  delete from public.expenses where outlet_id = v_o.id;       -- biaya pusat (outlet NULL) tidak disentuh
  delete from public.cash_sessions where outlet_id = v_o.id;
  delete from public.purchase_items i using public.purchases u where u.id = i.purchase_id and u.outlet_id = v_o.id;
  delete from public.purchases where outlet_id = v_o.id;
  delete from public.production_costs c using public.production_orders o
   where o.id = c.production_id and (o.kitchen_outlet_id = v_o.id or o.output_outlet_id = v_o.id);
  delete from public.production_orders where kitchen_outlet_id = v_o.id or output_outlet_id = v_o.id;
  delete from public.stock_transfer_items i using public.stock_transfers t
   where t.id = i.transfer_id and (t.from_outlet_id = v_o.id or t.to_outlet_id = v_o.id);
  delete from public.stock_transfers where from_outlet_id = v_o.id or to_outlet_id = v_o.id;

  alter table public.stock_movements disable trigger stock_movements_immutable;
  alter table public.inventory_losses disable trigger inventory_losses_immutable;
  delete from public.inventory_losses where outlet_id = v_o.id;
  delete from public.stock_movements where outlet_id = v_o.id;
  alter table public.stock_movements enable trigger stock_movements_immutable;
  alter table public.inventory_losses enable trigger inventory_losses_immutable;

  delete from app.outlet_counters where outlet_id = v_o.id;
  delete from app.approvals where outlet_id = v_o.id;

  if v_mode = 'nol' then
    update public.inventory_balances set quantity = 0, avg_cost = 0, updated_at = now() where outlet_id = v_o.id;
    update public.inventory_material_balances set quantity = 0, avg_cost = 0, updated_at = now() where outlet_id = v_o.id;
  else
    insert into public.stock_movements (outlet_id, item_type, item_id, movement_type, quantity_delta, unit_cost, value, balance_after, reference_type, user_id, note)
    select outlet_id, 'variant', variant_id, 'opening', quantity, avg_cost, round(quantity * avg_cost, 4), quantity, 'data_reset', v_uid, 'Stok awal setelah reset data'
      from public.inventory_balances where outlet_id = v_o.id and quantity <> 0;
    insert into public.stock_movements (outlet_id, item_type, item_id, movement_type, quantity_delta, unit_cost, value, balance_after, reference_type, user_id, note)
    select outlet_id, 'material', material_id, 'opening', quantity, avg_cost, round(quantity * avg_cost, 4), quantity, 'data_reset', v_uid, 'Stok awal setelah reset data'
      from public.inventory_material_balances where outlet_id = v_o.id and quantity <> 0;
  end if;

  perform app.audit(v_o.id, 'data_reset', 'outlets', v_o.id::text, v_n,
                    jsonb_build_object('stok', v_mode, 'alasan', left(v_why, 300)));

  v_res := jsonb_build_object('terapkan', true, 'blokir', null, 'jumlah', v_n, 'stok', v_mode,
    'outlet', jsonb_build_object('id', v_o.id, 'kode', v_o.code, 'nama', v_o.name));
  return app.idem_finish('data_reset', v_req, v_res);
end $$;

-- ---------- Pembungkus RPC publik + hak eksekusi ----------
do $$ declare n text; begin
  foreach n in array array['option_group_save','product_options_set','report_option_sales'] loop
    execute format('create function public.rpc_%1$s(p jsonb default ''{}''::jsonb) returns jsonb language sql security invoker set search_path = '''' as $f$ select app.%1$s(p) $f$', n);
    execute format('revoke all on function public.rpc_%1$s(jsonb) from public, anon', n);
    execute format('grant execute on function public.rpc_%1$s(jsonb) to authenticated', n);
    execute format('revoke all on function app.%1$s(jsonb) from public, anon', n);
    execute format('grant execute on function app.%1$s(jsonb) to authenticated', n);
  end loop;
end $$;
