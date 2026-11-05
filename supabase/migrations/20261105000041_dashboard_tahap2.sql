-- 0041 Beranda tahap 2: jumlah produk terjual (pcs), penjualan per metode bayar, diskon dan retur, jam ramai, produk terlaris menurut omzet/laba,
-- dan jumlah sebenarnya bahan habis/menipis (daftar 'low' tetap dibatasi 10).
-- Hanya MENAMBAH kunci pada keluaran app.dashboard dan menambah kunci pada 'cur' dan 'prev'; kunci lama tidak berubah, jadi klien lama tetap berjalan.
-- Batas waktu dibaca ke variabel (v_ta, v_tb, v_pa, v_pb) agar indeks sales_outlet_time dipakai. Hak akses tetap owner/admin/auditor.
-- Catatan arti angka: 'pcs' dan 'metode' bersifat NETO (retur mengurangi); 'metode.rp' = jumlah pembayaran terkonfirmasi (dapat termasuk PPN bila outlet memakainya),
-- sedangkan omzet Beranda tanpa PPN; 'jam' hanya memuat penjualan yang punya sesi kas.

create or replace function app.dashboard(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_o public.outlets; v_per text := coalesce(nullif(p ->> 'period', ''), 'hari');
  v_today date; v_from date; v_to date; v_pfrom date; v_pto date; v_sfrom date;
  v_cur jsonb; v_prev jsonb; v_series jsonb; v_ch jsonb; v_top jsonb; v_low jsonb; v_neg jsonb;
  v_ta timestamptz; v_tb timestamptz; v_pa timestamptz; v_pb timestamptz; v_pcs numeric; v_ppcs numeric; v_disc numeric; v_pay jsonb; v_jam jsonb; v_top_om jsonb; v_top_laba jsonb; v_habis bigint; v_tipis bigint;
  v_fee numeric; v_biaya numeric; v_laba numeric; v_loss numeric; v_rev bigint; v_miss bigint; v_vn bigint; v_warn jsonb := '[]'::jsonb;
begin
  select * into v_o from public.outlets where id = nullif(p ->> 'outlet_id', '')::uuid;
  if not found then raise exception 'Outlet tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v_o.id, array['owner','admin','auditor']);
  if v_per not in ('hari','minggu','bulan') then raise exception 'Periode tidak valid.' using errcode = '22023'; end if;

  v_today := (now() at time zone v_o.timezone)::date;
  if v_per = 'hari' then
    v_from := v_today; v_to := v_today; v_pto := v_today - 1; v_pfrom := v_pto;
  elsif v_per = 'minggu' then
    v_from := v_today - 6; v_to := v_today; v_pto := v_from - 1; v_pfrom := v_pto - 6;
  else
    v_from := date_trunc('month', v_today)::date; v_to := v_today;
    v_pfrom := (v_from - interval '1 month')::date;
    v_pto := least(v_pfrom + (v_to - v_from), v_from - 1);
  end if;
  v_sfrom := least(v_from, v_to - 6);
  v_ta := v_from::timestamp at time zone v_o.timezone; v_tb := (v_to + 1)::timestamp at time zone v_o.timezone;
  v_pa := v_pfrom::timestamp at time zone v_o.timezone; v_pb := (v_pto + 1)::timestamp at time zone v_o.timezone;      -- grafik minimal 7 hari agar "Hari ini" tetap punya konteks

  select jsonb_build_object('omzet', coalesce(sum(f.om), 0), 'trx', count(*) filter (where f.kind = 'sale'), 'laba', coalesce(sum(f.om - f.hpp), 0),
                            'retur_n', count(*) filter (where f.kind = 'return'), 'retur_rp', coalesce(-sum(f.om) filter (where f.kind = 'return'), 0)),
         coalesce(sum(f.fee), 0)
    into v_cur, v_fee from app.sales_facts(v_o.id, v_from, v_to) f;
  select jsonb_build_object('omzet', coalesce(sum(f.om), 0), 'trx', count(*) filter (where f.kind = 'sale'), 'laba', coalesce(sum(f.om - f.hpp), 0))
    into v_prev from app.sales_facts(v_o.id, v_pfrom, v_pto) f;

  -- 0041: jumlah produk terjual (neto: retur mengurangi), diskon, dan pembanding pcs.
  select coalesce(sum(i.qty), 0) into v_pcs from public.sale_items i join public.sales s on s.id = i.sale_id
   where s.outlet_id = v_o.id and s.status = 'completed' and s.sold_at >= v_ta and s.sold_at < v_tb;
  select coalesce(sum(i.qty), 0) into v_ppcs from public.sale_items i join public.sales s on s.id = i.sale_id
   where s.outlet_id = v_o.id and s.status = 'completed' and s.sold_at >= v_pa and s.sold_at < v_pb;
  select coalesce(sum(s.discount), 0) into v_disc from public.sales s
   where s.outlet_id = v_o.id and s.status = 'completed' and s.kind = 'sale' and s.sold_at >= v_ta and s.sold_at < v_tb;
  v_cur := v_cur || jsonb_build_object('pcs', v_pcs, 'diskon', v_disc);
  v_prev := v_prev || jsonb_build_object('pcs', v_ppcs);

  select coalesce(jsonb_agg(jsonb_build_object('d', to_char(v_sfrom + g.n, 'YYYY-MM-DD'), 'omzet', coalesce(x.om, 0), 'laba', coalesce(x.om - x.hpp, 0)) order by g.n), '[]'::jsonb)
    into v_series
    from generate_series(0, v_to - v_sfrom) as g(n)
    left join (select f.d, sum(f.om) as om, sum(f.hpp) as hpp from app.sales_facts(v_o.id, v_sfrom, v_to) f group by f.d) x on x.d = v_sfrom + g.n;

  select coalesce(jsonb_agg(jsonb_build_object('nama', c.name, 'omzet', t.om) order by t.om desc), '[]'::jsonb) into v_ch
    from (select f.channel_id, sum(f.om) as om from app.sales_facts(v_o.id, v_from, v_to) f group by f.channel_id having sum(f.om) <> 0) t
    join public.channels c on c.id = t.channel_id;

  -- Produk terlaris: satu agregasi, tiga urutan (qty, omzet, laba kotor). 'top' (qty) tetap seperti sebelumnya; 'om' dan 'laba' ditambahkan.
  with g as (
    select max(i.name_snapshot) as nm, sum(i.qty) as qty, sum(i.line_total) as om, sum(i.line_total - i.qty * coalesce(i.hpp_snapshot, 0)) as laba
      from public.sale_items i join public.sales s on s.id = i.sale_id
     where s.outlet_id = v_o.id and s.status = 'completed' and s.sold_at >= v_ta and s.sold_at < v_tb
     group by i.variant_id having sum(i.qty) > 0)
  select (select coalesce(jsonb_agg(jsonb_build_object('nama', x.nm, 'qty', x.qty, 'om', x.om, 'laba', x.laba) order by x.qty desc), '[]'::jsonb) from (select * from g order by qty desc limit 5) x),
         (select coalesce(jsonb_agg(jsonb_build_object('nama', x.nm, 'qty', x.qty, 'om', x.om, 'laba', x.laba) order by x.om desc), '[]'::jsonb) from (select * from g order by om desc limit 5) x),
         (select coalesce(jsonb_agg(jsonb_build_object('nama', x.nm, 'qty', x.qty, 'om', x.om, 'laba', x.laba) order by x.laba desc), '[]'::jsonb) from (select * from g order by laba desc limit 5) x)
    into v_top, v_top_om, v_top_laba;

  select coalesce(jsonb_agg(jsonb_build_object('nama', q.name, 'stok', q.qty, 'satuan', q.unit) order by q.qty - q.min_stock), '[]'::jsonb) into v_low from (
    select m.name, coalesce(b.quantity, 0) as qty, m.unit, m.min_stock
    from public.materials m left join public.inventory_material_balances b on b.outlet_id = v_o.id and b.material_id = m.id
    where m.active and m.min_stock > 0 and coalesce(b.quantity, 0) <= m.min_stock
    order by coalesce(b.quantity, 0) - m.min_stock limit 10) q;

  -- Jumlah sebenarnya bahan habis/menipis (daftar 'low' dibatasi 10).
  select count(*) filter (where coalesce(b.quantity, 0) <= 0), count(*) filter (where coalesce(b.quantity, 0) > 0) into v_habis, v_tipis
    from public.materials m left join public.inventory_material_balances b on b.outlet_id = v_o.id and b.material_id = m.id
   where m.active and m.min_stock > 0 and coalesce(b.quantity, 0) <= m.min_stock;

  -- Penjualan per metode bayar (neto retur), memakai tabel pembayaran seperti laporan "Pembayaran per metode".
  select coalesce(jsonb_agg(jsonb_build_object('metode', q.m, 'trx', q.trx, 'rp', q.rp) order by q.rp desc, q.m), '[]'::jsonb) into v_pay from (
    select pm.method as m, count(distinct s.id) filter (where s.kind = 'sale') as trx, coalesce(sum(pm.amount), 0) as rp
      from public.payments pm join public.sales s on s.id = pm.sale_id
     where s.outlet_id = v_o.id and s.status = 'completed' and pm.status = 'confirmed' and s.sold_at >= v_ta and s.sold_at < v_tb
     group by pm.method) q;

  -- Jam ramai (jam lokal outlet). Hanya penjualan kasir (punya sesi kas): transaksi lama yang diinput belakangan tidak punya jam asli.
  select coalesce(jsonb_agg(jsonb_build_object('jam', q.h, 'trx', q.trx, 'omzet', q.om) order by q.h), '[]'::jsonb) into v_jam from (
    select extract(hour from s.sold_at at time zone v_o.timezone)::int as h, count(*) as trx, coalesce(sum(s.total - s.tax_amount), 0) as om
      from public.sales s
     where s.outlet_id = v_o.id and s.kind = 'sale' and s.status = 'completed' and s.cash_session_id is not null and s.sold_at >= v_ta and s.sold_at < v_tb
     group by 1) q;

  select coalesce(jsonb_agg(jsonb_build_object('nama', q.nm, 'stok', q.qty)), '[]'::jsonb) into v_neg from (
    select trim(coalesce(pr.name, '?') || ' ' || v.sku) as nm, b.quantity as qty
      from public.inventory_balances b join public.product_variants v on v.id = b.variant_id left join public.products pr on pr.id = v.product_id
      where b.outlet_id = v_o.id and b.quantity < 0
    union all
    select m.name, b.quantity from public.inventory_material_balances b join public.materials m on m.id = b.material_id
      where b.outlet_id = v_o.id and b.quantity < 0
    order by 2 limit 20) q;

  -- F-06: biaya pada kategori "sudah masuk HPP" tidak dikurangkan lagi. F-01: kerugian persediaan mengurangi laba.
  select coalesce(sum(e.amount), 0) into v_biaya from public.expenses e
    where e.outlet_id = v_o.id and e.expense_date between v_from and v_to and lower(trim(e.category)) <> all (app.hpp_cats(v_o.id));
  select coalesce(sum(l.value), 0) into v_loss from public.inventory_losses l
    where l.outlet_id = v_o.id and l.loss_date between v_from and v_to;
  select count(*) into v_rev from public.sales s where s.outlet_id = v_o.id and s.review_flag;
  v_laba := (v_cur ->> 'laba')::numeric - v_fee - v_biaya - v_loss;
  -- F-08: peringatan HPP kosong (laba/margin terlihat lebih tinggi dari kenyataan).
  select coalesce(sum(f.hpp_missing), 0) into v_miss from app.sales_facts(v_o.id, v_from, v_to) f;
  select count(*) into v_vn from public.inventory_balances b join public.product_variants v on v.id = b.variant_id join public.products pr on pr.id = v.product_id and pr.active
   where b.outlet_id = v_o.id and v.active and b.quantity > 0 and coalesce(b.avg_cost, 0) <= 0;
  if v_miss > 0 then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('aksi', 'hpp', 'teks', v_miss || ' baris penjualan periode ini belum punya HPP, jadi laba dan margin terlihat lebih tinggi dari kenyataan.'));
  end if;
  if v_vn > 0 then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('aksi', 'stok', 'teks', v_vn || ' varian yang ada stoknya belum punya HPP. Isi HPP lewat Stok (penyesuaian) supaya penjualan berikutnya punya HPP.'));
  end if;

  return jsonb_build_object('period', v_per, 'outlet_id', v_o.id, 'from', v_from, 'to', v_to, 'pfrom', v_pfrom, 'pto', v_pto,
    'cur', v_cur, 'prev', v_prev, 'series', v_series, 'channels', v_ch, 'top', v_top, 'top_om', v_top_om, 'top_laba', v_top_laba, 'low', v_low, 'stok_minus', v_neg,
    'low_habis', v_habis, 'low_tipis', v_tipis, 'metode', v_pay, 'jam', v_jam,
    'peringatan', v_warn, 'biaya', v_biaya, 'fee_channel', v_fee, 'laba_bersih', v_laba,
    'kerugian', v_loss, 'review_trx', v_rev);
end $$;
