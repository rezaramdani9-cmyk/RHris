/* Reza HRIS — server kecil untuk Cloudflare Workers.
   Variabel yang harus diisi di dashboard Cloudflare (Settings → Variables and Secrets):
   GH_TOKEN (secret) · GH_OWNER · GH_REPO · SECRET (secret, teks acak panjang)
   Opsional: GH_BRANCH (default main) · GH_PATH (default data/db.json) */
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'};
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,'content-type':'application/json'}});
const enc=new TextEncoder(),hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha256=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const hmac=async(k,m)=>hex(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']),enc.encode(m)));
const b64=s=>{let x='';enc.encode(s).forEach(c=>x+=String.fromCharCode(c));return btoa(x)};
const unb64=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g,'')),c=>c.charCodeAt(0)));
const U=e=>`https://api.github.com/repos/${e.GH_OWNER}/${e.GH_REPO}/contents/${e.GH_PATH||'data/db.json'}`;
const GH=e=>({Authorization:'Bearer '+e.GH_TOKEN,Accept:'application/vnd.github+json','User-Agent':'reza-hris'});
const BR=e=>e.GH_BRANCH||'main';

const ge=async r=>'GitHub '+r.status+': '+((await r.json().catch(()=>({}))).message||'')+' — cek GH_OWNER, GH_REPO, GH_BRANCH, dan izin token (Contents: Read and write)';
async function read(e){const r=await fetch(U(e)+'?ref='+BR(e),{headers:GH(e)});if(r.status==404)return null;if(!r.ok)throw new Error(await ge(r));const j=await r.json();return{db:JSON.parse(unb64(j.content)),sha:j.sha}}
async function write(e,db,sha){const body={message:'data '+new Date().toISOString(),branch:BR(e),content:b64(JSON.stringify(db,null,1))};if(sha)body.sha=sha;
 const r=await fetch(U(e),{method:'PUT',headers:{...GH(e),'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(r.status==409||r.status==422)return{conflict:true};if(!r.ok)throw new Error(await ge(r));return{sha:(await r.json()).content.sha}}
async function seed(){return{employees:[],attendance:[],leaves:[],overtime:[],log:[],locs:[],slips:[],users:[{id:'u1',username:'admin',nama:'Admin',role:'Admin',hash:await sha256('admin:admin123')}],settings:{company:'Nama Perusahaan',workdays:[1,2,3,4,5],shiftIn:'08:00',shiftOut:'17:00',tol:15,quota:12,otRate:20000}}}
async function current(e){let r=await read(e);if(!r){const db=await seed(),w=await write(e,db,null);if(w.conflict)throw new Error('Gagal membuat '+(e.GH_PATH||'data/db.json')+' di GitHub. Cek GH_BRANCH (main/master) dan izin token.');r={db,sha:w.sha}}r.db.locs||=[];r.db.slips||=[];return r}
async function authed(req,e){const t=(req.headers.get('authorization')||'').replace('Bearer ','');const[p,s]=t.split('.');if(!p||s!==await hmac(e.SECRET,p))return null;const d=JSON.parse(atob(p));return d.exp>Date.now()?d:null}

const uid=()=>crypto.randomUUID().slice(0,7);
const wib=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return{date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`}};
const dist=(a,b,c,d)=>{const r=x=>x*Math.PI/180,h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2;return 12742000*Math.asin(Math.sqrt(h))};
const KIND=['Cuti','Izin','Sakit','Izin Terlambat','Izin Pulang Cepat'],DR=/^\d{4}-\d\d-\d\d$/,TR=/^\d\d:\d\d$/;
async function mutate(e,fn){for(let i=0;i<3;i++){const r=await current(e),res=fn(r.db);if(res.err)return res;const w=await write(e,r.db,r.sha);if(!w.conflict)return res}return{err:'Server sibuk, coba lagi',s:409}}
const done=x=>x.err?J({error:x.err},x.s||400):J(x.out||{ok:1});

export default{async fetch(req,e){
 if(req.method=='OPTIONS')return new Response(null,{headers:cors});
 const path=new URL(req.url).pathname;
 try{
  if(path=='/login'&&req.method=='POST'){
   const{username,hash}=await req.json(),{db}=await current(e),u=db.users.find(x=>x.username==username&&x.hash==hash);
   if(!u)return J({error:'invalid'},401);
   const p=btoa(JSON.stringify({id:u.id,exp:Date.now()+12*36e5}));return J({token:p+'.'+await hmac(e.SECRET,p),user:{id:u.id}})}
  const a=await authed(req,e);if(!a)return J({error:'unauthorized'},401);
  const r=await current(e),me=r.db.users.find(x=>x.id==a.id);if(!me)return J({error:'unauthorized'},401);
  const staff=me.role=='Staff';
  if(path=='/db'&&req.method=='GET'){
   if(!staff)return J({db:{...r.db,users:r.db.users.map(({hash,...u})=>u)},v:r.sha});
   const d=r.db,own=x=>x.emp==me.emp,s=d.settings,{hash,...self}=me;
   return J({v:r.sha,db:{employees:d.employees.filter(x=>x.id==me.emp),attendance:d.attendance.filter(own),leaves:d.leaves.filter(own),overtime:d.overtime.filter(own),slips:d.slips.filter(own),locs:d.locs,log:[],users:[self],settings:{company:s.company,workdays:s.workdays,shiftIn:s.shiftIn,shiftOut:s.shiftOut,tol:s.tol,quota:s.quota,otRate:s.otRate,gps:s.gps,acc:s.acc}}})}
  if(path=='/db'&&req.method=='PUT'){
   if(staff)return J({error:'forbidden'},403);
   const{db,v}=await req.json(),next={...db};
   if(me.role!='Admin'){next.users=r.db.users;next.settings=r.db.settings;next.locs=r.db.locs} /* hanya Admin yang boleh ubah pengguna, pengaturan, lokasi */
   else next.users=(db.users||[]).map(u=>({...u,hash:u.hash||(r.db.users.find(x=>x.id==u.id)||{}).hash})).filter(u=>u.hash);
   const w=await write(e,next,v);if(w.conflict)return J({error:'conflict'},409);return J({v:w.sha})}
  /* ---- jalur khusus Staff: server yang mengisi karyawan & jam ---- */
  if(!staff)return J({error:'forbidden'},403);
  if(!me.emp)return J({error:'Akun belum terhubung ke data karyawan. Hubungi Admin.'},400);
  const b=await req.json(),t=wib(),s=r.db.settings;
  if(path=='/clock'){
   if(s.gps){const{lat,lng,acc}=b;if(typeof lat!='number'||typeof lng!='number')return J({error:'Lokasi belum terbaca'},400);
    if(acc>(+s.acc||100))return J({error:'Sinyal GPS kurang akurat'},400);
    if(!r.db.locs.some(l=>dist(lat,lng,+l.lat,+l.lng)<=+l.r))return J({error:'Anda di luar jangkauan lokasi absen'},400)}
   return done(await mutate(e,d=>{const x=d.attendance.find(z=>z.emp==me.emp&&z.date==t.date);
    if(b.type=='in'){if(x&&x.in)return{err:'Sudah absen masuk hari ini'};if(x)x.in=t.time;else d.attendance.push({id:uid(),emp:me.emp,date:t.date,in:t.time,out:'',note:'Absen mandiri'})}
    else{if(!x||!x.in)return{err:'Belum absen masuk'};if(x.out)return{err:'Sudah absen pulang hari ini'};x.out=t.time}
    return{out:{time:t.time}}}))}
  if(path=='/request'){const k=b.kind;
   if(k=='Lembur'){if(!DR.test(b.date)||!TR.test(b.from)||!TR.test(b.to))return J({error:'Data tidak valid'},400);
    return done(await mutate(e,d=>{d.overtime.push({id:uid(),emp:me.emp,date:b.date,from:b.from,to:b.to,note:String(b.note||'').slice(0,200),status:'Menunggu'});return{}}))}
   const to=DR.test(b.to)?b.to:b.from;if(!KIND.includes(k)||!DR.test(b.from)||to<b.from)return J({error:'Data tidak valid'},400);
   return done(await mutate(e,d=>{d.leaves.push({id:uid(),emp:me.emp,type:k,from:b.from,to,reason:String(b.reason||'').slice(0,200)+(TR.test(b.time)?` (jam ${b.time})`:''),status:'Menunggu'});return{}}))}
  if(path=='/slip'){if(!/^\d{4}-\d\d$/.test(b.period))return J({error:'Periode tidak valid'},400);
   return done(await mutate(e,d=>{if(d.slips.some(x=>x.emp==me.emp&&x.period==b.period))return{err:'Slip periode ini sudah diajukan'};d.slips.push({id:uid(),emp:me.emp,period:b.period,status:'Diminta',date:t.date});return{}}))}
  return J({error:'not found'},404)
 }catch(err){return J({error:String(err)},500)}}}
