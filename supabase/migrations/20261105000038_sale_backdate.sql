-- 0038 Input transaksi penjualan lama (bertanggal lampau), khusus Owner/Admin.
--
-- Untuk memasukkan penjualan yang terjadi sebelum aplikasi dipakai (mis. transaksi di buku catatan) dengan TANGGAL ASLI, sehingga laporan harian,
-- bulanan, laba rugi, dan pembayaran per metode jatuh di hari yang benar. Penjualan lewat kasir tetap selalu bertanggal "sekarang".
--
-- Aturan:
--  * Hanya owner/admin di outlet toko aktif. Tanggal (waktu lokal outlet) harus di masa lalu dan tidak boleh di periode terkunci (ditolak, tidak digeser).
--  * Harga: harga per item bila dikirim, selain itu harga channel saat ini. Total, PPN, dan fee channel dihitung server dengan rumus yang sama seperti sale_create.
--  * Tidak memakai sesi kasir (cash_session_id = null), jadi TIDAK ikut hitungan laci/tutup kasir hari ini.
--  * potong_stok (bawaan true): mengurangi stok seperti penjualan biasa (stok boleh minus). Kirim false bila stok akhir akan dihitung fisik.
--  * HPP baris = HPP rata-rata saat ini (kosong bila 0; bisa diperbaiki lewat perbaikan HPP di Beranda).
--  * Nomor struk memakai tanggal transaksi. request_id wajib dan anti-ganda (kirim ulang dengan isi sama mengembalikan hasil pertama).
--  * Tercatat di audit (aksi sale_backdate) dan diberi catatan "Transaksi lama".
-- Forward-only. Tidak mengubah fungsi yang sudah ada; klien lama tidak terpengaruh, min_client tidak dinaikkan.

create function app.sale_backdate(p jsonb) returns jsonb
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

  create temp table if not exists _bd (variant_id uuid, qty numeric, price numeric, sku text, nm text) on commit drop;
  truncate _bd;
  for v_l in
    select i.variant_id, i.qty, i.harga, v.sku, v.active as vactive, pr.active as pactive,
           trim(coalesce(pr.name, '') || ' ' || coalesce(v.size, '') || case when v.spice_level is null or v.spice_level = '' then '' else ' ' || v.spice_level end) as nm
    from (select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'qty')::numeric) as qty,
                 round(sum((e ->> 'qty')::numeric * nullif(e ->> 'harga', '')::numeric) filter (where nullif(e ->> 'harga', '') is not null)
                       / nullif(sum((e ->> 'qty')::numeric) filter (where nullif(e ->> 'harga', '') is not null), 0), 2) as harga
          from jsonb_array_elements(p -> 'items') e group by 1) i
    left join public.product_variants v on v.id = i.variant_id
    left join public.products pr on pr.id = v.product_id
    order by i.variant_id
  loop
    if v_l.sku is null then raise exception 'Varian tidak ditemukan.' using errcode = 'P0001'; end if;
    if not v_l.vactive or not v_l.pactive then raise exception 'Varian nonaktif: %', v_l.sku using errcode = 'P0001'; end if;
    v_price := coalesce(v_l.harga, app.price_of(v_o.id, v_l.variant_id, v_ch.id));
    if v_price is null or v_price < 0 then raise exception 'Harga belum diatur: % di %', v_l.sku, v_ch.name using errcode = 'P0001'; end if;
    insert into _bd values (v_l.variant_id, v_l.qty, v_price, v_l.sku, v_l.nm);
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

  if v_stok then
    for v_l in select variant_id, sku, qty from _bd order by variant_id loop
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
  insert into public.sale_items (sale_id, outlet_id, variant_id, sku_snapshot, name_snapshot, qty, unit_price, hpp_snapshot)
  select v_sale, v_o.id, s.variant_id, s.sku, s.nm, s.qty, s.price, nullif(coalesce(b.avg_cost, 0), 0)
  from _bd s left join public.inventory_balances b on b.outlet_id = v_o.id and b.variant_id = s.variant_id;
  insert into public.payments (sale_id, outlet_id, cash_session_id, method, amount, received, change_given, reference)
  values (v_sale, v_o.id, null, v_method, v_total, v_total, 0, case when v_method <> 'tunai' then v_ref end);

  perform app.audit(v_o.id, 'sale_backdate', 'sales', v_sale::text, null,
                    jsonb_build_object('nomor', v_no, 'total', v_total, 'metode', v_method, 'tanggal', to_char(v_local, 'YYYY-MM-DD HH24:MI:SS'), 'potong_stok', v_stok));
  v_res := jsonb_build_object('sale', jsonb_build_object('id', v_sale, 'nomor', v_no, 'outlet_id', v_o.id, 'tanggal', to_char(v_local, 'YYYY-MM-DD HH24:MI:SS'),
                              'subtotal', v_sub, 'diskon', v_disc, 'ppn_nominal', v_tax, 'total', v_total, 'metode', v_method),
                              'stok', v_stock, 'potong_stok', v_stok);
  return app.idem_finish('sale_backdate', v_req, v_res);
end $$;

-- ---------- Pembungkus RPC publik + hak ----------
create function public.rpc_sale_backdate(p jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select app.sale_backdate(p) $$;
revoke all on function public.rpc_sale_backdate(jsonb) from public, anon;
grant execute on function public.rpc_sale_backdate(jsonb) to authenticated;
revoke all on function app.sale_backdate(jsonb) from public, anon;
grant execute on function app.sale_backdate(jsonb) to authenticated;
