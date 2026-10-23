// Supabase Edge Function. Secrets MUST exist only in the server environment.
import { verified } from './verify.mjs';
const env=(k:string)=>Deno.env.get(k)||'';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}});
const uid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
async function supa(route:string,body:unknown,bearer:string,service=false){const r=await fetch(env('SUPABASE_URL')+route,{method:'POST',headers:{apikey:env(service?'SUPABASE_SERVICE_ROLE_KEY':'SUPABASE_ANON_KEY'),Authorization:bearer,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.message||'Database error');return d;}
const service=(name:string,data:unknown)=>supa('/rest/v1/rpc/'+name,data,'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),true);
async function provider(route:string,body?:unknown,key?:string){const r=await fetch('https://api.yookassa.ru/v3/payments'+route,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(env('YOOKASSA_SHOP_ID')+':'+env('YOOKASSA_SECRET_KEY')),'Content-Type':'application/json',...(key?{'Idempotence-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error('Провайдер не принял запрос ('+r.status+'). Проверь настройки магазина на сервере.');return d;}
async function synchronize(payment:any){const v=verified(payment,env('YOOKASSA_TEST_MODE')==='true');await service('fox_record_provider',{p_order:v.order,p_provider:v.id,p_kopeks:v.amount,p_canceled:v.status==='canceled'});if(v.status==='succeeded')await service('fox_settle_payment',{p_order:v.order,p_provider:v.id,p_kopeks:v.amount});return v;}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return response({});if(req.method!=='POST')return response({message:'POST only'},405);try{
 if(env('FOX_PAYMENTS_READY')!=='true'||!env('YOOKASSA_SHOP_ID')||!env('YOOKASSA_SECRET_KEY'))return response({message:'Оплата ещё не подключена владельцем'},503);
 const raw=await req.text();if(raw.length>16000)return response({message:'Request too large'},413);const data=JSON.parse(raw);
 if(data.event){ // Webhook is untrusted: always refetch payment from YooKassa over authenticated HTTPS.
  if(!['payment.succeeded','payment.canceled'].includes(data.event)||!uid(data.object?.id))return response({message:'Invalid event'},400);
  const payment=await provider('/'+data.object.id);await synchronize(payment);return response({ok:true});
 }
 const bearer=req.headers.get('Authorization')||'';if(!/^Bearer .+/.test(bearer))return response({message:'Требуется вход'},401);
 const ar=await fetch(env('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:bearer},signal:AbortSignal.timeout(10000)});if(!ar.ok)return response({message:'Войди в Fox ID заново'},401);const user=await ar.json();
 const action=(name:string,args:unknown={})=>supa('/rest/v1/rpc/fox_action',{p_action:name,p_data:args},bearer);
 if(data.op==='create'){
  if(!Number.isInteger(data.amount)||data.amount<100||data.amount>15000||!uid(data.request_id))return response({message:'Сумма: 100–15000 рублей'},400);
  const returnUrl=env('PAYMENT_RETURN_URL');if(!/^https:\/\//.test(returnUrl))throw Error('Владелец не настроил страницу возврата');
  const mode=env('PAYMENT_RECEIPTS_MODE');if(!['provider','configured_external'].includes(mode))throw Error('Владелец не настроил выдачу чеков');
  const order=await action('payment_order',{amount:data.amount,request_id:data.request_id});if(order.status!=='pending')return response({id:order.id,status:order.status});
  const amount={value:(order.amount_kopeks/100).toFixed(2),currency:'RUB'};
  let receipt:any;if(mode==='provider'){
   const vat=Number(env('PAYMENT_VAT_CODE'));if(!user.email||!Number.isInteger(vat)||vat<1||vat>12)throw Error('Владелец не настроил параметры чека');
   receipt={customer:{email:user.email},items:[{description:'Аванс для покупки подписки Fox Launcher',quantity:'1.00',amount,vat_code:vat,payment_mode:'advance',payment_subject:'payment'}]};
   if(env('PAYMENT_TAX_SYSTEM_CODE'))receipt.tax_system_code=Number(env('PAYMENT_TAX_SYSTEM_CODE'));
  }
  const payment=await provider('',{amount,capture:true,confirmation:{type:'redirect',return_url:returnUrl},description:'Fox Launcher: пополнение баланса',metadata:{fox_order:order.id},...(receipt?{receipt}:{})},order.id);
  const v=await synchronize(payment);const url=payment.confirmation?.confirmation_url;if(url&&new URL(url).protocol!=='https:')throw Error('Invalid checkout URL');return response({id:order.id,status:v.status,confirmation_url:url||null});
 }
 if(data.op==='status'){
  if(!uid(data.id))return response({message:'Invalid order'},400);const order=await action('payment_status',{id:data.id});
  if(order.provider_id){const payment=await provider('/'+order.provider_id);const v=verified(payment,env('YOOKASSA_TEST_MODE')==='true');if(v.order!==order.id||v.amount!==order.amount_kopeks)throw Error('Order mismatch');await synchronize(payment);return response({id:order.id,status:v.status});}
  return response({id:order.id,status:order.status});
 }
 return response({message:'Unknown operation'},400);
 }catch(e){console.error('fox-payments:',e instanceof Error?e.message:'error');return response({message:e instanceof Error?e.message:'Ошибка оплаты'},400);}});
