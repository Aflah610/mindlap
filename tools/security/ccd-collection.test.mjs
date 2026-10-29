import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const data = s => 'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const waky = data(await readFile(new URL('../../worker/src/waky.js', import.meta.url),'utf8'));
const otp = data(await readFile(new URL('../../worker/src/otp-booking.js', import.meta.url),'utf8'));
const source = (await readFile(new URL('../../worker/src/index.js', import.meta.url),'utf8')).replace("'./waky.js'",JSON.stringify(waky)).replace("'./otp-booking.js'",JSON.stringify(otp));
const { SlotHolds } = await import(data(source));
const { handleWaky } = await import(waky);
const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const env = { WAKY_API_URL:'https://book.invalid',BOOKING_API_KEY:'synthetic',RAZORPAY_KEY_ID:'synthetic',RAZORPAY_KEY_SECRET:'synthetic',SLOT_HOLDS:{} };
function setup() {
  const values = new Map(); let chain=Promise.resolve();
  const storage={ get: async key => structuredClone(values.get(key)), put: async (key,value) => values.set(key,structuredClone(value)), delete: async key=>values.delete(key) };
  storage.transaction = fn => { const next=chain.then(()=>fn(storage)); chain=next.catch(()=>{});return next; };
  const actor=new SlotHolds({storage}); let creates=0; let lookups=0;
  const order={id:'order_test',amount:100000,currency:'INR',status:'created',notes:{engine:'waky',kind:'booking',ccd_collection:'1',waky_booking_id:id,phone:'+910000000000'}};
  const h={ jsonResponse:(d,status,headers)=>Response.json(d,{status,headers}), verifySessionToken:()=>{throw Error('must not require OTP')}, errorText:()=>'',
    hmacSha256Hex:async()=> 'a'.repeat(64), constantTimeEqual:(a,b)=>a===b,
    holdsCall:async(_env,op,body)=>(await actor.fetch(new Request('https://internal/'+op,{method:'POST',body:JSON.stringify(body)}))).json(),
    razorpayRequest:async(_env,method,path)=> { if(method==='POST'){creates++;await new Promise(r=>setTimeout(r,5));return order;} lookups++;return path.endsWith('/payments')?{items:[]}:path.startsWith('orders/')?order:{id:'pay_test',order_id:'order_test',amount:100000,status:'captured'}; }
  };
  const call=async(body={},path='ccd-order',overrides={})=>{const req=new Request('https://worker.invalid/api/payment/'+path,{method:'POST',body:JSON.stringify({booking_id:id,collection_token:'synthetic-token',amount:1,...body})});return handleWaky(req,{...env,...overrides},new URL(req.url),{},h);};
  return {call,h,order,values,stats:()=>({creates,lookups})};
}

test('CCD collection uses verified booking amounts, reusable orders and payment-only grants',async t=>{
  const original=globalThis.fetch;
  const record={id,amountPaise:100000,status:'pending',phone:'+910000000000'};
  try {
    globalThis.fetch=async()=>Response.json({data:record});
    await t.test('creates one order from server amount, never the browser amount, and reuses it',async()=>{
      const s=setup(); const replies=await Promise.all([s.call(),s.call(),s.call()]);
      assert.equal(replies.filter(r=>r.status===200).length,1);
      assert.equal(s.stats().creates,1);
      const reused=await (await s.call()).json();assert.equal(reused.amount,100000);assert.equal(reused.order_id,'order_test');assert.equal(s.stats().creates,1);
      assert.ok([...s.values.values()].every(v=>!JSON.stringify(v).includes(record.phone)));
    });
    await t.test('invalid/expired grants fail before creating an order',async()=>{
      const s=setup();globalThis.fetch=async()=>Response.json({error:{message:'denied'}},{status:404});
      assert.equal((await s.call()).status,400);assert.equal(s.stats().creates,0);assert.equal(s.values.size,0);
    });
    await t.test('paid bookings, invalid amounts and storage outages never create another order',async()=>{
      const s=setup();globalThis.fetch=async()=>Response.json({data:{...record,status:'paid'}});
      assert.equal((await (await s.call()).json()).booked,true);
      globalThis.fetch=async()=>Response.json({data:{...record,amountPaise:0}});
      assert.equal((await s.call()).status,409);
      assert.equal((await s.call({},'ccd-order',{SLOT_HOLDS:null})).status,503);
      assert.equal(s.stats().creates,0);
    });
    await t.test('verification rejects a genuine payment belonging to another booking',async()=>{
      const s=setup();s.order.notes.waky_booking_id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
      globalThis.fetch=async()=>Response.json({data:record});
      const r=await s.call({razorpay_order_id:'order_test',razorpay_payment_id:'pay_test',razorpay_signature:'a'.repeat(64)},'ccd-verify');assert.equal(r.status,400);
    });
    await t.test('an authorised payment waiting for capture cannot open another checkout',async()=>{
      const s=setup();globalThis.fetch=async()=>Response.json({data:record});
      await s.call();s.order.status='attempted';
      const original=s.h.razorpayRequest;
      const payment={id:'pay_pending',order_id:'order_test',amount:100000,status:'authorized',currency:'INR'};
      s.h.razorpayRequest=async(e,method,path,body)=>{
        if(path.endsWith('/payments'))return {items:[payment]};
        if(path.endsWith('/capture'))throw Error('synthetic capture outage');
        if(path==='payments/pay_pending')return payment;
        return original(e,method,path,body);
      };
      const quiet=console.error;console.error=()=>{};
      try { const r=await s.call();assert.equal(r.status,409);assert.match((await r.json()).error,/do not pay again/);assert.equal(s.stats().creates,1); }
      finally {console.error=quiet;}
    });
    await t.test('a paid Razorpay order waits for confirmation rather than offering another checkout',async()=>{
      const s=setup();s.order.status='paid';globalThis.fetch=async()=>Response.json({data:record});
      assert.equal((await s.call()).status,409);assert.match((await (await s.call()).json()).error,/do not pay again/);assert.equal(s.stats().creates,1);
    });
  } finally { globalThis.fetch=original; }
});
