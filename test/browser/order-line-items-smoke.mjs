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
  document.body.replaceChildren();document.body.className='columns appear';history.replaceState({},'', '/customer/order-details?orderRef=000000041');
  const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports:{...Object.fromEntries(['tools','storefront-account','storefront-order','storefront-auth','storefront-cart','storefront-checkout','storefront-pdp'].map(n=>['@dropins/'+n+'/', '/scripts/__dropins__/'+n+'/'])),[location.origin+'/scripts/initializers/account.js']:'data:text/javascript,export{}',[location.origin+'/scripts/initializers/order.js']:'data:text/javascript,export{}'}});document.head.append(map);
  for(const href of ['/styles/styles.css','/blocks/commerce-order-product-list/commerce-order-product-list.css']){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);await new Promise(r=>link.onload=r);}
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
  const block=document.createElement('div');block.className='commerce-order-product-list';wrapper.append(block);
  const {events}=await import('@dropins/tools/event-bus.js');
  await(await import('/blocks/commerce-order-product-list/commerce-order-product-list.js')).default(block);
  const loading=block.textContent;
  const money={value:22,currency:'AUD'};
  const order={number:'000000041',status:'Pending',orderDate:'2026-07-11T12:00:00Z',grandTotal:{value:66,currency:'AUD'},items:[
   {id:'event-line',productSku:'future',productName:'Electric Callboy — TANZNEID World Tour',quantityOrdered:2,price:money,total:{value:44,currency:'AUD'},configurableOptions:{Session:'Evening'},giftMessage:{senderName:'Alex',recipientName:'Mia',message:'Enjoy the show!'}},
   {id:'bottle-line',productSku:'bottle',productName:'Water bottle',quantityOrdered:1,price:money,total:money,product:{sku:'bottle',urlKey:'water-bottle',image:''}},
  ]};
  window.lineTest={block,events,order};events.emit('order/data',order);
  await new Promise(r=>setTimeout(r,700));
  return {text:main.textContent,loading,eventCalls:window.eventCalls};
 })()`);
 assert.match(result.loading,/Loading order items/);assert.match(result.text,/Evening/);assert.match(result.text,/Enjoy the show/);assert.match(result.text,/Water bottle/);assert.doesNotMatch(result.text,/Ordered on/);assert.doesNotMatch(result.text,/View order/);
 for(const width of [390,768,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});
  const layout=await run(`({rows:document.querySelectorAll('.upcoming-booking').length,overflow:document.documentElement.scrollWidth>innerWidth,nonEventTickets:document.querySelectorAll('.upcoming-booking')[1].querySelectorAll('.upcoming-booking__reference').length,eventTickets:document.querySelector('.upcoming-booking__reference')?.textContent,calendar:document.querySelectorAll('.event-calendar-button').length,links:[...document.querySelectorAll('.upcoming-booking__name a')].map(a=>a.getAttribute('href'))})`);
  assert.equal(layout.rows,2);assert.equal(layout.overflow,false);assert.equal(layout.nonEventTickets,0);assert.match(layout.eventTickets,/2 tickets/);assert.equal(layout.calendar,1);assert.ok(layout.links.some(h=>h.includes('water-bottle')));
  const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/order-line-items-'+width+'.png',Buffer.from(shot.result.data,'base64'));
 }
 const update=await run(`(async()=>{const{events,order,block}=window.lineTest;events.emit('order/data',{...order,status:'Canceled',items:[order.items[1]]});await new Promise(r=>setTimeout(r,200));return {text:block.textContent,rows:block.querySelectorAll('.upcoming-booking').length,calendar:block.querySelectorAll('.event-calendar-button').length};})()`);
 assert.equal(update.rows,1);assert.equal(update.calendar,0);assert.doesNotMatch(update.text,/Ordered on/);assert.doesNotMatch(update.text,/Electric Callboy/);
 await run(`document.cookie='auth_dropin_user_token=; path=/; Max-Age=0'`);
 console.log('Order detail line items passed: mixed event/product rows, event enrichment, non-event ticket suppression, prices, options, gifts, product links, no self-link, responsive layout, and live order updates.');
}finally{socket.close();}
