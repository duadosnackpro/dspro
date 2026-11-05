-- Tes migrasi 0037: kemasan beli per bahan (pack_unit, pack_size) dan pengirimannya lewat bootstrap. Dijalankan setelah 001-013.
\set ON_ERROR_STOP on
do $$
declare mid uuid; e text; b jsonb; m jsonb;
begin
  insert into public.materials (name, type, unit, min_stock) values ('ZZ Plastik Pack', 'bahan', 'pcs', 0) returning id into mid;

  -- bahan tanpa kemasan: kolom kosong, tidak melanggar aturan
  perform t.ok((select pack_unit is null and pack_size is null from public.materials where id = mid), 'bahan baru: kemasan kosong');

  -- aturan: nama dan isi harus berdua atau kosong keduanya; isi > 0
  begin update public.materials set pack_unit = 'pack' where id = mid; e := null; exception when check_violation then e := 'ck'; end;
  perform t.ok(e = 'ck', 'nama kemasan tanpa isi ditolak');
  begin update public.materials set pack_size = 24 where id = mid; e := null; exception when check_violation then e := 'ck'; end;
  perform t.ok(e = 'ck', 'isi kemasan tanpa nama ditolak');
  begin update public.materials set pack_unit = 'pack', pack_size = 0 where id = mid; e := null; exception when check_violation then e := 'ck'; end;
  perform t.ok(e = 'ck', 'isi kemasan 0 ditolak');
  begin update public.materials set pack_unit = '   ', pack_size = 24 where id = mid; e := null; exception when check_violation then e := 'ck'; end;
  perform t.ok(e = 'ck', 'nama kemasan kosong spasi ditolak');

  update public.materials set pack_unit = 'pack', pack_size = 24 where id = mid;
  perform t.ok((select pack_unit = 'pack' and pack_size = 24 from public.materials where id = mid), 'nama dan isi kemasan tersimpan');

  -- bootstrap (peran dengan akses bahan) mengirim pack_nama dan pack_isi; stok tidak berubah
  perform t.login(t.id('owner'));
  b := public.rpc_bootstrap(jsonb_build_object('outlet_id', t.id('o1')));
  select x into m from jsonb_array_elements(b -> 'materials') x where x ->> 'id' = mid::text;
  perform t.ok(m ->> 'pack_nama' = 'pack' and (m ->> 'pack_isi')::numeric = 24, 'bootstrap membawa pack_nama dan pack_isi');
  perform t.ok(m ? 'satuan_kecil' and m ? 'faktor_kecil' and m ->> 'satuan' = 'pcs', 'kunci lama bootstrap tetap ada');
  perform t.logout();

  -- kasir tidak menerima daftar bahan sama sekali (tidak berubah)
  perform t.login(t.id('ka'));
  b := public.rpc_bootstrap(jsonb_build_object('outlet_id', t.id('o1')));
  perform t.ok(not (b ? 'materials'), 'kasir tidak menerima daftar bahan');
  perform t.logout();

  -- dikosongkan kembali (keduanya sekaligus)
  update public.materials set pack_unit = null, pack_size = null where id = mid;
  perform t.ok((select pack_unit is null and pack_size is null from public.materials where id = mid), 'kemasan bisa dikosongkan lagi');
end $$;
select 'Tes kemasan bahan selesai' as hasil;
