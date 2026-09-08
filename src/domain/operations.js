import {active,integer,normalizeDate,sum,uid,log,TABLES,SCHEMA} from './model.js';
import {itemRows,summary} from './finance.js';
function stateAllocations(s,p){return (p.manualAllocations||[]).map(a=>({...a,paymentId:p.id}));}
function allocationPlan(s,p){
 let rows=itemRows(s,{from:s.meta.start}).filter(r=>r.supplier===p.supplier&&r.remaining>0&&r.cost!==null&&r.order.date<=p.date);
 if(p.mode==='none')return [];
 if(p.mode==='manual'){const prior=stateAllocations(s,p);for(const a of prior){const row=rows.find(r=>r.id===a.itemId);if(!row||row.remaining<a.amount)throw Error('تخصیص دستی ظرفیت کافی ندارد');}return prior;}
 if(p.mode==='target'){
  const order=s.orders.find(o=>o.id===p.orderId);if(!order||order.date<s.meta.start||order.date>p.date||order.status==='cancelled')throw Error('سفارش هدف معتبر نیست؛ اتصال خودکار انجام نشد');
  const targets=s.items.filter(i=>i.orderId===p.orderId&&i.supplier===p.supplier);if(!targets.length)throw Error('سفارش هدف برای این تأمین‌کننده قلمی ندارد');
  if(p.itemIds?.some(id=>!targets.some(i=>i.id===id)))throw Error('قلم هدف متعلق به سفارش و تأمین‌کننده نیست');
  rows=rows.filter(r=>r.orderId===p.orderId&&(!p.itemIds?.length||p.itemIds.includes(r.id)));
 }else if(p.mode!=='fifo')throw Error('نوع اتصال باید صریح انتخاب شود');
 rows.sort((a,b)=>a.order.date.localeCompare(b.order.date)||a.id.localeCompare(b.id));
 if(p.mode==='target'&&p.itemIds?.length)rows.sort((a,b)=>p.itemIds.indexOf(a.id)-p.itemIds.indexOf(b.id));
 let left=p.amount;const out=[];for(const row of rows){const amount=Math.min(left,row.remaining);if(amount>0)out.push({id:`${p.id}:${row.id}`,paymentId:p.id,itemId:row.id,amount});left-=amount;if(left===0)break;}return out;
}
export function putPayment(state,input,{device='local'}={}){
 const s=structuredClone(state),old=s.payments.find(p=>p.id===input.id);const p={...old,...input,id:input.id||uid(),amount:integer(input.amount),date:normalizeDate(input.date),active:true,createdAt:old?.createdAt??Date.now()};
 if(p.amount===0)throw Error('مبلغ پرداخت باید بیشتر از صفر باشد');if(!p.supplier||p.supplier==='unknown')throw Error('تأمین‌کننده را تعیین کنید');if(p.date<s.meta.start)throw Error('پرداخت جاری باید پس از مبنای حساب باشد');if(!['bank','cash','customer-direct'].includes(p.source))throw Error('منبع پول معتبر نیست');
 s.allocations=s.allocations.filter(a=>a.paymentId!==p.id);s.payments=s.payments.filter(x=>x.id!==p.id);const allocations=allocationPlan(s,p);s.payments.push(p);s.allocations.push(...allocations);
 log(s,old?'payment.edit':'payment.create',old,p,device);validateState(s);return s;
}
export function deletePayment(state,id){const p=state.payments.find(p=>p.id===id);if(!p)throw Error('پرداخت پیدا نشد');if(!active(p))return state;if(p.source==='customer-direct')throw Error('دریافت مستقیم و پرداخت مرتبط باید از رویداد مستقیم مدیریت شوند');const s=structuredClone(state),row=s.payments.find(p=>p.id===id);row.savedAllocations=s.allocations.filter(a=>a.paymentId===id);row.active=false;s.allocations=s.allocations.filter(a=>a.paymentId!==id);log(s,'payment.delete',p,row);validateState(s);return s;}
export function restorePayment(state,id){const p=state.payments.find(p=>p.id===id);if(!p)throw Error('پرداخت پیدا نشد');if(active(p))return state;const s=structuredClone(state),row=s.payments.find(p=>p.id===id);row.active=true;for(const a of row.savedAllocations||[]){const item=itemRows(s).find(x=>x.id===a.itemId);if(!item||item.supplier!==p.supplier||item.remaining<a.amount)throw Error('تعارض بازیابی: قلم قبلی ظرفیت تخصیص ندارد؛ ابتدا پرداخت‌های مرتبط را بررسی کنید');s.allocations.push({...a});}log(s,'payment.restore',p,row);validateState(s);return s;}
export function reconcile(state){const s=structuredClone(state);s.allocations=[];const payments=s.payments.filter(active).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));for(const p of payments)s.allocations.push(...allocationPlan(s,p));validateState(s);return s;}
export function postDirectReceipt(state,r){if(!r.supplier||!r.orderId)throw Error('سفارش و تأمین‌کننده دریافت مستقیم ضروری است');const s=structuredClone(state);if(s.receipts.some(x=>x.id===r.id))throw Error('دریافت تکراری است');s.receipts.push({...r,amount:integer(r.amount),confirmed:true,type:'supplier-direct'});return putPayment(s,{id:`direct:${r.id}`,receiptId:r.id,supplier:r.supplier,amount:r.amount,date:r.date,mode:'target',orderId:r.orderId,itemIds:r.itemIds||[],source:'customer-direct'});}
export function validateState(s){
 if(s.meta?.schema!==SCHEMA)throw Error('نسخه داده پشتیبانی نمی‌شود');normalizeDate(s.meta.start);
 for(const name of TABLES){if(!Array.isArray(s[name]))throw Error(`جدول ${name} موجود نیست`);const ids=new Set();for(const r of s[name]){if(!r.id||ids.has(r.id))throw Error(`شناسه مفقود یا تکراری در ${name}`);ids.add(r.id);}}
 const orderMap=new Map(s.orders.map(o=>[o.id,o])),items=new Map(s.items.map(i=>[i.id,i])),payments=new Map(s.payments.map(p=>[p.id,p]));
 for(const o of s.orders){if(!['active','cancelled'].includes(o.status)||!['cash','snapp'].includes(o.channel))throw Error('وضعیت یا روش پرداخت سفارش معتبر نیست');if(o.date!==null||!o.needsReview)normalizeDate(o.date);for(const k of ['discount','snappAmount','feeBps','vatBps'])if(o[k]!==undefined)integer(o[k]);if((o.feeBps||0)>10000||(o.vatBps||0)>10000)throw Error('درصد کارمزد نامعتبر است');}
 for(const i of s.items){if(!orderMap.has(i.orderId))throw Error('قلم بدون سفارش');if(typeof i.sale!=='number'||typeof i.quantity!=='number'||(i.cost!==null&&typeof i.cost!=='number'))throw Error('مبلغ و تعداد قلم باید عدد باشند');integer(i.sale);if(i.cost!==null)integer(i.cost);if(integer(i.quantity)<1)throw Error('تعداد قلم باید مثبت باشد');}
 for(const table of ['receipts','snappSettlements','payments','allocations','supplierRefunds','expenses','customerRefunds','sharePayments','withdrawals'])for(const r of s[table]){integer(r.amount);if(table!=='allocations'&&!r.date)throw Error('تاریخ رویداد مالی لازم است');if(r.date)normalizeDate(r.date);if(typeof r.amount!=='number')throw Error('مبلغ ذخیره‌شده باید عدد باشد');if(r.orderId&&!orderMap.has(r.orderId))throw Error('رویداد بدون سفارش معتبر');}
 for(const r of s.snappSettlements){integer(r.feeWithheld??0);if(!['ninety','retention'].includes(r.kind))throw Error('نوع واریزی اسنپ معتبر نیست');}
 for(const r of s.customerRefunds){for(const k of ['salesReduction','costReduction','feeRecovered','snappReduction'])if(r[k]!==undefined)integer(r[k]);if(r.itemId&&items.get(r.itemId)?.orderId!==r.orderId)throw Error('قلم مرجوعی متعلق به سفارش نیست');if(r.costReduction&&!r.itemId)throw Error('کاهش بهای خرید باید به قلم مرجوعی متصل باشد');}
 for(const o of s.orders){const rows=s.items.filter(i=>i.orderId===o.id);if(sum(s.customerRefunds.filter(r=>active(r)&&r.orderId===o.id),r=>r.salesReduction||0)+(o.discount||0)>sum(rows,i=>i.sale*i.quantity))throw Error('تخفیف و مرجوعی بیش از فروش سفارش است');}
 for(const i of s.items)if(sum(s.customerRefunds.filter(r=>active(r)&&r.itemId===i.id),r=>r.costReduction||0)>(i.cost||0)*i.quantity)throw Error('بهای مرجوعی بیش از بهای قلم است');
 const byPayment=new Map(),byItem=new Map();for(const a of s.allocations){const p=payments.get(a.paymentId),i=items.get(a.itemId);if(!p||!active(p)||!i)throw Error('تخصیص بدون پرداخت فعال یا قلم');if(p.supplier!==i.supplier)throw Error('تأمین‌کننده تخصیص اشتباه است');if(p.mode==='none'||(p.mode==='target'&&(p.orderId!==i.orderId||(p.itemIds?.length&&!p.itemIds.includes(i.id)))))throw Error('تخصیص خارج از هدف پرداخت');byPayment.set(p.id,(byPayment.get(p.id)||0)+a.amount);byItem.set(i.id,(byItem.get(i.id)||0)+a.amount);}
 for(const p of s.payments){if((byPayment.get(p.id)||0)>p.amount)throw Error('تخصیص بیشتر از مبلغ پرداخت');if(!['target','fifo','none','manual'].includes(p.mode))throw Error('حالت تخصیص نامعتبر');if(p.source==='customer-direct'&&active(p)){const r=s.receipts.find(r=>r.id===p.receiptId&&r.type==='supplier-direct'&&r.confirmed&&active(r));if(!r||r.amount!==p.amount||r.orderId!==p.orderId)throw Error('پرداخت مستقیم فاقد دریافت مرتبط معتبر است');}}
 for(const i of s.items){const returns=sum(s.customerRefunds.filter(r=>active(r)&&r.itemId===i.id),r=>r.costReduction||0);if((byItem.get(i.id)||0)>Math.max(0,(i.cost||0)*i.quantity-returns))throw Error('تخصیص بیشتر از بهای خالص قلم؛ ابتدا تخصیص مرتبط را اصلاح کنید');}
 for(const o of s.openings){normalizeDate(o.date);if(!Number.isSafeInteger(o.cash))throw Error('مانده شروع معتبر نیست');for(const v of Object.values(o.supplierBalances||{}))if(!Number.isSafeInteger(v))throw Error('مانده تأمین‌کننده معتبر نیست');}if(new Set(s.openings.map(o=>o.date)).size!==s.openings.length)throw Error('مانده شروع تکراری');
 for(const r of s.rules)if(integer(r.bps)>10000)throw Error('سهم همکاری بیش از صد درصد');for(const sup of new Set(s.rules.map(r=>r.supplier)))if(sum(s.rules.filter(r=>active(r)&&r.supplier===sup),r=>r.bps)>10000)throw Error('مجموع قواعد همکاری بیش از صد درصد');

 for(const r of s.receipts.filter(r=>active(r)&&r.type==='supplier-direct')){const ps=s.payments.filter(p=>active(p)&&p.source==='customer-direct'&&p.receiptId===r.id);if(ps.length!==1||ps[0].amount!==r.amount||ps[0].supplier!==r.supplier||ps[0].date!==r.date)throw Error('دریافت مستقیم و پرداخت مرتبط با هم مطابقت ندارند');}
 const references=new Set();for(const table of ['receipts','snappSettlements','payments','supplierRefunds','customerRefunds'])for(const r of s[table].filter(active)){if(!r.reference?.trim())continue;const key=table+':'+r.reference.trim();if(references.has(key))throw Error('شماره پیگیری تکراری است');references.add(key);}

 for(const parent of s.snappSettlements){const children=s.snappSettlements.filter(r=>active(r)&&r.groupId===parent.id);if(children.length&&(active(parent)||sum(children)>parent.amount))throw Error('واریزی تجمیعی و سهم‌های آن نباید هم‌زمان دوباره محاسبه شوند');}
 summary(s);return true;
}

export function editDirectReceipt(state,input){
 const old=state.receipts.find(r=>r.id===input.id);if(!old||old.type!=='supplier-direct')throw Error('دریافت مستقیم پیدا نشد');
 const s=structuredClone(state),p=s.payments.find(p=>p.receiptId===old.id&&p.source==='customer-direct');
 if(!p)throw Error('پرداخت مرتبط پیدا نشد');
 s.receipts=s.receipts.filter(r=>r.id!==old.id);s.payments=s.payments.filter(x=>x.id!==p.id);s.allocations=s.allocations.filter(a=>a.paymentId!==p.id);
 return postDirectReceipt(s,{...old,...input,active:true});
}
export function setEventActive(state,table,id,enabled){
 if(!['receipts','snappSettlements','supplierRefunds','expenses','customerRefunds','sharePayments','withdrawals'].includes(table))throw Error('نوع رویداد نامعتبر است');
 const old=state[table].find(r=>r.id===id);if(!old)throw Error('رویداد پیدا نشد');if(active(old)===enabled)return state;
 const s=structuredClone(state),row=s[table].find(r=>r.id===id);row.active=enabled;
 if(table==='receipts'&&row.type==='supplier-direct'){
  const p=s.payments.find(p=>p.receiptId===id&&p.source==='customer-direct');if(!p)throw Error('پرداخت مرتبط پیدا نشد');
  p.active=enabled;
  if(enabled){s.allocations=s.allocations.filter(a=>a.paymentId!==p.id);s.allocations.push(...allocationPlan(s,p));}
  else s.allocations=s.allocations.filter(a=>a.paymentId!==p.id);
 }
 log(s,enabled?'event.restore':'event.delete',old,{table,...row});validateState(s);return s;
}

export function splitSettlement(state,id,parts){
 const original=state.snappSettlements.find(r=>r.id===id&&active(r));if(!original)throw Error('واریزی فعال پیدا نشد');
 if(!parts.length)throw Error('حداقل یک سهم لازم است');const ids=new Set();
 const rows=parts.map(r=>{const o=state.orders.find(o=>o.id===r.orderId);if(!o||o.channel!=='snapp'||o.status==='cancelled'||!o.date||o.date>original.date)throw Error('سفارش سهم واریزی معتبر نیست');if(ids.has(o.id))throw Error('سفارش تکراری است');ids.add(o.id);return {...original,id:uid(),orderId:o.id,amount:integer(r.amount),feeWithheld:integer(r.feeWithheld||0),groupId:original.groupId||original.id,reference:'',note:original.note||'',needsFeeReview:false};});
 if(rows.some(r=>!r.amount)||sum(rows)!==original.amount||sum(rows,r=>r.feeWithheld)!==(original.feeWithheld||0))throw Error('جمع سهم‌ها و کارمزدها باید دقیقاً با واریزی اولیه برابر باشد');
 const s=structuredClone(state);s.snappSettlements.find(r=>r.id===id).active=false;s.snappSettlements.push(...rows);log(s,'snapp.split',original,rows);validateState(s);return s;
}

export function putCustomerRefund(state,input){
 const s=structuredClone(state),old=s.customerRefunds.find(r=>r.id===input.id);const row={...old,...input,id:input.id||uid(),amount:integer(input.amount),date:normalizeDate(input.date),active:true};
 for(const key of ['salesReduction','costReduction','feeRecovered','snappReduction'])row[key]=integer(input[key]??0);
 s.customerRefunds=s.customerRefunds.filter(r=>r.id!==row.id);s.customerRefunds.push(row);
 if(row.itemId){const item=s.items.find(i=>i.id===row.itemId);if(!item||item.orderId!==row.orderId)throw Error('قلم مرجوعی معتبر نیست');let capacity=(item.cost||0)*item.quantity-sum(s.customerRefunds.filter(r=>active(r)&&r.itemId===item.id),r=>r.costReduction||0);if(capacity<0)throw Error('بهای مرجوعی بیشتر از بهای قلم است');
  s.allocations=s.allocations.flatMap(a=>{if(a.itemId!==item.id)return [a];const amount=Math.min(a.amount,capacity);capacity-=amount;return amount>0?[{...a,amount}]:[];});
  for(const p of s.payments)if(p.mode==='manual')p.manualAllocations=s.allocations.filter(a=>a.paymentId===p.id);
 }
 log(s,old?'refund.edit':'refund.create',old,row);validateState(s);return s;
}
