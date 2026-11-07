-- Tes migrasi 0042: pencarian Riwayat (sales_search) dan detail nota (sale_receipt). Dijalankan setelah 001-018.
\set ON_ERROR_STOP on

-- Outlet terpisah + dua kasir baru supaya hitungan tidak bercampur dengan tes lain.
do $$ declare org uuid; os uuid; kx uuid := gen_random_uuid(); ky uuid := gen_random_uuid(); begin
  select organization_id into org from public.outlets where id = t.id('o1');
  insert into public.outlets (organization_id, code, name) values (org, 'OUT-S19', 'Outlet Cari 019') returning id into os;
  insert into auth.users (id, email) values (kx, 'kx19@t'), (ky, 'ky19@t');
  insert into public.profiles (id, username, full_name) values (kx, 'kasir.x19', 'Kasir X'), (ky, 'kasir.y19', 'Kasir Y');
  insert into public.memberships (user_id, outlet_id, role) values (kx, os, 'kasir'), (ky, os, 'kasir');
  insert into t.ids values ('os', os), ('kx', kx), ('ky', ky);
  update public.cash_sessions set status = 'closed', closed_at = now() where cashier_id = t.id('owner') and status = 'open';
  perform t.login(t.id('owner'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', os, 'tipe', 'varian', 'id', t.id('v1'), 'stok_baru', 50, 'hpp', 6000, 'alasan', 'stok uji 019'));
  perform public.rpc_stock_adjust(jsonb_build_object('outlet_id', os, 'tipe', 'varian', 'id', t.id('v2'), 'stok_baru', 50, 'hpp', 11000, 'alasan', 'stok uji 019'));
  perform t.logout();
end $$;

-- Data: A (kasir X, 20.000, bayar 25.000), B (kasir Y, 18.000), C (owner, 28.000 dua baris), D (kemarin, owner, 27.000), RT-A (retur 1 pcs dari A oleh owner)
do $$ declare os uuid := t.id('os'); ch uuid := t.id('ch'); v1 uuid := t.id('v1'); v2 uuid := t.id('v2'); r jsonb; tz text; ystd text; a uuid; begin
  select timezone into tz from public.outlets where id = os; ystd := to_char((now() at time zone tz)::date - 1, 'YYYY-MM-DD');
  perform t.login(t.id('kx'));
  r := public.rpc_sale_create(jsonb_build_object('outlet_id', os, 'request_id', 'cari19-a-0001', 'channel_id', ch, 'metode_bayar', 'tunai', 'amount_received', 25000,
        'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 2))));
  a := (r -> 'sale' ->> 'id')::uuid;
  perform t.logout(); insert into t.ids values ('sa', a); perform t.login(t.id('ky'));
  perform public.rpc_sale_create(jsonb_build_object('outlet_id', os, 'request_id', 'cari19-b-0001', 'channel_id', ch, 'metode_bayar', 'qris',
        'items', jsonb_build_array(jsonb_build_object('variant_id', v2, 'qty', 1))));
  perform t.logout(); perform t.login(t.id('owner'));
  perform public.rpc_sale_create(jsonb_build_object('outlet_id', os, 'request_id', 'cari19-c-0001', 'channel_id', ch, 'metode_bayar', 'transfer',
        'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 1), jsonb_build_object('variant_id', v2, 'qty', 1))));
  perform public.rpc_sale_backdate(jsonb_build_object('outlet_id', os, 'channel_id', ch, 'tanggal', ystd || ' 10:30:00', 'metode_bayar', 'tunai', 'potong_stok', false, 'request_id', 'cari19-d-0001',
        'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 3, 'harga', 9000))));
  perform public.rpc_sale_return(jsonb_build_object('request_id', 'cari19-ret-0001', 'id', a, 'alasan', 'uji 019', 'restock', true, 'items', jsonb_build_array(jsonb_build_object('variant_id', v1, 'qty', 1))));
  perform t.logout();
end $$;

do $$ declare
  os uuid := t.id('os'); tz text; td text; yd text; r jsonb; n int; no_a text; seq_a text; e text; i int; ids1 jsonb; ids2 jsonb; ra jsonb; rr jsonb; rid_ret uuid;
  s jsonb := '{}'::jsonb;
begin
  select timezone into tz from public.outlets where id = os; td := to_char((now() at time zone tz)::date, 'YYYY-MM-DD'); yd := to_char((now() at time zone tz)::date - 1, 'YYYY-MM-DD');
  select receipt_no into no_a from public.sales where id = t.id('sa'); seq_a := substring(no_a from '([0-9]+)$');

  perform t.login(t.id('owner'));
  -- nama produk, hari ini: A, B, C dan retur A (baris retur membawa nama produk)
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 4 and jsonb_array_length(r -> 'rows') = 4, 'produk hari ini: 4 nota (A, B, C, retur A), dapat ' || (r ->> 'total'));
  perform t.ok(not exists (select 1 from jsonb_array_elements(r -> 'rows') x where not (x -> 'cocok') ? 'produk'), 'semua baris ditandai cocok produk');
  perform t.ok((r -> 'rows' -> 0 ? 'items') and (r -> 'rows' -> 0 ? 'item_n'), 'baris memuat ringkasan item');
  -- lintas hari: D (kemarin) ikut
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 5, 'lintas 2 hari: 5 nota, dapat ' || (r ->> 'total'));
  perform t.ok((r -> 'rows' -> 4 ->> 'tanggal') like yd || '%', 'urutan terbaru dulu: nota kemarin paling akhir');
  -- tanpa from/to = hari ini saja
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng'));
  perform t.ok((r ->> 'total')::int = 4, 'tanpa rentang = hari ini saja');
  -- SKU dan label
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'bsr-200', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 2, 'SKU BSR-200: B dan C, dapat ' || (r ->> 'total'));
  -- nomor urut: angka saja = urut nota
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', seq_a, 'from', td, 'to', td));
  perform t.ok(exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'nomor' = no_a and (x -> 'cocok') ? 'nomor'), 'angka urut ' || seq_a || ' menemukan ' || no_a);
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', no_a, 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'nomor' = no_a, 'nomor lengkap menemukan tepat satu nota');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'RT-' || (select receipt_no from public.sales where request_id = 'cari19-c-0001'), 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 0, 'RT- + nomor penjualan C (urutan retur berbeda) tidak menemukan apa pun');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', (select receipt_no from public.sales where request_id = 'cari19-c-0001'), 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'nomor' not like 'RT-%', 'nomor penjualan C menemukan C saja');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', (select receipt_no from public.sales where ref_sale_id = t.id('sa')), 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'nomor' like 'RT-%', 'nomor retur lengkap menemukan retur itu saja');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', lower(no_a), 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1, 'nomor tidak peka huruf besar/kecil');
  -- total (pemisah ribuan boleh); retur dicari lewat nilai mutlak
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', '20.000', 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and (r -> 'rows' -> 0 -> 'cocok') ? 'total' and r -> 'rows' -> 0 ->> 'nomor' = no_a, 'total 20.000 menemukan A');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', '10000', 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'nomor' like 'RT-%', 'total 10000 menemukan retur (nilai mutlak)');
  -- awalan RT-
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'RT-', 'from', td, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'nomor' like 'RT-%' and r -> 'rows' -> 0 ->> 'ref_sale_id' = t.id('sa')::text, 'RT- hanya menemukan retur, dengan ref_sale_id');
  -- beberapa kata: semuanya harus cocok
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng 18000', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and ((r -> 'rows' -> 0 -> 'cocok') ?& array['produk','total']), 'produk + total: hanya B');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng 99999', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 0 and jsonb_array_length(r -> 'rows') = 0, 'satu kata tak cocok => tidak ada hasil');
  -- karakter wildcard tidak berlaku sebagai pola
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', '%', 'from', yd, 'to', td)); perform t.ok((r ->> 'total')::int = 0, '% tidak mencocokkan semua nota');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', '_', 'from', yd, 'to', td)); perform t.ok((r ->> 'total')::int = 0, '_ tidak mencocokkan semua nota');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'zzzz-tidak-ada', 'from', yd, 'to', td)); perform t.ok((r ->> 'total')::int = 0 and (r ->> 'omzet')::numeric = 0, 'tidak ada hasil: total 0, omzet 0');
  -- omzet pada hasil = jumlah total nota yang cocok (retur mengurangi): 20000 + 18000 + 28000 - 10000 = 56000 hari ini
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', td, 'to', td));
  perform t.ok((r ->> 'omzet')::numeric = 56000, 'omzet hasil hari ini 56000, dapat ' || (r ->> 'omzet'));
  -- paginasi: tidak ada nota hilang atau ganda; total sama di tiap halaman
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', yd, 'to', td, 'limit', 2, 'offset', 0)); ids1 := (select jsonb_agg(x ->> 'id') from jsonb_array_elements(r -> 'rows') x);
  perform t.ok(jsonb_array_length(r -> 'rows') = 2 and (r ->> 'total')::int = 5, 'halaman 1: 2 baris, total 5');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', yd, 'to', td, 'limit', 2, 'offset', 2)); ids2 := (select jsonb_agg(x ->> 'id') from jsonb_array_elements(r -> 'rows') x);
  perform t.ok(jsonb_array_length(r -> 'rows') = 2 and (r ->> 'total')::int = 5 and not (ids1 ?| (select array_agg(x) from jsonb_array_elements_text(ids2) x)), 'halaman 2: 2 baris berbeda, total tetap 5');
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', yd, 'to', td, 'limit', 2, 'offset', 4));
  perform t.ok(jsonb_array_length(r -> 'rows') = 1 and (r ->> 'total')::int = 5, 'halaman 3: sisa 1 baris');
  -- validasi masukan
  perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', '   ')) like '22023:%', 'kata kunci kosong ditolak');
  perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', repeat('a', 61))) like '22023:%', 'kata kunci > 60 karakter ditolak');
  perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', 'x', 'from', td, 'to', yd)) like '22023:%', 'rentang terbalik ditolak');
  perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', 'x', 'from', to_char((td::date - 100), 'YYYY-MM-DD'), 'to', td)) like '22023:%', 'rentang > 92 hari ditolak');
  perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', 'x', 'from', to_char((td::date - 91), 'YYYY-MM-DD'), 'to', td)) is null, 'rentang tepat 92 hari diterima');
  perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', gen_random_uuid(), 'q', 'x')) like 'P0002:%', 'outlet tidak ada => P0002');
  perform t.logout();

  -- kasir hanya melihat nota miliknya
  perform t.login(t.id('kx'));
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and r -> 'rows' -> 0 ->> 'nomor' = no_a, 'kasir X hanya melihat nota sendiri (A), dapat ' || (r ->> 'total'));
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', '18000', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 0, 'kasir X tidak menemukan total nota kasir Y');
  perform t.logout();
  perform t.login(t.id('ky'));
  r := public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'basreng', 'from', yd, 'to', td));
  perform t.ok((r ->> 'total')::int = 1 and (r -> 'rows' -> 0 ->> 'kasir_id')::uuid = t.id('ky'), 'kasir Y hanya melihat nota sendiri (B)');
  perform t.logout();
  -- tanpa akses outlet
  perform t.login(t.id('kb')); perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', 'basreng')) is not null, 'kasir outlet lain ditolak'); perform t.logout();
  perform t.login(t.id('ks')); perform t.ok(t.err('rpc_sales_search', jsonb_build_object('outlet_id', os, 'q', 'basreng')) is not null, 'peran stok ditolak'); perform t.logout();
  -- anon tidak punya hak eksekusi
  begin execute 'set local role anon'; perform public.rpc_sales_search(jsonb_build_object('outlet_id', os, 'q', 'x')); perform t.logout(); raise exception 'anon seharusnya ditolak';
  exception when insufficient_privilege then perform t.logout(); end;
  begin execute 'set local role anon'; perform public.rpc_sale_receipt(jsonb_build_object('id', t.id('sa'))); perform t.logout(); raise exception 'anon seharusnya ditolak';
  exception when insufficient_privilege then perform t.logout(); end;

  -- ===== detail nota =====
  perform t.login(t.id('owner'));
  ra := public.rpc_sale_receipt(jsonb_build_object('id', t.id('sa')));
  perform t.ok(ra -> 'sale' ->> 'nomor' = no_a and ra -> 'sale' ->> 'jenis' = 'sale' and ra -> 'sale' ->> 'status' = 'selesai', 'receipt: nomor, jenis, status');
  perform t.ok(ra -> 'sale' ->> 'kasir' = 'Kasir X' and ra -> 'sale' ->> 'channel' = 'Kasir Toko' and ra -> 'sale' ->> 'metode_bayar' = 'tunai', 'receipt: nama kasir, kanal, metode');
  perform t.ok((ra -> 'sale' ->> 'total')::numeric = 20000 and (ra -> 'sale' ->> 'terima')::numeric = 25000 and (ra -> 'sale' ->> 'kembali')::numeric = 5000, 'receipt: total 20000, terima 25000, kembali 5000, dapat ' || (ra -> 'sale' ->> 'terima') || '/' || (ra -> 'sale' ->> 'kembali'));
  perform t.ok(jsonb_array_length(ra -> 'items') = 1 and (ra -> 'items' -> 0 ->> 'qty')::numeric = 2 and (ra -> 'items' -> 0 ->> 'harga')::numeric = 10000 and (ra -> 'items' -> 0 ->> 'total')::numeric = 20000 and ra -> 'items' -> 0 ->> 'sku' = 'BSR-100-L2', 'receipt: baris item (qty, harga, total, SKU)');
  perform t.ok((ra -> 'sale' ->> 'waktu_ms')::bigint > 1700000000000, 'receipt: waktu_ms epoch milidetik');
  perform t.ok(jsonb_array_length(ra -> 'returns') = 1 and (ra -> 'returns' -> 0 ->> 'total')::numeric = -10000 and ra -> 'returns' -> 0 ->> 'nomor' like 'RT-%', 'receipt: retur terkait tercantum');
  perform t.ok(not (ra -> 'sale') ? 'fee_channel' and not (ra -> 'sale') ? 'hpp' and not (ra -> 'items' -> 0) ? 'hpp_snapshot', 'receipt: tidak membocorkan fee/HPP');
  rid_ret := (select id from public.sales where ref_sale_id = t.id('sa'));
  rr := public.rpc_sale_receipt(jsonb_build_object('id', rid_ret));
  perform t.ok(rr -> 'sale' ->> 'jenis' = 'return' and rr -> 'sale' ->> 'ref_nomor' = no_a and (rr -> 'sale' ->> 'total')::numeric = -10000, 'receipt retur: jenis, ref_nomor, total negatif');
  perform t.ok(jsonb_array_length(rr -> 'items') = 1 and (rr -> 'items' -> 0 ->> 'qty')::numeric = -1, 'receipt retur: baris item negatif');
  perform t.ok(t.err('rpc_sale_receipt', jsonb_build_object('id', gen_random_uuid())) like 'P0002:%', 'receipt: id tidak ada => P0002');
  perform t.logout();
  perform t.login(t.id('kx')); ra := public.rpc_sale_receipt(jsonb_build_object('id', t.id('sa'))); perform t.ok(ra -> 'sale' ->> 'nomor' = no_a, 'kasir X boleh membuka nota sendiri'); perform t.logout();
  perform t.login(t.id('ky')); perform t.ok(t.err('rpc_sale_receipt', jsonb_build_object('id', t.id('sa'))) like '42501:%', 'kasir Y tidak boleh membuka nota kasir X'); perform t.logout();
  perform t.login(t.id('kb')); perform t.ok(t.err('rpc_sale_receipt', jsonb_build_object('id', t.id('sa'))) is not null, 'kasir outlet lain ditolak'); perform t.logout();
end $$;

select 'Tes pencarian Riwayat selesai' as hasil;
