const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const token = () => sessionStorage.getItem('posToken');
const state = { user:null, hotel:{}, menu:[], category:'All', cart:[], orders:[], activeOrder:null, receipt:null };
const money = n => 'KSh ' + Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(token()) headers.Authorization='Bearer '+token();
  const res=await fetch(url,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(res.status===401){sessionStorage.removeItem('posToken');location.href='/';throw new Error(data.error||'Please sign in again.');}
  if(!res.ok) throw new Error(data.error||'Request failed.');
  return data;
}
function notify(message,type='ok'){
  const el=$('#notice');el.textContent=message;el.className='notice show '+(type==='bad'?'bad':'ok');
  clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.className='notice',4200);
}
function roleAllowed(roles){return !roles||roles.split(',').includes(state.user?.role);}
function showView(name){
  if(name==='users'&&!roleAllowed('owner')||name==='reports'&&!roleAllowed('owner,supervisor')) return notify('Your account does not have access to that page.','bad');
  $$('.view').forEach(v=>v.classList.add('hidden'));$('#view-'+name)?.classList.remove('hidden');
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  const titles={pos:'New order',orders:'Orders',kitchen:'Kitchen & bar',menu:'Menu management',users:'Workers',reports:'Sales reports'};
  $('#page-title').textContent=titles[name]||'Dashboard';$('#sidebar').classList.remove('open');
  if(name==='orders')loadOrders();if(name==='kitchen')loadKitchen();if(name==='menu')renderMenuTable();if(name==='users')loadUsers();if(name==='reports')loadReports();
}
async function init(){
  if(!token()){location.href='/';return;}
  try{
    const me=await api('/api/me');state.user=me.user;state.hotel=me.hotel;
    $('#user-name').textContent=state.user.name;$('#user-role').textContent=state.user.role;$('#user-avatar').textContent=state.user.name.charAt(0).toUpperCase();
    $$('[data-roles]').forEach(el=>{el.classList.toggle('hidden',!roleAllowed(el.dataset.roles));});
    await loadMenu();await loadOrders();renderCart();await loadReportsSafe();
  }catch(e){notify(e.message,'bad');}
}
async function loadMenu(){state.menu=await api('/api/menu');renderCategories();renderMenu();renderMenuTable();}
function renderCategories(){
  const cats=['All',...new Set(state.menu.filter(i=>i.available).map(i=>i.category))];
  if(!cats.includes(state.category))state.category='All';
  $('#category-filters').innerHTML=cats.map(c=>`<button class="category-btn ${c===state.category?'active':''}" data-category="${esc(c)}">${esc(c)}</button>`).join('');
  $$('#category-filters button').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;renderCategories();renderMenu();});
}
function renderMenu(){
  const query=$('#menu-search').value.trim().toLowerCase();
  const items=state.menu.filter(i=>i.available&&(state.category==='All'||i.category===state.category)&&i.name.toLowerCase().includes(query));
  $('#menu-grid').innerHTML=items.length?items.map(i=>`<button class="menu-card" data-add="${i.id}"><span class="menu-icon">${i.destination==='bar'?'🥤':'🍽️'}</span><strong>${esc(i.name)}</strong><small>${esc(i.category)}</small><span class="price">${money(i.price)}</span></button>`).join(''):'<p class="muted">No matching menu items.</p>';
  $$('#menu-grid [data-add]').forEach(b=>b.onclick=()=>addToCart(Number(b.dataset.add)));
}
function addToCart(id){
  const item=state.menu.find(x=>x.id===id);if(!item)return;
  const existing=state.cart.find(x=>x.id===id);
  if(existing)existing.quantity++;else state.cart.push({id:item.id,name:item.name,price:Number(item.price),quantity:1,instructions:'',destination:item.destination});
  renderCart();
}
function renderCart(){
  const host=$('#cart-items');
  if(!state.cart.length)host.innerHTML='<div class="empty-state">Your order is empty.<br>Choose items from the menu.</div>';
  else host.innerHTML=state.cart.map(i=>`<div class="cart-row"><div><strong>${esc(i.name)}</strong><small>${money(i.price)} each · ${money(i.price*i.quantity)}</small><input data-note="${i.id}" aria-label="Special instructions for ${esc(i.name)}" placeholder="Special instructions…" value="${esc(i.instructions)}" style="width:100%;margin-top:7px;border:1px solid #e7eaf0;border-radius:6px;padding:6px;font-size:11px"></div><div class="qty-control"><button data-minus="${i.id}" aria-label="Decrease">−</button><span>${i.quantity}</span><button data-plus="${i.id}" aria-label="Increase">+</button></div></div>`).join('');
  $$('[data-minus]').forEach(b=>b.onclick=()=>changeQty(Number(b.dataset.minus),-1));
  $$('[data-plus]').forEach(b=>b.onclick=()=>changeQty(Number(b.dataset.plus),1));
  $$('[data-note]').forEach(i=>i.onchange=()=>{const item=state.cart.find(x=>x.id===Number(i.dataset.note));if(item)item.instructions=i.value;});
  const sub=state.cart.reduce((s,i)=>s+i.price*i.quantity,0),discount=Math.max(0,Number($('#discount').value)||0);
  $('#cart-subtotal').textContent=money(sub);$('#cart-discount').textContent=money(discount);$('#cart-total').textContent=money(Math.max(0,sub-discount));
  $('#place-order').disabled=!state.cart.length;
}
function changeQty(id,delta){const i=state.cart.find(x=>x.id===id);if(!i)return;i.quantity+=delta;if(i.quantity<1)state.cart=state.cart.filter(x=>x.id!==id);renderCart();}
async function placeOrder(){
  if(!state.cart.length)return notify('Add at least one item first.','bad');
  const subtotal=state.cart.reduce((s,i)=>s+i.price*i.quantity,0),discount=Number($('#discount').value)||0;
  if(discount<0||discount>subtotal)return notify('Discount must be between zero and the subtotal.','bad');
  const btn=$('#place-order');btn.disabled=true;
  try{
    const order=await api('/api/orders',{method:'POST',body:JSON.stringify({items:state.cart.map(i=>({menu_item_id:i.id,quantity:i.quantity,instructions:i.instructions})),order_type:$('#order-type').value,table_no:$('#table-no').value,discount,notes:$('#order-notes').value})});
    state.cart=[];$('#discount').value=0;$('#order-notes').value='';renderCart();await loadOrders();showPayment(order);
    notify('Order '+order.order_no+' created.');
  }catch(e){notify(e.message,'bad');}finally{btn.disabled=false;}
}
function showPayment(order){
  state.activeOrder=order;const balance=Math.max(0,order.total-order.amount_paid);
  $('#payment-order-info').textContent=`${order.order_no} · ${order.items.length} line item(s)`;
  $('#payment-due').textContent=money(balance);$('#payment-amount').value=balance.toFixed(2);$('#payment-amount').max=balance.toFixed(2);
  $('#payment-method').value='Cash';$('#mpesa-ref').value='';updatePaymentFields();
  $('#payment-dialog').showModal();
}
function updatePaymentFields(){
  const method=$('#payment-method').value,amount=Number($('#payment-amount').value)||0;
  $('#mpesa-ref-wrap').classList.toggle('hidden',method!=='M-Pesa');
  const change=method==='Cash'?Math.max(0,amount-(state.activeOrder?.total-state.activeOrder?.amount_paid||0)):0;
  $('#cash-change').textContent='Change due: '+money(change);
}
async function savePayment(e){
  e.preventDefault();if(!state.activeOrder)return;
  const amount=Number($('#payment-amount').value),method=$('#payment-method').value,reference=$('#mpesa-ref').value.trim();
  try{
    const order=await api(`/api/orders/${state.activeOrder.id}/payments`,{method:'POST',body:JSON.stringify({amount,method,reference})});
    $('#payment-dialog').close();state.activeOrder=order;await loadOrders();showReceipt(order);await loadReportsSafe();notify('Payment recorded successfully.');
  }catch(e){notify(e.message,'bad');}
}
async function loadOrders(){
  state.orders=await api('/api/orders');
  const today=new Date().toLocaleDateString('en-CA');
  const todayOrders=state.orders.filter(o=>new Date(o.created_at.replace(' ','T')+'Z').toLocaleDateString('en-CA')===today);
  $('#stat-orders').textContent=todayOrders.length;
  $('#stat-pending').textContent=state.orders.filter(o=>o.payment_status!=='Paid'&&o.status!=='Cancelled').length;
  $('#stat-sales').textContent=money(state.orders.filter(o=>o.payment_status==='Paid'&&new Date(o.created_at.replace(' ','T')+'Z').toLocaleDateString('en-CA')===today).reduce((s,o)=>s+Number(o.total),0));
  renderOrdersTable();
}
function statusPill(s){return `<span class="pill ${esc(String(s).toLowerCase().replace(/[^a-z]/g,''))}">${esc(s)}</span>`;}
function renderOrdersTable(){
  $('#orders-body').innerHTML=state.orders.length?state.orders.map(o=>`<tr><td><strong>${esc(o.order_no)}</strong></td><td>${esc(o.created_at)}</td><td>${esc(o.order_type)}${o.table_no?' · '+esc(o.table_no):''}</td><td>${esc(o.cashier_name)}</td><td>${money(o.total)}</td><td>${statusPill(o.payment_status)}</td><td>${statusPill(o.status)}</td><td><button class="table-action" data-view-order="${o.id}">Open</button><button class="table-action" data-receipt="${o.id}">Receipt</button>${o.payment_status!=='Paid'&&o.status!=='Cancelled'?`<button class="table-action" data-pay="${o.id}">Pay</button>`:''}</td></tr>`).join(''):'<tr><td colspan="8">No orders have been recorded.</td></tr>';
  $$('[data-view-order]').forEach(b=>b.onclick=()=>openOrder(Number(b.dataset.viewOrder)));
  $$('[data-receipt]').forEach(b=>b.onclick=async()=>{try{showReceipt(await api('/api/orders/'+b.dataset.receipt));}catch(e){notify(e.message,'bad');}});
  $$('[data-pay]').forEach(b=>b.onclick=async()=>{try{showPayment(await api('/api/orders/'+b.dataset.pay));}catch(e){notify(e.message,'bad');}});
}
async function openOrder(id){
  try{
    const o=await api('/api/orders/'+id);
    const details=o.items.map(i=>`${i.quantity} × ${i.item_name} — ${money(i.line_total)}${i.instructions?' ('+i.instructions+')':''}`).join('\n');
    const next=prompt(`Order ${o.order_no}\n${details}\n\nCurrent status: ${o.status}\nEnter status: New, Accepted, Preparing, Ready, Served, Completed, Cancelled\nLeave blank to cancel this action.`);
    if(!next)return;
    const status=['New','Accepted','Preparing','Ready','Served','Completed','Cancelled'].find(s=>s.toLowerCase()===next.trim().toLowerCase());
    if(!status)return notify('Unknown status.','bad');
    await api(`/api/orders/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await loadOrders();notify('Order status updated.');
  }catch(e){notify(e.message,'bad');}
}
async function loadKitchen(){
  const orders=await api('/api/orders');const active=orders.filter(o=>!['Completed','Cancelled'].includes(o.status));
  const full=await Promise.all(active.map(o=>api('/api/orders/'+o.id)));
  const role=state.user.role;
  const filtered=full.map(o=>({...o,items:o.items.filter(i=>role==='kitchen'?i.destination==='kitchen':role==='bar'?i.destination==='bar':true)})).filter(o=>o.items.length);
  $('#kitchen-list').innerHTML=filtered.length?filtered.map(o=>`<article class="ticket"><div class="ticket-head"><div><h4>${esc(o.order_no)}</h4><small>${esc(o.order_type)} ${esc(o.table_no||'')} · ${esc(o.created_at)}</small></div>${statusPill(o.status)}</div><ul>${o.items.map(i=>`<li><strong>${i.quantity} × ${esc(i.item_name)}</strong>${i.instructions?`<br><small>Note: ${esc(i.instructions)}</small>`:''}</li>`).join('')}</ul><label class="tiny muted">Update status <select data-ticket-status="${o.id}" style="margin:5px 0 0;padding:8px;border:1px solid #ddd;border-radius:8px;width:100%">${['New','Accepted','Preparing','Ready','Served','Completed'].map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select></label></article>`).join(''):'<div class="empty-state">No active tickets.</div>';
  $$('[data-ticket-status]').forEach(sel=>sel.onchange=async()=>{try{await api(`/api/orders/${sel.dataset.ticketStatus}/status`,{method:'PATCH',body:JSON.stringify({status:sel.value})});notify('Ticket updated.');loadKitchen();loadOrders();}catch(e){notify(e.message,'bad');}});
}
function renderMenuTable(){
  $('#menu-body').innerHTML=state.menu.map(i=>`<tr><td><strong>${esc(i.name)}</strong></td><td>${esc(i.category)}</td><td>${money(i.price)}</td><td>${esc(i.destination)}</td><td>${i.available?'Available':'Disabled'}</td><td><button class="table-action" data-toggle-item="${i.id}" data-available="${i.available}">${i.available?'Disable':'Enable'}</button><button class="table-action" data-edit-price="${i.id}">Price</button></td></tr>`).join('');
  $$('[data-toggle-item]').forEach(b=>b.onclick=async()=>{try{await api('/api/menu/'+b.dataset.toggleItem,{method:'PATCH',body:JSON.stringify({available:b.dataset.available!=='1'})});await loadMenu();notify('Menu availability updated.');}catch(e){notify(e.message,'bad');}});
  $$('[data-edit-price]').forEach(b=>b.onclick=async()=>{const item=state.menu.find(i=>i.id===Number(b.dataset.editPrice));const value=prompt('New selling price for '+item.name, item.price);if(value===null)return;try{await api('/api/menu/'+item.id,{method:'PATCH',body:JSON.stringify({price:Number(value)})});await loadMenu();notify('Price updated.');}catch(e){notify(e.message,'bad');}});
}
async function loadUsers(){
  const users=await api('/api/users');
  $('#users-body').innerHTML=users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.active?'Active':'Disabled'}</td><td>${u.role==='owner'?'—':`<button class="table-action" data-user-toggle="${u.id}" data-active="${u.active}">${u.active?'Disable':'Enable'}</button>`}</td></tr>`).join('');
  $$('[data-user-toggle]').forEach(b=>b.onclick=async()=>{try{await api('/api/users/'+b.dataset.userToggle,{method:'PATCH',body:JSON.stringify({active:b.dataset.active!=='1'})});loadUsers();notify('Worker account updated.');}catch(e){notify(e.message,'bad');}});
}
async function loadReports(){
  const d=await api('/api/reports/summary'),s=d.summary;
  $('#report-sales').textContent=money(s.paid_sales);$('#report-outstanding').textContent=money(s.outstanding);$('#report-cancelled').textContent=s.cancelled_count;
  $('#top-items-body').innerHTML=d.topItems.length?d.topItems.map(i=>`<tr><td>${esc(i.item_name)}</td><td>${i.quantity}</td><td>${money(i.sales)}</td></tr>`).join(''):'<tr><td colspan="3">No sales recorded today.</td></tr>';
}
async function loadReportsSafe(){if(roleAllowed('owner,supervisor'))try{await loadReports();}catch(e){}}
function showReceipt(order){
  state.receipt=order;
  const h=state.hotel;
  const paid=Number(order.amount_paid||0),change=0;
  $('#receipt-content').innerHTML=`<div class="receipt-center"><div class="receipt-title">${esc(h.name||'TICOH HOTEL')}</div><div class="receipt-sub">${esc(h.address||'Nairobi, Kenya')}<br>${h.phone?'Tel: '+esc(h.phone)+'<br>':''}CUSTOMER RECEIPT</div></div>
  <hr class="receipt-rule"><div class="receipt-meta"><span>Receipt: RCP-${String(order.id).padStart(6,'0')}</span><span>${esc(order.created_at)}</span></div>
  <div class="receipt-meta"><span>Order: ${esc(order.order_no)}</span><span>Cashier: ${esc(order.cashier_name)}</span></div>
  <div class="receipt-meta"><span>${esc(order.order_type)}${order.table_no?' · '+esc(order.table_no):''}</span><span>${esc(order.payment_status)}</span></div>
  <hr class="receipt-rule"><table class="receipt-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${order.items.map(i=>`<tr><td>${esc(i.item_name)}${i.instructions?`<br><small>${esc(i.instructions)}</small>`:''}</td><td>${i.quantity}</td><td>${Number(i.unit_price).toFixed(2)}</td><td>${Number(i.line_total).toFixed(2)}</td></tr>`).join('')}</tbody></table>
  <hr class="receipt-rule"><div class="receipt-meta"><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div class="receipt-meta"><span>Discount</span><span>-${money(order.discount)}</span></div>
  <div class="receipt-meta receipt-total"><span>TOTAL</span><span>${money(order.total)}</span></div><div class="receipt-meta"><span>Amount paid</span><span>${money(paid)}</span></div><div class="receipt-meta"><span>Balance due</span><span>${money(Math.max(0,order.total-paid))}</span></div>
  <div class="receipt-meta"><span>Payment method</span><span>${esc(order.payment_method||'Not paid')}</span></div>${order.mpesa_ref?`<div class="receipt-meta"><span>M-Pesa ref</span><span>${esc(order.mpesa_ref)}</span></div>`:''}
  <hr class="receipt-rule"><div class="receipt-footer"><strong>Thank you for dining with us!</strong><br>Karibu tena — we appreciate your visit.<br><small>Keep this receipt for your records.</small></div>`;
  $('#receipt-dialog').showModal();
}
$('#menu-search').addEventListener('input',renderMenu);
$('#discount').addEventListener('input',renderCart);
$('#clear-cart').onclick=()=>{state.cart=[];renderCart();};
$('#place-order').onclick=placeOrder;
$('#payment-method').onchange=updatePaymentFields;$('#payment-amount').oninput=updatePaymentFields;
$('#payment-form').addEventListener('submit',savePayment);
$('#close-payment').onclick=()=>$('#payment-dialog').close();
$('#skip-payment').onclick=()=>$('#payment-dialog').close();
$('#close-receipt').onclick=()=>$('#receipt-dialog').close();
$('#download-receipt').onclick=()=>window.print();
$('#refresh-orders').onclick=()=>loadOrders().catch(e=>notify(e.message,'bad'));
$('#refresh-kitchen').onclick=()=>loadKitchen().catch(e=>notify(e.message,'bad'));
$('#mobile-menu').onclick=()=>$('#sidebar').classList.toggle('open');
$$('.nav-item').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('#logout-btn').onclick=async()=>{try{await api('/api/logout',{method:'POST'});}catch{}sessionStorage.removeItem('posToken');location.href='/';};
$('#menu-form').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());
  try{await api('/api/menu',{method:'POST',body:JSON.stringify(payload)});e.currentTarget.reset();await loadMenu();notify('Menu item added.');}catch(e){notify(e.message,'bad');}
};
$('#user-form').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());
  try{await api('/api/users',{method:'POST',body:JSON.stringify(payload)});e.currentTarget.reset();await loadUsers();notify('Worker account created.');}catch(e){notify(e.message,'bad');}
};
$('#export-orders').onclick=()=>{
  const rows=[['Order','Created','Type','Table','Cashier','Total','Paid','Payment status','Order status'],...state.orders.map(o=>[o.order_no,o.created_at,o.order_type,o.table_no,o.cashier_name,o.total,o.amount_paid,o.payment_status,o.status])];
  const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='ticoh-hotel-orders.csv';a.click();URL.revokeObjectURL(url);
};
init();
