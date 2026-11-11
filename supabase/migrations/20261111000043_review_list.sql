-- 0043 Daftar nota bertanda "perlu ditinjau" (semua tanggal) untuk peringatan Beranda.
-- Latar belakang: angka "N transaksi perlu ditinjau" di Beranda menghitung SEMUA nota outlet yang bertanda review_flag (lintas tanggal), sedangkan Riwayat
-- hanya menampilkan satu hari, sehingga nota yang dimaksud sulit ditemukan dan tanda tidak pernah dihapus.
-- Fungsi baru (hanya menambah; tidak ada fungsi lama yang diubah):
--   app.sales_review_list(p) : nota bertanda review_flag pada outlet aktif, terbaru dulu (maks. 50), plus jumlah seluruhnya.
-- Akses: owner/admin/supervisor/auditor (sama dengan yang boleh melihat semua nota outlet). Menandai ditinjau tetap lewat sale_review (owner/admin/supervisor).
-- Kompatibilitas: klien 2.7.2 dan sebelumnya tidak memakai fungsi ini. Klien baru tetap berjalan di skema 0042 (bagian ini turun ke Riwayat biasa), jadi MIN_SCHEMA tidak dinaikkan.

create function app.sales_review_list(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_o public.outlets; v_rows jsonb; v_total int;
begin
  select * into v_o from public.outlets where id = nullif(p ->> 'outlet_id', '')::uuid;
  if not found then raise exception 'Outlet tidak ditemukan.' using errcode = 'P0002'; end if;
  perform app.require_role(v_o.id, array['owner','admin','supervisor','auditor']);
  select count(*) into v_total from public.sales s where s.outlet_id = v_o.id and s.review_flag;
  select coalesce(jsonb_agg(x order by (x ->> 'tanggal') desc, (x ->> 'id')), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', s.id, 'nomor', s.receipt_no, 'tanggal', to_char(s.sold_at at time zone v_o.timezone, 'YYYY-MM-DD HH24:MI:SS'),
             'channel_id', s.channel_id, 'metode_bayar', s.payment_method, 'total', s.total, 'ref_sale_id', s.ref_sale_id,
             'status', case s.status when 'completed' then 'selesai' else 'batal' end, 'review_note', s.review_note, 'outlet_id', s.outlet_id) as x
      from public.sales s where s.outlet_id = v_o.id and s.review_flag
     order by s.sold_at desc, s.id limit 50) q;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

create function public.rpc_sales_review_list(p jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select app.sales_review_list(p) $$;
revoke all on function public.rpc_sales_review_list(jsonb) from public, anon;
grant execute on function public.rpc_sales_review_list(jsonb) to authenticated;
revoke all on function app.sales_review_list(jsonb) from public, anon;
grant execute on function app.sales_review_list(jsonb) to authenticated;
