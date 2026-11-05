// Tes logika klien Opsi Produk (src/app/138-opsi.js) di sandbox vm tanpa DOM: label, harga, kunci baris, grup wajib, migrasi keranjang.
const fs=require('fs'),vm=require('vm'),path=require('path');
let src=fs.readFileSync(path.join(__dirname,'../src/app/138-opsi.js'),'utf8');
const ls={}; const log=[];
const ctx={S:{cart:[],ch:'c1',data:{products:[{id:'p1',nama:'Basreng',pakai_opsi:true}],variants:[{id:'v1',product_id:'p1',stok:50}],
 option_groups:[{id:'g1',nama:'Level',urutan:1},{id:'g2',nama:'Cara masak',urutan:2}],
 option_items:[{id:'a1',group_id:'g1',nama:'Level 1',selisih_harga:0},{id:'a3',group_id:'g1',nama:'Level 3',selisih_harga:500},{id:'b1',group_id:'g2',nama:'Goreng',selisih_harga:0}],
 product_options:[{product_id:'p1',group_id:'g2',wajib:true,urutan:2},{product_id:'p1',group_id:'g1',wajib:true,urutan:1,default_item_id:'a1'}]}},
 pById:id=>ctx.S.data.products.find(x=>x.id===id), vById:id=>ctx.S.data.variants.find(x=>x.id===id), priceOf:()=>10000,
 LS:{get:(k,d)=>k in ls?ls[k]:d,set:(k,v)=>{ls[k]=v}}, toast:m=>log.push(m), setTimeout:f=>f(), T:()=>false, cfg:()=>'', ACT:{}, esc:x=>x, dsOf:e=>e.dataset, $:()=>null, document:{querySelector:()=>null,querySelectorAll:()=>[]}};
vm.createContext(ctx);
vm.runInContext(src+'\nthis.X={optGroupsOf,hasOpt,optKey,optLabel,linePrice,reqMissing,optStale,cartMigrate,optIdx};',ctx);
const X=ctx.X, ok=(c,m)=>{console.log((c?'ok  ':'GAGAL ')+m); if(!c) process.exitCode=1;};
ok(X.hasOpt(ctx.vById('v1')),'produk beropsi terdeteksi');
ok(X.optGroupsOf('p1')[0].g.id==='g1','grup urut menurut urutan tautan (Level lebih dulu)');
ok(X.optLabel(['b1','a3'])==='Level 3 · Goreng','label urut grup: '+X.optLabel(['b1','a3']));
ok(X.linePrice({v:'v1',qty:1,o:['a3','b1']})===10500,'harga = channel + selisih');
ok(X.optKey(['b1','a3'])===X.optKey(['a3','b1']),'kunci baris tidak peduli urutan pilih');
ok(X.reqMissing({v:'v1',qty:1,o:['a3']})===true && X.reqMissing({v:'v1',qty:1,o:['a3','b1']})===false,'grup wajib kosong terdeteksi');
ok(X.optStale({v:'v1',qty:1,o:['zzz']})===true,'item tak aktif terdeteksi');
ctx.S.cart=[{v:'v1',qty:2}]; X.cartMigrate();
ok(ctx.S.cart.length===0 && ls.cartv===2,'keranjang format lama untuk produk beropsi dikosongkan, cartv=2');
