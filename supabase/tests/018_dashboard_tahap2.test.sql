-- Tes migrasi 0041: data baru Beranda (pcs, metode bayar, diskon, retur, jam ramai, urutan terlaris, total bahan habis). Dijalankan setelah 001-017.
\set ON_ERROR_STOP on

-- Outlet terpisah agar angka tidak bercampur dengan data uji lain.
do $$ declare org uuid; od uuid; begin
  select organization_id into org from public.outlets where id = t.id('o1');
  insert into public.outlets (organization_id, code, name) values (org, 'OUT-D18', 'Outlet Dashboard 018') returning id into od;
  insert into t.ids values ('od', od);
  perform t.login(t.id('owner'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', od, 'tipe', 'varian', 'id', t.id('v2'), 'stok_baru', 50, 'hpp', 5000, 'alasan', 'stok uji 018'));
  perform t.logout();
end $$;

do $$ declare
  od uuid := t.id('od'); ch uuid := t.id('ch'); v1 uuid := t.id('v1'); v2 uuid := t.id('v2'); tz text; ystd text; r jsonb; s3 uuid; d jsonb; e text;
  tot_all numeric; x jsonb; n_hab bigint; i int;
begin
  select timezone into tz from public.outlets where id = od;
  -- sesi kas owner dari tes sebelumnya masih terbuka di outlet lain: tutup dulu agar penjualan kasir di outlet uji bisa membuka sesi sendiri
  update public.cash_sessions set status = 'closed', closed_at = now() where cashier_id = t.id('owner') and status = 'open';
  ystd := to_char((now() at time zone tz)::date - 1, 'YYYY-MM-DD');
  perform t.login(t.id('owner'));
  -- dua transaksi lama (kemarin) dan satu penjualan kasir (sekarang, diskon 3.000) yang sebagian diretur
  perform public.rpc_sale_backdate(jsonb_build_object('outlet_id', od, 'channel_id', ch, 'tanggal', ystd || ' 10:30:00', 'metode_bayar', 'tunai', 'potong_stok', false, 'request_id', 'dash18-bd-0001',
        'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 3, 'harga', 9000))));
  perform public.rpc_sale_backdate(jsonb_build_object('outlet_id', od, 'channel_id', ch, 'tanggal', ystd || ' 11:15:00', 'metode_bayar', 'qris', 'potong_stok', false, 'request_id', 'dash18-bd-0002',
        'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 2, 'harga', 9000), jsonb_build_object('variant_id', v2, 'qty', 1, 'harga', 12000))));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', od, 'request_id', 'dash18-live-0001', 'channel_id', ch, 'metode_bayar', 'tunai', 'diskon', 3000,
        'items', jsonb_build_array(jsonb_build_object('variant_id', v2, 'qty', 2))));
  s3 := (r -> 'sale' ->> 'id')::uuid;
  perform public.rpc_sale_return(jsonb_build_object('request_id', 'dash18-ret-0001', 'id', s3, 'alasan', 'uji 018', 'restock', true, 'items', jsonb_build_array(jsonb_build_object('variant_id', v2, 'qty', 1))));
  d := public.rpc_dashboard(jsonb_build_object('outlet_id', od, 'period', 'minggu'));
  perform t.logout();

  -- kontrak lama tetap utuh
  perform t.ok(d ?& array['period','from','to','cur','prev','series','channels','top','low','stok_minus','peringatan','biaya','fee_channel','laba_bersih','kerugian','review_trx'], 'kunci lama tetap ada');
  perform t.ok((d -> 'cur') ?& array['omzet','trx','laba'], 'cur: omzet, trx, laba tetap ada');
  perform t.ok(d ?& array['top_om','top_laba','low_habis','low_tipis','metode','jam'] and (d -> 'cur') ?& array['pcs','diskon','retur_n','retur_rp'] and (d -> 'prev') ? 'pcs', 'kunci baru ada');

  -- pcs neto: 3 + (2+1) + 2 - 1 retur = 7
  perform t.ok((d -> 'cur' ->> 'pcs')::numeric = 7, 'pcs terjual neto = 7 (retur mengurangi): ' || (d -> 'cur' ->> 'pcs'));
  perform t.ok((d -> 'cur' ->> 'trx')::int = 3, '3 transaksi penjualan');
  perform t.ok((d -> 'cur' ->> 'retur_n')::int = 1 and (d -> 'cur' ->> 'retur_rp')::numeric > 0, 'retur: 1 transaksi dengan nilai > 0: ' || (d -> 'cur' ->> 'retur_rp'));
  perform t.ok((d -> 'cur' ->> 'diskon')::numeric = 3000, 'diskon = 3.000 (hanya penjualan, bukan retur): ' || (d -> 'cur' ->> 'diskon'));

  -- metode bayar neto: jumlah semua metode = total semua baris penjualan + retur (retur negatif)
  select coalesce(sum(total), 0) into tot_all from public.sales where outlet_id = od and status = 'completed';
  perform t.ok((select sum((m ->> 'rp')::numeric) from jsonb_array_elements(d -> 'metode') m) = tot_all, 'jumlah per metode = total neto semua transaksi: ' || tot_all);
  perform t.ok((select (m ->> 'trx')::int from jsonb_array_elements(d -> 'metode') m where m ->> 'metode' = 'tunai') = 2
           and (select (m ->> 'trx')::int from jsonb_array_elements(d -> 'metode') m where m ->> 'metode' = 'qris') = 1, 'transaksi per metode: tunai 2, qris 1');
  perform t.ok((select (m ->> 'rp')::numeric from jsonb_array_elements(d -> 'metode') m where m ->> 'metode' = 'qris') = 30000, 'qris = 30.000');
  perform t.ok((select (m ->> 'rp')::numeric from jsonb_array_elements(d -> 'metode') m where m ->> 'metode' = 'tunai') < 27000 + (r -> 'sale' ->> 'total')::numeric, 'tunai sudah dikurangi retur');
  perform t.ok(((d -> 'metode') -> 0 ->> 'rp')::numeric >= ((d -> 'metode') -> 1 ->> 'rp')::numeric, 'metode terurut dari terbesar');

  -- jam ramai: hanya penjualan kasir (transaksi lama tidak punya jam asli)
  perform t.ok((select coalesce(sum((j ->> 'trx')::int), 0) from jsonb_array_elements(d -> 'jam') j) = 1, 'jam: hanya 1 transaksi kasir (transaksi lama dikecualikan)');
  perform t.ok((select (j ->> 'jam')::int from jsonb_array_elements(d -> 'jam') j limit 1) = extract(hour from now() at time zone tz)::int
            or (select (j ->> 'jam')::int from jsonb_array_elements(d -> 'jam') j limit 1) between 0 and 23, 'jam berupa 0-23 (zona outlet)');

  -- produk terlaris: tiga urutan, kolom om/laba terisi
  x := d -> 'top';
  perform t.ok((x -> 0) ?& array['nama','qty','om','laba'], 'top memuat nama, qty, om, laba');
  perform t.ok(jsonb_array_length(d -> 'top_om') >= 1 and jsonb_array_length(d -> 'top_laba') >= 1, 'top_om dan top_laba terisi');
  perform t.ok(((d -> 'top_om') -> 0 ->> 'om')::numeric >= ((d -> 'top_om') -> 1 ->> 'om')::numeric, 'top_om terurut menurut omzet');
  perform t.ok(((d -> 'top') -> 0 ->> 'qty')::numeric >= ((d -> 'top') -> 1 ->> 'qty')::numeric, 'top terurut menurut qty');

  -- hak akses
  perform t.login(t.id('ka'));
  e := t.err('rpc_dashboard', jsonb_build_object('outlet_id', od, 'period', 'minggu'));
  perform t.ok(e like '42501%', 'kasir tetap tidak boleh membuka dashboard: ' || coalesce(e, 'NULL'));
  perform t.logout();
end $$;

-- total bahan habis/menipis sebenarnya (daftar low dibatasi 10)
do $$ declare od uuid := t.id('od'); d jsonb; n_hab bigint; n_tip bigint; m uuid; i int; begin
  for i in 1..12 loop
    insert into public.materials (name, unit, min_stock) values ('Habis018-' || i, 'gram', 10);
  end loop;
  insert into public.materials (name, unit, min_stock) values ('Tipis018', 'gram', 100) returning id into m;
  insert into public.inventory_material_balances (outlet_id, material_id, quantity, avg_cost) values (od, m, 40, 10) on conflict (outlet_id, material_id) do update set quantity = 40;
  select count(*) filter (where coalesce(b.quantity, 0) <= 0), count(*) filter (where coalesce(b.quantity, 0) > 0) into n_hab, n_tip
    from public.materials mm left join public.inventory_material_balances b on b.outlet_id = od and b.material_id = mm.id
   where mm.active and mm.min_stock > 0 and coalesce(b.quantity, 0) <= mm.min_stock;
  perform t.login(t.id('owner'));
  d := public.rpc_dashboard(jsonb_build_object('outlet_id', od, 'period', 'hari'));
  perform t.logout();
  perform t.ok(jsonb_array_length(d -> 'low') = 10, 'daftar low tetap dibatasi 10');
  perform t.ok((d ->> 'low_habis')::bigint = n_hab and n_hab >= 12, 'low_habis = jumlah sebenarnya (' || n_hab || '), bukan 10');
  perform t.ok((d ->> 'low_tipis')::bigint = n_tip and n_tip >= 1, 'low_tipis = jumlah sebenarnya (' || n_tip || ')');
end $$;

-- periode kosong: nol dan larik kosong, bukan galat
do $$ declare d jsonb; begin
  perform t.login(t.id('owner'));
  d := public.rpc_dashboard(jsonb_build_object('outlet_id', t.id('kit'), 'period', 'hari'));
  perform t.logout();
  perform t.ok((d -> 'cur' ->> 'pcs')::numeric = 0 and (d -> 'cur' ->> 'diskon')::numeric = 0 and (d -> 'cur' ->> 'retur_n')::int = 0, 'outlet tanpa penjualan: pcs, diskon, retur = 0');
  perform t.ok(d -> 'metode' = '[]'::jsonb and d -> 'jam' = '[]'::jsonb and d -> 'top_om' = '[]'::jsonb and d -> 'top_laba' = '[]'::jsonb, 'larik kosong untuk metode, jam, top_om, top_laba');
end $$;

select 'Tes Beranda tahap 2 selesai' as hasil;
