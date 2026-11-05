import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/* eslint-disable no-console */
const target = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/config.json', {
  method: 'PUT',
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  id += 1;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => {
  const message = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (message.result.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails));
  return message.result.result.value;
};

try {
 await send('Page.enable');await new Promise(r=>setTimeout(r,1000));
 const result=await run(`(async()=>{
  const viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';document.head.append(viewport);
  document.body.replaceChildren();document.body.className='columns appear';
  const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports:{...Object.fromEntries(['tools','storefront-account','storefront-order','storefront-auth','storefront-cart','storefront-checkout','storefront-pdp'].map(n=>['@dropins/'+n+'/', '/scripts/__dropins__/'+n+'/'])),[location.origin+'/scripts/initializers/account.js']:'data:text/javascript,export{}'}});document.head.append(map);
  for(const href of ['/styles/styles.css','/blocks/commerce-orders-list/commerce-orders-list.css']){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);await new Promise(r=>link.onload=r);}
  const rawFetch=window.fetch.bind(window);window.orderCalls=[];window.eventCalls=0;
  const item=(sku,name)=>({id:sku,product_name:name,product_sku:sku,product_url_key:sku,quantity_ordered:2,status:'Complete',product:{sku,small_image:{url:''}}});
  const items=[item('future','Electric Callboy — TANZNEID World Tour'),item('past','The Dark Side of the Moon')];
  const event=(id,date)=>({event_id:id,schedule_type:'one_time',starts_at_utc:date+'T07:00:00Z',ends_at_utc:date+'T09:00:00Z',timezone:'Australia/Brisbane',tags:[],venue:{venue_id:'venue',name:'Riverstage',address:{city:'Brisbane',country_code:'AU',lines:['1 Main Street']}},allocations:[{event_allocation_id:'allocation-'+id,commerce_sku:id,allocated_capacity:20,available_quantity:10,space:{space_id:'space',name:'Hall'},zone:{zone_id:'zone',name:'Front'}}]});
  window.fetch=async(input,opts)=>{
   const url=String(input);let data;
   if(url.includes('/orders-fixture')){
    const vars=JSON.parse(new URL(url).searchParams.get('variables')||'{}');window.orderCalls.push(vars);
    const page=vars.currentPage||1;
    data={customer:{returns:{items:[]},orders:{items:[{id:'order-'+page,number:'10000012'+page,token:'token',order_date:'2026-11-01 10:00:00',status:page===1?'Complete':'Canceled',items:page===1?items:[item('deleted','Unavailable event')],total:{grand_total:{value:40,currency:'USD'}}}],page_info:{current_page:page,total_pages:2,page_size:1},total_count:2,date_of_first_order:'2025-01-01 00:00:00'}},storeConfig:{store_code:'default'}};
   }else if(url.includes('/catalog-fixture')){
    data={productSearch:{page_info:{total_pages:1},items:items.map(i=>({productView:{sku:i.product_sku,urlKey:i.product_sku,attributes:[{name:'is_event_ticket',value:'true'},{name:'external_event_id',value:i.product_sku}]}}))}};
   }else if(url.startsWith('https://events.test/enrich')){
    window.eventCalls++;return new Response(JSON.stringify({events:{future:event('future','2030-12-01'),past:event('past','2020-01-01')}}),{headers:{'Content-Type':'application/json'}});
   }else return rawFetch(input,opts);
   return new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
  };
  const configs=await import('@dropins/tools/lib/aem/configs.js');configs.initializeConfig({public:{default:{'event-app':{enabled:true,actions:{enrich:{url:'https://events.test/enrich',method:'POST',encoding:'json-body'}}}}}});
  const api=await import('@dropins/storefront-account/api.js');const{initializers}=await import('@dropins/tools/initializer.js');const commerce=await import('/scripts/commerce.js');const labels=await commerce.fetchPlaceholders('placeholders/account.json');await initializers.mountImmediately(api.initialize,{langDefinitions:{default:labels}});
  api.setEndpoint(location.origin+'/orders-fixture');commerce.CS_FETCH_GRAPHQL.setEndpoint(location.origin+'/catalog-fixture');document.cookie='auth_dropin_user_token=fixture; path=/';
  const main=document.createElement('main');document.body.append(main);
  const sidebar=document.createElement('div');sidebar.className='section commerce-account-sidebar-container';sidebar.style.setProperty('--column-width','30%');sidebar.textContent='Account navigation';main.append(sidebar);
  const section=document.createElement('div');section.className='section';section.style.setProperty('--column-width','70%');main.append(section);
  const wrapper=document.createElement('div');wrapper.className='commerce-orders-list-wrapper';section.append(wrapper);
  const block=document.createElement('div');block.className='commerce-orders-list';wrapper.append(block);
  await(await import('/blocks/commerce-orders-list/commerce-orders-list.js')).default(block);
  await new Promise(r=>setTimeout(r,700));
  return {text:main.textContent,html:main.innerHTML,calls:window.orderCalls,eventCalls:window.eventCalls};
 })()`);
 assert.match(result.text,/Electric Callboy/);assert.match(result.text,/The Dark Side/);assert.equal(result.eventCalls,1);
 for(const width of [390,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
  const layout=await run(`({footer:!!document.querySelector('.order-booking-summary__meta'),ordered:document.querySelector('.upcoming-booking__ordered')?.textContent,heading:document.querySelector('h1')?.textContent,font:getComputedStyle(document.querySelector('h1')).fontSize,color:getComputedStyle(document.querySelector('h1')).color,rows:document.querySelectorAll('.upcoming-booking').length,overflow:document.documentElement.scrollWidth>innerWidth,titleHeight:document.querySelector('.account-page-title').getBoundingClientRect().height})`);
  assert.equal(layout.footer,false);assert.match(layout.ordered,/Ordered on .*Order 100000121.*Complete.*40/);assert.equal(layout.heading,'All orders');assert.equal(layout.font,'34px');assert.equal(layout.color,'rgb(16, 46, 90)');assert.equal(layout.rows,2);assert.equal(layout.overflow,false);assert.ok(layout.titleHeight<100);
  const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/all-orders-'+width+'.png',Buffer.from(shot.result.data,'base64'));
 }
 const navigation=await run(`(async()=>{
  document.querySelector('[data-testid=next-button]').click();await new Promise(r=>setTimeout(r,300));
  const pageTwo=document.querySelector('.order-booking-summary').textContent;const quantityRows=document.querySelectorAll('.upcoming-booking__reference').length;const action=document.querySelector('.upcoming-booking__details').textContent;
  const picker=document.querySelector('select');picker.value='viewAll';picker.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,300));
  return {pageTwo,quantityRows,action,calls:window.orderCalls,rows:document.querySelectorAll('.upcoming-booking').length};
 })()`);
 assert.equal(navigation.quantityRows,0);assert.equal(navigation.action,'View order');assert.match(navigation.pageTwo,/Canceled/);assert.match(navigation.pageTwo,/Unavailable event/);assert.match(navigation.pageTwo,/Ordered on/);
 assert.ok(navigation.calls.some(c=>c.currentPage===2));assert.ok(navigation.calls.some(c=>c.filter&&Object.keys(c.filter).length===0));assert.ok(navigation.rows>0);
 await run(`document.cookie='auth_dropin_user_token=; path=/; Max-Age=0'`);
 console.log('All orders browser checks passed: heading, booking rows, enrichment, retained past/canceled orders, pagination, date filter, and responsive layout.');
}finally{socket.close();}
