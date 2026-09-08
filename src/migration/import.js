import {importLedger} from './ledger.js';
import {emptyState,integer,supplierId,normalizeDate,TABLES,SCHEMA} from '../domain/model.js';
import {validateState} from '../domain/operations.js';
import {summary,orderAmounts} from '../domain/finance.js';
export function backup(state,legacySource=null){validateState(state);return {format:'OMS_PRO_BACKUP',schema:SCHEMA,createdAt:new Date().toISOString(),state,legacySource};}
export function inspectBackup(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('فایل پشتیبان معتبر نیست');
 if(input.format==='OMS_PRO_BACKUP'){if(input.schema!==SCHEMA)throw Error('نسخه پشتیبان جدیدتر یا ناسازگار است');const state=structuredClone(input.state);validateState(state);return {state,kind:'native',issues:[],raw:input.legacySource,counts:Object.fromEntries(TABLES.map(k=>[k,state[k].length])),totals:summary(state)};}
 const main=input.main||input.data||input;if(!Array.isArray(main.orders)||!Array.isArray(main.products))throw Error('ساختار این فایل شناخته نشد؛ هیچ داده‌ای تغییر نکرد');
 let s=emptyState();const issues=[],used=new Set();
 function warn(code,message,entity=''){issues.push({code,message,entity});}
 function idOf(raw,prefix,index){let id=raw===null||raw===undefined||raw===''?`${prefix}:legacy-${index}`:String(raw);if(used.has(`${prefix}:${id}`)){warn('duplicate-id','شناسه تکراری؛ شناسه مهاجرت جدا ساخته شد',id);id=`${id}:duplicate-${index}`;}used.add(`${prefix}:${id}`);if(raw===null||raw===undefined||raw==='')warn('missing-id','شناسه ثابت در منبع موجود نبود',id);return id;}
 function money(v,entity,nullable=false){try{return integer(v);}catch{warn('invalid-amount','مبلغ نامعتبر یا نامشخص؛ نیازمند بررسی',entity);if(nullable)return null;throw Error('مبلغ نامعتبر در '+entity+'؛ اصل فایل را نگه دارید و مقدار را از سند مشخص کنید');}}
 for(const [idx,p] of main.products.entries()){s.products.push({id:idOf(p.id,'product',idx),name:p.name_fa||p.name||p.name_en||'محصول بدون نام',supplier:supplierId(p.supplier),reference:money(p.buyPrice,p.id,true),sale:money(p.salePrice,p.id,true),note:p.note||'',legacyId:p.id});}
 const products=new Map(s.products.map(p=>[String(p.legacyId),p]));
 for(const [idx,o] of main.orders.entries()){
  const id=idOf(o.id,'order',idx);let date;try{date=normalizeDate(o.orderDateFa||o.dateFa);}catch{date=null;warn('missing-date','تاریخ سفارش در منبع موجود یا معتبر نیست؛ بدون تاریخ و خارج از حساب جاری حفظ شد',id);}
  const channel=String(o.orderChannel||'').includes('اسنپ')?'snapp':'cash';const order={id,date,customer:o.customerName||'بدون نام',code:o.customerCode||id,note:o.note||'',status:String(o.status||'').includes('لغو')?'cancelled':'active',channel,discount:channel==='snapp'?0:money(o.discount??0,id),feeBps:0,vatBps:0,needsReview:true,legacyStatus:o.status};
  s.orders.push(order);
  for(const [ix,it] of (o.items||[]).entries()){const product=products.get(String(it.productId));const supplier=supplierId(it.supplier||o.supplier||product?.supplier);let q;try{q=integer(it.qty??it.quantity??1);if(q===0)throw Error();}catch{throw Error('تعداد قلم در سفارش '+id+' نامعتبر است؛ انتقال بدون تعداد واقعی انجام نمی‌شود');}const cost=money(it.buyPrice,`${id}/${ix}`,true),sale=money(it.salePrice,`${id}/${ix}`);s.items.push({id:idOf(`${id}:${it.id??`row-${ix}`}`,'item',ix),orderId:id,legacyOrderIndex:idx,legacyItemIndex:ix,productId:product?.id||'',name:product?.name||it.name||'قلم بدون نام',supplier,quantity:q,cost,sale});if(supplier==='unknown')warn('unknown-supplier','تأمین‌کننده قلم نامشخص است',id);}
  if(channel==='snapp')warn('snapp-review','مبلغ ثبت‌شده اسنپ، تخفیف و نرخ کارمزد باید از سند مالی تأیید شود',id);
  const economic=orderAmounts(s,{...order,needsReview:false});if(o.profit!==undefined){let old;try{old=integer(o.profit);}catch{old=null;}if(old===null||old>economic.gross||old!==economic.profit)warn('stored-profit','سود ذخیره‌شده با محاسبه پایه یکسان نیست؛ مقدار قدیمی مبنای حساب نیست',id);}
 }
 s.meta.financeComplete=false;s.meta.importedAt=Date.now();s.meta.importKind='legacy';
 const accounting=input.accounting||main.accounting;
 s=importLedger(s,accounting,main,warn);
 s.meta.migrationIssues=issues;
 warn(accounting?'legacy-ledger-review':'missing-ledger',accounting?'رکوردهای دارای مبلغ، تاریخ و نگاشت روشن تبدیل شدند؛ موارد مبهم در اصل پشتیبان حفظ شدند و در گزارش آمده‌اند':'این پشتیبان دفتر مالی، دریافت‌ها و تخصیص پرداخت‌ها را ندارد');
 warn('no-receipts-inferred','از وضعیت «تسویه‌شده» هیچ دریافت یا پرداختی ساخته نشد');
 warn('no-opening-inferred','مانده شروع صفرِ تأییدشده فرض نشده؛ صندوق و سود قابل برداشت تا تکمیل حساب قابل اتکا نیست');
 validateState(s);return {state:s,kind:'legacy',issues,raw:input,counts:Object.fromEntries(TABLES.map(k=>[k,s[k].length])),totals:summary(s)};
}
