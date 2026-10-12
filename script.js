/* SAMRYC DISHES POS. Set your Supabase URL and publishable/anon key below. */
const SUPABASE_URL = "https://cfkyqxddkqhfksodbtkn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_h3MRI_ycKZIswLs0sl4VMA_V_sGkAfC";
const db = window.supabase && SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_")
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const $ = (id) => document.getElementById(id);
const money = (n) => "KSh " + Number(n || 0).toLocaleString("en-KE",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayStart = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); };
const state = { user:null, profile:null, menu:[], orders:[], payments:[], cart:new Map(), settings:{hotel_name:"SAMRYC DISHES",hotel_address:"",hotel_phone:""}, activeOrder:null };
const categories = ["Breakfast","Main Meals","Snacks","Soft Drinks","Hot Drinks","Water","Other Items"];
const canManage = () => state.profile?.role === "Owner";
const canCashier = () => ["Owner","Cashier"].includes(state.profile?.role);
const canOrder = () => ["Owner","Cashier","Waiter 1","Waiter 2","Waiter 3","Waiter 4"].includes(state.profile?.role);
const isConfigured = () => !!db;

function message(text, error=false) {
  const el=$("appMessage"); el.textContent=text; el.className="app-message show"+(error?" error":"");
  window.setTimeout(()=>el.classList.remove("show","error"),4500);
}
function moneyNum(v){return Math.round((Number(v)+Number.EPSILON)*100)/100}
function roleAllowed(role){return ["Owner","Waiter 1","Waiter 2","Waiter 3","Waiter 4","Cashier"].includes(role)}
function showLogin(){ $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(){ $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); }
function page(name){
  if(["staff","settings"].includes(name)&&!canManage()){message("Only the Owner can access that section.",true);return}
  if(name==="cashier"&&!canCashier()&&!canManage()){message("Only the cashier or owner can access payments.",true);return}
  if(name==="sales"&&!canCashier()&&!canManage()){message("Sales reports are restricted to the cashier and owner.",true);return}
  if(name==="menu"&&!canOrder()){message("You do not have access to the menu.",true);return}
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  $("page-"+name)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  const titles={"dashboard":"Dashboard","new-order":"New order","orders":"All orders","menu":"Food & drinks menu","cashier":"Cashier & receipts","sales":"Sales today","staff":"Staff accounts","settings":"Hotel settings"};
  $("pageTitle").textContent=titles[name]||"Dashboard";
  if(name==="dashboard") renderDashboard();
  if(name==="new-order") renderMenu();
  if(name==="orders") renderOrders();
  if(name==="menu") renderManageMenu();
  if(name==="cashier") renderCashier();
  if(name==="sales") renderSales();
  if(name==="staff") loadStaff();
  if(name==="settings") loadSettingsForm();
}
function setRoleUI(){
  document.querySelectorAll(".owner-only").forEach(el=>el.classList.toggle("hidden",!canManage()));
  document.querySelector('[data-page="cashier"]').classList.toggle("hidden",!canCashier());
  document.querySelector('[data-page="sales"]').classList.toggle("hidden",!canCashier());
  document.querySelector('[data-page="new-order"]').classList.toggle("hidden",!canOrder());
  $("userName").textContent=state.profile?.full_name||state.user?.email||"Staff";
  $("userRole").textContent=state.profile?.role||"Staff";
  $("userInitials").textContent=(state.profile?.full_name||"SD").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("id,full_name,role,active").eq("id",state.user.id).single();
  if(error)throw error;
  if(!data||!data.active)throw new Error("Your staff account is inactive. Contact the owner.");
  state.profile=data;
}
async function refreshData(){
  const [m,o,p,s]=await Promise.all([
    db.from("menu_items").select("*").order("category").order("name"),
    db.from("orders").select("*,order_items(*)").order("created_at",{ascending:false}).limit(300),
    db.from("payments").select("*").order("created_at",{ascending:false}).limit(300),
    db.from("hotel_settings").select("*").eq("id",1).maybeSingle()
  ]);
  if(m.error)throw m.error;if(o.error)throw o.error;if(p.error)throw p.error;
  state.menu=m.data||[];state.orders=o.data||[];state.payments=p.data||[];
  if(s.data)state.settings=s.data;
  fillCategoryFilters();renderDashboard();
}
async function signIn(email,password,role){
  if(!db)throw new Error("Supabase is not configured. Edit SUPABASE_URL and SUPABASE_ANON_KEY in script.js first.");
  const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;
  state.user=data.user;
  try{
    await loadProfile();
    if(state.profile.role!==role)throw new Error("The selected role does not match this account.");
    await refreshData();showApp();setRoleUI();page("dashboard");
  }catch(e){await db.auth.signOut();state.user=null;state.profile=null;throw e}
}
async function signOut(){if(db)await db.auth.signOut();state.user=null;state.profile=null;showLogin()}
async function boot(){
  if(!db){$("loginMessage").textContent="Setup needed: add your Supabase URL and publishable key in script.js.";return}
  const {data:{session}}=await db.auth.getSession();
  if(session){state.user=session.user;try{await loadProfile();await refreshData();showApp();setRoleUI();page("dashboard")}catch(e){await db.auth.signOut();showLogin();$("loginMessage").textContent=e.message}}
}
function fillCategoryFilters(){
  ["categoryFilter","menuManageCategory"].forEach(id=>{
    const el=$(id),v=el.value;el.innerHTML='<option value="all">All categories</option>'+categories.map(c=>`<option>${esc(c)}</option>`).join("");el.value=v||"all";
  });
}
function renderDashboard(){
  const todayOrders=state.orders.filter(o=>new Date(o.created_at)>=new Date(todayStart()));
  const paid=state.payments.filter(p=>new Date(p.created_at)>=new Date(todayStart()));
  $("statSales").textContent=money(paid.reduce((a,p)=>a+Number(p.amount),0));
  $("statOrders").textContent=todayOrders.length;
  $("statUnpaid").textContent=state.orders.filter(o=>!o.paid&&o.status!=="Cancelled").length;
  $("statPreparing").textContent=state.orders.filter(o=>o.status==="Preparing").length;
  $("recentOrders").innerHTML=state.orders.slice(0,5).map(orderCard).join("")||empty("No orders yet. Create your first order.");
}
function itemsText(o){return (o.order_items||[]).map(i=>`${i.quantity} × ${i.item_name}`).join(", ")||"No item details"}
function orderCard(o){
  const loc=o.order_type==="Takeaway"?"Takeaway":`Table ${esc(o.table_number||"—")}`;
  const dt=new Date(o.created_at).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"});
  const actions=[];
  if(o.status!=="Cancelled"&&o.status!=="Completed"&&canOrder()){
    actions.push(`<select aria-label="Update status" onchange="updateOrderStatus('${o.id}',this.value)">${["Pending","Preparing","Ready","Completed","Cancelled"].map(s=>`<option ${o.status===s?"selected":""}>${s}</option>`).join("")}</select>`);
  }
  if(!o.paid&&o.status!=="Cancelled"&&canCashier())actions.push(`<button type="button" class="btn primary" onclick="openPayment('${o.id}')">Take payment</button>`);
  if(o.paid)actions.push(`<button class="btn outline" onclick="showReceipt('${o.id}')">Receipt</button>`);
  return `<article class="order-card"><div><div class="order-top"><strong>${esc(o.order_number)}</strong><span class="pill ${esc(o.status)}">${esc(o.status)}</span><span class="pill ${o.paid?"paid":"unpaid"}">${o.paid?"Paid":"Unpaid"}</span></div><div class="order-detail"><b>${loc}</b>${o.customer_name?" · "+esc(o.customer_name):""}<br>${esc(itemsText(o))}<br>${esc(o.staff_name||"Staff")} · ${dt}</div></div><div><div class="order-amount">${money(o.total)}</div><div class="order-actions">${actions.join("")}</div></div></article>`;
}
function empty(text){return `<div class="empty-state">${esc(text)}</div>`}
function renderMenu(){
  const q=$("menuSearch").value.toLowerCase(),cat=$("categoryFilter").value;
  const list=state.menu.filter(i=>i.available&&i.name.toLowerCase().includes(q)&&(cat==="all"||i.category===cat));
  $("menuGrid").innerHTML=list.map(i=>`<article class="menu-item"><div><small>${esc(i.category)}</small><br><strong>${esc(i.name)}</strong></div><div class="menu-bottom"><span class="price">${money(i.price)}</span><button class="btn primary" onclick="addToCart('${i.id}')">Add +</button></div></article>`).join("")||empty("No available menu items match your search.");
}
function addToCart(id){const item=state.menu.find(i=>i.id===id);if(!item||!item.available)return;const old=state.cart.get(id);state.cart.set(id,{item,quantity:(old?.quantity||0)+1});renderCart()}
function changeQty(id,delta){const row=state.cart.get(id);if(!row)return;row.quantity+=delta;if(row.quantity<=0)state.cart.delete(id);else state.cart.set(id,row);renderCart()}
function removeCart(id){state.cart.delete(id);renderCart()}
function cartTotal(){return moneyNum([...state.cart.values()].reduce((a,r)=>a+Number(r.item.price)*r.quantity,0))}
function renderCart(){
  const rows=[...state.cart.entries()];
  $("cartItems").innerHTML=rows.map(([id,r])=>`<div class="cart-line"><div><strong>${esc(r.item.name)}</strong><small>${money(r.item.price)} each</small><div class="qty-controls"><button onclick="changeQty('${id}',-1)">−</button><b>${r.quantity}</b><button onclick="changeQty('${id}',1)">+</button><button class="remove" onclick="removeCart('${id}')">Remove</button></div></div><strong>${money(r.item.price*r.quantity)}</strong></div>`).join("")||'<p class="muted">No items added yet.</p>';
  $("cartSubtotal").textContent=money(cartTotal());$("cartTotal").textContent=money(cartTotal());
}
async function saveOrder(){
  if(!state.cart.size)throw new Error("Add at least one item first.");
  const type=$("orderType").value,table=$("tableNumber").value.trim();
  if(type==="Table"&&!table)throw new Error("Enter a table number or choose Takeaway.");
  const rows=[...state.cart.values()],total=cartTotal();
  const {data,error}=await db.rpc("create_order",{p_order_type:type,p_table_number:type==="Table"?table:null,p_customer_name:$("customerName").value.trim()||null,p_items:rows.map(r=>({menu_item_id:r.item.id,quantity:r.quantity})),p_total:total});
  if(error)throw error;
  state.cart.clear();$("customerName").value="";$("tableNumber").value="";renderCart();
  await refreshData();message("Order saved successfully: "+(data?.order_number||""));page("orders");
}
function renderOrders(){
  const q=$("ordersSearch").value.toLowerCase(),status=$("ordersStatus").value;
  const list=state.orders.filter(o=>(status==="all"||o.status===status)&&[o.order_number,o.table_number,o.staff_name,o.customer_name,itemsText(o)].join(" ").toLowerCase().includes(q));
  $("ordersList").innerHTML=list.map(orderCard).join("")||empty("No matching orders.");
}
async function updateOrderStatus(id,status){
  if(!["Pending","Preparing","Ready","Completed","Cancelled"].includes(status))return;
  const {error}=await db.rpc("update_order_status",{p_order_id:id,p_status:status});
  if(error){message(error.message,true);await refreshData();renderOrders();return}
  await refreshData();renderOrders();renderCashier();message("Order status updated.");
}
function renderManageMenu(){
  const q=$("menuManageSearch").value.toLowerCase(),cat=$("menuManageCategory").value;
  const list=state.menu.filter(i=>i.name.toLowerCase().includes(q)&&(cat==="all"||i.category===cat));
  $("manageMenuGrid").innerHTML=list.map(i=>`<article class="manage-item"><h4>${esc(i.name)}</h4><p>${esc(i.category)} · ${money(i.price)} · ${i.available?"Available":"Unavailable"}</p><div class="button-row">${canManage()?`<button class="btn outline" onclick="editMenuItem('${i.id}')">Edit</button><button class="btn danger" onclick="deleteMenuItem('${i.id}')">Delete</button>`:""}</div></article>`).join("")||empty("No menu items found.");
  $("addMenuBtn").classList.toggle("hidden",!canManage());
}
function editMenuItem(id){
  if(!canManage())return;const i=state.menu.find(x=>x.id===id);if(!i)return;
  $("menuEditorTitle").textContent="Edit menu item";$("menuItemId").value=i.id;$("itemName").value=i.name;$("itemCategory").value=i.category;$("itemPrice").value=i.price;$("itemAvailable").value=String(i.available);$("menuEditor").classList.remove("hidden");$("menuEditor").scrollIntoView({behavior:"smooth",block:"start"});
}
function resetMenuForm(){$("menuForm").reset();$("menuItemId").value="";$("menuEditorTitle").textContent="Add menu item";$("menuEditor").classList.add("hidden")}
async function saveMenuItem(e){
  e.preventDefault();if(!canManage())throw new Error("Owner access required.");
  const id=$("menuItemId").value,payload={name:$("itemName").value.trim(),category:$("itemCategory").value,price:Number($("itemPrice").value),available:$("itemAvailable").value==="true"};
  if(!payload.name||payload.price<0||!Number.isFinite(payload.price))throw new Error("Enter a valid name and price.");
  const result=id?await db.from("menu_items").update(payload).eq("id",id):await db.from("menu_items").insert(payload);
  if(result.error)throw result.error;resetMenuForm();await refreshData();renderManageMenu();message("Menu item saved.");
}
async function deleteMenuItem(id){
  if(!canManage()||!confirm("Delete this menu item? Existing orders will retain their saved item names."))return;
  const {error}=await db.from("menu_items").delete().eq("id",id);if(error){message(error.message,true);return}
  await refreshData();renderManageMenu();message("Menu item deleted.");
}
function renderCashier(){
  if(!canCashier())return;
  const list=state.orders.filter(o=>!o.paid&&o.status!=="Cancelled");
  $("cashierOrders").innerHTML=list.map(orderCard).join("")||empty("No orders are awaiting payment.");
}
function openPayment(id){
  try {
    if(!canCashier()){message("Only the Owner or Cashier can take payments.",true);return;}
    const panel=$("paymentPanel");
    if(!panel){message("Payment panel is missing. Check that index.html contains id=\"paymentPanel\".",true);return;}
    const o=state.orders.find(x=>String(x.id)===String(id));
    if(!o){message("Order not found in the current list. Refresh the page and try again.",true);return;}
    if(o.paid){message("This order has already been paid.",true);return;}
    const required=["paymentOrderId","paymentHeading","paymentOrderSummary","amountPaid","paymentChange"];
    const missing=required.filter(key=>!$(key));
    if(missing.length){message("Payment form is missing: "+missing.join(", ")+". Update index.html.",true);return;}
    state.activeOrder=o;
    $("paymentOrderId").value=o.id;
    $("paymentHeading").textContent="Payment for "+o.order_number;
    $("paymentOrderSummary").textContent=`${o.order_type==="Takeaway"?"Takeaway":"Table "+(o.table_number||"—")} · ${itemsText(o)} · Total ${money(o.total)}`;
    $("amountPaid").value=o.total;
    $("paymentChange").textContent=money(0);
    panel.classList.remove("hidden");
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  } catch(err) {
    console.error("Open payment failed:",err);
    message("Could not open payment: "+(err?.message||"Unknown error"),true);
  }
}
function calcChange(){const o=state.activeOrder;const paid=Number($("amountPaid").value||0);$("paymentChange").textContent=money(Math.max(0,moneyNum(paid-Number(o?.total||0))))}
async function recordPayment(e){
  e.preventDefault();const o=state.orders.find(x=>x.id===$("paymentOrderId").value);
  if(!o||o.paid)throw new Error("This order is already paid or no longer exists.");
  const amount=Number($("amountPaid").value),total=Number(o.total);
  if(!Number.isFinite(amount)||amount<total)throw new Error("Amount received must be at least the order total.");
  const {data,error}=await db.rpc("record_payment",{p_order_id:o.id,p_method:$("paymentMethod").value,p_amount:moneyNum(amount)});
  if(error)throw error;
  $("paymentPanel").classList.add("hidden");await refreshData();renderCashier();message("Payment recorded. Receipt number: "+(data?.receipt_number||""));showReceipt(o.id);
}
function showReceipt(orderId){
  const o=state.orders.find(x=>x.id===orderId),p=state.payments.find(x=>x.order_id===orderId);
  if(!o||!p){message("Receipt is unavailable until payment is recorded.",true);return}
  const items=o.order_items||[],change=Math.max(0,Number(p.amount)-Number(o.total));
  const html=`<div class="receipt"><h2>${esc(state.settings.hotel_name||"SAMRYC DISHES")}</h2><div class="center">${esc(state.settings.hotel_address||"")}<br>${esc(state.settings.hotel_phone||"")}<br><b>PAYMENT RECEIPT</b></div><div class="receipt-rule"></div><div>Receipt: ${esc(p.receipt_number)}<br>Order: ${esc(o.order_number)}<br>Date: ${new Date(p.created_at).toLocaleString("en-KE")}<br>Cashier: ${esc(p.cashier_name||"Cashier")}<br>Type: ${o.order_type==="Takeaway"?"Takeaway":"Table "+esc(o.table_number||"—")}${o.customer_name?"<br>Customer: "+esc(o.customer_name):""}</div><div class="receipt-rule"></div><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(i.item_name)}</td><td>${i.quantity}</td><td>${Number(i.unit_price).toFixed(2)}</td><td>${(Number(i.unit_price)*Number(i.quantity)).toFixed(2)}</td></tr>`).join("")}</tbody></table><div class="receipt-rule"></div><div class="total-line receipt-total"><span>TOTAL</span><strong>${money(o.total)}</strong></div><div>Payment: ${esc(p.method)}<br>Amount paid: ${money(p.amount)}<br>Change: ${money(change)}</div><div class="receipt-rule"></div><div class="center">Thank you for dining with SAMRYC DISHES!</div></div>`;
  $("receiptContent").innerHTML=html;$("printRoot").innerHTML=html;$("receiptPanel").classList.remove("hidden");$("receiptPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderSales(){
  if(!canCashier())return;const payments=state.payments.filter(p=>new Date(p.created_at)>=new Date(todayStart()));
  const sum=method=>payments.filter(p=>p.method===method).reduce((a,p)=>a+Number(p.amount),0);
  $("salesTotal").textContent=money(payments.reduce((a,p)=>a+Number(p.amount),0));$("salesCount").textContent=payments.length;$("salesCash").textContent=money(sum("Cash"));$("salesMpesa").textContent=money(sum("M-Pesa"));
  $("paymentRecords").innerHTML=payments.map(p=>{const o=state.orders.find(x=>x.id===p.order_id);return `<article class="order-card"><div><div class="order-top"><strong>${esc(p.receipt_number)}</strong><span class="pill paid">Paid</span></div><div class="order-detail">Order ${esc(o?.order_number||"—")} · ${esc(p.method)} · ${new Date(p.created_at).toLocaleString("en-KE")}<br>Cashier: ${esc(p.cashier_name||"—")}</div></div><div><div class="order-amount">${money(p.amount)}</div><div class="order-actions"><button class="btn outline" onclick="showReceipt('${p.order_id}')">Receipt</button></div></div></article>`}).join("")||empty("No payments recorded today.");
}
async function loadStaff(){
  if(!canManage())return;const {data,error}=await db.from("profiles").select("id,full_name,role,active,created_at").order("created_at");
  if(error){message(error.message,true);return}
  $("staffList").innerHTML=(data||[]).map(p=>`<article class="order-card"><div><div class="order-top"><strong>${esc(p.full_name)}</strong><span class="pill">${esc(p.role)}</span><span class="pill ${p.active?"paid":"unpaid"}">${p.active?"Active":"Inactive"}</span></div></div><div class="order-actions">${p.id!==state.user.id?`<button class="btn outline" onclick="toggleStaff('${p.id}',${!p.active})">${p.active?"Deactivate":"Activate"}</button>`:"<small class='muted'>Current account</small>"}</div></article>`).join("")||empty("No staff profiles found.");
}
async function createStaff(e){
  e.preventDefault();if(!canManage())throw new Error("Owner access required.");
  const body={full_name:$("staffName").value.trim(),email:$("staffEmail").value.trim(),role:$("staffRole").value,password:$("staffPassword").value};
  const {data:{session}}=await db.auth.getSession();
  const res=await fetch(`${SUPABASE_URL}/functions/v1/create-staff`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":SUPABASE_ANON_KEY},body:JSON.stringify(body)});
  const out=await res.json().catch(()=>({error:"Unexpected server response"}));if(!res.ok)throw new Error(out.error||"Could not create staff account.");
  $("staffForm").reset();await loadStaff();message("Staff account created.");
}
async function toggleStaff(id,active){
  if(!canManage())return;const {error}=await db.from("profiles").update({active}).eq("id",id);if(error){message(error.message,true);return}await loadStaff();message("Staff access updated.");
}
async function loadSettingsForm(){
  if(!canManage())return;const {data,error}=await db.from("hotel_settings").select("*").eq("id",1).single();if(error){message(error.message,true);return}
  state.settings=data;$("hotelName").value=data.hotel_name||"SAMRYC DISHES";$("hotelAddress").value=data.hotel_address||"";$("hotelPhone").value=data.hotel_phone||"";
}
async function saveSettings(e){
  e.preventDefault();if(!canManage())throw new Error("Owner access required.");
  const payload={id:1,hotel_name:$("hotelName").value.trim(),hotel_address:$("hotelAddress").value.trim(),hotel_phone:$("hotelPhone").value.trim()};
  const {error}=await db.from("hotel_settings").upsert(payload);if(error)throw error;state.settings=payload;message("Hotel receipt details saved.");
}
function runAction(fn){return async e=>{try{await fn(e)}catch(err){console.error(err);message(err.message||"Something went wrong.",true)}}}

$("loginForm").addEventListener("submit",runAction(async e=>{e.preventDefault();$("loginMessage").textContent="";const role=$("roleSelect").value;if(!roleAllowed(role))throw new Error("Select your assigned role.");await signIn($("loginEmail").value.trim(),$("loginPassword").value,role)}));
$("logoutBtn").addEventListener("click",signOut);
$("mainNav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)page(b.dataset.page)});
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>page(b.dataset.goto)));

$("menuSearch").addEventListener("input",renderMenu);$("categoryFilter").addEventListener("change",renderMenu);
$("ordersSearch").addEventListener("input",renderOrders);$("ordersStatus").addEventListener("change",renderOrders);
$("menuManageSearch").addEventListener("input",renderManageMenu);$("menuManageCategory").addEventListener("change",renderManageMenu);
$("orderType").addEventListener("change",()=>$("tableWrap").classList.toggle("hidden",$("orderType").value==="Takeaway"));
$("submitOrder").addEventListener("click",runAction(saveOrder));$("clearCart").addEventListener("click",()=>{state.cart.clear();renderCart()});
$("addMenuBtn").addEventListener("click",()=>{resetMenuForm();$("menuEditor").classList.remove("hidden");$("menuEditor").scrollIntoView({behavior:"smooth"})});
$("cancelMenuEdit").addEventListener("click",resetMenuForm);$("menuForm").addEventListener("submit",runAction(saveMenuItem));
$("paymentForm").addEventListener("submit",runAction(recordPayment));$("amountPaid").addEventListener("input",calcChange);$("cancelPayment").addEventListener("click",()=>$("paymentPanel").classList.add("hidden"));
$("printReceipt").addEventListener("click",()=>window.print());$("refreshSales").addEventListener("click",runAction(async()=>{await refreshData();renderSales()}));
$("staffForm").addEventListener("submit",runAction(createStaff));$("settingsForm").addEventListener("submit",runAction(saveSettings));
window.addToCart=addToCart;window.changeQty=changeQty;window.removeCart=removeCart;window.updateOrderStatus=updateOrderStatus;window.editMenuItem=editMenuItem;window.deleteMenuItem=deleteMenuItem;window.openPayment=openPayment;window.showReceipt=showReceipt;window.toggleStaff=toggleStaff;
boot();
