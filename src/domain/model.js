export const VERSION='10.0.0-rc.2';
export const SCHEMA=1;
export const TABLES=['orders','items','products','receipts','snappSettlements','payments','allocations','supplierRefunds','expenses','customerRefunds','rules','sharePayments','withdrawals','openings','audit'];
export const SUPPLIERS={ali:'علی ورساچ',vahid:'وحید نظری',unknown:'نیازمند تعیین تأمین‌کننده'};
export function uid(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export const digits=v=>String(v??'').replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c));
export function integer(v){const t=digits(v).replace(/[٬,\s]/g,'');if(!/^\d+$/.test(t))throw Error('مبلغ باید عدد صحیح و نامنفیِ تومان باشد');const n=Number(t);if(!Number.isSafeInteger(n))throw Error('مبلغ خارج از محدوده امن است');return n;}
export function signedInteger(v){const t=digits(v).trim();return t.startsWith('-')?-integer(t.slice(1)):integer(t);}
export function normalizeDate(v){const x=digits(v).trim().split('/');if(x.length!==3)throw Error('تاریخ را مانند ۱۴۰۵/۰۶/۰۱ وارد کنید');const [y,m,d]=x.map(integer);if(y<1200||y>1600||m<1||m>12||d<1||d>(m<=6?31:30))throw Error('تاریخ نامعتبر است');return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;}
export function today(){return normalizeDate(new Intl.DateTimeFormat('fa-IR',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'}).format(new Date()));}
export function supplierId(v){const n=String(v??'').toLowerCase().replace(/[\s‌\-]/g,'');if(['علیورساچ','علیورساچه','aliversace','ali'].includes(n))return 'ali';if(['وحید','وحیدنظری','vahid'].includes(n))return 'vahid';return n?`other:${n}`:'unknown';}
export const sum=(rows,fn=x=>x.amount)=>rows.reduce((s,x)=>{const n=s+fn(x);if(!Number.isSafeInteger(n))throw Error('جمع مالی خارج از محدوده امن است');return n;},0);
export const rate=(amount,bps)=>Number((BigInt(integer(amount))*BigInt(integer(bps))+5000n)/10000n);
export function emptyState(){return {...Object.fromEntries(TABLES.map(k=>[k,[]])),meta:{schema:SCHEMA,revision:0,start:'1405/06/01',financeComplete:true,lastSaved:null},settings:{theme:'light'}};}
export const active=x=>x.active!==false;
export function log(s,action,before,after,device='local'){s.audit.push({id:uid(),action,at:Date.now(),device,before:before??null,after:after??null});}
