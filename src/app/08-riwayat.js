/* ---------- Riwayat ---------- */
async function vRiwayat() {
  const CRS = crState(), t0 = today(), day = S.day || t0; if (S.rlimDay !== day) { S.rlimDay = day; delete LIM.hist; } // hari berganti: mulai dari halaman pertama
  const yd = addDays(t0, -1), pre = S.rcustom ? 'custom' : day === t0 ? 'today' : day === yd ? 'yday' : 'custom';
  $('#main').innerHTML = wrapChips('<button class="chip ' + (pre === 'today' ? 'on' : '') + '" data-act="rday" data-p="today">Hari ini</button><button class="chip ' + (pre === 'yday' ? 'on' : '') + '" data-act="rday" data-p="yday">Kemarin</button><button class="chip ' + (pre === 'custom' ? 'on' : '') + '" data-act="rday" data-p="custom">Pilih tanggal</button>') +
    '<p class="muted rcap">' + esc(idDate(day)) + '</p>' + (pre === 'custom' ? '<label>Tanggal<input type="date" class="inp" data-chg="day" value="' + day + '"></label>' : '') + '<label class="search u-mt8">' + svg('search', 18) + '<input id="crin" type="search" class="inp" data-in="cr" placeholder="Cari nomor nota, total, atau produk" value="' + esc(CRS.q) + '" aria-label="Cari transaksi" autocomplete="off" enterkeyhint="search"></label>' +
    '<div id="crr" hidden></div><div id="crday"><div id="rq"></div><div id="rsum"></div><div id="rlist">' + skel(3) + '</div></div>';
  const qs = S.queue.map((q, i) => q.uid !== S.data.user.uid && q.by !== S.data.user.uid ? '' : '<div class="li"><div><b>' + rp(q.total) + '</b> <span class="muted">' + esc(q.ch) + ' · ' + fmtDT(q.ts).slice(11) + '</span>' + (q.ringkas ? '<div class="muted">' + esc(q.ringkas) + '</div>' : '') +
    (q.status === 'review' ? '<div class="u-err muted">' + esc(q.error) + '</div>' : '') + '</div><div class="r"><span class="tag ' + (q.status === 'review' ? 'red' : '') + '">' + (q.status === 'review' ? 'Perlu ditinjau' : 'Menunggu kirim') + '</span>' +
    (q.status === 'review' ? '<div>' + (qinfo(q).accept ? '<button class="chip" data-act="qaccept" data-i="' + i + '">Terima harga server</button> ' : '') + '<button class="chip" data-act="qretry" data-i="' + i + '">Coba lagi</button> <button class="chip" data-act="qdel" data-i="' + i + '">Hapus</button></div>' : '') + '</div></div>').join('');
  $('#rq').innerHTML = qs;
  crMode(true); // ada kata kunci tersimpan: tampilkan hasil pencarian, bukan daftar harian
  const uid = S.data.user.uid, hist = S.rhist && S.rhist.uid === uid ? S.rhist : (S.rhist = {uid: uid, d: {}}), ent = hist.d[day];
  const paint = e => {
    if (S.tab !== 'riwayat' || !$('#rlist') || !$('#rsum')) return; const rows = e.rows; S.rcur = e;
    const sm = e.sum || (() => { const dn = rows.filter(r => r.status === 'selesai'); return {omzet: dn.reduce((a, r) => a + Number(r.total), 0), nTrx: dn.filter(r => !r.ref_sale_id).length, nDone: dn.length}; })(), nTrx = sm.nTrx, omzet = sm.omzet, avg = nTrx ? omzet / nTrx : 0; // v1.9.9: ringkasan dari server (semua transaksi), bukan hanya halaman yang dimuat; // retur (nilai minus) mengurangi omzet tetapi tidak dihitung sebagai transaksi
    $('#rsum').innerHTML = '<div class="kgrid"><div class="kpi"><div class="muted">Omzet</div><b>' + rp(omzet) + '</b></div><div class="kpi"><div class="muted">Transaksi</div><b>' + nTrx + '</b></div><div class="kpi wide"><div class="muted">Rata-rata per transaksi</div><b>' + rp(avg) + '</b></div>' + (own() ? '<div class="kpi wide"><div class="muted">Produk terlaris</div><b id="rtop">' + (sm.nDone ? (e.top || 'Memuat…') : '-') + '</b></div>' : '') + '</div>';
    if (own() && sm.nDone && !e.top && !e.topReq) { e.topReq = true; api('report.get', {type: 'penjualan', from: day, to: day}, {silent: true}).then(r => { const best = r.rows.slice().sort((a, b) => b[2] - a[2])[0]; e.top = best ? esc((best[0] + ' ' + best[1]).trim()) + ' <small class="muted">' + qf(best[2]) + ' terjual</small>' : '-'; const el = $('#rtop'); if (el && S.tab === 'riwayat') el.innerHTML = e.top; }).catch(() => { const el = $('#rtop'); if (el && !e.top) el.textContent = '-'; }); }
    paintList(e);
  };
  const paintList = e => { // v1.9.8: daftar bertahap; "Tampilkan lagi" hanya menggambar ulang daftar (KPI tidak dihitung ulang)
    if (S.tab !== 'riwayat' || !$('#rlist')) return; const rows = e.rows;
    const rest = e.srv ? e.total - rows.length : 0; $('#rlist').innerHTML = (e.srv ? rows : rows.slice(0, lim('hist'))).map(r => riwayatRow(r)).join('') + (e.srv ? (rest > 0 ? '<button class="btn sec lmore" data-act="more" data-k="hist">Tampilkan ' + Math.min(rest, PGN.hist) + ' lagi (sisa ' + rest + ')</button>' : '') : moreBtn('hist', rows.length)) ||
      emptyState('riwayat', 'Belum ada transaksi', 'Tidak ada transaksi pada ' + esc(idDate(day)) + '.', '<button class="btn pri" data-act="tab" data-t="kasir">Mulai transaksi</button>');
    watchMore();
  };
  S.rlist = paintList;
  S.rmore = async () => { // halaman berikutnya dari server; hindari ganda lewat id (transaksi baru menggeser urutan)
    const e = S.rcur; if (!e || !e.srv || e.loading || e.rows.length >= e.total) return; e.loading = true;
    try { const r = await api('sales.list', {tanggal: day, limit: PGN.hist, offset: e.rows.length}, {silent: true}); if (r && r.rows) { const seen = new Set(e.rows.map(x => x.id)); r.rows.forEach(x => { if (!seen.has(x.id)) e.rows.push(x); }); e.total = r.total; } }
    catch (er) { toast('Gagal memuat transaksi berikutnya: ' + er.message); } finally { e.loading = false; if (S.rcur === e) paintList(e); }
  };
  try {
    if (ent) paint(ent); // tampil seketika dari hasil terakhir; diperbarui hanya bila ada data baru
    if (ent && navigator.onLine === false) return;
    await verSync(15000); if (S.tab !== 'riwayat' || !$('#rlist')) return; // cek versi murah dulu; muat daftar penuh hanya bila versi berubah
    const k = dverKey(); if (ent && ent.k === k) return;
    const res = await api('sales.list', {tanggal: day, limit: PGN.hist}); if (S.tab !== 'riwayat' || !$('#rlist')) return;
    const ne = Array.isArray(res) ? {k: k, rows: res} : {k: k, rows: res.rows, total: res.total, sum: res.summary, srv: true}; /* server lama menjawab larik penuh */ hist.d[day] = ne; Object.keys(hist.d).slice(0, -8).forEach(x => delete hist.d[x]); paint(ne); // maks. 8 hari disimpan di memori
  } catch (e) { if ($('#rlist') && !ent) $('#rlist').innerHTML = '<p class="muted">Tidak bisa memuat riwayat dari server (' + esc(e.message) + ').</p>'; }
}

/* ---------- Pencarian Riwayat dan detail nota (v2.7.0, migrasi 0042) ----------
   Pencarian berjalan di server (sales.search): nomor nota, total, dan nama produk/SKU/label opsi, lintas hari (hari terpilih, 7, 30, atau 90 hari ke belakang),
   dipaginasi 50 per halaman. Angka saja = nomor urut nota atau total. Mengetuk baris membuka struk lengkap dari server (sale.receipt): dapat dibagikan, dicetak ulang
   (diberi tanda SALINAN STRUK), atau diretur. Tidak berjalan offline: nota yang belum terkirim tetap terlihat di antrean. */
const CR_SPAN = [[1, 'Hari terpilih'], [7, '7 hari'], [30, '30 hari'], [90, '90 hari']];
function crState() { // keadaan pencarian per pengguna (perangkat bersama: hasil pengguna lain tidak ikut terbawa)
  const uid = S.data && S.data.user ? S.data.user.uid : '';
  if (!S.cr || S.cr.uid !== uid) S.cr = {uid: uid, q: '', span: 1, seq: 0, res: null, k: '', err: '', loading: false, t: 0};
  return S.cr;
}
function riwayatRow(r, o) { // satu nota: area utama diketuk untuk membuka struk; tombol Retur/Tinjau terpisah (tidak ikut membuka struk)
  o = o || {}; const tg = {nomor: 'Nomor', total: 'Total', produk: 'Produk'}, cc = Array.isArray(r.cocok) ? r.cocok : [], it = Array.isArray(r.items) ? r.items : [];
  const acts = (r.review && can('approve') ? '<button class="chip" data-act="sreview" data-id="' + esc(r.id) + '">Tandai ditinjau</button>' : '') +
    (r.status === 'selesai' && !r.ref_sale_id ? '<button class="chip" data-act="retur" data-id="' + esc(r.id) + '">Retur</button>' : '');
  return '<div class="li rli"><button type="button" class="rli-main" data-act="rcpt" data-id="' + esc(r.id) + '" aria-label="Lihat struk ' + esc(r.nomor) + '"><span class="rli-t"><b>' + esc(r.nomor) + '</b>' +
    (r.ref_sale_id ? ' <span class="tag red">Retur</span>' : '') + (r.review ? ' <span class="tag red">Perlu ditinjau</span>' : '') + (o.tags ? cc.map(c => ' <span class="tag">' + esc(tg[c] || c) + '</span>').join('') : '') +
    '<span class="muted rli-s">' + (o.date ? esc(idDate(r.tanggal)) + ' · ' : '') + esc(String(r.tanggal).slice(11, 16)) + ' · ' + esc(chName(r.channel_id)) + ' · ' + esc(r.metode_bayar) + '</span>' +
    (o.items && it.length ? '<span class="muted rli-s">' + it.map(x => esc(x.n) + ' ×' + qf(Math.abs(Number(x.q)))).join(', ') + (r.item_n > it.length ? ' +' + (r.item_n - it.length) + ' lagi' : '') + '</span>' : '') +
    (r.review && r.review_note ? '<span class="u-err muted rli-s">' + esc(r.review_note) + '</span>' : '') + '</span><b class="rli-n">' + rp(r.total) + '</b></button>' + (acts ? '<div class="rli-a">' + acts + '</div>' : '') + '</div>';
}
function crMode(go) { // tampilkan hasil pencarian bila ada kata kunci, selain itu daftar harian
  const R = crState(), on = !!R.q.trim(), d = $('#crday'), r = $('#crr'); if (!d || !r) return;
  d.hidden = on; r.hidden = !on; if (on) { crPaint(); if (go) crGo(false); }
}
function crType(v) { // ketikan: gabungkan ketukan beruntun (350 md) menjadi satu permintaan
  const R = crState(); R.q = String(v || '').slice(0, 60); clearTimeout(R.t);
  if (!R.q.trim()) { R.seq++; R.res = null; R.k = ''; R.err = ''; R.loading = false; return crMode(false); }
  crMode(false); R.t = setTimeout(() => crGo(false), 350);
}
async function crGo(more) {
  const R = crState(), q = R.q.trim(); if (!q || S.tab !== 'riwayat' || !$('#crr')) return;
  const to = S.day || today(), from = addDays(to, 1 - R.span), key = [q, from, to, dverKey()].join('|');
  if (!more && R.res && R.k === key) return crPaint(); // hasil masih sesuai versi data perangkat ini
  if (more && (R.loading || !R.res || R.res.rows.length >= R.res.total)) return;
  if (navigator.onLine === false) { if (more) return toast('Pencarian butuh koneksi internet'); R.res = null; R.err = 'Pencarian butuh koneksi internet. Transaksi yang belum terkirim ada di bagian Menunggu kirim pada daftar harian.'; return crPaint(); }
  const my = ++R.seq; R.loading = true; R.err = ''; if (!more) R.res = null; crPaint();
  try {
    const r = await api('sales.search', {q: q, from: from, to: to, limit: PGN.hist, offset: more ? R.res.rows.length : 0}, {silent: true});
    if (my !== R.seq) return; // pencarian lebih baru sudah berjalan
    if (more) { const seen = new Set(R.res.rows.map(x => x.id)); r.rows.forEach(x => { if (!seen.has(x.id)) R.res.rows.push(x); }); R.res.total = r.total; R.res.omzet = r.omzet; }
    else { R.res = {rows: r.rows, total: r.total, omzet: Number(r.omzet) || 0}; R.k = key; }
  } catch (e) {
    if (my !== R.seq) return; if (e.auth) { softLogout(); return; }
    if (more) toast('Gagal memuat hasil berikutnya: ' + e.message); else R.err = e.server ? e.message : 'Pencarian gagal (periksa koneksi): ' + e.message;
  } finally { if (my === R.seq) { R.loading = false; crPaint(); } }
}
function crPaint() {
  const R = crState(), el = $('#crr'); if (!el || S.tab !== 'riwayat' || !R.q.trim()) return;
  const to = S.day || today(), from = addDays(to, 1 - R.span), res = R.res;
  let body;
  if (R.err) body = '<p class="u-err">' + esc(R.err) + '</p>';
  else if (!res) body = skel(3);
  else if (!res.rows.length) body = emptyState('search', 'Tidak ada nota yang cocok', 'Coba kata lain atau lebarkan rentang tanggal. Angka dicari sebagai nomor urut nota atau total.');
  else {
    const rest = res.total - res.rows.length;
    body = '<div class="kgrid"><div class="kpi"><div class="muted">Nota cocok</div><b>' + res.total + '</b></div><div class="kpi"><div class="muted">Nilai nota (neto)</div><b>' + rp(res.omzet) + '</b></div></div>' +
      res.rows.map(r => riwayatRow(r, {date: R.span > 1, items: true, tags: true})).join('') +
      (rest > 0 ? '<button class="btn sec lmore" data-act="crmore"' + (R.loading ? ' disabled' : '') + '>Tampilkan ' + Math.min(rest, PGN.hist) + ' lagi (sisa ' + rest + ')</button>' : '');
  }
  el.innerHTML = wrapChips(CR_SPAN.map(x => '<button class="chip ' + (R.span === x[0] ? 'on' : '') + '" data-act="crspan" data-n="' + x[0] + '">' + x[1] + '</button>').join('')) +
    '<p class="muted rcap">' + (R.span > 1 ? esc(idDate(from)) + ' – ' : '') + esc(idDate(to)) + '</p>' + body;
}
async function rcptOpen(id) { // struk lengkap satu nota dari server
  if (!id) return; if (navigator.onLine === false) return toast('Detail nota butuh koneksi internet');
  let d; try { d = await api('sale.receipt', {id: id}); } catch (e) { if (e.auth) return softLogout(); return toast(e.server ? e.message : 'Tidak bisa memuat nota (periksa koneksi)'); }
  const s = d.sale, ret = s.jenis === 'return', num0 = x => Number(x) || 0, rets = d.returns || [], batal = s.status !== 'selesai';
  const rc = {rid: s.id, nomor: s.nomor, salinan: true, retur: ret, ref: String(s.ref_nomor || ''), time: num0(s.waktu_ms), kasir: String(s.kasir || ''), ch: String(s.channel || ''), metode: String(s.metode_bayar || ''),
    terima: num0(s.terima), kembali: num0(s.kembali), sub: num0(s.subtotal), dis: num0(s.diskon), ppn: num0(s.ppn_nominal), total: num0(s.total),
    lines: (d.items || []).map(l => ({n: String(l.nama || '') + (l.label ? ' (' + l.label + ')' : ''), q: num0(l.qty), h: num0(l.harga)}))};
  S.rc = rc; const tunai = rc.metode === 'tunai';
  sheet('<div class="grab"></div><h2>' + esc(s.nomor) + '</h2><p class="muted">' + esc(idDate(s.tanggal)) + ' ' + esc(String(s.tanggal).slice(11, 16)) + (rc.kasir ? ' · ' + esc(rc.kasir) : '') +
    (ret ? ' <span class="tag red">Retur</span>' : '') + (batal ? ' <span class="tag red">Batal</span>' : '') + (s.review ? ' <span class="tag red">Perlu ditinjau</span>' : '') + '</p>' +
    '<div class="rc-sum"><div><small>' + (ret ? 'Dikembalikan' : 'Total') + '</small><b>' + rp(ret ? -rc.total : rc.total) + '</b></div><div><small>' + (tunai && !ret ? 'Kembalian' : 'Metode') + '</small><b>' + (tunai && !ret ? rp(Math.max(rc.kembali, 0)) : esc(rc.metode.toUpperCase())) + '</b></div></div>' +
    (s.review && s.review_note ? '<p class="u-err muted">' + esc(s.review_note) + '</p>' : '') + (ret && s.alasan ? '<p class="muted">Alasan retur: ' + esc(s.alasan) + '</p>' : '') + (s.catatan ? '<p class="muted">Catatan: ' + esc(s.catatan) + '</p>' : '') +
    '<pre class="rc" id="rtxt"></pre>' +
    (ret && s.ref_sale_id ? '<button class="btn sec" data-act="rcpt" data-id="' + esc(s.ref_sale_id) + '">Lihat nota asal ' + esc(rc.ref) + '</button>' : '') +
    (rets.length ? '<h3 class="ri-h">Retur terkait</h3>' + rets.map(x => '<button type="button" class="li" data-act="rcpt" data-id="' + esc(x.id) + '"><div><b>' + esc(x.nomor) + '</b><div class="muted">' + esc(idDate(x.tanggal)) + ' ' + esc(String(x.tanggal).slice(11, 16)) + '</div></div><div class="r"><b>' + rp(x.total) + '</b></div></button>').join('') : '') +
    '<label>No. WhatsApp pelanggan (opsional)<input class="inp" id="wa" inputmode="tel" placeholder="08xxxxxxxxxx"></label>' +
    '<div class="row2"><button class="btn wa" data-act="wa">Kirim WhatsApp</button><button class="btn dark" data-act="rawbt">Cetak Bluetooth</button></div>' + btBox('rc') +
    '<div class="row3"><button class="btn sec sm" data-act="share">Bagikan…</button><button class="btn sec sm" data-act="copyrc">Salin</button><button class="btn sec sm" data-act="print">Cetak</button></div>' +
    (!ret && !batal ? '<button class="btn sec" data-act="retur" data-id="' + esc(s.id) + '">Retur</button>' : '') +
    (s.review && can('approve') ? '<button class="btn sec" data-act="rcpt_rev" data-id="' + esc(s.id) + '">Tandai ditinjau</button>' : '') +
    '<button class="btn pri big" data-act="close">Tutup</button>');
  refreshRc();
}
