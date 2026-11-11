#!/usr/bin/env node
// Menjamin hasil tools/minify.js tidak merusak perilaku: menyalin repo ke folder sementara, memperkecil web/ di sana, lalu menjalankan ulang uji
// yang benar-benar MENJALANKAN berkas web/js (adapter Supabase, Realtime, Produksi). Uji lain membaca teks sumber per nama fungsi, jadi memang
// hanya valid pada sumber terbaca dan tetap dijalankan terhadap web/ asli oleh `npm test`.
const fs = require('fs'), os = require('os'), path = require('path'), {spawnSync} = require('child_process');
const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duado-min-'));
let bad = 0;
try {
  fs.cpSync(root, tmp, {recursive: true, filter: s => !/(^|[\\/])(node_modules|\.git|_site)([\\/]|$)/.test(path.relative(root, s))});
  const m = spawnSync(process.execPath, [path.join(__dirname, 'minify.js'), path.join(tmp, 'web')], {encoding: 'utf8'});
  process.stdout.write(m.stdout); if (m.status) { process.stderr.write(m.stderr); process.exit(1); }
  for (const t of ['fe_sb', 'realtime', 'produksi_ui']) {
    const r = spawnSync(process.execPath, [path.join(tmp, 'tests', t + '.js')], {cwd: tmp, encoding: 'utf8'});
    const last = (r.stdout.trim().split('\n').pop() || '').trim();
    console.log((r.status ? 'GAGAL  ' : 'lulus  ') + t + (last ? '  (' + last + ')' : '')); if (r.status) { bad++; process.stderr.write(r.stdout + r.stderr); }
  }
} finally { fs.rmSync(tmp, {recursive: true, force: true}); }
if (bad) { console.error('Uji pada hasil perkecil GAGAL'); process.exit(1); }
console.log('Hasil perkecil lulus uji perilaku');
