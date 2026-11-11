#!/usr/bin/env node
// Memperkecil JS dan CSS di PAKET SITUS (bukan di repo): dipanggil oleh deploy.yml pada _site setelah tests/release_check.js lulus.
//   node tools/minify.js [folder]     bawaan: _site
// Aturan sengaja konservatif: hanya spasi dan sintaks (tanpa mengganti nama variabel), sehingga nama fungsi di jejak galat produksi tetap terbaca
// dan tidak ada risiko kopling antarberkas yang terputus. Selisih ukuran gzip dengan penggantian nama hanya sekitar 7 KB, jadi tidak sepadan.
// TIDAK disentuh: sw.js dan config.js (deploy.yml memeriksa versi tayang dari teks keduanya). Sumber di web/ tetap terbaca.
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const esbuild = require('esbuild');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '../_site'));
const JS = ['js/app.js', 'js/modules.js', 'js/sb-adapter.js'], CSS = ['css/app.css'];
const gz = s => zlib.gzipSync(s, {level: 9}).length, kb = n => (n / 1024).toFixed(1) + ' KB';
const fail = m => { console.error('GAGAL: ' + m); process.exit(1); };
const count = (s, re) => (s.match(re) || []).length;
let rawA = 0, rawB = 0, gzA = 0, gzB = 0;
const note = (f, a, b) => { rawA += a.length; rawB += b.length; gzA += gz(a); gzB += gz(b); console.log(f.padEnd(18) + kb(a.length).padStart(10) + ' ->' + kb(b.length).padStart(10) + '   (gzip ' + kb(gz(a)) + ' -> ' + kb(gz(b)) + ')'); };

for (const f of JS) {
  const p = path.join(dir, f); if (!fs.existsSync(p)) fail(f + ' tidak ada di ' + dir);
  const src = fs.readFileSync(p, 'utf8');
  const out = esbuild.transformSync(src, {loader: 'js', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, target: 'es2022', legalComments: 'none'}).code;
  if (out.length >= src.length) fail(f + ' tidak mengecil');
  try { new vm.Script(out, {filename: f}); } catch (e) { fail(f + ' hasil kecil tidak dapat diurai: ' + e.message); }
  const m = src.match(/MIN_SCHEMA\s*=\s*'(\d+)'/);                  // klien menolak skema lama: nilai ini wajib tetap ada apa adanya
  if (f.endsWith('sb-adapter.js') && (!m || !out.includes(m[1]))) fail('MIN_SCHEMA hilang dari ' + f);
  for (const k of ['data-act=', 'aria-live', 'role="dialog"']) if (count(src, new RegExp(k, 'g')) !== count(out, new RegExp(k, 'g'))) fail(f + ': jumlah "' + k + '" berubah setelah diperkecil');
  fs.writeFileSync(p, out); note(f, src, out);
}
for (const f of CSS) {
  const p = path.join(dir, f); if (!fs.existsSync(p)) fail(f + ' tidak ada di ' + dir);
  const src = fs.readFileSync(p, 'utf8');
  const out = esbuild.transformSync(src, {loader: 'css', minifyWhitespace: true, legalComments: 'none'}).code;   // tanpa minifySyntax: #hex/rgba() tidak ditulis ulang (aturan token)
  if (out.length >= src.length) fail(f + ' tidak mengecil');
  const strip = s => s.replace(/:root\s*\{[^}]*\}/, '');            // aturan MASTER.md: tidak ada #hex/rgba() di luar :root
  for (const [k, re] of [[':root', /:root\s*\{/g], ['var(--', /var\(--/g], ['#hex di luar :root', null], ['rgba di luar :root', null], ['{', /\{/g], ['}', /\}/g]]) {
    const a = re ? count(src, re) : count(strip(src), k[0] === '#' ? /#[0-9a-fA-F]{3,8}\b/g : /rgba?\(/g), b = re ? count(out, re) : count(strip(out), k[0] === '#' ? /#[0-9a-fA-F]{3,8}\b/g : /rgba?\(/g);
    if (a !== b) fail(f + ': "' + k + '" ' + a + ' -> ' + b + ' setelah diperkecil');
  }
  fs.writeFileSync(p, out); note(f, src, out);
}
console.log('-'.repeat(60) + '\nTotal'.padEnd(19) + kb(rawA).padStart(10) + ' ->' + kb(rawB).padStart(10) + '   (gzip ' + kb(gzA) + ' -> ' + kb(gzB) + ', hemat ' + Math.round((1 - gzB / gzA) * 100) + '%)');
