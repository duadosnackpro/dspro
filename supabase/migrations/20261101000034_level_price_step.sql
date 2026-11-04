-- 0034 Harga tambahan Level: Level 1 = +0, Level 2 = +0, Level 3 = +1.000, Level 4 = +2.000, Level 5 = +2.000.
-- 1) Level 4 dan 5 dibuat bila belum ada (aktif atau tidak) di grup 'Level'; pilihan yang pernah dinonaktifkan owner tidak dihidupkan lagi.
-- 2) Level 3-5 yang sudah ada dan selisihnya masih 0 diisi sesuai tabel; angka yang sudah diubah owner di Pustaka opsi tidak tertimpa.
-- Aman diulang. Penjualan lama tidak berubah (snapshot di sale_item_options).
do $$
declare g uuid; r record;
begin
  select id into g from public.option_groups where lower(name) = 'level' and active order by created_at limit 1;
  if g is null then return; end if;
  for r in select * from (values ('Level 3', 3, 1000), ('Level 4', 4, 2000), ('Level 5', 5, 2000)) as t(nm, srt, delta) loop
    if exists (select 1 from public.option_items where group_id = g and lower(name) = lower(r.nm)) then
      update public.option_items set price_delta = r.delta
       where group_id = g and lower(name) = lower(r.nm) and price_delta = 0;
    else
      insert into public.option_items (group_id, name, price_delta, sort) values (g, r.nm, r.delta, r.srt);
    end if;
  end loop;
end $$;
