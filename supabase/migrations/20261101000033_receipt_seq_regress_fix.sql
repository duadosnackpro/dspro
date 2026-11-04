-- 0033 Perbaikan regresi 0028: 0032 (opsi_produk) mendefinisikan ulang app.sale_create dan app.sale_return dengan pola lama
-- lpad(v_seq::text, 3, '0'), sehingga nomor urut >= 1000 terpotong lagi dan bentrok pada indeks unik sales_receipt_key.
-- Migrasi ini mengulang penulisan ulang 0028 (idempoten: jika tidak ada pola lama, tidak melakukan apa pun).
-- Catatan: setiap migrasi berikutnya yang memakai CREATE OR REPLACE pada fungsi ini harus memakai app.seq_text(v_seq).

do $$
declare r record; d text; left_ int;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'app' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%lpad(v_seq::text, 3, ''0'')%'
  loop
    d := replace(pg_get_functiondef(r.oid), 'lpad(v_seq::text, 3, ''0'')', 'app.seq_text(v_seq)');
    execute d;
    raise notice 'diperbaiki: app.%', r.proname;
  end loop;
  select count(*) into left_ from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'app' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%lpad(v_seq::text, 3%';
  if left_ > 0 then raise exception 'Masih ada % fungsi yang memotong nomor urut (lpad v_seq).', left_; end if;
end $$;
