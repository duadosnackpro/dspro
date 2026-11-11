-- Tes migrasi 0043: daftar nota bertanda "perlu ditinjau" (sales_review_list). Dijalankan setelah 001-019; memakai outlet 'os' dan nota 'sa' dari tes 019.
\set ON_ERROR_STOP on

do $$ declare os uuid := t.id('os'); r jsonb; begin
  perform t.ok(not exists (select 1 from public.sales where outlet_id = os and review_flag), 'awal: tidak ada nota bertanda di outlet uji');
  update public.sales set review_flag = true, review_note = 'uji 020 harga disesuaikan' where id = t.id('sa');

  perform t.login(t.id('owner'));
  r := public.rpc_sales_review_list(jsonb_build_object('outlet_id', os));
  perform t.ok((r ->> 'total')::int = 1 and jsonb_array_length(r -> 'rows') = 1, 'owner: satu nota bertanda');
  perform t.ok(r -> 'rows' -> 0 ->> 'id' = t.id('sa')::text and r -> 'rows' -> 0 ->> 'review_note' like 'uji 020%', 'baris memuat id dan catatan');
  perform t.ok((r -> 'rows' -> 0 ->> 'tanggal') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$', 'tanggal berformat lokal outlet');
  perform t.logout();

  perform t.login(t.id('kx')); perform t.ok(t.err('rpc_sales_review_list', jsonb_build_object('outlet_id', os)) is not null, 'kasir ditolak'); perform t.logout();
  perform t.login(t.id('ks')); perform t.ok(t.err('rpc_sales_review_list', jsonb_build_object('outlet_id', os)) is not null, 'peran stok ditolak'); perform t.logout();
  perform t.login(t.id('owner')); perform t.ok(t.err('rpc_sales_review_list', jsonb_build_object('outlet_id', gen_random_uuid())) like 'P0002:%', 'outlet tidak ada => P0002'); perform t.logout();

  -- setelah ditandai ditinjau, nota hilang dari daftar dan jumlahnya turun
  perform t.login(t.id('owner'));
  perform public.rpc_sale_review(jsonb_build_object('id', t.id('sa'), 'catatan', 'uji 020 sudah dijelaskan'));
  r := public.rpc_sales_review_list(jsonb_build_object('outlet_id', os));
  perform t.ok((r ->> 'total')::int = 0 and jsonb_array_length(r -> 'rows') = 0, 'setelah ditandai ditinjau: daftar kosong');
  perform t.logout();

  begin execute 'set local role anon'; perform public.rpc_sales_review_list(jsonb_build_object('outlet_id', os)); perform t.logout(); raise exception 'anon seharusnya ditolak';
  exception when insufficient_privilege then perform t.logout(); end;
end $$;

select 'Tes daftar nota perlu ditinjau selesai' as hasil;
