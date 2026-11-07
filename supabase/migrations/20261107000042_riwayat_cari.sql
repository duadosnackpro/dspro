-- 0042 Pencarian Riwayat (ISS-01, opsi B): cari transaksi lintas hari berdasarkan nomor nota, total, dan nama produk; detail per nota seperti struk.
-- Fungsi baru (hanya menambah; tidak ada fungsi lama yang diubah):
--   app.sales_search(p)  : daftar nota yang cocok dengan kata kunci pada rentang tanggal (maks. 92 hari), dipaginasi di server (limit/offset).
--   app.sale_receipt(p)  : satu nota lengkap (kasir, kanal, bayar/kembalian, baris item, retur terkait) untuk menyusun ulang struk.
--   app.riwayat_match()  : pembantu internal pencocokan (tidak dapat dipanggil klien).
-- Aturan akses sama dengan sales_list/sale_detail: owner/admin/supervisor/auditor melihat semua nota outlet, kasir hanya nota miliknya.
-- Kompatibilitas: klien 2.6.19 dan sebelumnya tidak memakai fungsi ini dan tetap berjalan. Klien 2.7.0 butuh skema ini (MIN_SCHEMA).
-- min_client TIDAK dinaikkan (kontrak lama tidak berubah).
--
-- Cara kata kunci dibaca (dipisah spasi, maksimal 4 kata, SEMUA kata harus cocok; satu kata cocok bila cocok di salah satu bidang):
--   nomor lengkap penjualan (mis. OUT-001-261107-012) hanya cocok dengan nota penjualan itu; untuk retur ketik lengkap dengan RT- (urutan retur terpisah dari urutan penjualan)
--   angka saja (mis. 12, 0012, 12.500)  -> nomor urut nota = angka itu, ATAU total nota = angka itu (retur dihitung nilai mutlaknya);
--                                           angka 6 digit ke atas juga dicari sebagai potongan nomor (mis. 261107)
--   selain angka (mis. basreng, RT-, 261107-001) -> potongan nomor nota; bila mengandung huruf juga dicari di nama produk, SKU, dan label opsi
--   bila kata kunci lebih dari satu kata, angka juga dicari di nama produk/label opsi (mis. "level 3")

create function app.riwayat_match(p_sale uuid, p_no text, p_total numeric, p_toks text[]) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v_tok text; v_dg text; v_num boolean; v_full boolean; v_pat text; v_multi boolean := cardinality(p_toks) > 1; v_hit text[]; v_all text[] := '{}';
begin
  foreach v_tok in array p_toks loop
    v_dg := regexp_replace(v_tok, '[.,]', '', 'g');
    v_num := v_tok ~ '^[0-9][0-9.,]*$' and v_dg ~ '^[0-9]+$' and length(v_dg) <= 14;
    v_pat := '%' || replace(replace(replace(v_tok, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_full := v_tok ~* '(^|-)[0-9]{6}-[0-9]+$' and v_tok !~* '^rt-';   -- nomor penjualan lengkap (KODE-YYMMDD-urut): jangan cocok dengan nomor retur yang kebetulan memuat teks yang sama (urutan retur terpisah)
    v_hit := '{}';
    if v_num then
      if length(v_dg) <= 9 and substring(p_no from '([0-9]+)$')::bigint = v_dg::bigint then v_hit := array_append(v_hit, 'nomor');
      elsif length(v_dg) >= 6 and p_no ilike v_pat then v_hit := array_append(v_hit, 'nomor'); end if;
      if abs(p_total) = v_dg::numeric then v_hit := array_append(v_hit, 'total'); end if;
    elsif p_no ilike v_pat and not (v_full and p_no ~* '^rt-') then v_hit := array_append(v_hit, 'nomor'); end if;
    if (v_tok ~ '[A-Za-z]' or v_multi) and exists (
         select 1 from public.sale_items i where i.sale_id = p_sale
            and (i.name_snapshot ilike v_pat or i.sku_snapshot ilike v_pat or coalesce(i.option_label, '') ilike v_pat)) then v_hit := array_append(v_hit, 'produk'); end if;
    if cardinality(v_hit) = 0 then return null; end if;   -- satu kata tidak cocok di mana pun => nota tidak lolos
    v_all := v_all || v_hit;
  end loop;
  return (select coalesce(array_agg(distinct f order by f), '{}') from unnest(v_all) f);
end $$;
revoke all on function app.riwayat_match(uuid, text, numeric, text[]) from public, anon, authenticated;

create function app.sales_search(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_o public.outlets; v_all boolean; v_uid uuid := (select auth.uid()); v_q text := trim(coalesce(p ->> 'q', '')); v_toks text[];
  v_to date; v_from date; v_lim int := least(greatest(coalesce(app.num(p, 'limit', 50), 50), 1), 100)::int; v_off int := greatest(coalesce(app.num(p, 'offset', 0), 0), 0)::int;
  v_rows jsonb; v_total int; v_omzet numeric; v_t0 timestamptz; v_t1 timestamptz;
begin
  select * into v_o from public.outlets where id = nullif(p ->> 'outlet_id', '')::uuid;
  if not found then raise exception 'Outlet tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v_o.id, array['owner','admin','supervisor','kasir','auditor']);
  v_all := app.has_role(v_o.id, array['owner','admin','supervisor','auditor']);
  if v_q = '' then raise exception 'Isi kata kunci pencarian.' using errcode = '22023'; end if;
  if length(v_q) > 60 then raise exception 'Kata kunci terlalu panjang (maksimal 60 karakter).' using errcode = '22023'; end if;
  select array_agg(t) into v_toks from (select t from regexp_split_to_table(v_q, '\s+') t where t <> '' limit 4) x;
  v_to := coalesce(nullif(p ->> 'to', '')::date, (now() at time zone v_o.timezone)::date);
  v_from := coalesce(nullif(p ->> 'from', '')::date, v_to);
  if v_from > v_to then raise exception 'Rentang tanggal terbalik.' using errcode = '22023'; end if;
  if v_to - v_from > 91 then raise exception 'Rentang pencarian maksimal 92 hari.' using errcode = '22023'; end if;
  v_t0 := v_from::timestamp at time zone v_o.timezone; v_t1 := (v_to + 1)::timestamp at time zone v_o.timezone;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'nomor', q.receipt_no, 'tanggal', to_char(q.sold_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS'),
           'channel_id', q.channel_id, 'kasir_id', q.cashier_id, 'subtotal', q.subtotal, 'diskon', q.discount, 'ppn_nominal', q.tax_amount, 'total', q.total,
           'metode_bayar', q.payment_method, 'status', case q.status when 'completed' then 'selesai' else 'batal' end, 'catatan', q.note,
           'ref_sale_id', q.ref_sale_id, 'outlet_id', q.outlet_id, 'review', q.review_flag, 'review_note', q.review_note,
           'cocok', to_jsonb(q.f), 'item_n', it.n, 'items', it.l) order by q.sold_at desc, q.id), '[]'::jsonb),
         coalesce(max(q.n), 0), coalesce(max(q.om), 0)
    into v_rows, v_total, v_omzet
    from (select h.*, count(*) over () as n, sum(case when h.status = 'completed' then h.total else 0 end) over () as om
            from (select s.*, app.riwayat_match(s.id, s.receipt_no, s.total, v_toks) as f
                    from public.sales s
                   where s.outlet_id = v_o.id and s.sold_at >= v_t0 and s.sold_at < v_t1 and (v_all or s.cashier_id = v_uid)) h
           where h.f is not null
           order by h.sold_at desc, h.id limit v_lim offset v_off) q
    left join lateral (select count(*)::int as n,
                              coalesce(jsonb_agg(jsonb_build_object('n', z.nm, 'q', z.qty) order by z.ord) filter (where z.rn <= 3), '[]'::jsonb) as l
                         from (select i.name_snapshot || coalesce(' (' || nullif(i.option_label, '') || ')', '') as nm, i.qty, i.id as ord,
                                      row_number() over (order by i.id) as rn
                                 from public.sale_items i where i.sale_id = q.id) z) it on true;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'offset', v_off, 'omzet', v_omzet, 'from', v_from, 'to', v_to);
end $$;

create function app.sale_receipt(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.sales; v_o public.outlets; v_kasir text; v_ch text; v_ref text; v_pay public.payments; v_items jsonb; v_rets jsonb;
begin
  select * into v from public.sales where id = nullif(p ->> 'id', '')::uuid;
  if not found then raise exception 'Transaksi tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v.outlet_id, array['owner','admin','supervisor','kasir','auditor']);
  if not app.has_role(v.outlet_id, array['owner','admin','supervisor','auditor']) and v.cashier_id <> (select auth.uid()) then
    raise exception 'Akses ditolak.' using errcode = '42501'; end if;
  select * into v_o from public.outlets where id = v.outlet_id;
  select coalesce(nullif(pr.full_name, ''), pr.username) into v_kasir from public.profiles pr where pr.id = v.cashier_id;
  select c.name into v_ch from public.channels c where c.id = v.channel_id;
  select s2.receipt_no into v_ref from public.sales s2 where s2.id = v.ref_sale_id;
  select * into v_pay from public.payments pm where pm.sale_id = v.id and pm.status = 'confirmed' order by pm.created_at limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'sku', i.sku_snapshot, 'nama', i.name_snapshot, 'label', nullif(i.option_label, ''),
                                               'qty', i.qty, 'harga', i.unit_price, 'total', i.line_total) order by i.id), '[]'::jsonb)
    into v_items from public.sale_items i where i.sale_id = v.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nomor', r.receipt_no, 'tanggal', to_char(r.sold_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS'), 'total', r.total) order by r.sold_at), '[]'::jsonb)
    into v_rets from public.sales r where r.ref_sale_id = v.id and r.status = 'completed';
  return jsonb_build_object(
    'sale', jsonb_build_object('id', v.id, 'nomor', v.receipt_no, 'tanggal', to_char(v.sold_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS'),
      'waktu_ms', (extract(epoch from v.sold_at) * 1000)::bigint, 'jenis', v.kind, 'status', case v.status when 'completed' then 'selesai' else 'batal' end,
      'ref_sale_id', v.ref_sale_id, 'ref_nomor', v_ref, 'channel_id', v.channel_id, 'channel', coalesce(v_ch, ''), 'kasir', coalesce(v_kasir, ''),
      'metode_bayar', v.payment_method, 'subtotal', v.subtotal, 'diskon', v.discount, 'ppn_nominal', v.tax_amount, 'total', v.total,
      'terima', coalesce(v_pay.received, abs(v.total)), 'kembali', coalesce(v_pay.change_given, 0), 'referensi', nullif(v_pay.reference, ''),
      'catatan', v.note, 'alasan', v.reason, 'review', v.review_flag, 'review_note', v.review_note, 'outlet_id', v.outlet_id),
    'items', v_items, 'returns', v_rets);
end $$;

-- Pembungkus publik + hak eksekusi (pola 0038)
create function public.rpc_sales_search(p jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select app.sales_search(p) $$;
revoke all on function public.rpc_sales_search(jsonb) from public, anon;
grant execute on function public.rpc_sales_search(jsonb) to authenticated;
revoke all on function app.sales_search(jsonb) from public, anon;
grant execute on function app.sales_search(jsonb) to authenticated;

create function public.rpc_sale_receipt(p jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select app.sale_receipt(p) $$;
revoke all on function public.rpc_sale_receipt(jsonb) from public, anon;
grant execute on function public.rpc_sale_receipt(jsonb) to authenticated;
revoke all on function app.sale_receipt(jsonb) from public, anon;
grant execute on function app.sale_receipt(jsonb) to authenticated;
