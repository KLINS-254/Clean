import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, ChefHat, ChevronDown,
  CircleDollarSign, ClipboardList, Coffee, CreditCard, LayoutDashboard, LogOut,
  Menu as MenuIcon, Package, Plus, Printer, Search, Settings, ShieldCheck,
  ShoppingBag, ShoppingCart, Table2, Users, Wallet, X, Minus, Check, Clock3,
  RefreshCw, Utensils, Trash2, CircleAlert
} from 'lucide-react';
import { configured, supabase } from './lib/supabase';

const money = n => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format((Number(n)||0)/100);
const dateTime = value => new Date(value || Date.now()).toLocaleString('en-KE', { dateStyle:'medium', timeStyle:'short' });
const roleLabel = role => ({owner:'Owner', waiter:'Waiter', cashier:'Cashier', kitchen:'Kitchen'})[role] || role;
const categoriesFallback = ['Breakfast','Main Meals','Local Dishes','Fast Food','Snacks','Beef','Chicken','Fish','Rice and Pilau','Ugali and Accompaniments','Vegetables','Fresh Juice','Soft Drinks','Water','Tea and Coffee','Other Beverages'];
const demoProducts = [
  {id:'demo-1',name:'Chicken & Rice',category_name:'Main Meals',price_minor:35000,stock_quantity:20,is_available:true,description:'Roast chicken served with rice'},
  {id:'demo-2',name:'Beef Pilau',category_name:'Rice and Pilau',price_minor:28000,stock_quantity:15,is_available:true,description:'Kenyan spiced pilau'},
  {id:'demo-3',name:'Ugali & Fish',category_name:'Fish',price_minor:40000,stock_quantity:8,is_available:true,description:'Fish with ugali and greens'},
  {id:'demo-4',name:'Soda 300ml',category_name:'Soft Drinks',price_minor:6000,stock_quantity:36,is_available:true,description:'Chilled soft drink'},
  {id:'demo-5',name:'Bottled Water',category_name:'Water',price_minor:5000,stock_quantity:30,is_available:true,description:'500ml bottled water'},
  {id:'demo-6',name:'Masala Tea',category_name:'Tea and Coffee',price_minor:7000,stock_quantity:25,is_available:true,description:'Kenyan tea with spices'}
];

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginRole, setLoginRole] = useState('owner');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState('POS');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState([]);
  const [tableName, setTableName] = useState('Takeaway');
  const [orderNote, setOrderNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentRef, setPaymentRef] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm, setProductForm] = useState({name:'',category_name:'Main Meals',price:'',stock:'0',description:''});
  const [mobileNav, setMobileNav] = useState(false);
  const role = profile?.role || 'owner';
  const isOwner = role === 'owner';
  const isWaiter = role === 'waiter';
  const isCashier = role === 'cashier';
  const canPOS = ['owner','waiter'].includes(role);

  const loadProfile = useCallback(async (user) => {
    if (!user || !supabase) return;
    const { data, error: e } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (e) { setError('Your account has no staff profile. Ask the owner to provision it.'); return; }
    setProfile(data);
    setError('');
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase || !session) return;
    const [p,c,o,pay] = await Promise.all([
      supabase.from('products').select('*, categories(name)').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('orders').select('*, order_items(*), profiles:created_by(full_name)').order('created_at',{ascending:false}).limit(100),
      supabase.from('payments').select('*').order('created_at',{ascending:false}).limit(100)
    ]);
    if (p.error || c.error || o.error || pay.error) {
      setError([p.error,c.error,o.error,pay.error].filter(Boolean).map(x=>x.message).join(' · '));
      return;
    }
    setProducts((p.data||[]).map(x=>({...x,category_name:x.categories?.name || 'Other'})));
    setCategories(c.data||[]);
    setOrders(o.data||[]);
    setPayments(pay.data||[]);
  }, [session]);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({data}) => {
      setSession(data.session);
      if (data.session) await loadProfile(data.session.user);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) { setProfile(null); setLoading(false); }
      else setTimeout(() => loadProfile(next.user), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => { if (session && profile) loadData(); }, [session, profile, loadData]);
  useEffect(() => {
    if (!configured || !session) return;
    const channel = supabase.channel('samryc-live-orders')
      .on('postgres_changes',{event:'*',schema:'public',table:'orders'},()=>loadData())
      .on('postgres_changes',{event:'*',schema:'public',table:'payments'},()=>loadData())
      .subscribe();
    const interval = setInterval(loadData, 20000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [session, loadData]);

  const menuProducts = useMemo(() => {
    const source = products.length ? products : (!configured ? demoProducts : []);
    return source.filter(p => p.is_available !== false)
      .filter(p => category === 'All' || p.category_name === category)
      .filter(p => `${p.name} ${p.category_name} ${p.description||''}`.toLowerCase().includes(search.toLowerCase()));
  }, [products, category, search]);
  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum,item)=>sum+item.price_minor*item.quantity,0);
    return {subtotal,total:subtotal};
  }, [cart]);
  const pendingOrders = orders.filter(o => !['paid','cancelled','refunded'].includes(o.status));
  const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === new Date().toDateString());
  const paidToday = payments.filter(p => new Date(p.created_at).toDateString() === new Date().toDateString()).reduce((s,p)=>s+p.amount_minor,0);

  async function login(e) {
    e.preventDefault(); setError(''); setBusy(true);
    if (!configured) { setError('Connect Supabase first: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Demo browsing is available, but login and transactions require a database.'); setBusy(false); return; }
    const {data, error:e1} = await supabase.auth.signInWithPassword({email:email.trim(),password});
    if (e1) { setError(e1.message); setBusy(false); return; }
    const {data:staff,error:e2} = await supabase.from('profiles').select('role,active').eq('id',data.user.id).single();
    if (e2 || !staff?.active || staff.role !== loginRole) {
      await supabase.auth.signOut();
      setError('The selected role does not match an active staff account.');
    } else { setSession(data.session); await loadProfile(data.user); setNotice('Welcome to SAMRYC DISHES.'); }
    setBusy(false);
  }

  async function logout() { if(supabase) await supabase.auth.signOut(); setSession(null); setProfile(null); setCart([]); }
  function addToCart(product) {
    if (!canPOS) return;
    setCart(prev => {
      const existing=prev.find(x=>x.product_id===product.id);
      if(existing) return prev.map(x=>x.product_id===product.id?{...x,quantity:x.quantity+1}:x);
      return [...prev,{product_id:product.id,name:product.name,price_minor:product.price_minor,quantity:1,instructions:''}];
    });
  }
  function changeQty(id, delta) { setCart(prev=>prev.map(x=>x.product_id===id?{...x,quantity:Math.max(0,x.quantity+delta)}:x).filter(x=>x.quantity>0)); }

  async function saveOrder(sendKitchen=false) {
    if (!supabase || !session || !cart.length) { setError('Add at least one menu item before saving.'); return; }
    setBusy(true); setError('');
    try {
      const payload={created_by:session.user.id, table_label:tableName, status:sendKitchen?'new':'held', notes:orderNote, subtotal_minor:totals.subtotal, discount_minor:0, tax_minor:0, total_minor:totals.total, amount_paid_minor:0};
      const {data:order,error:e1}=await supabase.from('orders').insert(payload).select().single();
      if(e1) throw e1;
      const rows=cart.map(i=>({order_id:order.id,product_id:i.product_id.startsWith('demo-')?null:i.product_id,product_name:i.name,quantity:i.quantity,unit_price_minor:i.price_minor,line_total_minor:i.price_minor*i.quantity,instructions:i.instructions||''}));
      const {error:e2}=await supabase.from('order_items').insert(rows);
      if(e2) { await supabase.from('orders').delete().eq('id',order.id); throw e2; }
      await supabase.from('audit_logs').insert({actor_id:session.user.id,action:sendKitchen?'order_sent_to_kitchen':'order_created',entity_type:'order',entity_id:order.id,details:{table_label:tableName,total_minor:totals.total}});
      setCart([]); setOrderNote(''); setTableName('Takeaway'); setNotice(`Order ${order.order_number} ${sendKitchen?'sent to kitchen':'saved'}.`); await loadData();
    } catch(e) { setError(e.message || 'Unable to save order.'); }
    finally { setBusy(false); }
  }

  async function recordPayment(order) {
    if (!supabase || !session) return;
    const amount=Math.round(Number(paymentAmount)*100);
    if(!Number.isFinite(amount)||amount<=0) {setError('Enter a valid payment amount.');return;}
    const balance=order.total_minor-order.amount_paid_minor;
    if(amount>balance) {setError('Payment cannot exceed the outstanding balance.');return;}
    if(paymentMethod==='mpesa'&&!paymentRef.trim()) {setError('Enter the M-Pesa transaction reference.');return;}
    setBusy(true);setError('');
    try {
      const {error:e}=await supabase.from('payments').insert({order_id:order.id,received_by:session.user.id,method:paymentMethod,amount_minor:amount,reference:paymentRef.trim()||null,status:'recorded'});
      if(e) throw e;
      const newPaid=order.amount_paid_minor+amount;
      const {error:oe}=await supabase.from('orders').update({amount_paid_minor:newPaid,status:newPaid>=order.total_minor?'paid':'awaiting_payment'}).eq('id',order.id);
      if(oe) throw oe;
      await supabase.from('audit_logs').insert({actor_id:session.user.id,action:'payment_recorded',entity_type:'order',entity_id:order.id,details:{method:paymentMethod,amount_minor:amount,reference:paymentRef||null}});
      setReceipt({...order,amount_paid_minor:newPaid,last_payment:amount,payment_method:paymentMethod,payment_reference:paymentRef,receipt_number:`SD-${Date.now().toString().slice(-8)}`});
      setPaymentOrder(null);setPaymentAmount('');setPaymentRef('');await loadData();
    } catch(e) {setError(e.message||'Payment could not be recorded.');}
    finally {setBusy(false);}
  }

  async function addProduct(e) {
    e.preventDefault(); if(!supabase||!session) return;
    const price=Math.round(Number(productForm.price)*100), stock=Number(productForm.stock);
    if(!productForm.name.trim()||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0){setError('Check product name, price and stock.');return;}
    setBusy(true);
    try {
      let categoryId=categories.find(c=>c.name===productForm.category_name)?.id;
      if(!categoryId){const {data,error:e1}=await supabase.from('categories').insert({name:productForm.category_name}).select().single();if(e1)throw e1;categoryId=data.id;}
      const {error:e2}=await supabase.from('products').insert({name:productForm.name.trim(),category_id:categoryId,price_minor:price,stock_quantity:stock,description:productForm.description,is_available:true});
      if(e2)throw e2;
      setShowProductForm(false);setProductForm({name:'',category_name:'Main Meals',price:'',stock:'0',description:''});setNotice('Menu item added.');await loadData();
    }catch(e){setError(e.message||'Unable to add item.');}finally{setBusy(false);}
  }

  function printReceipt(r, duplicate=false) {
    setReceipt({...r, duplicate});
    setTimeout(()=>window.print(),100);
  }

  if (loading) return <div className="loading-screen"><div className="brand-mark"><Utensils/></div><h2>SAMRYC DISHES</h2><p>Preparing your workspace…</p></div>;
  if (!session || !profile) return <div className="login-page">
    <div className="login-visual"><div className="login-brand"><div className="brand-mark"><Utensils size={28}/></div><span>SAMRYC <b>DISHES</b></span></div><div className="login-message"><span className="eyebrow">HOTEL MANAGEMENT & POS</span><h1>Every order.<br/><em>Handled beautifully.</em></h1><p>One workspace for service, kitchen coordination and payments.</p><div className="login-points"><span><Check/> Faster ordering</span><span><Check/> Clear kitchen tickets</span><span><Check/> Accurate sales records</span></div></div><div className="login-footer">HOSPITALITY, MADE SIMPLE</div></div>
    <div className="login-panel"><form className="login-card" onSubmit={login}><div className="mobile-logo"><div className="brand-mark"><Utensils/></div><h2>SAMRYC DISHES</h2></div><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p className="muted">Use your individual staff credentials to continue.</p>
      {!configured&&<div className="alert warning"><CircleAlert size={17}/><span>Supabase is not configured yet. Set the environment variables to enable secure sign-in.</span></div>}
      {error&&<div className="alert danger">{error}</div>}
      <label>Staff role<select value={loginRole} onChange={e=>setLoginRole(e.target.value)}><option value="owner">Owner</option><option value="waiter">Waiter</option><option value="cashier">Cashier</option><option value="kitchen">Kitchen</option></select></label>
      <label>Email / username<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="staff@samrycdishes.co.ke" required/></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" required/></label>
      <button className="primary full" disabled={busy}>{busy?'Signing in…':'Sign in securely'} <span>→</span></button><p className="login-note"><ShieldCheck size={15}/> Staff access is verified against the database.</p>
      {!configured&&<button type="button" className="secondary full" onClick={()=>{setError('Demo mode is only a design preview. Connect Supabase to enable real orders, staff authentication and payment persistence.');}}>Check setup</button>}
    </form><div className="login-copyright">© {new Date().getFullYear()} SAMRYC DISHES · HOTEL & RESTAURANT</div></div>
  </div>;

  const navItems = [
    {name:'POS',icon:ShoppingCart,roles:['owner','waiter']},
    {name:'Orders',icon:ClipboardList,roles:['owner','waiter','cashier','kitchen']},
    {name:'Kitchen',icon:ChefHat,roles:['owner','waiter','kitchen']},
    {name:'Tables',icon:Table2,roles:['owner','waiter']},
    {name:'Menu',icon:Utensils,roles:['owner']},
    {name:'Inventory',icon:Package,roles:['owner']},
    {name:'Payments',icon:Wallet,roles:['owner','cashier']},
    {name:'Reports',icon:BarChart3,roles:['owner']},
    {name:'Staff & Settings',icon:Settings,roles:['owner']}
  ].filter(x=>x.roles.includes(role));

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'show':''}`}><div className="side-brand"><div className="brand-mark"><Utensils/></div><div><strong>SAMRYC <b>DISHES</b></strong><small>HOTEL & RESTAURANT</small></div><button className="mobile-close icon-btn" onClick={()=>setMobileNav(false)}><X/></button></div><div className="side-label">WORKSPACE</div><nav>{navItems.map(n=><button key={n.name} className={`nav-link ${page===n.name?'active':''}`} onClick={()=>{setPage(n.name);setMobileNav(false);}}><n.icon size={18}/><span>{n.name}</span>{n.name==='Orders'&&pendingOrders.length>0&&<i>{pendingOrders.length}</i>}</button>)}</nav><div className="sidebar-bottom"><div className="connection"><span className="online-dot"></span><div><b>Database connected</b><small>Sync enabled</small></div><Activity size={16}/></div><div className="user-mini"><div className="avatar">{(profile.full_name||'S').slice(0,1).toUpperCase()}</div><div className="user-info"><b>{profile.full_name}</b><small>{roleLabel(role)}</small></div><button className="icon-btn" onClick={logout} title="Sign out"><LogOut size={17}/></button></div></div></aside>
    {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}></div>}
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><MenuIcon/></button><div><span className="eyebrow">SAMRYC DISHES / WORKSPACE</span><h1>{page==='POS'?'Point of Sale':page}</h1></div></div><div className="topbar-right"><span className="today-date">{new Date().toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span><button className="icon-btn notification" title="Refresh data" onClick={loadData}><RefreshCw size={18}/></button><div className="avatar">{(profile.full_name||'S').slice(0,1).toUpperCase()}</div></div></header>
      {(error||notice)&&<div className={`toast ${error?'toast-error':'toast-success'}`}><span>{error||notice}</span><button onClick={()=>{setError('');setNotice('')}}><X size={16}/></button></div>}
      {page==='POS'&&<div className="pos-layout"><section className="menu-section"><div className="section-head"><div><h2>Food & drinks</h2><p className="muted">Choose items to add to the current order.</p></div><span className="item-count">{menuProducts.length} items</span></div><div className="searchbar"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search food, drinks…"/></div><div className="category-tabs"><button className={category==='All'?'selected':''} onClick={()=>setCategory('All')}>All items</button>{[...new Set([...categories.map(c=>c.name),...categoriesFallback])].map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="product-grid">{menuProducts.map(p=><button key={p.id} className="product-card" onClick={()=>addToCart(p)} disabled={!p.is_available||p.stock_quantity===0}><div className={`product-illustration illustration-${(p.name.length%5)+1}`}><Utensils size={24}/><span className="add-bubble"><Plus size={15}/></span></div><div className="product-card-body"><span className="product-category">{p.category_name}</span><strong>{p.name}</strong><div className="product-bottom"><b>{money(p.price_minor)}</b><small>{p.stock_quantity>0?`${p.stock_quantity} available`:'Stock not set / unavailable'}</small></div></div></button>)}
        {!menuProducts.length&&<div className="empty-state"><ShoppingBag size={30}/><b>No menu items found</b><span>Add products or change your search.</span></div>}</div></section>
        <aside className="cart-panel"><div className="cart-head"><div><h2>Current order</h2><p className="muted">New service ticket</p></div><span className="cart-count">{cart.reduce((s,i)=>s+i.quantity,0)} items</span></div><div className="order-meta"><label>Table / service<select value={tableName} onChange={e=>setTableName(e.target.value)}><option>Takeaway</option>{Array.from({length:10},(_,i)=><option key={i}>Table {i+1}</option>)}</select></label><div className="order-id"><span>ORDER NUMBER</span><b>Generated when saved</b></div></div><div className="cart-items">{cart.map(i=><div className="cart-item" key={i.product_id}><div className="cart-item-main"><strong>{i.name}</strong><span>{money(i.price_minor)} each</span><div className="qty-control"><button onClick={()=>changeQty(i.product_id,-1)}><Minus size={13}/></button><b>{i.quantity}</b><button onClick={()=>changeQty(i.product_id,1)}><Plus size={13}/></button></div></div><div className="cart-line-total"><b>{money(i.price_minor*i.quantity)}</b><button className="remove-btn" onClick={()=>changeQty(i.product_id,-i.quantity)}><Trash2 size={14}/></button></div></div>)}{!cart.length&&<div className="cart-empty"><div className="empty-cart-icon"><ShoppingCart size={26}/></div><b>Your order is empty</b><span>Select menu items to begin.</span></div>}</div><label className="order-note-label">Kitchen instructions<textarea value={orderNote} onChange={e=>setOrderNote(e.target.value)} placeholder="e.g. no onions, less salt…" rows="2"/></label><div className="cart-summary"><div><span>Subtotal</span><b>{money(totals.subtotal)}</b></div><div><span>Discount</span><span>{money(0)}</span></div><div><span>Tax</span><span>{money(0)}</span></div><div className="grand-total"><strong>Total</strong><strong>{money(totals.total)}</strong></div></div><div className="cart-actions"><button className="secondary" onClick={()=>{setCart([]);setOrderNote('')}} disabled={!cart.length}>Clear</button><button className="primary" onClick={()=>saveOrder(false)} disabled={!cart.length||busy}>Save order</button><button className="primary full" onClick={()=>saveOrder(true)} disabled={!cart.length||busy}><ChefHat size={17}/> Send to kitchen</button></div></aside></div>}

      {page==='Orders'&&<section className="page-content"><div className="section-head"><div><h2>Order management</h2><p className="muted">Track active tickets, service and outstanding balances.</p></div><button className="secondary" onClick={loadData}><RefreshCw size={16}/> Refresh</button></div><div className="table-wrap"><table><thead><tr><th>Order</th><th>Table</th><th>Created</th><th>Waiter</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><b>{o.order_number}</b></td><td>{o.table_label}</td><td>{dateTime(o.created_at)}</td><td>{o.profiles?.full_name||'Staff'}</td><td>{money(o.total_minor)}</td><td>{money(o.amount_paid_minor)}</td><td>{money(o.total_minor-o.amount_paid_minor)}</td><td><span className={`status status-${o.status}`}>{o.status?.replaceAll('_',' ')}</span></td><td><button className="small-btn" onClick={()=>{setPaymentOrder(o);setPaymentAmount(((o.total_minor-o.amount_paid_minor)/100).toFixed(2));setPage('Payments')}}>{o.status==='paid'?'View':'Payment'}</button></td></tr>)}{!orders.length&&<tr><td colSpan="9" className="table-empty">No orders have been recorded yet.</td></tr>}</tbody></table></div></section>}

      {page==='Kitchen'&&<section className="page-content"><div className="section-head"><div><h2>Kitchen display</h2><p className="muted">Preparation queue · payment details are hidden.</p></div><button className="secondary" onClick={loadData}><RefreshCw size={16}/> Refresh</button></div><div className="kitchen-grid">{orders.filter(o=>['new','preparing','ready'].includes(o.status)).map(o=><article className="kitchen-card" key={o.id}><div className="kitchen-card-head"><div><span className="eyebrow">ORDER TICKET</span><h3>{o.order_number}</h3></div><span className={`status status-${o.status}`}>{o.status}</span></div><div className="kitchen-table">{o.table_label}</div><p className="muted">Submitted {dateTime(o.created_at)} · {o.profiles?.full_name||'Waiter'}</p><div className="kitchen-items">{(o.order_items||[]).map(it=><div key={it.id}><b>{it.quantity} ×</b><span>{it.product_name}</span>{it.instructions&&<small>{it.instructions}</small>}</div>)}</div>{o.notes&&<div className="kitchen-note">Note: {o.notes}</div>}<div className="kitchen-actions">{o.status==='new'&&<button className="primary" onClick={async()=>{await supabase.from('orders').update({status:'preparing'}).eq('id',o.id);await loadData()}}>Start preparing</button>}{o.status==='preparing'&&<button className="primary" onClick={async()=>{await supabase.from('orders').update({status:'ready'}).eq('id',o.id);await loadData()}}>Mark ready</button>}{o.status==='ready'&&<button className="secondary" onClick={async()=>{await supabase.from('orders').update({status:'served'}).eq('id',o.id);await loadData()}}>Mark served</button>}</div></article>)}{!orders.some(o=>['new','preparing','ready'].includes(o.status))&&<div className="empty-state"><ChefHat size={32}/><b>Kitchen is all caught up</b><span>New orders sent by waiters will appear here.</span></div>}</div></section>}

      {page==='Tables'&&<section className="page-content"><div className="section-head"><div><h2>Table overview</h2><p className="muted">Quick view of service areas and active tickets.</p></div></div><div className="table-cards">{Array.from({length:10},(_,i)=>{const label=`Table ${i+1}`, active=orders.find(o=>o.table_label===label&&!['paid','cancelled','served'].includes(o.status));return <button className={`table-card ${active?'occupied':''}`} key={label} onClick={()=>{if(active){setPage('Orders')}else{setTableName(label);setPage('POS')}}}><Table2 size={24}/><b>{label}</b><span className={`status ${active?'status-preparing':'status-served'}`}>{active?'Occupied':'Available'}</span>{active&&<small>{active.order_number}</small>}</button>})}<button className="table-card takeaway" onClick={()=>{setTableName('Takeaway');setPage('POS')}}><ShoppingBag size={24}/><b>Takeaway</b><span className="status status-new">Order to go</span></button></div></section>}

      {page==='Menu'&&<section className="page-content"><div className="section-head"><div><h2>Menu management</h2><p className="muted">Maintain your catalogue and configurable selling prices.</p></div><button className="primary" onClick={()=>setShowProductForm(true)}><Plus size={17}/> Add menu item</button></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Availability</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><b>{p.name}</b><small className="table-sub">{p.description}</small></td><td>{p.category_name}</td><td>{money(p.price_minor)}</td><td>{p.stock_quantity}</td><td><span className={`status ${p.is_available?'status-served':'status-cancelled'}`}>{p.is_available?'Available':'Unavailable'}</span></td></tr>)}</tbody></table></div></section>}

      {page==='Inventory'&&<section className="page-content"><div className="section-head"><div><h2>Inventory overview</h2><p className="muted">Current tracked sellable-product quantities.</p></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Quantity</th><th>Stock status</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{p.category_name}</td><td>{p.stock_quantity}</td><td><span className={`status ${p.stock_quantity<=5?'status-cancelled':'status-served'}`}>{p.stock_quantity<=5?'Low stock':'In stock'}</span></td></tr>)}</tbody></table></div><p className="muted small-note">Ingredient-level recipes and stock movement adjustments are not enabled in this initial release.</p></section>}

      {page==='Payments'&&<section className="page-content"><div className="section-head"><div><h2>Payments & balances</h2><p className="muted">Record cash, M-Pesa, card and other payments against orders.</p></div></div><div className="stats-grid compact"><div className="stat-card"><span>Cash received today</span><b>{money(payments.filter(p=>p.method==='cash'&&new Date(p.created_at).toDateString()===new Date().toDateString()).reduce((s,p)=>s+p.amount_minor,0))}</b><Wallet/></div><div className="stat-card"><span>M-Pesa received today</span><b>{money(payments.filter(p=>p.method==='mpesa'&&new Date(p.created_at).toDateString()===new Date().toDateString()).reduce((s,p)=>s+p.amount_minor,0))}</b><CircleDollarSign/></div><div className="stat-card"><span>Outstanding balance</span><b>{money(pendingOrders.reduce((s,o)=>s+o.total_minor-o.amount_paid_minor,0))}</b><Clock3/></div></div><h3 className="subheading">Orders awaiting payment</h3><div className="table-wrap"><table><thead><tr><th>Order</th><th>Table</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>{orders.filter(o=>o.total_minor>o.amount_paid_minor&&!['cancelled','refunded'].includes(o.status)).map(o=><tr key={o.id}><td><b>{o.order_number}</b></td><td>{o.table_label}</td><td>{money(o.total_minor)}</td><td>{money(o.amount_paid_minor)}</td><td>{money(o.total_minor-o.amount_paid_minor)}</td><td><button className="small-btn" onClick={()=>{setPaymentOrder(o);setPaymentAmount(((o.total_minor-o.amount_paid_minor)/100).toFixed(2));setPaymentMethod('cash');setPaymentRef('')}}>Receive payment</button></td></tr>)}</tbody></table></div><h3 className="subheading">Recent transactions</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Order</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{dateTime(p.created_at)}</td><td>{p.order_id?.slice(0,8)}</td><td>{p.method?.toUpperCase()}</td><td>{p.reference||'—'}</td><td><b>{money(p.amount_minor)}</b></td></tr>)}</tbody></table></div></section>}

      {page==='Reports'&&<section className="page-content"><div className="section-head"><div><h2>Sales overview</h2><p className="muted">Figures are calculated from persisted order and payment records.</p></div><button className="secondary" onClick={()=>{const rows=[['Order','Date','Table','Status','Total KSh','Paid KSh','Balance KSh'],...orders.map(o=>[o.order_number,o.created_at,o.table_label,o.status,(o.total_minor/100).toFixed(2),(o.amount_paid_minor/100).toFixed(2),((o.total_minor-o.amount_paid_minor)/100).toFixed(2)])];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='samryc-sales-report.csv';a.click();URL.revokeObjectURL(a.href)}}><ArrowDownRight size={16}/> Export CSV</button></div><div className="stats-grid"><div className="stat-card"><span>Today's sales collected</span><b>{money(paidToday)}</b><small><ArrowUpRight size={13}/> Payments recorded today</small><CircleDollarSign/></div><div className="stat-card"><span>Orders today</span><b>{todayOrders.length}</b><small>All recorded statuses</small><ClipboardList/></div><div className="stat-card"><span>Average order value</span><b>{money(todayOrders.length?Math.round(todayOrders.reduce((s,o)=>s+o.total_minor,0)/todayOrders.length):0)}</b><small>Based on today's orders</small><BarChart3/></div><div className="stat-card"><span>Outstanding balances</span><b>{money(pendingOrders.reduce((s,o)=>s+o.total_minor-o.amount_paid_minor,0))}</b><small>Across open orders</small><Clock3/></div></div><div className="report-panel"><div><h3>Recent orders</h3><p className="muted">Sales history from your database.</p></div><div className="table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Waiter</th><th>Status</th><th>Total</th><th>Paid</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><b>{o.order_number}</b></td><td>{dateTime(o.created_at)}</td><td>{o.profiles?.full_name||'Staff'}</td><td><span className={`status status-${o.status}`}>{o.status}</span></td><td>{money(o.total_minor)}</td><td>{money(o.amount_paid_minor)}</td></tr>)}</tbody></table></div></div><p className="muted small-note">Gross profit and advanced sales charts require accurate product cost data; those figures are intentionally not fabricated.</p></section>}

      {page==='Staff & Settings'&&<section className="page-content"><div className="section-head"><div><h2>Staff & settings</h2><p className="muted">Account provisioning and business configuration.</p></div></div><div className="settings-grid"><article className="settings-card"><ShieldCheck/><h3>Secure staff accounts</h3><p>Create staff in Supabase Authentication, then insert a matching profile with the same user ID and assigned role. Never share accounts or expose service-role credentials in the browser.</p><code>profiles.role: owner / waiter / cashier / kitchen</code></article><article className="settings-card"><Settings/><h3>Business receipt details</h3><p>Update the business_settings row in Supabase to configure the restaurant address, telephone, currency, tax and receipt footer.</p><button className="secondary" onClick={()=>setNotice('Business settings are managed in Supabase for this release. See README.md for the SQL fields.')}>View setup note</button></article><article className="settings-card"><Users/><h3>Active staff directory</h3><p>Staff identity and permissions are database-controlled. Add accounts through Supabase Auth and the secure provisioning procedure documented in the README.</p></article></div></section>}
      <footer className="app-footer"><span>© {new Date().getFullYear()} SAMRYC DISHES</span><span><span className="online-dot"></span> Workspace active</span></footer>
    </main>

    {paymentOrder&&<div className="modal-backdrop" onClick={()=>setPaymentOrder(null)}><form className="modal" onSubmit={e=>{e.preventDefault();recordPayment(paymentOrder)}} onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PAYMENT COLLECTION</span><h2>Receive payment</h2></div><button type="button" className="icon-btn" onClick={()=>setPaymentOrder(null)}><X/></button></div><div className="payment-order-summary"><span>{paymentOrder.order_number} · {paymentOrder.table_label}</span><b>Balance due: {money(paymentOrder.total_minor-paymentOrder.amount_paid_minor)}</b></div><label>Payment method<select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="other">Other</option></select></label><label>Amount received (KSh)<input type="number" min="0.01" step="0.01" max={(paymentOrder.total_minor-paymentOrder.amount_paid_minor)/100} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} required/></label>{paymentMethod==='mpesa'&&<label>M-Pesa transaction reference<input value={paymentRef} onChange={e=>setPaymentRef(e.target.value.toUpperCase())} placeholder="e.g. QGH12ABC34" required/></label>}{paymentMethod==='cash'&&<div className="change-box"><span>Change due</span><b>{money(Math.max(0,Math.round(Number(paymentAmount||0)*100)-(paymentOrder.total_minor-paymentOrder.amount_paid_minor)))}</b></div>}<p className="muted small-note">M-Pesa entries are recorded by the cashier; this does not independently verify payment with Safaricom.</p><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setPaymentOrder(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Recording…':'Record payment'}</button></div></form></div>}

    {showProductForm&&<div className="modal-backdrop" onClick={()=>setShowProductForm(false)}><form className="modal" onSubmit={addProduct} onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">MENU CATALOGUE</span><h2>Add menu item</h2></div><button type="button" className="icon-btn" onClick={()=>setShowProductForm(false)}><X/></button></div><label>Product name<input value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})} required/></label><label>Category<select value={productForm.category_name} onChange={e=>setProductForm({...productForm,category_name:e.target.value})}>{[...new Set([...categories.map(c=>c.name),...categoriesFallback])].map(c=><option key={c}>{c}</option>)}</select></label><label>Selling price (KSh)<input type="number" min="0" step="0.01" value={productForm.price} onChange={e=>setProductForm({...productForm,price:e.target.value})} required/></label><label>Stock quantity<input type="number" min="0" step="1" value={productForm.stock} onChange={e=>setProductForm({...productForm,stock:e.target.value})} required/></label><label>Description<textarea value={productForm.description} onChange={e=>setProductForm({...productForm,description:e.target.value})}/></label><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setShowProductForm(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save item'}</button></div></form></div>}

    {receipt&&<div className="receipt-print-root"><div className="receipt-actions"><button className="primary" onClick={()=>window.print()}><Printer size={16}/> Print receipt</button><button className="secondary" onClick={()=>{const blob=new Blob([document.querySelector('.receipt-paper').innerText],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${receipt.receipt_number||'samryc-receipt'}.txt`;a.click();URL.revokeObjectURL(a.href)}}>Download text copy</button><button className="icon-btn" onClick={()=>setReceipt(null)}><X/></button></div><div className="receipt-paper"><h2>SAMRYC DISHES</h2><b>HOTEL & RESTAURANT</b><p> [Hotel Address]<br/>Tel: [Hotel Phone]</p><hr/><h3>{receipt.duplicate?'DUPLICATE RECEIPT':'RECEIPT / CUSTOMER COPY'}</h3><div className="receipt-line"><span>Receipt No:</span><b>{receipt.receipt_number||'SD-RECORDED'}</b></div><div className="receipt-line"><span>Order No:</span><b>{receipt.order_number}</b></div><div className="receipt-line"><span>Date:</span><span>{dateTime(new Date())}</span></div><div className="receipt-line"><span>Table:</span><span>{receipt.table_label}</span></div><hr/><div className="receipt-items-head"><span>ITEM</span><span>QTY</span><span>AMOUNT</span></div>{(receipt.order_items||[]).map(i=><div className="receipt-item" key={i.id||i.product_name}><span>{i.product_name}</span><span>{i.quantity}</span><span>{money(i.line_total_minor||i.unit_price_minor*i.quantity)}</span></div>)}<hr/><div className="receipt-line"><span>Subtotal</span><span>{money(receipt.subtotal_minor||receipt.total_minor)}</span></div><div className="receipt-line"><span>Discount</span><span>{money(receipt.discount_minor||0)}</span></div><div className="receipt-line"><span>Tax</span><span>{money(receipt.tax_minor||0)}</span></div><div className="receipt-line receipt-total"><b>TOTAL</b><b>{money(receipt.total_minor)}</b></div><div className="receipt-line"><span>Paid now</span><span>{money(receipt.last_payment||0)}</span></div><div className="receipt-line"><span>Total paid</span><span>{money(receipt.amount_paid_minor)}</span></div><div className="receipt-line"><b>Balance</b><b>{money(receipt.total_minor-receipt.amount_paid_minor)}</b></div><div className="receipt-line"><span>Payment</span><b>{(receipt.payment_method||'RECORDED').toUpperCase()}</b></div>{receipt.payment_reference&&<div className="receipt-line"><span>Reference</span><span>{receipt.payment_reference}</span></div>}<hr/><h3 className="receipt-thanks">THANK YOU!<br/>WE APPRECIATE YOUR VISIT<br/>KARIBU TENA!</h3></div></div>}
  </div>;
}

export default App;
