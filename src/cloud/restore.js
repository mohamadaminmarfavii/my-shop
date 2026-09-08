// Read-only compatibility with the two records used by OMS v9.
// Connection values remain in the form only; never saved in application settings.
export function connection({url,key,workspace='main',token=''}){
 const u=new URL(url.trim());if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(u.href))throw Error('نشانی پروژه باید مانند https://project.supabase.co باشد');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(workspace))throw Error('شناسه فضای کاری نامعتبر است');
 key=key.trim();token=token.trim();const headers={apikey:key};
 function role(jwt){try{return JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{return null;}}
 if(key.startsWith('sb_secret_')||role(key)==='service_role'||role(token)==='service_role')throw Error('کلید مدیریتی برای برنامه مرورگر مجاز نیست؛ Publishable یا anon را وارد کنید');
 if(!key.startsWith('sb_publishable_')&&role(key)!=='anon')throw Error('کلید Publishable یا anon معتبر وارد کنید');
 if(token)headers.Authorization=`Bearer ${token}`;else if(role(key)==='anon')headers.Authorization=`Bearer ${key}`;
 const endpoint=new URL('/rest/v1/oms_data',u);endpoint.searchParams.set('id',`in.(${workspace},${workspace}__accounting)`);endpoint.searchParams.set('select','id,payload,updated_at');
 return {url:endpoint.href,headers,workspace};
}
export async function readOnlineBackup(input,fetcher=fetch){
 const c=connection(input),response=await fetcher(c.url,{method:'GET',headers:c.headers,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`دریافت پشتیبان انجام نشد (${response.status}). نشانی، کلید و دسترسی خواندن را بررسی کنید.`);
 const rows=await response.json();if(!Array.isArray(rows))throw Error('پاسخ سرور ساختار معتبر ندارد');
 const main=rows.find(r=>r.id===c.workspace),accounting=rows.find(r=>r.id===`${c.workspace}__accounting`);
 if(!main?.payload||!Object.keys(main.payload).length)throw Error('پشتیبان سفارش‌ها در این فضای کاری پیدا نشد؛ هیچ اطلاعاتی تغییر نکرد');
 if(main.payload.format==='OMS_PRO_BACKUP')return {backup:main.payload,updatedAt:main.updated_at,hasAccounting:true};
 return {backup:{main:main.payload,accounting:accounting?.payload??null},updatedAt:main.updated_at,accountingUpdatedAt:accounting?.updated_at??null,hasAccounting:!!accounting?.payload};
}
