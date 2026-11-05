-- 0040 Sinkronisasi data operasional: resep, bahan, pembelian, produksi, retur, biaya, transfer, dan sesi kas ikut memicu pembaruan di semua perangkat.
--
-- Masalah: sidik versi di app.ping (cat_ver + stock_ver) hanya mencakup katalog/harga/pengaturan dan stok PRODUK JADI. Perubahan resep, bahan dan stok
-- bahan, pembelian, produksi, retur tanpa restock, biaya, transfer, dan sesi kas tidak mengubah sidik itu, sehingga perangkat lain (dan cache layar)
-- tetap memakai data lama sampai dimuat ulang manual.
--
-- Perbaikan (hanya menambah; forward-only):
--   * app.ops_seq: urutan global yang dinaikkan setiap ada perubahan data operasional. app.ping menambah 'ops_ver' (nilai urutan terakhir). Urutan tidak
--     mengunci baris dan tidak menjadi titik rebutan antar transaksi (nextval tidak transaksional); transaksi yang dibatalkan paling jauh menyebabkan satu
--     pemuatan ulang yang tidak perlu.
--   * sync_events menerima jenis 'ops'. Trigger memasukkan satu sinyal 'ops' global per perubahan (beruntun dalam 200 ms digabung; ping klien baru berjalan
--     >= 800 ms setelah sinyal pertama, jadi perubahan yang digabung sudah terlihat oleh ping itu).
--   * 'ops_ver' sengaja TIDAK memuat penjualan biasa (sudah tercakup stock_ver) sehingga kasir ramai tidak memicu pemuatan ulang ke seluruh perangkat.
--     Yang dihitung dari penjualan: retur baru, perubahan status/penandaan tinjau, dan penghapusan (reset data).
-- Klien 2.6.8 tetap berjalan (mengabaikan ops_ver); klien 2.6.9 butuh skema ini (MIN_SCHEMA).

create sequence if not exists app.ops_seq;

-- sync_events.kind: tambahkan 'ops' (nama batasan dicari dinamis; otomatis bernama sync_events_kind_check pada 0026).
do $$ declare c record; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.sync_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.sync_events drop constraint %I', c.conname);
  end loop;
  alter table public.sync_events add constraint sync_events_kind_check check (kind in ('cat', 'stock', 'ops'));
end $$;

create function app.trg_sync_ops() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cut timestamptz := clock_timestamp() - interval '200 milliseconds';   -- ke variabel (stabil) agar indeks dipakai, seperti 0029
begin
  perform nextval('app.ops_seq');   -- selalu naik: ping membaca nilai ini, jadi sinyal yang digabung tetap terlihat
  if not exists (select 1 from public.sync_events e where e.kind = 'ops' and e.outlet_id is null and e.created_at > v_cut) then
    insert into public.sync_events (outlet_id, kind) values (null, 'ops');
  end if;
  if random() < 0.01 then delete from public.sync_events where created_at < now() - interval '1 day'; end if;
  return null;
end $$;
revoke all on function app.trg_sync_ops() from public, anon, authenticated;

-- Tabel operasional: satu sinyal per perintah (bukan per baris).
do $$ declare t text; begin
  foreach t in array array['recipes', 'recipe_items', 'materials', 'suppliers', 'inventory_material_balances', 'purchases',
                           'production_orders', 'stock_transfers', 'expenses', 'cash_movements'] loop
    execute format('create trigger sync_ops_signal after insert or update or delete on public.%I for each statement execute function app.trg_sync_ops()', t);
  end loop;
end $$;

-- Sesi kas: hanya tutup/buka ulang/persetujuan (UPDATE) dan penghapusan. INSERT sengaja tidak: penjualan pertama kasir membuka sesi otomatis, dan itu
-- tidak boleh memicu pemuatan ulang di perangkat kasir yang sedang melayani.
create trigger sync_ops_signal after update or delete on public.cash_sessions for each statement execute function app.trg_sync_ops();

-- Penjualan: hanya retur baru, perubahan status/penandaan tinjau, dan penghapusan (reset data). Penjualan biasa tidak dihitung.
create trigger sync_ops_return after insert on public.sales
  for each row when (new.kind = 'return') execute function app.trg_sync_ops();
create trigger sync_ops_sale_state after update of status, review_flag on public.sales
  for each row execute function app.trg_sync_ops();
create trigger sync_ops_sale_delete after delete on public.sales
  for each statement execute function app.trg_sync_ops();

-- ping: tambah ops_ver (kunci lain tidak berubah).
create or replace function app.ping(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_o uuid := nullif(p ->> 'outlet_id', '')::uuid; v_cat text; v_stk text; v_ops text;
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
  select case when s.is_called then s.last_value::text else '0' end into v_ops from app.ops_seq s;
  return jsonb_build_object('ver', v_cat || '~' || coalesce(v_stk, ''), 'cat_ver', v_cat, 'stock_ver', coalesce(v_stk, ''), 'ops_ver', v_ops, 'time', now());
end $$;
