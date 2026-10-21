/* CatatanKu v1.0.0 - offline notes */
(function(){
"use strict";
var LS_KEY = "catatanku_v1";
var FOLDER_COLORS = ["#8b7cf6","#4da3ff","#3ecf8e","#ffb020","#ff6b81","#b678f0","#38c6d9","#ff8a5c"];

var state = { notes:[], folders:[], theme:"dark", onboarded:false,
  filter:{ q:"", folder:"all" }, secret:{pinHash:null,salt:null,bio:false,totp:null}, mascot:0, sort:"baru" };
var editingId = null, dirtyCheck = "";
var folderTouched = false; /* true jika user manual pilih folder di editor */
var listVisible = false;   /* home = maskot saja; true = tampil daftar */
var searchMode = false;

/* ---------- storage ---------- */
function load(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(raw){ var d = JSON.parse(raw);
      state.notes = d.notes||[]; state.folders = d.folders||[];
      state.theme = d.theme||"dark"; state.onboarded = !!d.onboarded;
      state.secret = (d.secret&&typeof d.secret==="object") ? d.secret : {pinHash:null,salt:null,bio:false,totp:null};
      state.trash = d.trash||[];
      state.mascot = d.mascot||0;
      state.sort = d.sort||"baru";
    }
  }catch(e){}
}
function save(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({
    notes:state.notes, folders:state.folders,
    theme:state.theme, onboarded:state.onboarded, secret:state.secret, trash:state.trash, mascot:state.mascot, sort:state.sort })); }catch(e){}
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,
  function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

/* ---------- helpers ---------- */
function $(id){ return document.getElementById(id); }
var toastTimer = null;
function toast(msg){
  var t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.add("hidden"); }, 2200);
}
function fmtDate(ts){
  var d = new Date(ts), now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  var y = new Date(now); y.setDate(now.getDate()-1);
  var time = ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);
  if(sameDay) return "Hari ini "+time;
  if(d.toDateString() === y.toDateString()) return "Kemarin "+time;
  return d.getDate()+"/"+(d.getMonth()+1)+"/"+d.getFullYear()+" "+time;
}
function folderById(id){ return state.folders.find(function(f){return f.id===id;}); }
var LINK_FOLDER_ID = "folder-link"; /* legacy v1.1.x, dimigrasi */
var DOMAIN_NAMES = {
  "youtube.com":"YouTube","youtu.be":"YouTube","m.youtube.com":"YouTube",
  "tiktok.com":"TikTok","vt.tiktok.com":"TikTok","vm.tiktok.com":"TikTok",
  "instagram.com":"Instagram",
  "threads.com":"Threads","threads.net":"Threads",
  "x.com":"X","twitter.com":"X","mobile.twitter.com":"X",
  "facebook.com":"Facebook","fb.watch":"Facebook",
  "douyin.com":"Douyin","v.douyin.com":"Douyin",
  "bilibili.tv":"Bilibili","bilibili.com":"Bilibili",
  "t.me":"Telegram","telegram.me":"Telegram"
};
function hostOf(u){
  try{ return new URL(u).hostname.replace(/^www\./,"").toLowerCase(); }
  catch(e){ return ""; }
}
function prettyDomain(host){
  if(DOMAIN_NAMES[host]) return DOMAIN_NAMES[host];
  var base = (host.split(".")[0]||host);
  return base.charAt(0).toUpperCase()+base.slice(1);
}
function findOrCreateDomainFolder(url){
  var host = hostOf(url) || "link";
  var fid = "fld-dom-" + host.replace(/[^a-z0-9]/g,"-");
  var f = state.folders.find(function(x){return x.id===fid;});
  if(!f){
    var h=0; for(var i=0;i<host.length;i++) h=(h*31+host.charCodeAt(i))%997;
    f = {id:fid, name:prettyDomain(host),
      color:FOLDER_COLORS[h%FOLDER_COLORS.length], icon:"🔗"};
    state.folders.push(f);
  }
  return f;
}
var CATATAN_FOLDER_ID = "folder-catatan";
function ensureCatatanFolder(){
  var f = state.folders.find(function(x){return x.id===CATATAN_FOLDER_ID;});
  if(!f){
    f = {id:CATATAN_FOLDER_ID, name:"Catatan", color:"#8b7cf6", icon:"📝"};
    state.folders.unshift(f);
  }
  return f;
}
function extractURLs(text){
  var m = String(text||"").match(/https?:\/\/[^\s]+/gi);
  return m || [];
}
/* migrasi: link lama dari folder "Link" dipindah ke folder per domain */
function migrateLinkFolder(){
  var moved = false;
  state.notes.forEach(function(n){
    if(n.isLink && n.body && isURL(n.body) && n.folderId!==SECRET_FOLDER_ID){
      var f = findOrCreateDomainFolder(n.body);
      if(n.folderId!==f.id){ n.folderId=f.id; moved=true; }
    }
  });
  if(state.folders.some(function(f){return f.id===LINK_FOLDER_ID;}) &&
     !state.notes.some(function(n){return n.folderId===LINK_FOLDER_ID;})){
    state.folders = state.folders.filter(function(f){return f.id!==LINK_FOLDER_ID;});
    moved = true;
  }
  if(moved) save();
}
function isURL(s){ return /^(https?:\/\/[^\s]+)$/i.test(String(s||"").trim()); }
var EMAIL_FOLDER_ID = "folder-email";
function extractEmails(text){
  var m = String(text||"").match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return m || [];
}
function isEmail(s){
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(String(s||"").trim());
}
function findOrCreateEmailFolder(){
  var f = folderById(EMAIL_FOLDER_ID);
  if(!f){
    f = { id:EMAIL_FOLDER_ID, name:"Email", color:"#4da3ff", icon:"📧" };
    state.folders.push(f); save();
  }
  return f;
}
function domainOf(u){
  try{ return new URL(u).hostname.replace(/^www\./,""); }
  catch(e){ return u; }
}

/* ---------- TOTP authenticator (kunci folder rahasia), murni offline ---------- */
var B32ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(bytes){
  var out="", bits=0, val=0, i;
  for(i=0;i<bytes.length;i++){ val=(val<<8)|bytes[i]; bits+=8;
    while(bits>=5){ out+=B32ABC[(val>>>(bits-5))&31]; bits-=5; } }
  if(bits>0) out+=B32ABC[(val<<(5-bits))&31];
  while(out.length%8) out+="=";
  return out;
}
function b32decode(s){
  s=String(s).replace(/=+$/,"").toUpperCase().replace(/[^A-Z2-7]/g,"");
  var out=[], bits=0, val=0, i, idx;
  for(i=0;i<s.length;i++){ idx=B32ABC.indexOf(s.charAt(i)); if(idx<0) continue;
    val=(val<<5)|idx; bits+=5;
    if(bits>=8){ out.push((val>>>(bits-8))&255); bits-=8; } }
  return out;
}
function sha1(msgBytes){
  var K=[0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xca62c1d6];
  var H=[0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0];
  var l=msgBytes.length, bytes=msgBytes.slice(), i, off;
  bytes.push(0x80);
  while((bytes.length%64)!==56) bytes.push(0x00);
  var bitLen=l*8, hi=Math.floor(bitLen/0x100000000), lo=bitLen>>>0;
  bytes.push((hi>>>24)&255,(hi>>>16)&255,(hi>>>8)&255,hi&255,
             (lo>>>24)&255,(lo>>>16)&255,(lo>>>8)&255,lo&255);
  var w=new Array(80);
  function rol(x,n){ return ((x<<n)|(x>>>(32-n)))>>>0; }
  for(off=0;off<bytes.length;off+=64){
    for(i=0;i<16;i++)
      w[i]=((bytes[off+i*4]<<24)|(bytes[off+i*4+1]<<16)|(bytes[off+i*4+2]<<8)|bytes[off+i*4+3])>>>0;
    for(i=16;i<80;i++) w[i]=rol(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f,k,t;
    for(i=0;i<80;i++){
      if(i<20){ f=(b&c)|((~b)&d); k=K[0]; }
      else if(i<40){ f=b^c^d; k=K[1]; }
      else if(i<60){ f=(b&c)|(b&d)|(c&d); k=K[2]; }
      else { f=b^c^d; k=K[3]; }
      t=(rol(a,5)+f+e+k+w[i])>>>0;
      e=d; d=c; c=rol(b,30); b=a; a=t;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0;
    H[3]=(H[3]+d)>>>0; H[4]=(H[4]+e)>>>0;
  }
  var out=[];
  for(i=0;i<5;i++) out.push((H[i]>>>24)&255,(H[i]>>>16)&255,(H[i]>>>8)&255,H[i]&255);
  return out;
}
function sha256(str){
  var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var b=[], i;
  for(i=0;i<str.length;i++) b.push(str.charCodeAt(i)&255);
  var bitLen=b.length*8;
  b.push(0x80);
  while(b.length%64!==56) b.push(0);
  b.push(0,0,0,0,(bitLen>>>24)&255,(bitLen>>>16)&255,(bitLen>>>8)&255,bitLen&255);
  function rotr(x,n){ return (x>>>n)|(x<<(32-n)); }
  var w=new Array(64);
  for(var off=0; off<b.length; off+=64){
    for(i=0;i<16;i++) w[i]=((b[off+i*4]<<24)|(b[off+i*4+1]<<16)|(b[off+i*4+2]<<8)|b[off+i*4+3])>>>0;
    for(i=16;i<64;i++){
      var s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3);
      var s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    var a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(i=0;i<64;i++){
      var S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
      var ch=(e&f)^((~e)&g);
      var t1=(h+S1+ch+K[i]+w[i])>>>0;
      var S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
      var maj=(a&bb)^(a&c)^(bb&c);
      var t2=(S0+maj)>>>0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=bb; bb=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+bb)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  var out="";
  for(i=0;i<8;i++) out+=("00000000"+H[i].toString(16)).slice(-8);
  return out;
}
function hmacSha1(key,msg){
  var B=64,i;
  if(key.length>B) key=sha1(key);
  key=key.slice(); while(key.length<B) key.push(0);
  var o=[],pp=[];
  for(i=0;i<B;i++){ o.push(key[i]^0x5c); pp.push(key[i]^0x36); }
  return sha1(o.concat(sha1(pp.concat(msg))));
}
function totpCode(secretB32,when){
  var key=b32decode(secretB32);
  var c=Math.floor((when||Date.now())/30000);
  var msg=[0,0,0,0,(c>>>24)&255,(c>>>16)&255,(c>>>8)&255,c&255];
  var h=hmacSha1(key,msg), off=h[19]&0x0f;
  var code=(((h[off]&0x7f)<<24)|((h[off+1]&255)<<16)|((h[off+2]&255)<<8)|(h[off+3]&255))%1000000;
  return ("000000"+code).slice(-6);
}
function totpVerify(secretB32,input,nowMs){
  input=String(input||"").replace(/\D/g,"");
  if(!secretB32 || input.length!==6) return false;
  var now=(nowMs==null?Date.now():nowMs), w;
  for(w=-1;w<=1;w++) if(totpCode(secretB32,now+w*30000)===input) return true;
  return false;
}
function genTotpSecret(){
  var b=[], i, n=20;
  try{
    var u=new Uint8Array(n);
    (window.crypto||window.msCrypto).getRandomValues(u);
    for(i=0;i<n;i++) b.push(u[i]);
  }catch(e){ for(i=0;i<n;i++) b.push(Math.floor(Math.random()*256)); }
  return b32encode(b).replace(/=+$/,"");
}

/* ---------- folder rahasia ---------- */
var SECRET_FOLDER_ID = "folder-rahasia";
var secretUnlocked = false;
function ensureSecretFolder(){
  var f = state.folders.find(function(x){return x.id===SECRET_FOLDER_ID;});
  if(!f){
    f = {id:SECRET_FOLDER_ID, name:"Rahasia", color:"#e5484d", icon:"🔒"};
    state.folders.unshift(f);
  }
  return f;
}
function openURL(u){
  if(window.AndroidBridge && AndroidBridge.openLink) AndroidBridge.openLink(u);
  else window.open(u, "_blank");
}

/* ---------- theme ---------- */
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
  $("btn-theme").textContent = state.theme==="dark" ? "🌙" : "☀️";
}
function toggleTheme(){
  state.theme = state.theme==="dark" ? "light" : "dark";
  applyTheme(); save();
}

/* ---------- dialog ---------- */
var dlgOkCb = null, dlgCancelCb = null;
function openDialog(title, bodyHTML, okLabel, cb, onCancel){
  $("dlg-title").textContent = title;
  $("dlg-body").innerHTML = bodyHTML;
  $("dlg-ok").textContent = okLabel || "OK";
  dlgOkCb = cb || null; dlgCancelCb = onCancel || null;
  $("dialog-wrap").classList.remove("hidden");
  var inp = $("dlg-body").querySelector("input");
  if(inp) setTimeout(function(){ inp.focus(); }, 120);
}
function closeDialog(){ $("dialog-wrap").classList.add("hidden"); dlgOkCb = null; dlgCancelCb = null; }
$("dlg-cancel").addEventListener("click", function(){
  var cb = dlgCancelCb; closeDialog(); if(cb) cb();
});
$("dlg-ok").addEventListener("click", function(){
  var cb = dlgOkCb; closeDialog(); if(cb) cb();
});
$("dialog-wrap").addEventListener("click", function(e){
  if(e.target === this) closeDialog();
});

/* ---------- drawer ---------- */
function openDrawer(){ renderDrawerFolders(); renderStats();
  $("drawer").classList.add("open"); $("scrim").classList.remove("hidden"); }
function closeDrawer(){ $("drawer").classList.remove("open"); $("scrim").classList.add("hidden"); }
/* geser drawer untuk tutup/buka (pakai touchmove, lebih andal) */
(function(){
  var sx=null, sy=null;
  document.addEventListener("touchstart", function(e){
    var t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
  }, {passive:true});
  document.addEventListener("touchmove", function(e){
    if(sx===null) return;
    var t = e.touches[0];
    var dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
    if(dy > 70) return;
    var open = $("drawer").classList.contains("open");
    if(open && dx < -70){ closeDrawer(); sx=null; }
    else if(!open && sx < 28 && dx > 70 &&
      $("dialog-wrap").classList.contains("hidden") &&
      !(e.target && e.target.closest && e.target.closest(".chips"))){
      openDrawer(); sx=null;
    }
  }, {passive:true});
  document.addEventListener("touchend", function(){ sx=null; }, {passive:true});
})();
$("btn-menu").addEventListener("click", openDrawer);
$("scrim").addEventListener("click", closeDrawer);
$("nav-pin").addEventListener("click", function(){
  if(selectMode) exitSelectMode();
  secretUnlocked = false;
  closeDrawer();
  state.filter.folder = "pinned"; state.filter.q = "";
  searchMode = false; listVisible = true;
  renderHome();
});
$("btn-select").addEventListener("click", function(){
  selectMode = true; selectedIds = {};
  $("btn-select").classList.add("hidden");
  $("btn-sel-all").classList.remove("hidden");
  $("btn-move-sel").classList.remove("hidden");
  $("btn-exp-sel").classList.remove("hidden");
  $("btn-del-sel").classList.remove("hidden");
  renderHome(); updateSelectUI();
});
$("btn-sort").addEventListener("click", function(){
  var html = SORTS.map(function(o){
    var cur = (state.sort||"baru")===o.id;
    return '<button class="move-folder-item" data-sort="'+o.id+'">'+
      '<span>'+(cur?"\u2713 ":"")+'</span><span>'+o.label+'</span></button>';
  }).join("");
  openDialog("Urutkan", '<div class="move-list">'+html+'</div>', "Tutup", null);
  document.querySelectorAll("[data-sort]").forEach(function(b){
    b.addEventListener("click", function(){
      state.sort = b.getAttribute("data-sort");
      save(); closeDialog(); renderHome();
      toast("Urutan: "+sortLabel());
    });
  });
});
$("btn-sel-all").addEventListener("click", function(){
  var notes = filteredNotes();
  var allSel = notes.length>0 && notes.every(function(n){ return selectedIds[n.id]; });
  if(allSel) selectedIds = {};
  else notes.forEach(function(n){ selectedIds[n.id] = 1; });
  renderHome(); updateSelectUI();
});
$("btn-move-sel").addEventListener("click", function(){
  var ids = Object.keys(selectedIds);
  if(!ids.length) return;
  var html = state.folders.map(function(f){
    var lock = f.id===SECRET_FOLDER_ID ? "\uD83D\uDD12 " : "";
    return '<button class="move-folder-item" data-fid="'+f.id+'">'+
      '<span class="dot" style="background:'+f.color+'"></span>'+
      '<span>'+lock+esc(f.name)+'</span></button>';
  }).join("");
  openDialog("Pindah ke folder", '<div class="move-list">'+html+'</div>', "Tutup", null);
  var items = document.querySelectorAll(".move-folder-item");
  items.forEach(function(b){
    b.addEventListener("click", function(){
      var fid = b.getAttribute("data-fid");
      closeDialog();
      moveSelectedTo(fid);
    });
  });
});
function moveSelectedTo(fid){
  var ids = Object.keys(selectedIds);
  if(!ids.length) return;
  var f = folderById(fid);
  var isTrash = state.filter.folder===TRASH_ID;
  if(isTrash){
    var moved = [];
    state.trash = state.trash.filter(function(t){
      if(ids.indexOf(t.id)>=0){ moved.push(t); return false; }
      return true;
    });
    moved.forEach(function(t){
      state.notes.push({ id:t.id, title:t.title, body:t.body, folderId:fid,
        pinned:!!t.pinned, created:t.created, updated:Date.now(), isLink:!!t.isLink });
    });
  } else {
    ids.forEach(function(id){
      var n = state.notes.find(function(x){ return x.id===id; });
      if(n){ n.folderId = fid; n.updated = Date.now(); }
    });
  }
  exitSelectMode();
  save(); renderHome(); renderStats();
  toast(ids.length+" dipindah ke "+(f?f.name:"folder")+(fid===SECRET_FOLDER_ID?" \uD83D\uDD12":""));
}
$("btn-export").addEventListener("click", function(){
  try{ AndroidBridge.exportPdf($("ed-title").value.trim(), $("ed-body").value); }
  catch(e){ toast("Gagal ekspor"); }
});
$("btn-exp-sel").addEventListener("click", function(){
  var ids = Object.keys(selectedIds);
  if(!ids.length) return;
  var src = state.filter.folder===TRASH_ID ? state.trash : state.notes;
  var items = [];
  ids.forEach(function(id){
    var n = src.find(function(x){ return x.id===id; });
    if(n) items.push({title:n.title||"", body:n.body||""});
  });
  try{ AndroidBridge.exportPdfBulk(JSON.stringify(items)); }
  catch(e){ toast("Gagal ekspor"); }
});
$("btn-del-sel").addEventListener("click", function(){
  var ids = Object.keys(selectedIds);
  if(!ids.length) return;
  var isTrash = state.filter.folder===TRASH_ID;
  openDialog(isTrash?"Hapus permanen?":"Hapus "+ids.length+" catatan?",
    ids.length+" catatan akan "+(isTrash?"dihapus permanen":"dipindah ke sampah")+".",
    "Hapus", function(){
      ids.forEach(function(id){ if(isTrash) deleteForever(id); else moveToTrash(id); });
      exitSelectMode();
      save(); renderHome(); renderStats();
      toast(isTrash?"Dihapus permanen":"Dipindah ke sampah");
    });
});
function updateSelectUI(){
  var c = Object.keys(selectedIds).length;
  $("subhead-title").textContent = c ? c+" dipilih" : "Pilih catatan";
  $("btn-del-sel").classList.toggle("hidden", !c);
}
function exitSelectMode(){
  selectMode = false; selectedIds = {};
  $("btn-select").classList.remove("hidden");
  $("btn-sel-all").classList.add("hidden");
  $("btn-move-sel").classList.add("hidden");
  $("btn-exp-sel").classList.add("hidden");
  $("btn-del-sel").classList.add("hidden");
}
$("nav-trash").addEventListener("click", function(){
  if(selectMode) exitSelectMode();
  secretUnlocked = false;
  closeDrawer();
  state.filter.folder = TRASH_ID; state.filter.q = "";
  var si = $("search-input"); if(si) si.value = "";
  searchMode = false; listVisible = true;
  renderHome();
});

function renderStats(){
  var visN = secretUnlocked ? state.notes.length :
    state.notes.filter(function(n){return n.folderId!==SECRET_FOLDER_ID;}).length;
  $("drawer-stats").textContent = visN + " catatan · " +
    state.folders.length + " folder";
}
function renderDrawerFolders(){
  var box = $("drawer-folders"); box.innerHTML = "";
  state.folders.forEach(function(f){
    var n = state.notes.filter(function(x){return x.folderId===f.id;}).length;
    var b = document.createElement("div");
    b.className = "drawer-item"; b.style.cursor = "default";
    var isSec = f.id===SECRET_FOLDER_ID;
    b.innerHTML = '<span class="dot" style="background:'+f.color+'"></span>'+
      '<span data-open="'+f.id+'" style="flex:1">'+
      (f.icon?esc(f.icon)+" ":"")+esc(f.name)+'</span>'+
      (isSec
        ? (secretUnlocked ? '<span class="cnt">'+n+'</span>' : '')
        : '<span class="cnt">'+n+'</span><button class="del" data-del="'+f.id+'">✕</button>');
    box.appendChild(b);
  });
  /* ketuk: buka isi folder | tahan lama: ubah nama */
  box.querySelectorAll("[data-open]").forEach(function(sp){
    var f = folderById(sp.getAttribute("data-open"));
    var lpTimer=null, lpFired=false;
    sp.addEventListener("touchstart", function(){
      lpFired=false;
      lpTimer=setTimeout(function(){
        lpFired=true; closeDrawer();
        if(f.id===SECRET_FOLDER_ID) openSecretReset(); else openFolderDialog(f);
      }, 550);
    }, {passive:true});
    ["touchend","touchmove","touchcancel"].forEach(function(ev){
      sp.addEventListener(ev, function(){ clearTimeout(lpTimer); }, {passive:true});
    });
    sp.addEventListener("click", function(){
      if(lpFired || !f) return;
      if(f.id===SECRET_FOLDER_ID){ openSecretFolder(); return; }
      if(selectMode) exitSelectMode();
      secretUnlocked = false;
      closeDrawer();
      state.filter.folder = f.id; state.filter.q = "";
      var si = $("search-input"); if(si) si.value = "";
      searchMode = false; listVisible = true;
      renderHome();
    });
  });
  box.querySelectorAll("[data-del]").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      var fid = btn.getAttribute("data-del");
      var f = folderById(fid);
      openDialog("Hapus folder?", 'Folder "<b>'+esc(f.name)+
        '</b>" akan dihapus. Catatan di dalamnya tidak ikut terhapus.',
        "Hapus", function(){
          state.folders = state.folders.filter(function(x){return x.id!==fid;});
          state.notes.forEach(function(n){ if(n.folderId===fid) n.folderId=null; });
          if(state.filter.folder===fid){ listVisible=false; state.filter.folder="all"; }
          save(); renderAll(); renderDrawerFolders(); renderStats();
          toast("Folder dihapus");
        });
    });
  });
}

/* ---------- tong sampah ---------- */
var TRASH_ID = "__trash";
var selectMode = false, selectedIds = {};
var TRASH_DAYS = 30;
function purgeTrash(){
  var cutoff = Date.now() - TRASH_DAYS*24*3600*1000;
  var before = state.trash.length;
  state.trash = state.trash.filter(function(t){ return t.deletedAt >= cutoff; });
  if(state.trash.length!==before) save();
}
function moveToTrash(id){
  var i = state.notes.findIndex(function(x){return x.id===id;});
  if(i<0) return false;
  var n = state.notes[i];
  n.deletedAt = Date.now();
  state.trash.push(n);
  state.notes.splice(i,1);
  save(); return true;
}
function restoreFromTrash(id){
  var i = state.trash.findIndex(function(x){return x.id===id;});
  if(i<0) return;
  var n = state.trash[i];
  delete n.deletedAt;
  if(n.folderId && n.folderId!==SECRET_FOLDER_ID && !folderById(n.folderId)) n.folderId = null;
  state.notes.push(n);
  state.trash.splice(i,1);
  save();
}
function deleteForever(id){
  state.trash = state.trash.filter(function(x){return x.id!==id;});
  save();
}

/* ---------- maskot: 5 pilihan ---------- */
var MASCOTS=[
{name:"Memo",svg:'<svg viewBox="0 0 200 200" class="mascot"><ellipse class="m-shadow" cx="100" cy="182" rx="50" ry="9" fill="rgba(0,0,0,.4)"/><g class="m-bob"><rect x="58" y="48" width="84" height="106" rx="20" fill="#FFD66E"/><rect x="58" y="48" width="84" height="42" rx="20" fill="#ffffff" opacity=".16"/><polygon points="122,48 142,48 122,68" fill="#F0B429"/><g class="m-arm-l"><rect x="44" y="98" width="14" height="34" rx="7" fill="#FFD66E"/></g><g class="m-arm-r"><rect x="142" y="98" width="14" height="34" rx="7" fill="#FFD66E"/></g><ellipse cx="82" cy="160" rx="13" ry="7" fill="#F0B429"/><ellipse cx="118" cy="160" rx="13" ry="7" fill="#F0B429"/><g class="eye"><ellipse cx="84" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="86" cy="93" r="2.2" fill="#fff"/></g><g class="eye"><ellipse cx="116" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="118" cy="93" r="2.2" fill="#fff"/></g><ellipse cx="72" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><ellipse cx="128" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><path class="m-smile" d="M90 110 Q100 119 110 110" stroke="#2B2440" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse class="m-mouth-open" cx="100" cy="117" rx="8" ry="10" fill="#5B3A1E"/></g><g class="tw" style="animation-delay:.4s"><path d="M30 52 l2.5 5.5 5.5 2.5 -5.5 2.5 -2.5 5.5 -2.5 -5.5 -5.5 -2.5 5.5 -2.5 z" fill="#fff"/></g><g class="tw" style="animation-delay:1.6s"><path d="M170 76 l2 4.4 4.4 2 -4.4 2 -2 4.4 -2 -4.4 -4.4 -2 4.4 -2 z" fill="#B9A8FF"/></g></svg>'},
{name:"Bibo",svg:'<svg viewBox="0 0 200 200" class="mascot"><ellipse class="m-shadow" cx="100" cy="182" rx="50" ry="9" fill="rgba(0,0,0,.4)"/><g class="m-bob"><rect x="60" y="50" width="80" height="102" rx="14" fill="#6BA8FF"/><rect x="60" y="50" width="18" height="102" rx="9" fill="#4A86D8"/><rect x="86" y="66" width="42" height="6" rx="3" fill="#ffffff" opacity=".5"/><rect x="86" y="78" width="32" height="6" rx="3" fill="#ffffff" opacity=".35"/><g class="m-arm-l"><rect x="46" y="98" width="14" height="34" rx="7" fill="#6BA8FF"/></g><g class="m-arm-r"><rect x="140" y="98" width="14" height="34" rx="7" fill="#6BA8FF"/></g><ellipse cx="84" cy="158" rx="13" ry="7" fill="#4A86D8"/><ellipse cx="116" cy="158" rx="13" ry="7" fill="#4A86D8"/><g class="eye"><ellipse cx="84" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="86" cy="93" r="2.2" fill="#fff"/></g><g class="eye"><ellipse cx="116" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="118" cy="93" r="2.2" fill="#fff"/></g><ellipse cx="72" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><ellipse cx="128" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><path class="m-smile" d="M90 110 Q100 119 110 110" stroke="#2B2440" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse class="m-mouth-open" cx="100" cy="117" rx="8" ry="10" fill="#5B3A1E"/></g><g class="tw" style="animation-delay:.4s"><path d="M30 52 l2.5 5.5 5.5 2.5 -5.5 2.5 -2.5 5.5 -2.5 -5.5 -5.5 -2.5 5.5 -2.5 z" fill="#fff"/></g><g class="tw" style="animation-delay:1.6s"><path d="M170 76 l2 4.4 4.4 2 -4.4 2 -2 4.4 -2 -4.4 -4.4 -2 4.4 -2 z" fill="#B9A8FF"/></g></svg>'},
{name:"Pip",svg:'<svg viewBox="0 0 200 200" class="mascot"><ellipse class="m-shadow" cx="100" cy="182" rx="50" ry="9" fill="rgba(0,0,0,.4)"/><g class="m-bob"><rect x="78" y="30" width="44" height="14" rx="7" fill="#FF9D9D"/><rect x="78" y="42" width="44" height="12" fill="#C0C7D1"/><rect x="78" y="54" width="44" height="78" rx="8" fill="#58CC7A"/><polygon points="78,132 122,132 100,158" fill="#F5D7A8"/><polygon points="93,147 107,147 100,158" fill="#2B2440"/><g class="m-arm-l"><rect x="64" y="88" width="14" height="32" rx="7" fill="#58CC7A"/></g><g class="m-arm-r"><rect x="122" y="88" width="14" height="32" rx="7" fill="#58CC7A"/></g><g class="eye"><ellipse cx="84" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="86" cy="93" r="2.2" fill="#fff"/></g><g class="eye"><ellipse cx="116" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="118" cy="93" r="2.2" fill="#fff"/></g><ellipse cx="72" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><ellipse cx="128" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><path class="m-smile" d="M90 110 Q100 119 110 110" stroke="#2B2440" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse class="m-mouth-open" cx="100" cy="117" rx="8" ry="10" fill="#5B3A1E"/></g><g class="tw" style="animation-delay:.4s"><path d="M30 52 l2.5 5.5 5.5 2.5 -5.5 2.5 -2.5 5.5 -2.5 -5.5 -5.5 -2.5 5.5 -2.5 z" fill="#fff"/></g><g class="tw" style="animation-delay:1.6s"><path d="M170 76 l2 4.4 4.4 2 -4.4 2 -2 4.4 -2 -4.4 -4.4 -2 4.4 -2 z" fill="#B9A8FF"/></g></svg>'},
{name:"Mochi",svg:'<svg viewBox="0 0 200 200" class="mascot"><ellipse class="m-shadow" cx="100" cy="182" rx="50" ry="9" fill="rgba(0,0,0,.4)"/><g class="m-bob"><rect x="52" y="52" width="96" height="84" rx="24" fill="#B678F0"/><polygon points="72,130 64,154 94,130" fill="#B678F0"/><g class="m-arm-l"><rect x="38" y="88" width="14" height="32" rx="7" fill="#B678F0"/></g><g class="m-arm-r"><rect x="148" y="88" width="14" height="32" rx="7" fill="#B678F0"/></g><ellipse cx="80" cy="150" rx="12" ry="6" fill="#9660D1"/><ellipse cx="120" cy="150" rx="12" ry="6" fill="#9660D1"/><g class="eye"><ellipse cx="84" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="86" cy="93" r="2.2" fill="#fff"/></g><g class="eye"><ellipse cx="116" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="118" cy="93" r="2.2" fill="#fff"/></g><ellipse cx="72" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><ellipse cx="128" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><path class="m-smile" d="M90 110 Q100 119 110 110" stroke="#2B2440" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse class="m-mouth-open" cx="100" cy="117" rx="8" ry="10" fill="#5B3A1E"/></g><g class="tw" style="animation-delay:.4s"><path d="M30 52 l2.5 5.5 5.5 2.5 -5.5 2.5 -2.5 5.5 -2.5 -5.5 -5.5 -2.5 5.5 -2.5 z" fill="#fff"/></g><g class="tw" style="animation-delay:1.6s"><path d="M170 76 l2 4.4 4.4 2 -4.4 2 -2 4.4 -2 -4.4 -4.4 -2 4.4 -2 z" fill="#B9A8FF"/></g></svg>'},
{name:"Kiko",svg:'<svg viewBox="0 0 200 200" class="mascot"><ellipse class="m-shadow" cx="100" cy="182" rx="50" ry="9" fill="rgba(0,0,0,.4)"/><g class="m-bob"><rect x="54" y="64" width="92" height="72" rx="10" fill="#FF9E5C"/><path d="M60 74 L100 106 L140 74" fill="none" stroke="#E07B39" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><g class="m-arm-l"><rect x="40" y="94" width="14" height="32" rx="7" fill="#FF9E5C"/></g><g class="m-arm-r"><rect x="146" y="94" width="14" height="32" rx="7" fill="#FF9E5C"/></g><ellipse cx="82" cy="142" rx="12" ry="6" fill="#E07B39"/><ellipse cx="118" cy="142" rx="12" ry="6" fill="#E07B39"/><g class="eye"><ellipse cx="84" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="86" cy="93" r="2.2" fill="#fff"/></g><g class="eye"><ellipse cx="116" cy="96" rx="6.5" ry="8.5" fill="#2B2440"/><circle cx="118" cy="93" r="2.2" fill="#fff"/></g><ellipse cx="72" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><ellipse cx="128" cy="112" rx="7" ry="4.5" fill="#FF9D9D" opacity=".65"/><path class="m-smile" d="M90 110 Q100 119 110 110" stroke="#2B2440" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse class="m-mouth-open" cx="100" cy="117" rx="8" ry="10" fill="#5B3A1E"/></g><g class="tw" style="animation-delay:.4s"><path d="M30 52 l2.5 5.5 5.5 2.5 -5.5 2.5 -2.5 5.5 -2.5 -5.5 -5.5 -2.5 5.5 -2.5 z" fill="#fff"/></g><g class="tw" style="animation-delay:1.6s"><path d="M170 76 l2 4.4 4.4 2 -4.4 2 -2 4.4 -2 -4.4 -4.4 -2 4.4 -2 z" fill="#B9A8FF"/></g></svg>'}
];
function renderMascot(){
  var wrap = document.querySelector('#empty-state .mascot-wrap');
  if(!wrap) return;
  wrap.innerHTML = '<div class="mascot-walk">'+MASCOTS[state.mascot||0].svg+'</div>';
  renderMascotPicker();
}
function mascotWalkPause(p){
  var w = document.querySelector("#empty-state .mascot-walk");
  if(w) w.classList.toggle("paused", !!p);
}
document.addEventListener("click", function(e){
  var w = e.target.closest && e.target.closest("#empty-state .mascot-wrap");
  if(!w) return;
  var svg = w.querySelector(".mascot");
  if(!svg || svg.classList.contains("jump") || svg.classList.contains("eat")) return;
  svg.classList.add("jump");
  setTimeout(function(){ svg.classList.remove("jump"); }, 750);
});
function renderMascotPicker(){
  var box = $('mascot-row'); if(!box) return;
  box.innerHTML = '';
  MASCOTS.forEach(function(m, i){
    var b = document.createElement('button');
    b.className = 'mascot-pick' + (i===(state.mascot||0) ? ' sel' : '');
    b.innerHTML = m.svg + '<div class="m-name">'+m.name+'</div>';
    b.addEventListener('click', function(){
      state.mascot = i; save(); renderMascot();
    });
    box.appendChild(b);
  });
}

/* ---------- home: maskot / daftar ---------- */
var SORTS=[
  {id:"baru", label:"Terbaru diubah"},
  {id:"lama", label:"Terlama diubah"},
  {id:"az", label:"Judul A-Z"}
];
function sortNotes(a,b){
  if(a.pinned!==b.pinned) return a.pinned? -1:1;
  var st = state.sort||"baru";
  if(st==="lama") return a.updated - b.updated;
  if(st==="az"){
    var ta=(a.title||"").toLowerCase(), tb=(b.title||"").toLowerCase();
    if(ta<tb) return -1; if(ta>tb) return 1;
    return b.updated - a.updated;
  }
  return b.updated - a.updated;
}
function sortLabel(){
  var f = SORTS.filter(function(x){ return x.id===(state.sort||"baru"); })[0];
  return f ? f.label : "Terbaru diubah";
}

function filteredNotes(){
  var q = state.filter.q.trim().toLowerCase();
  if(state.filter.folder===TRASH_ID){
    return state.trash.filter(function(n){
      if(q && (n.title+" "+n.body).toLowerCase().indexOf(q)<0) return false;
      return true;
    }).sort(function(a,b){ return b.deletedAt - a.deletedAt; });
  }
  return state.notes.filter(function(n){
    if(n.folderId===SECRET_FOLDER_ID && !secretUnlocked) return false;
    if(state.filter.folder==="pinned"){
      if(!n.pinned || n.isLink) return false;
    } else if(state.filter.folder==="all"){
      if(n.isLink) return false;
    } else if(n.folderId!==state.filter.folder) return false;
    if(q && (n.title+" "+n.body).toLowerCase().indexOf(q)<0) return false;
    return true;
  }).sort(sortNotes);
}

function goHome(){
  if(selectMode) exitSelectMode();
  secretUnlocked = false;
  listVisible = false; searchMode = false;
  state.filter.folder = "all"; state.filter.q = "";
  var si = $("search-input"); if(si) si.value = "";
  $("searchbar").classList.add("hidden"); searchOpen = false;
  renderHome();
}
$("btn-subback").addEventListener("click", function(){
  if(selectMode){ exitSelectMode(); renderHome(); return; }
  goHome();
});

function renderGreet(){
  var h = new Date().getHours();
  var g = (h>=4&&h<11) ? "Selamat pagi" : (h>=11&&h<15) ? "Selamat siang"
        : (h>=15&&h<18) ? "Selamat sore" : "Selamat malam";
  var nc = 0, ne = 0, nl = 0;
  state.notes.forEach(function(n){
    if(n.folderId===SECRET_FOLDER_ID && !secretUnlocked) return;
    if(n.isLink) nl++;
    else if(n.folderId===EMAIL_FOLDER_ID) ne++;
    else nc++;
  });
  $("greet-hi").textContent = g;
  $("greet-stats").textContent = nc+" catatan \u2022 "+ne+" email \u2022 "+nl+" link";
}
function renderHome(){
  var sh = $("subhead"), box = $("notes-list"), empty = $("empty-state");
  var q = state.filter.q.trim().toLowerCase();
  if(!listVisible){
    sh.classList.add("hidden");
    box.classList.add("hidden"); box.innerHTML = "";
    empty.classList.remove("hidden");
    renderGreet();
    return;
  }
  var notes, title;
  if(searchMode && q){
    notes = state.notes.filter(function(n){
      if(n.folderId===SECRET_FOLDER_ID && !secretUnlocked) return false;
      return (n.title+" "+n.body).toLowerCase().indexOf(q)>=0;
    }).sort(sortNotes);
    title = "Hasil pencarian";
  } else {
    notes = filteredNotes();
    title = state.filter.folder==="pinned" ? "📌 Disematkan"
      : state.filter.folder==="all" ? "🗂 Semua catatan"
      : state.filter.folder===TRASH_ID ? "🗑 Sampah"
      : ((folderById(state.filter.folder)||{}).icon||"")+" "+
        ((folderById(state.filter.folder)||{name:""}).name);
  }
  $("subhead-title").textContent = title;
  sh.classList.remove("hidden");
  box.classList.remove("hidden");
  box.innerHTML = "";
  empty.classList.toggle("hidden", notes.length>0);
  notes.forEach(function(n, i){
    var f = n.folderId ? folderById(n.folderId) : null;
    var el = document.createElement("div");
    el.className = "note-card" + (n.pinned?" pinned":"") + (n.isLink?" link-card":"") +
      (selectMode ? " selectable" + (selectedIds[n.id] ? " selected" : "") : "");
    el.style.setProperty("--i", i);
    var preview = n.body.length>140 ? n.body.slice(0,140)+"…" : n.body;
    var titleHTML = n.isLink
      ? '<div class="link-row"><div><div class="note-title">'+esc(n.title||domainOf(n.body))+'</div>'+
        '<div class="link-url">🔗 '+esc(n.body)+'</div></div>'+
        '<button class="open-link" data-url="'+esc(n.body)+'" aria-label="Buka link">↗</button></div>'
      : '<div class="note-title">'+esc(n.title||"(Tanpa judul)")+'</div>'+
        (n.body?'<div class="note-body">'+esc(preview)+'</div>':"");
    var isTrash = state.filter.folder===TRASH_ID;
    el.innerHTML =
      (n.pinned?'<span class="note-pin">📌</span>':"")+
      titleHTML+
      '<div class="note-foot">'+
        (f?'<span class="note-folder" style="background:'+f.color+'">'+(f.icon?esc(f.icon)+" ":"")+esc(f.name)+'</span>':"")+
        '<span>'+fmtDate(isTrash?n.deletedAt:n.updated)+'</span>'+
        (isTrash
          ? '<button class="card-restore" data-id="'+n.id+'" aria-label="Pulihkan"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>'+
            '<button class="card-del" data-id="'+n.id+'" aria-label="Hapus permanen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>'
          : '<button class="card-del" data-id="'+n.id+'" aria-label="Hapus">'+
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>')+
      '</div>';
    el.addEventListener("click", function(){
      if(selectMode){
        if(selectedIds[n.id]) delete selectedIds[n.id];
        else selectedIds[n.id] = 1;
        el.classList.toggle("selected");
        updateSelectUI();
        return;
      }
      if(state.filter.folder===TRASH_ID) return;
      openEditor(n.id);
    });
    box.appendChild(el);
  });
  box.querySelectorAll(".open-link").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      openURL(btn.getAttribute("data-url"));
    });
  });
  box.querySelectorAll(".card-restore").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      restoreFromTrash(btn.getAttribute("data-id"));
      renderHome(); renderStats(); toast("Dipulihkan \u2713");
    });
  });
  box.querySelectorAll(".card-del").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      var id = btn.getAttribute("data-id");
      var isTrash = state.filter.folder===TRASH_ID;
      var src = isTrash ? state.trash : state.notes;
      var n = src.find(function(x){return x.id===id;});
      if(!n) return;
      if(isTrash){
        openDialog("Hapus permanen?",
          "<p style='font-size:14px'>\u201C"+esc((n.title||n.body||"").slice(0,50))+"\u201D akan hilang selamanya.</p>",
          "Hapus", function(){
            deleteForever(id);
            renderHome(); renderStats(); toast("Dihapus permanen");
          });
      } else {
        openDialog("Hapus "+(n.isLink?"link":"catatan")+"?",
          "<p style='font-size:14px'>\u201C"+esc((n.title||n.body||"").slice(0,50))+"\u201D akan dipindah ke sampah.</p>",
          "Hapus", function(){
            moveToTrash(id);
            renderHome(); renderStats(); toast("Dipindah ke sampah");
          });
      }
    });
  });
}

/* ---------- search ---------- */
var searchOpen = false;
$("btn-search").addEventListener("click", function(){
  searchOpen = !searchOpen;
  $("searchbar").classList.toggle("hidden", !searchOpen);
  if(searchOpen){ $("search-input").focus(); }
  else { $("search-input").value=""; state.filter.q=""; searchMode=false; renderHome(); }
});
$("search-input").addEventListener("input", function(e){
  state.filter.q = e.target.value;
  searchMode = state.filter.q.trim().length>0;
  if(searchMode) listVisible = true;
  renderHome();
});

/* ---------- navigation ---------- */
function showHome(){
  persistEditor(true);
  $("view-editor").classList.add("off-right");
  $("view-home").classList.remove("off-left");
  editingId = null;
  renderHome();
}
function openEditor(id){
  editingId = id || null;
  var n = id ? state.notes.find(function(x){return x.id===id;}) : null;
  renderFolderSelect(n ? n.folderId : (state.filter.folder!=="all"&&
    state.filter.folder!=="pinned" ? state.filter.folder : CATATAN_FOLDER_ID));
  $("ed-title").value = n ? n.title : "";
  $("ed-body").value = n ? n.body : "";
  renderEdMeta(n);
  $("btn-pin").classList.toggle("on", !!(n && n.pinned));
  $("btn-delete").style.visibility = n ? "visible" : "hidden";
  dirtyCheck = draftKey(currentDraft());
  folderTouched = false;
  $("view-home").classList.add("off-left");
  var v = $("view-editor");
  v.classList.remove("off-right");
  // re-trigger entrance for editor fields
  setTimeout(function(){ $("ed-title").focus(); }, 380);
  if(id) history.pushState({v:"ed",id:id}, "");
  else history.pushState({v:"new"}, "");
  autoGrow();
}
$("btn-back").addEventListener("click", function(){ history.back(); });
window.addEventListener("popstate", function(e){
  if(!$("view-editor").classList.contains("off-right")) showHome();
});
history.replaceState({v:"home"}, "");

function syncFolderChip(){
  var s = $("ed-folder");
  var f = s.value ? folderById(s.value) : null;
  $("ed-folder-dot").style.background = f ? f.color : "var(--muted)";
  var t = s.options[s.selectedIndex];
  $("ed-folder-name").textContent = t ? t.textContent : "";
}
function renderFolderSelect(sel){
  var s = $("ed-folder"); s.innerHTML = "";
  var o0 = document.createElement("option");
  o0.value = ""; o0.textContent = "Tanpa folder"; s.appendChild(o0);
  state.folders.forEach(function(f){
    var o = document.createElement("option");
    o.value = f.id;
    o.textContent = (f.id===SECRET_FOLDER_ID ? "🔒 " : "") + f.name;
    if(f.id===sel) o.selected = true;
    s.appendChild(o);
  });
  s.setAttribute("data-prev", sel||"");
  syncFolderChip();
  s.onchange = function(){
    if(s.value===SECRET_FOLDER_ID && !secretUnlocked){
      var prev = s.getAttribute("data-prev") || "";
      function done(ok){
        if(ok){
          s.setAttribute("data-prev", s.value);
          folderTouched = true;
          persistEditor(true);
        } else s.value = prev;
        syncFolderChip();
      }
      if(!state.secret.pinHash) setupPinLock(done);
      else unlockSecretInline(done);
      return;
    }
    s.setAttribute("data-prev", s.value);
    folderTouched = true;
    syncFolderChip();
    persistEditor(true);
  };
}

function renderEdMeta(n){
  var body = $("ed-body").value || "";
  var words = body.trim() ? body.trim().split(/\s+/).length : 0;
  $("ed-meta").innerHTML = "🕐 " + esc(n ? "Diubah "+fmtDate(n.updated) : "Catatan baru") +
    (words ? ' <span class="ed-words">· '+words+' kata</span>' : "");
}
$("ed-body").addEventListener("input", function(){
  renderEdMeta(editingId ? state.notes.find(function(x){return x.id===editingId;}) : null);
});

/* ---------- editor actions ---------- */
function currentDraft(){
  return { title:$("ed-title").value.trim(),
    body:$("ed-body").value.replace(/\s+$/,""),
    folderId:$("ed-folder").value||null };
}
function draftKey(d){ return d.title+"\n"+d.body+"\n"+d.folderId; }
function persistEditor(silent){
  var d = currentDraft();
  var key = draftKey(d);
  if(key === dirtyCheck) return;
  if(!d.title && !d.body){ dirtyCheck = key; return; }
  var now = Date.now();
  // otomatis: kalau isinya URL tunggal -> jadikan link di folder Link
  var linkURL = isURL(d.body) ? d.body.trim() : (isURL(d.title) ? d.title.trim() : null);
  if(linkURL && !folderTouched){
    d.folderId = findOrCreateDomainFolder(linkURL).id;
    if(!d.title) d.title = domainOf(linkURL);
    d.body = linkURL;
  }
  var emailAddr = !linkURL && isEmail(d.body) ? d.body.trim()
    : (!linkURL && isEmail(d.title) ? d.title.trim() : null);
  if(emailAddr && !folderTouched){
    d.folderId = findOrCreateEmailFolder().id;
    if(!d.title) d.title = emailAddr;
    d.body = emailAddr;
  }
  var isLinkNote = !!linkURL;
  if(editingId){
    var n = state.notes.find(function(x){return x.id===editingId;});
    if(n){ n.title=d.title; n.body=d.body; n.folderId=d.folderId; n.updated=now;
      n.isLink = isLinkNote || (n.isLink && n.folderId===LINK_FOLDER_ID); }
  } else {
    var nn = { id:uid(), title:d.title, body:d.body,
      folderId:d.folderId || CATATAN_FOLDER_ID,
      pinned:false, created:now, updated:now, isLink:isLinkNote };
    state.notes.push(nn); editingId = nn.id;
  }
  dirtyCheck = key; save();
  if(!silent) toast("Tersimpan ✓");
}
$("btn-save").addEventListener("click", function(){
  persistEditor(false);
  $("ed-meta").textContent = "Diubah "+fmtDate(Date.now());
});
$("btn-pin").addEventListener("click", function(){
  persistEditor(true);
  var n = state.notes.find(function(x){return x.id===editingId;});
  if(!n){ toast("Tulis dulu catatannya"); return; }
  n.pinned = !n.pinned; n.updated = Date.now(); save();
  $("btn-pin").classList.toggle("on", n.pinned);
  toast(n.pinned ? "Di-pin 📌" : "Pin dilepas");
});
$("btn-delete").addEventListener("click", function(){
  if(!editingId) return;
  openDialog("Hapus catatan?", "Catatan ini akan dipindah ke sampah.", "Hapus",
    function(){
      moveToTrash(editingId);
      editingId = null; history.back();
      setTimeout(function(){ toast("Dipindah ke sampah"); }, 350);
    });
});
["ed-title","ed-body"].forEach(function(id){
  $(id).addEventListener("input", autoGrow);
});
function autoGrow(){
  var t = $("ed-body");
  t.style.height = "auto";
  t.style.height = Math.max(t.scrollHeight, 200) + "px";
}
setInterval(function(){
  if(!$("view-editor").classList.contains("off-right")) persistEditor(true);
}, 4000);

/* ---------- pesawat kertas terbang ke mulut maskot ---------- */
function flyToMascot(done){
  var svg = document.querySelector("#empty-state .mascot");
  if(!svg || listVisible){ done(); return; }
  mascotWalkPause(true);
  var ir = $("chat-input").getBoundingClientRect();
  var sx = ir.left + ir.width/2, sy = ir.top + ir.height/2;
  function mouthPos(){
    var mr = svg.getBoundingClientRect();
    return { x: mr.left + mr.width*0.5, y: mr.top + mr.height*0.585 };
  }
  var plane = document.createElement("div");
  plane.className = "fly-plane";
  plane.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24">'+
    '<path d="M2 21l21-9L2 3v7l15 2-15 2z" fill="#fff"/></svg>';
  document.body.appendChild(plane);
  var opened = false, t0 = null, dur = 950;
  function frame(t){
    if(!t0) t0 = t;
    var p = Math.min((t-t0)/dur, 1);
    if(p>0.45 && !opened){ opened = true; svg.classList.add("eat"); }
    var e = 1-Math.pow(1-p,3);
    var mp = mouthPos(); /* ukur ulang tiap frame: layout bisa bergeser (keyboard turun) */
    var ex = mp.x, ey = mp.y;
    var cx = (sx+ex)/2, cy = Math.min(sy,ey) - 110;
    var x = (1-e)*(1-e)*sx + 2*(1-e)*e*cx + e*e*ex;
    var y = (1-e)*(1-e)*sy + 2*(1-e)*e*cy + e*e*ey;
    var dx = 2*(1-e)*(cx-sx) + 2*e*(ex-cx);
    var dy = 2*(1-e)*(cy-sy) + 2*e*(ey-cy);
    var ang = Math.atan2(dy,dx)*180/Math.PI;
    var tail = Math.max(p-0.82,0)/0.18;
    var sc = 1 - tail*0.75, op = 1 - Math.max(p-0.88,0)/0.12;
    plane.style.transform = "translate("+(x-18)+"px,"+(y-18)+"px)"+
      " rotate("+ang+"deg) scale("+sc+")";
    plane.style.opacity = op;
    if(p<1){ requestAnimationFrame(frame); return; }
    plane.remove();
    setTimeout(function(){ svg.classList.remove("eat"); mascotWalkPause(false); done(); }, 220);
  }
  requestAnimationFrame(frame);
}

/* ---------- chat bar: satu input untuk catatan & link ---------- */
function quickAdd(){
  var inp = $("chat-input");
  var text = inp.value.trim();
  if(!text) return;
  var now = Date.now();
  var urls = extractURLs(text);
  var emails = urls.length ? [] : extractEmails(text);
  var note, emailCount = 0;
  var inSecret = listVisible && !searchMode &&
    state.filter.folder===SECRET_FOLDER_ID && secretUnlocked;
  if(emails.length && !inSecret){
    var ef = findOrCreateEmailFolder();
    var made = [], pendingLabel = "";
    text.split("\n").forEach(function(line){
      var ems = extractEmails(line);
      if(ems.length){
        var clean = line;
        ems.forEach(function(e2){ clean = clean.split(e2).join(" "); });
        clean = clean.replace(/#(\s*#)+/g," ").replace(/\s+/g," ").replace(/^[\s\-:,;|]+|[\s\-:,;|]+$/g,"").trim();
        ems.forEach(function(em){
          made.push({ email: em, label: clean || pendingLabel });
        });
        pendingLabel = "";
      } else if(line.trim()){
        pendingLabel = line.trim();
      }
    });
    if(!made.length) emails.forEach(function(em){ made.push({ email: em, label: "" }); });
    made.forEach(function(m){
      state.notes.push({ id:uid(), title: m.label || m.email, body: m.email,
        folderId: ef.id, pinned:false, created:now, updated:now, isLink:false });
    });
    state.filter.folder = ef.id;
    note = null; emailCount = made.length;
  } else if(emails.length && inSecret){
    var em2 = emails[0];
    var restE2 = text.replace(em2,"").trim();
    note = { id:uid(), title: restE2 || em2, body:em2,
      folderId:SECRET_FOLDER_ID, pinned:false, created:now,
      updated:now, isLink:false };
  } else if(urls.length && !inSecret){
    var u = urls[0];
    var rest = text.replace(u,"").trim();
    var df = findOrCreateDomainFolder(u);
    note = { id:uid(), title: rest || domainOf(u), body:u,
      folderId:df.id, pinned:false, created:now, updated:now, isLink:true };
    state.filter.folder = df.id;
  } else if(urls.length && inSecret){
    var u2 = urls[0];
    var rest2 = text.replace(u2,"").trim();
    note = { id:uid(), title: rest2 || u2, body:u2,
      folderId:SECRET_FOLDER_ID, pinned:false, created:now,
      updated:now, isLink:true };
  } else {
    /* catatan biasa -> folder yang sedang dibuka, atau folder Catatan */
    var targetId = inSecret ? SECRET_FOLDER_ID :
      (listVisible && !searchMode &&
       state.filter.folder!=="all" && state.filter.folder!=="pinned")
      ? state.filter.folder : ensureCatatanFolder().id;
    var firstLine = text.split("\n")[0];
    note = { id:uid(),
      title: firstLine.length>60 ? firstLine.slice(0,60)+"…" : firstLine,
      body:text, folderId:targetId, pinned:false, created:now,
      updated:now, isLink:false };
  }
  if(note) state.notes.push(note);
  save(); inp.value = "";
  var msg = urls.length
    ? "Link tersimpan di folder "+folderById(note.folderId).name+" 🔗"
    : emailCount ? emailCount+" email tersimpan di folder Email 📧"
    : "Catatan tersimpan ✓";
  flyToMascot(function(){ renderHome(); toast(msg); });
}

$("chat-send").addEventListener("click", quickAdd);
$("chat-input").addEventListener("keydown", function(e){
  if(e.key === "Enter") quickAdd();
});


/* ---------- folder rahasia: buka / setup / reset (TOTP) ---------- */
function wireTotpInput(){
  var ci = $("totp-code"); if(!ci) return;
  ci.addEventListener("input", function(){
    ci.value = ci.value.replace(/\D/g,"").slice(0,6);
    if(ci.value.length===6) setTimeout(function(){ $("dlg-ok").click(); }, 200);
  });
}
function copyText(t){
  function fallback(){
    var ta = document.createElement("textarea");
    ta.value = t; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); toast("Kode disalin ✓"); }
    catch(e){ toast("Gagal menyalin"); }
    ta.remove();
  }
  if(navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(t).then(function(){ toast("Kode disalin ✓"); }, fallback);
  else fallback();
}
function pasteTotp(){
  function fill(t){
    var d = String(t||"").replace(/\D/g,"").slice(-6);
    var ci = $("totp-code");
    if(d.length===6 && ci){
      ci.value = d;
      setTimeout(function(){ $("dlg-ok").click(); }, 200);
    } else toast("Tidak ada kode 6 digit di clipboard");
  }
  var nt = "";
  try{ if(window.AndroidBridge && AndroidBridge.readClipboard) nt = AndroidBridge.readClipboard(); }catch(e){}
  if(nt){ fill(nt); return; }
  if(navigator.clipboard && navigator.clipboard.readText)
    navigator.clipboard.readText().then(fill, function(){ toast("Tidak bisa membaca clipboard"); });
  else toast("Tidak bisa membaca clipboard");
}
function wireTotpPaste(){
  var b = $("totp-paste"); if(!b) return;
  b.addEventListener("click", pasteTotp);
}
function showSecretFolder(){
  state.filter.folder = SECRET_FOLDER_ID; state.filter.q = "";
  var si = $("search-input"); if(si) si.value = "";
  searchMode = false; listVisible = true;
  renderDrawerFolders(); renderStats(); renderHome();
}
/* ---------- kunci folder rahasia: PIN + sidik jari ---------- */
var bioAvail = false;
function checkBio(){
  try { bioAvail = !!(window.AndroidBridge && AndroidBridge.bioAvailable && AndroidBridge.bioAvailable()); }
  catch(e){ bioAvail = false; }
}
window.__bioResult = function(ok, msg){
  var cb = window.__bioCb; window.__bioCb = null;
  if(cb) cb(!!ok, msg||"");
};
function bioAuth(cb){
  window.__bioCb = cb;
  try { AndroidBridge.bioAuth(); }
  catch(e){ window.__bioCb = null; cb(false, "bridge"); }
}
function pinDigest(pin, salt){ return sha256(salt+"|"+pin); }
function autoPinSubmit(inputId){
  var inp = $(inputId); if(!inp) return;
  inp.addEventListener("input", function(){
    if(inp.value.replace(/\D/g,"").length>=6)
      setTimeout(function(){ $("dlg-ok").click(); }, 150);
  });
}
function openSecretFolder(){
  closeDrawer();
  ensureSecretFolder();
  if(!state.secret.pinHash){
    if(state.secret.totp){ migrateLegacyTotp(); return; }
    setupPinLock(); return;
  }
  if(secretUnlocked){ showSecretFolder(); return; }
  if(state.secret.bio && bioAvail){
    bioAuth(function(ok){
      if(ok){ secretUnlocked = true; showSecretFolder(); }
      else openPinDialog();
    });
    return;
  }
  openPinDialog();
}
function openPinDialog(){
  var bioBtn = bioAvail ? '<button class="btn-text" id="pin-bio">Gunakan sidik jari</button>' : "";
  openDialog("\uD83D\uDD12 Folder Rahasia",
    '<p class="dlg-hint">Masukkan PIN 6 digit.</p>'+
    '<input id="pin-code" class="dialog-totp" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022">'+
    bioBtn,
    "Buka", function(){
      var v = $("pin-code").value.replace(/\D/g,"");
      if(pinDigest(v, state.secret.salt)===state.secret.pinHash){
        secretUnlocked = true; showSecretFolder();
      } else {
        toast("PIN salah, coba lagi");
        setTimeout(openPinDialog, 350);
      }
    });
  autoPinSubmit("pin-code");
  var bb = $("pin-bio");
  if(bb) bb.addEventListener("click", function(){
    bioAuth(function(ok, msg){
      if(ok){
        if(!state.secret.bio){ state.secret.bio = true; save(); }
        secretUnlocked = true; showSecretFolder();
      } else if(msg) toast(msg);
    });
  });
}
/* migrasi sekali dari authenticator lama */
function migrateLegacyTotp(){
  openDialog("\uD83D\uDD12 Migrasi Kunci",
    '<p class="dlg-hint">Kunci authenticator diganti PIN + sidik jari. Masukkan 6 digit authenticator lama sekali untuk migrasi.</p>'+
    '<div class="totp-row"><input id="totp-code" class="dialog-totp" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"><button class="totp-paste-btn" id="totp-paste" aria-label="Tempel dari clipboard">\uD83D\uDCCB</button></div>',
    "Lanjut", function(){
      if(totpVerify(state.secret.totp, $("totp-code").value)){
        state.secret.totp = null; save();
        setupPinLock();
      } else { toast("Kode salah"); setTimeout(migrateLegacyTotp, 350); }
    });
  wireTotpInput(); wireTotpPaste();
}
function setupPinLock(onDone){
  openDialog("\uD83D\uDD12 Kunci Folder Rahasia",
    '<p class="dlg-hint">Buat PIN 6 digit untuk membuka folder Rahasia.</p>'+
    '<input id="pin-code" class="dialog-totp" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022">',
    "Lanjut", function(){
      var v = $("pin-code").value.replace(/\D/g,"");
      if(v.length!==6){ toast("PIN harus 6 digit"); setTimeout(function(){ setupPinLock(onDone); }, 350); return; }
      setupPinLock2(v, onDone);
    });
  autoPinSubmit("pin-code");
}
function setupPinLock2(pin1, onDone){
  openDialog("\uD83D\uDD12 Kunci Folder Rahasia",
    '<p class="dlg-hint">Ulangi PIN untuk memastikan.</p>'+
    '<input id="pin-code" class="dialog-totp" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022">',
    "Simpan", function(){
      var v = $("pin-code").value.replace(/\D/g,"");
      if(v!==pin1){ toast("PIN tidak sama, ulangi"); setTimeout(function(){ setupPinLock(onDone); }, 350); return; }
      finishPinSetup(v, onDone);
    });
  autoPinSubmit("pin-code");
}
function finishPinSetup(pin, onDone){
  var salt = uid()+uid()+Date.now().toString(36);
  state.secret = { pinHash:pinDigest(pin, salt), salt:salt, bio:false, totp:null };
  save();
  secretUnlocked = true;
  if(onDone){ onDone(true); toast("Folder Rahasia aktif \uD83D\uDD12"); return; }
  if(bioAvail){
    openDialog("Aktifkan sidik jari?",
      '<p class="dlg-hint">Buka folder Rahasia lebih cepat dengan sidik jari. PIN tetap bisa dipakai.</p>',
      "Aktifkan",
      function(){
        state.secret.bio = true; save();
        showSecretFolder(); toast("Folder Rahasia aktif \uD83D\uDD12");
      },
      function(){ showSecretFolder(); toast("Folder Rahasia aktif \uD83D\uDD12"); });
  } else {
    showSecretFolder(); toast("Folder Rahasia aktif \uD83D\uDD12");
  }
}
/* dipakai dari dropdown folder di editor */
function unlockSecretInline(onDone){
  if(!state.secret.pinHash){
    toast("Siapkan kunci dulu lewat sidebar \u2192 folder Rahasia");
    onDone(false); return;
  }
  if(state.secret.bio && bioAvail){
    bioAuth(function(ok){
      if(ok){
        secretUnlocked = true;
        renderDrawerFolders(); renderStats(); onDone(true);
      } else openPinInline(onDone);
    });
    return;
  }
  openPinInline(onDone);
}
function openPinInline(onDone){
  openDialog("\uD83D\uDD12 Folder Rahasia",
    '<p class="dlg-hint">Masukkan PIN untuk memakai folder Rahasia.</p>'+
    '<input id="pin-code" class="dialog-totp" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022">',
    "Buka", function(){
      var v = $("pin-code").value.replace(/\D/g,"");
      if(pinDigest(v, state.secret.salt)===state.secret.pinHash){
        secretUnlocked = true;
        renderDrawerFolders(); renderStats(); onDone(true);
      } else { toast("PIN salah"); onDone(false); }
    },
    function(){ onDone(false); });
  autoPinSubmit("pin-code");
}
function openSecretReset(){
  if(!state.secret.pinHash){ openSecretFolder(); return; }
  function askPin(){
    openDialog("\uD83D\uDD12 Atur Ulang Kunci",
      '<p class="dlg-hint">Masukkan PIN saat ini untuk membuat kunci baru.</p>'+
      '<input id="pin-code" class="dialog-totp" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022">',
      "Lanjut", function(){
        var v = $("pin-code").value.replace(/\D/g,"");
        if(pinDigest(v, state.secret.salt)===state.secret.pinHash) setupPinLock();
        else toast("PIN salah");
      });
    autoPinSubmit("pin-code");
  }
  if(state.secret.bio && bioAvail){
    bioAuth(function(ok){ if(ok) setupPinLock(); else askPin(); });
  } else askPin();
}

/* ---------- folders: tambah & ubah nama ---------- */
function openFolderDialog(folder){
  var isEdit = !!folder;
  var selColor = folder ? folder.color : FOLDER_COLORS[0];
  var colors = FOLDER_COLORS.map(function(c){
    return '<span class="color-pick'+(c===selColor?" sel":"")+'" data-c="'+c+
      '" style="background:'+c+'"></span>';
  }).join("");
  openDialog(isEdit ? "Ubah folder" : "Folder baru",
    '<input id="fld-name" placeholder="Nama folder" maxlength="24" value="'+
      esc(isEdit ? folder.name : "")+'">'+
    '<div class="color-row">'+colors+'</div>',
    isEdit ? "Simpan" : "Buat", function(){
      var name = $("fld-name").value.trim();
      if(!name){ toast("Nama folder kosong"); return; }
      if(isEdit){
        folder.name = name; folder.color = selColor;
        toast("Folder diubah ✓");
      } else {
        state.folders.push({id:uid(), name:name, color:selColor});
        toast('Folder "'+name+'" dibuat');
      }
      save(); renderDrawerFolders(); renderStats(); renderHome();
    });
  document.querySelectorAll(".color-pick").forEach(function(p){
    p.addEventListener("click", function(){
      document.querySelectorAll(".color-pick").forEach(function(x){
        x.classList.remove("sel"); });
      p.classList.add("sel"); selColor = p.getAttribute("data-c");
    });
  });
}
$("btn-add-folder").addEventListener("click", function(){ openFolderDialog(null); });

/* ---------- backup / restore ---------- */
function b64encode(str){
  return btoa(unescape(encodeURIComponent(str)));
}
$("btn-backup").addEventListener("click", function(){
  closeDrawer();
  var payload = JSON.stringify({ app:"CatatanKu", version:1,
    exportedAt:new Date().toISOString(),
    notes:state.notes, folders:state.folders, secret:state.secret, trash:state.trash, mascot:state.mascot, sort:state.sort }, null, 2);
  var fname = "catatanku-backup-" +
    new Date().toISOString().slice(0,10) + ".json";
  if(window.AndroidBridge && AndroidBridge.saveFile){
    AndroidBridge.saveFile(fname, "application/json", b64encode(payload));
  } else {
    var a = document.createElement("a");
    a.href = "data:application/json;base64,"+b64encode(payload);
    a.download = fname; a.click();
    toast("Backup diunduh");
  }
});
$("btn-restore").addEventListener("click", function(){
  closeDrawer(); $("restore-file").click();
});
$("restore-file").addEventListener("change", function(e){
  var f = e.target.files[0]; if(!f) return;
  var r = new FileReader();
  r.onload = function(){
    try{
      var d = JSON.parse(r.result);
      if(!d || !Array.isArray(d.notes)) throw 0;
      openDialog("Pulihkan backup?",
        d.notes.length+" catatan dan "+((d.folders||[]).length)+
        " folder akan MENGGANTIKAN data saat ini.", "Pulihkan",
        function(){
          state.notes = d.notes; state.folders = d.folders||[];
          state.secret = (d.secret&&typeof d.secret==="object") ? d.secret : {pinHash:null,salt:null,bio:false,totp:null};
          state.trash = d.trash||[];
          state.mascot = d.mascot||0;
          state.sort = d.sort||"baru";
          secretUnlocked = false;
          state.filter = {q:"", folder:"all"};
          save(); renderAll(); toast("Backup dipulihkan ✓");
        });
    }catch(err){ toast("File backup tidak valid"); }
    e.target.value = "";
  };
  r.readAsText(f);
});

/* ---------- misc ---------- */
$("btn-theme").addEventListener("click", toggleTheme);
$("btn-theme2").addEventListener("click", function(){ closeDrawer(); toggleTheme(); });
$("btn-about").addEventListener("click", function(){
  closeDrawer();
  openDialog("Tentang CatatanKu",
    "<p style='font-size:14px;line-height:1.7;color:var(--muted)'>"+
    "CatatanKu v1.0.0<br>Catatan offline yang ringan dan cepat.<br><br>"+
    "Tanpa login · tanpa iklan · tanpa server.<br>"+
    "Semua data tersimpan di perangkatmu.</p>", "Tutup", null);
});

/* ---------- onboarding ---------- */
var obIdx = 0;
function renderOb(){
  var slides = document.querySelectorAll(".ob-slide");
  slides.forEach(function(s,i){ s.classList.toggle("active", i===obIdx); });
  var dots = $("ob-dots"); dots.innerHTML = "";
  slides.forEach(function(_,i){
    var d = document.createElement("span");
    if(i===obIdx) d.className = "on";
    dots.appendChild(d);
  });
  $("ob-next").textContent = obIdx===slides.length-1 ? "Mulai ✦" : "Lanjut";
  $("ob-skip").style.visibility = obIdx===slides.length-1 ? "hidden" : "visible";
}
function finishOb(){
  state.onboarded = true; save();
  var ob = $("onboarding");
  ob.style.transition = "opacity .4s"; ob.style.opacity = "0";
  setTimeout(function(){
    ob.classList.add("hidden"); $("app").classList.remove("hidden");
  }, 400);
}
$("ob-next").addEventListener("click", function(){
  var n = document.querySelectorAll(".ob-slide").length;
  if(obIdx < n-1){ obIdx++; renderOb(); } else finishOb();
});
$("ob-skip").addEventListener("click", finishOb);

/* ---------- init ---------- */
function renderAll(){ renderHome(); }
load();
if(!state.secret || typeof state.secret!=="object") state.secret = {pinHash:null,salt:null,bio:false,totp:null};
if(!Array.isArray(state.trash)) state.trash = [];
purgeTrash();
checkBio();
migrateLinkFolder();
ensureCatatanFolder();
ensureSecretFolder();
(function(){ /* catatan lama tanpa folder -> folder Catatan */
  var cf = ensureCatatanFolder(), moved = false;
  state.notes.forEach(function(n){
    if(!n.isLink && !n.folderId){ n.folderId = cf.id; moved = true; }
  });
  if(moved) save();
})();
applyTheme();
if(state.onboarded){
  $("onboarding").classList.add("hidden");
  $("app").classList.remove("hidden");
} else {
  $("onboarding").classList.remove("hidden");
  renderOb();
}
/* terima teks dari menu Bagikan aplikasi lain */
window.__onSharedText = function(text){
  text = (text||"").trim();
  if(!text) return;
  if(!$("view-editor").classList.contains("off-right")) showHome();
  secretUnlocked = false; listVisible = false; searchMode = false;
  state.filter.folder = "all"; state.filter.q = "";
  renderHome();
  $("chat-input").value = text;
  setTimeout(function(){ quickAdd(); }, 120);
};
renderMascot();
renderAll();
})();
