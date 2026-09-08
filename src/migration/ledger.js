import {integer,normalizeDate,supplierId,active,sum} from '../domain/model.js';
import {validateState} from '../domain/operations.js';
// Only explicit source facts are mapped. Ambiguous records remain in the original
// snapshot and are listed individually; no inferred receipt or FIFO allocation.
export function importLedger(state,accounting,main,warn){
 if(!accounting||typeof accounting!=='object')return state;
 let s=structuredClone(state);const v=accounting.financialV2||{},aliases=new Map();
 for(const o of main.orders)for(const [ix,it] of (o.items||[]).entries()){
  const mapped=s.items.find(i=>i.legacyOrderIndex===main.orders.indexOf(o)&&i.legacyItemIndex===ix);if(!mapped)continue;
  for(const tail of new Set([it.id,it.productId,ix,'item'].filter(x=>x!==undefined&&x!==null&&x!==''))){
   for(const key of [`${o.id}::row-${ix}::${tail}`,`${o.id}::${tail}`]){const prior=aliases.get(key);aliases.set(key,prior&&prior!==mapped.id?null:mapped.id);}
  }
 }
 const orderIds=new Set(s.orders.map(o=>o.id));
 function process(source,table,mapper){
  if(!Array.isArray(source))return;const counts=new Map();for(const r of source)counts.set(String(r.id),(counts.get(String(r.id))||0)+1);
  const reversals=source.filter(r=>r.kind==='reversal'&&!r.voided);
  for(const r of source){
   const entity=`${table}/${r.id??'بدون شناسه'}`;
   try{
    if(r.kind==='reversal'){warn('reversal-preserved','رکورد برگشت در اصل پشتیبان محفوظ است؛ اثر آن فقط با تطبیق مبلغ روی رکورد مبنا اعمال می‌شود',entity);continue;}
    if(!r.id||counts.get(String(r.id))!==1)throw Error('شناسه مفقود یا تکراری؛ نیازمند بررسی');
    const amount=integer(r.amount),date=normalizeDate(r.dateFa||r.date);const rev=reversals.filter(x=>String(x.reversesId)===String(r.id));
    if(rev.length>1||rev.some(x=>integer(x.amount)!==amount))throw Error('برگشت تکراری یا مبلغ نامنطبق');
    const record=mapper(r,{id:`legacy:${table}:${r.id}`,amount,date,active:!r.voided&&!r.deleted&&!rev.length,reference:r.reference||'',note:r.note||'',legacyId:r.id});
    if(!record)continue;
    const next=structuredClone(s);next[table].push(record);
    if(record._allocations){next.allocations.push(...record._allocations);delete record._allocations;}
    validateState(next);s=next;
    if(date<s.meta.start)warn('archived-event','رویداد پیش از مبنا به آرشیو منتقل شد و در حساب جاری اثر ندارد',entity);
   }catch(error){warn('unmapped-event',error.message+'؛ رکورد کامل در اصل پشتیبان محفوظ است',entity);}
  }
 }
 const opening=v.periodOpenings?.[s.meta.start.slice(0,7)]||v.opening;
 if(opening&&Object.hasOwn(opening,'cashBalance')){try{const cash=Number(opening.cashBalance);if(!Number.isSafeInteger(cash))throw Error('مانده شروع نامعتبر');const balances={};for(const [name,value] of Object.entries(opening.suppliers||{})){const n=Number(value);if(!Number.isSafeInteger(n))throw Error('مانده تأمین‌کننده نامعتبر');const sup=supplierId(name);if(Object.hasOwn(balances,sup))throw Error('مانده شروع با نام تکراری تأمین‌کننده');balances[sup]=n;}s.openings.push({id:'legacy:opening',date:s.meta.start,cash,supplierBalances:balances});}catch(e){warn('opening-review',e.message);}}
 process(v.customerReceipts,'receipts',(r,b)=>{if(!orderIds.has(String(r.orderId)))throw Error('دریافت بدون سفارش معتبر');if(r.destination&&r.destination!=='merchant')throw Error('مقصد دریافت نیازمند تطبیق');return {...b,orderId:String(r.orderId),confirmed:r.confirmed!==false,type:'bank'};});
 process(v.expenses,'expenses',(r,b)=>({...b,orderId:r.orderId?String(r.orderId):undefined,paid:r.confirmed!==false}));
 process(v.personalWithdrawals,'withdrawals',(r,b)=>({...b}));
 process(v.partnerTransactions,'sharePayments',(r,b)=>{if(!['bank','cash','payment'].includes(r.kind))throw Error('نوع سهم همکاری نیازمند بررسی');return {...b,partner:r.partner||r.name||'نیازمند تعیین شریک'};});
 process(v.supplierTransactions,'payments',(r,b)=>{
  if(r.confirmed===false||r.accountingStatus==='archive_review')throw Error('پرداخت قدیمی تأیید نشده است');
  if(!['bank','cash'].includes(r.kind))throw Error('نوع پرداخت (مستقیم، تهاتر یا اصلاحی) نیازمند تطبیق مستقل است');
  const supplier=supplierId(r.supplier);if(supplier==='unknown')throw Error('تأمین‌کننده نامشخص');
  const allocations=(r.allocations||[]).map(a=>{const itemId=aliases.get(String(a.key));if(!itemId)throw Error('کلید قلم تخصیص مفقود یا مبهم');return {id:`${b.id}:${itemId}`,paymentId:b.id,itemId,amount:integer(a.amount)};});
  if(sum(allocations)>b.amount)throw Error('تخصیص بیش از مبلغ پرداخت');
  const target=r.targetOrderId?String(r.targetOrderId):null;
  if(target&&!orderIds.has(target))throw Error('سفارش هدف مفقود');
  // Preserve each exact allocation, including manual payments spanning orders.
  const mode=target?'target':allocations.length?'manual':'none';
  if(!allocations.length&&b.active)warn('unallocated-payment','پرداخت بدون تخصیص باقی ماند؛ اتصال خودکار انجام نشد',b.id);
  return {...b,supplier,source:r.kind,mode,orderId:target||undefined,itemIds:allocations.map(a=>a.itemId),manualAllocations:mode==='manual'?allocations:undefined,_allocations:b.active?allocations:[],savedAllocations:!b.active?allocations:undefined};
 });
 process(accounting.snappSettlements,'snappSettlements',(r,b)=>{
  const ids=r.orderIds||[];const orderId=ids.length===1?String(ids[0]):undefined;
  if(orderId&&!orderIds.has(orderId))throw Error('سفارش واریزی اسنپ مفقود');
  if(!orderId)warn('unallocated-settlement','واریزی تجمیعی هنوز به سفارش‌ها تخصیص نیافته است؛ تا تعیین سهم هر سفارش سود وصول‌شده نمی‌سازد',b.id);
  return {...b,orderId,kind:'ninety',confirmed:r.accountingStatus==='confirmed',feeWithheld:0,needsFeeReview:true,legacyOrderIds:ids};
 });
 for(const [name,rows] of Object.entries(accounting))if(['supplierPayments','profitPartnerPayments','snappRetentionPayouts'].includes(name)&&Array.isArray(rows)&&rows.length)warn('legacy-extra-ledger',`${rows.length} رکورد ${name} برای جلوگیری از دوباره‌شماری نیازمند تطبیق با دفتر جدید است`,name);
 if(Object.keys(v.orderLifecycle||{}).length||Object.keys(v.orderFinanceOverrides||{}).length)warn('legacy-overrides','وضعیت مرجوعی، لغو و اصلاح مبلغ سفارش‌ها باید با سند مالی تطبیق داده شود','order-overrides');
 return s;
}
