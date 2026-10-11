const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'hotel-pos.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','cashier','waiter','kitchen','bar','supervisor')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0),
  cost_price REAL NOT NULL DEFAULT 0,
  destination TEXT NOT NULL DEFAULT 'kitchen',
  stock_qty REAL,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL DEFAULT 'Dine-in',
  table_no TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  payment_status TEXT NOT NULL DEFAULT 'Unpaid',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  service_charge REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  mpesa_ref TEXT,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  destination TEXT NOT NULL DEFAULT 'kitchen',
  instructions TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount REAL NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL,
  reference TEXT,
  received_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const ownerCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner'").get().n;
if (!ownerCount) {
  const username = process.env.OWNER_USERNAME || 'owner';
  const name = process.env.OWNER_NAME || 'Hotel Owner';
  const password = process.env.OWNER_PASSWORD;
  if (!password || password.length < 12) {
    console.warn('OWNER NOT CREATED: set OWNER_PASSWORD in .env to at least 12 characters, then restart.');
  } else {
    db.prepare('INSERT INTO users (username,name,password_hash,role) VALUES (?,?,?,?)')
      .run(username, name, hashPassword(password), 'owner');
    console.log(`Initial owner account created: ${username}`);
  }
}

const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
if (!count) {
  const insert = db.prepare('INSERT INTO menu_items (name,category,price,cost_price,destination) VALUES (?,?,?,?,?)');
  const seed = [
    ['Chicken & Chips','Main Meals',450,260,'kitchen'],
    ['Beef Pilau','Main Meals',350,190,'kitchen'],
    ['Ugali & Fish','Traditional Kenyan Food',500,300,'kitchen'],
    ['Chapati & Beans','Traditional Kenyan Food',180,90,'kitchen'],
    ['Soda 300ml','Soft Drinks',100,55,'bar'],
    ['Bottled Water 500ml','Water',80,35,'bar'],
    ['Fresh Juice','Fresh Juice',180,80,'bar'],
    ['Tea','Tea and Coffee',80,25,'bar']
  ];
  const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  tx(seed);
}

module.exports = { db, hashPassword, verifyPassword };
