require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, hashPassword, verifyPassword } = require('./database');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 24) {
  console.error('Set JWT_SECRET in .env to a random secret at least 24 characters long.');
  process.exit(1);
}
const hotelSettings = {
  name: process.env.HOTEL_NAME || 'TICOH HOTEL',
  address: process.env.HOTEL_ADDRESS || 'Nairobi, Kenya',
  phone: process.env.HOTEL_PHONE || ''
};

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id, username: user.username, name: user.name, role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 2) return res.status(401).json({ error: 'Please log in again.' });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(parts[0]).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid session.' });
  try {
    const user = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (user.exp < Date.now() / 1000) return res.status(401).json({ error: 'Session expired.' });
    const current = db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(user.id);
    if (!current || !current.active) return res.status(401).json({ error: 'Account disabled.' });
    req.user = current;
    next();
  } catch { return res.status(401).json({ error: 'Invalid session.' }); }
}
function allow(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next() : res.status(403).json({ error: 'You do not have permission to do that.' });
}
function audit(userId, action, details='') {
  db.prepare('INSERT INTO audit_logs (user_id,action,details) VALUES (?,?,?)').run(userId, action, details);
}
function getOrder(id) {
  const order = db.prepare(`
    SELECT o.*, u.name AS cashier_name FROM orders o
    JOIN users u ON u.id=o.created_by WHERE o.id=?
  `).get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(id);
  order.payments = db.prepare('SELECT p.*,u.name AS worker_name FROM payments p JOIN users u ON u.id=p.received_by WHERE p.order_id=? ORDER BY p.id').all(id);
  return order;
}

app.get('/api/health', (req,res) => res.json({ ok:true }));
app.post('/api/login', (req,res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error:'Enter username and password.' });
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username).trim());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error:'Incorrect username or password.' });
  }
  audit(user.id, 'LOGIN', 'Successful login');
  res.json({ token: tokenFor(user), user:{ id:user.id, username:user.username, name:user.name, role:user.role } });
});
app.get('/api/me', auth, (req,res) => res.json({ user:req.user, hotel:hotelSettings }));
app.post('/api/logout', auth, (req,res) => { audit(req.user.id,'LOGOUT'); res.json({ok:true}); });

app.get('/api/menu', auth, (req,res) => {
  const rows = db.prepare('SELECT * FROM menu_items ORDER BY category,name').all();
  res.json(rows);
});
app.post('/api/menu', auth, allow('owner','supervisor'), (req,res) => {
  const { name, category, price, cost_price=0, destination='kitchen', stock_qty=null } = req.body || {};
  if (!String(name||'').trim() || !String(category||'').trim() || !Number.isFinite(Number(price)) || Number(price)<0) {
    return res.status(400).json({error:'Name, category and a valid non-negative price are required.'});
  }
  const info = db.prepare(`INSERT INTO menu_items(name,category,price,cost_price,destination,stock_qty)
    VALUES(?,?,?,?,?,?)`).run(String(name).trim(),String(category).trim(),Number(price),Number(cost_price)||0,
      destination==='bar'?'bar':'kitchen', stock_qty===''||stock_qty===undefined?null:(stock_qty===null?null:Number(stock_qty)));
  audit(req.user.id,'MENU_ADD',String(name));
  res.status(201).json(db.prepare('SELECT * FROM menu_items WHERE id=?').get(info.lastInsertRowid));
});
app.patch('/api/menu/:id', auth, allow('owner','supervisor'), (req,res) => {
  const old = db.prepare('SELECT * FROM menu_items WHERE id=?').get(Number(req.params.id));
  if (!old) return res.status(404).json({error:'Menu item not found.'});
  const b = req.body || {};
  const next = {
    name: b.name === undefined ? old.name : String(b.name).trim(),
    category: b.category === undefined ? old.category : String(b.category).trim(),
    price: b.price === undefined ? old.price : Number(b.price),
    cost_price: b.cost_price === undefined ? old.cost_price : Number(b.cost_price),
    destination: b.destination === undefined ? old.destination : (b.destination==='bar'?'bar':'kitchen'),
    available: b.available === undefined ? old.available : (b.available ? 1 : 0),
    stock_qty: b.stock_qty === undefined ? old.stock_qty : b.stock_qty
  };
  if (!next.name || !next.category || !Number.isFinite(next.price) || next.price<0) return res.status(400).json({error:'Invalid menu details.'});
  db.prepare(`UPDATE menu_items SET name=?,category=?,price=?,cost_price=?,destination=?,available=?,stock_qty=? WHERE id=?`)
    .run(next.name,next.category,next.price,Number(next.cost_price)||0,next.destination,next.available,next.stock_qty,old.id);
  audit(req.user.id,'MENU_UPDATE',next.name);
  res.json(db.prepare('SELECT * FROM menu_items WHERE id=?').get(old.id));
});

app.get('/api/users', auth, allow('owner'), (req,res) => {
  res.json(db.prepare('SELECT id,username,name,role,active,created_at FROM users ORDER BY name').all());
});
app.post('/api/users', auth, allow('owner'), (req,res) => {
  const { username,name,password,role } = req.body || {};
  const roles = ['cashier','waiter','kitchen','bar','supervisor'];
  if (!username || !name || !password || String(password).length<10 || !roles.includes(role)) {
    return res.status(400).json({error:'Enter a username, name, password of at least 10 characters, and valid worker role.'});
  }
  try {
    const info = db.prepare('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)')
      .run(String(username).trim(),String(name).trim(),hashPassword(String(password)),role);
    audit(req.user.id,'USER_ADD',`${username}:${role}`);
    res.status(201).json(db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({error:'That username already exists.'});
    throw e;
  }
});
app.patch('/api/users/:id', auth, allow('owner'), (req,res) => {
  const id = Number(req.params.id);
  if (id === req.user.id && req.body.active === false) return res.status(400).json({error:'You cannot disable your own account.'});
  const active = req.body.active ? 1 : 0;
  const info = db.prepare("UPDATE users SET active=? WHERE id=? AND role!='owner'").run(active,id);
  if (!info.changes) return res.status(404).json({error:'Worker not found or cannot be changed.'});
  audit(req.user.id,'USER_STATUS',`${id}:${active}`);
  res.json({ok:true});
});

app.post('/api/orders', auth, allow('owner','cashier','waiter','supervisor'), (req,res) => {
  const { items, order_type='Dine-in', table_no='', discount=0, notes='' } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({error:'Add at least one item.'});
  if (!['Dine-in','Takeaway','Room service','Delivery'].includes(order_type)) return res.status(400).json({error:'Invalid order type.'});
  const discountNum = Number(discount);
  if (!Number.isFinite(discountNum) || discountNum<0) return res.status(400).json({error:'Invalid discount.'});
  const prepared = [];
  for (const item of items) {
    const menu = db.prepare('SELECT * FROM menu_items WHERE id=? AND available=1').get(Number(item.menu_item_id));
    const qty = Number(item.quantity);
    if (!menu || !Number.isInteger(qty) || qty<1 || qty>500) return res.status(400).json({error:'An item is unavailable or has an invalid quantity.'});
    prepared.push({ menu, qty, instructions:String(item.instructions||'').slice(0,300) });
  }
  const subtotal = prepared.reduce((sum,x)=>sum+x.menu.price*x.qty,0);
  if (discountNum>subtotal) return res.status(400).json({error:'Discount cannot exceed subtotal.'});
  const total = Math.round((subtotal-discountNum)*100)/100;
  const orderNo = `ORD-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const create = db.transaction(() => {
    const info = db.prepare(`INSERT INTO orders(order_no,order_type,table_no,subtotal,discount,total,notes,created_by)
      VALUES(?,?,?,?,?,?,?,?)`).run(orderNo,order_type,String(table_no||'').slice(0,40),subtotal,discountNum,total,String(notes||'').slice(0,500),req.user.id);
    const add = db.prepare(`INSERT INTO order_items(order_id,menu_item_id,item_name,quantity,unit_price,line_total,destination,instructions)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const x of prepared) add.run(info.lastInsertRowid,x.menu.id,x.menu.name,x.qty,x.menu.price,x.menu.price*x.qty,x.menu.destination,x.instructions);
    audit(req.user.id,'ORDER_CREATE',orderNo);
    return info.lastInsertRowid;
  });
  res.status(201).json(getOrder(create()));
});
app.get('/api/orders', auth, (req,res) => {
  const rows = db.prepare(`SELECT o.*,u.name AS cashier_name FROM orders o JOIN users u ON u.id=o.created_by
    ORDER BY o.id DESC LIMIT 200`).all();
  res.json(rows);
});
app.get('/api/orders/:id', auth, (req,res) => {
  const order = getOrder(Number(req.params.id));
  if (!order) return res.status(404).json({error:'Order not found.'});
  res.json(order);
});
app.patch('/api/orders/:id/status', auth, allow('owner','supervisor','kitchen','bar','waiter','cashier'), (req,res) => {
  const {status} = req.body || {};
  const allowed = ['New','Accepted','Preparing','Ready','Served','Completed','Cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({error:'Invalid order status.'});
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!order) return res.status(404).json({error:'Order not found.'});
  if (['Completed','Cancelled'].includes(order.status) && !['owner','supervisor'].includes(req.user.role)) {
    return res.status(400).json({error:'Only an owner or supervisor can change a completed/cancelled order.'});
  }
  if (status==='Cancelled' && order.payment_status==='Paid') return res.status(400).json({error:'Refund or reconcile the payment before cancelling a paid order.'});
  db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,order.id);
  audit(req.user.id,'ORDER_STATUS',`${order.order_no}:${status}`);
  res.json(getOrder(order.id));
});
app.post('/api/orders/:id/payments', auth, allow('owner','cashier','supervisor'), (req,res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!order) return res.status(404).json({error:'Order not found.'});
  if (order.status==='Cancelled') return res.status(400).json({error:'Cannot pay a cancelled order.'});
  const { amount, method, reference='' } = req.body || {};
  const value = Number(amount);
  const methods = ['Cash','M-Pesa','Card','Bank transfer','Other'];
  const remaining = Math.round((order.total-order.amount_paid)*100)/100;
  if (!Number.isFinite(value) || value<=0 || value>remaining+0.001) return res.status(400).json({error:`Enter an amount up to KSh ${remaining.toFixed(2)}.`});
  if (!methods.includes(method)) return res.status(400).json({error:'Choose a valid payment method.'});
  if (method==='M-Pesa' && !String(reference).trim()) return res.status(400).json({error:'Enter the M-Pesa transaction reference.'});
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO payments(order_id,amount,method,reference,received_by) VALUES(?,?,?,?,?)')
      .run(order.id,value,method,String(reference||'').trim().slice(0,100),req.user.id);
    const paid = Math.round((order.amount_paid+value)*100)/100;
    const paymentStatus = paid >= order.total-0.001 ? 'Paid' : 'Partial';
    db.prepare('UPDATE orders SET amount_paid=?,payment_status=?,payment_method=?,mpesa_ref=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(paid,paymentStatus,method,method==='M-Pesa'?String(reference).trim():'',order.id);
    audit(req.user.id,'PAYMENT',`${order.order_no}:${method}:${value}`);
  });
  tx();
  res.json(getOrder(order.id));
});
app.get('/api/reports/summary', auth, allow('owner','supervisor'), (req,res) => {
  const summary = db.prepare(`SELECT COUNT(*) AS order_count,
    COALESCE(SUM(CASE WHEN payment_status='Paid' THEN total ELSE 0 END),0) AS paid_sales,
    COALESCE(SUM(CASE WHEN payment_status!='Paid' AND status!='Cancelled' THEN total-amount_paid ELSE 0 END),0) AS outstanding,
    COALESCE(SUM(CASE WHEN status='Cancelled' THEN 1 ELSE 0 END),0) AS cancelled_count
    FROM orders WHERE date(created_at,'localtime')=date('now','localtime')`).get();
  const topItems = db.prepare(`SELECT oi.item_name,SUM(oi.quantity) AS quantity,SUM(oi.line_total) AS sales
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status!='Cancelled' AND date(o.created_at,'localtime')=date('now','localtime')
    GROUP BY oi.item_name ORDER BY quantity DESC LIMIT 5`).all();
  res.json({summary,topItems});
});
app.get('/api/settings', auth, allow('owner','supervisor'), (req,res) => res.json(hotelSettings));

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`TICOH HOTEL POS running on http://localhost:${PORT}`));
