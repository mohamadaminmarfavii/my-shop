import {active,sum,rate,SUPPLIERS} from './model.js';
const isOrderActive=o=>o.status!=='cancelled';
function group(rows,key){const out=new Map();for(const r of rows){const value=r[key];if(!out.has(value))out.set(value,[]);out.get(value).push(r);}return out;}
export function financeIndex(s){return Object.fromEntries(['items','customerRefunds','expenses','receipts','snappSettlements'].map(k=>[k,group(s[k],'orderId')]));}
export function orderMetrics(s,options={}){const index=financeIndex(s);return s.orders.map(o=>({...o,...orderAmounts(s,o,{...options,index})}));}

export function context(s,{from=s.meta.start,to='9999/99/99'}={}){const orders=s.orders.filter(o=>o.date>=from&&o.date<=to);return {orders,ids:new Set(orders.map(o=>o.id)),from,to};}
export function orderAmounts(s,o,{to='9999/99/99',index=null}={}){
 const related=k=>index?(index[k].get(o.id)||[]):s[k].filter(r=>r.orderId===o.id);
 const inTime=r=>!r.date||r.date<=to;
 const its=related('items'),refunds=related('customerRefunds').filter(r=>active(r)&&inTime(r)),gross=sum(its,i=>i.sale*i.quantity);
 const cancelled=!isOrderActive(o),discount=o.discount||0,salesReduction=sum(refunds,r=>r.salesReduction||0);
 const costKnown=its.length>0&&its.every(i=>i.cost!==null&&i.cost!==undefined)&&!o.needsReview;
 const cost=Math.max(0,sum(its,i=>(i.cost||0)*i.quantity)-sum(refunds,r=>r.costReduction||0));
 const netSales=cancelled?0:Math.max(0,gross-discount-salesReduction);
 const base=o.channel==='snapp'?(o.snappAmount||0):Math.max(0,gross-discount),commission=rate(base,o.feeBps||0),vat=rate(commission,o.vatBps||0);
 const fee=Math.max(0,commission+vat-sum(refunds,r=>r.feeRecovered||0));
 const expenses=sum(related('expenses').filter(e=>active(e)&&inTime(e)));
 const receipts=related('receipts').filter(r=>active(r)&&inTime(r)&&r.confirmed),settlements=related('snappSettlements').filter(r=>active(r)&&inTime(r)&&r.confirmed);
 const received=sum(receipts)+sum(settlements),refundCash=sum(refunds.filter(r=>r.confirmed)),feeWithheld=sum(settlements,r=>r.feeWithheld||0);
 const profit=cancelled?0:costKnown?netSales-cost-fee-expenses:null;
 const realized=profit===null||cancelled?0:Math.max(0,Math.min(profit,received-refundCash-cost-expenses-Math.max(0,fee-feeWithheld)));
 const snappReduction=sum(refunds,r=>r.snappReduction||0);
 const snappNet=!cancelled&&o.channel==='snapp'?Math.max(0,base-fee-snappReduction):0,retention=snappNet-Math.round(snappNet*0.9);
 const retentionReceived=sum(settlements.filter(x=>x.kind==='retention'));
 const rows=its.map(i=>{const weight=gross>0?i.sale*i.quantity/gross:0;const returned=sum(refunds.filter(r=>r.itemId===i.id),r=>r.costReduction||0);return {item:i,profit:Math.max(0,Math.round((netSales-fee-expenses)*weight)-Math.max(0,(i.cost||0)*i.quantity-returned))};});
 const positive=sum(rows,r=>r.profit);let partnerRealized=0;
 for(const r of rows){const rules=s.rules.filter(x=>active(x)&&x.supplier===r.item.supplier&&(!x.from||o.date>=x.from)&&(!x.to||o.date<=x.to));const bps=sum(rules,x=>x.bps);const part=positive?Math.floor(realized*r.profit/positive):0;partnerRealized+=rate(part,bps);}
 return {id:o.id,gross,netSales,cost:cancelled?0:cost,fee:cancelled?0:fee,commission,vat,expenses,profit,realized,received,refundCash,feeWithheld,partnerRealized,personalRealized:Math.max(0,realized-partnerRealized),costKnown,retentionPending:Math.max(0,retention-retentionReceived),snappPending:Math.max(0,snappNet-sum(settlements)),customerDue:cancelled?0:Math.max(0,netSales-(o.channel==='snapp'?Math.max(0,base-snappReduction):0)-sum(receipts)+refundCash),explanation:{gross,discount,salesReduction,cost,fee,expenses,received,refundCash,feeWithheld}};
}
export function itemRows(s,options={}){
 const c=context(s,options),activeOrders=new Map(c.orders.filter(isOrderActive).map(o=>[o.id,o]));
 const payments=new Map(s.payments.filter(p=>active(p)&&p.date>=c.from&&p.date<=c.to).map(p=>[p.id,p]));
 const paidByItem=new Map(),returnedByItem=new Map();
 for(const a of s.allocations)if(payments.has(a.paymentId))paidByItem.set(a.itemId,(paidByItem.get(a.itemId)||0)+a.amount);
 for(const r of s.customerRefunds)if(active(r)&&r.date<=c.to)returnedByItem.set(r.itemId,(returnedByItem.get(r.itemId)||0)+(r.costReduction||0));
 return s.items.filter(i=>activeOrders.has(i.orderId)).map(i=>{const cost=Math.max(0,(i.cost||0)*i.quantity-(returnedByItem.get(i.id)||0)),paid=paidByItem.get(i.id)||0;return {...i,order:activeOrders.get(i.orderId),totalCost:cost,paid,remaining:Math.max(0,cost-paid),status:i.cost===null?'نیازمند بررسی':paid>=cost?'تسویه‌شده':paid?'تسویه جزئی':'تسویه‌نشده'};});
}
export function supplierRows(s,options={}){const c=context(s,options),rows=itemRows(s,options),opening=s.openings.find(x=>x.date===c.from);const ids=new Set([...Object.keys(SUPPLIERS).filter(x=>x!=='unknown'),...rows.map(x=>x.supplier),...s.payments.map(x=>x.supplier),...Object.keys(opening?.supplierBalances||{})]);return [...ids].map(id=>{const payments=s.payments.filter(p=>active(p)&&p.supplier===id&&p.date>=c.from&&p.date<=c.to),purchase=sum(rows.filter(x=>x.supplier===id),x=>x.totalCost),paid=sum(payments),allocated=sum(rows.filter(x=>x.supplier===id),x=>x.paid),refund=sum(s.supplierRefunds.filter(x=>active(x)&&x.confirmed&&x.supplier===id&&x.date>=c.from&&x.date<=c.to));const initial=opening?.supplierBalances?.[id]||0;return {id,name:SUPPLIERS[id]||id,purchase,paid,allocated,initial,refund,balance:initial+purchase-paid+refund,itemDebt:purchase-allocated,credit:Math.max(0,paid-allocated-refund-Math.max(0,initial))};});}
export function summary(s,options={}){const c=context(s,options),index=financeIndex(s),m=c.orders.map(o=>orderAmounts(s,o,{to:c.to,index}));const valid=x=>active(x)&&x.date>=c.from&&x.date<=c.to&&(!x.orderId||c.ids.has(x.orderId));const receipts=s.receipts.filter(x=>valid(x)&&x.confirmed&&x.type!=='supplier-direct'),settlements=s.snappSettlements.filter(x=>valid(x)&&x.confirmed),payments=s.payments.filter(x=>valid(x)&&x.source!=='customer-direct'),refunds=s.customerRefunds.filter(x=>valid(x)&&x.confirmed),supplierRefunds=s.supplierRefunds.filter(x=>valid(x)&&x.confirmed),expenses=s.expenses.filter(valid),shares=s.sharePayments.filter(valid),withdrawals=s.withdrawals.filter(valid);const opening=s.openings.find(x=>x.date===c.from);
 const cash=(opening?.cash||0)+sum(receipts)+sum(settlements)+sum(supplierRefunds)-sum(payments)-sum(refunds)-sum(expenses.filter(x=>x.paid))-sum(shares)-sum(withdrawals);
 const suppliers=supplierRows(s,options),supplierDue=sum(suppliers,x=>Math.max(0,x.balance)),partnerRealized=sum(m,x=>x.partnerRealized),partnerDue=Math.max(0,partnerRealized-sum(shares)),unpaidExpenses=sum(expenses.filter(x=>!x.paid)),pendingRefunds=sum(s.customerRefunds.filter(x=>valid(x)&&!x.confirmed)),personalRealized=sum(m,x=>x.personalRealized),remainingProfit=Math.max(0,personalRealized-sum(withdrawals)-sum(expenses.filter(x=>!x.orderId))),freeCash=Math.max(0,cash-supplierDue-partnerDue-unpaidExpenses-pendingRefunds),unknown=s.meta.financeComplete===false||m.some(x=>!x.costKnown);
 return {sales:sum(m,x=>x.netSales),cost:sum(m,x=>x.cost),fee:sum(m,x=>x.fee),profit:sum(m,x=>x.profit||0)-sum(expenses.filter(x=>!x.orderId)),realized:sum(m,x=>x.realized),personalRealized,partnerRealized,partnerDue,cash,freeCash,withdrawable:unknown?0:Math.min(remainingProfit,freeCash),unknown,supplierDue,retention:sum(m,x=>x.retentionPending),snappPending:sum(m,x=>x.snappPending),customerDue:sum(m,x=>x.customerDue),orders:m,explanation:{opening:opening?.cash||0,customerReceipts:sum(receipts),snappReceipts:sum(settlements),supplierRefunds:sum(supplierRefunds),supplierPayments:sum(payments),refunds:sum(refunds),expenses:sum(expenses.filter(x=>x.paid)),partnerPayments:sum(shares),withdrawals:sum(withdrawals),supplierDue,partnerDue,unpaidExpenses,pendingRefunds,remainingProfit,freeCash}};
}
