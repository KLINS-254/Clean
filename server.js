
import express from "express";
import cors from "cors";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_LONG_RANDOM_SECRET";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@horologix.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_THIS_ADMIN_PASSWORD";

app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:true}));
app.use(express.json({limit:"100kb"}));

const db = new Database(path.join(__dirname,"horologix.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 phone TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 points INTEGER NOT NULL DEFAULT 0,
 cash_balance INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watches(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 brand TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price BETWEEN 800 AND 10000),
 gender TEXT NOT NULL,
 stock INTEGER NOT NULL DEFAULT 0,
 image TEXT,
 description TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_codes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT NOT NULL UNIQUE,
 points_min INTEGER NOT NULL DEFAULT 1,
 points_max INTEGER NOT NULL DEFAULT 40,
 active_date TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 code_id INTEGER NOT NULL,
 points INTEGER NOT NULL,
 claimed_at TEXT NOT NULL,
 UNIQUE(user_id, active_date),
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(code_id) REFERENCES daily_codes(id)
);
CREATE TABLE IF NOT EXISTS ledger(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 type TEXT NOT NULL,
 description TEXT NOT NULL,
 points INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0,10);

function hash(s){ return crypto.createHash("sha256").update(s).digest("hex"); }
function sign(user){
  return jwt.sign({sub:user.id, role:"user"}, JWT_SECRET, {expiresIn:"7d"});
}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    const token=h.startsWith("Bearer ")?h.slice(7):"";
    req.user=jwt.verify(token,JWT_SECRET);
    next();
  }catch{ res.status(401).json({error:"Unauthorized"}); }
}
function adminAuth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    const token=h.startsWith("Bearer ")?h.slice(7):"";
    const p=jwt.verify(token,JWT_SECRET);
    if(p.role!=="admin") throw new Error();
    req.admin=p; next();
  }catch{ res.status(401).json({error:"Admin authorization required"}); }
}
function weightedPoints(){
  const r=Math.random()*100;
  if(r<35) return 1+Math.floor(Math.random()*5);      // 1-5
  if(r<65) return 6+Math.floor(Math.random()*5);     // 6-10
  if(r<85) return 11+Math.floor(Math.random()*5);    // 11-15
  if(r<98) return 16+Math.floor(Math.random()*5);    // 16-20
  if(r<99.5) return 21+Math.floor(Math.random()*10);// 21-30
  return 31+Math.floor(Math.random()*10);             // 31-40
}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"HOROLOGIX"}));

app.post("/api/auth/register",(req,res)=>{
  const {name,phone,password}=req.body||{};
  if(!name||!phone||!password||String(password).length<6)
    return res.status(400).json({error:"Name, phone and password (6+ characters) are required"});
  try{
    const info=db.prepare("INSERT INTO users(name,phone,password_hash,created_at) VALUES(?,?,?,?)")
      .run(String(name).trim(),String(phone).trim(),hash(String(password)),now());
    const user={id:Number(info.lastInsertRowid)};
    res.json({token:sign(user),user:{id:user.id,name:String(name).trim(),phone:String(phone).trim(),points:0}});
  }catch{ res.status(409).json({error:"Phone number already registered"}); }
});

app.post("/api/auth/login",(req,res)=>{
  const {phone,password}=req.body||{};
  const user=db.prepare("SELECT * FROM users WHERE phone=?").get(String(phone||"").trim());
  if(!user||user.password_hash!==hash(String(password||"")))
    return res.status(401).json({error:"Invalid login details"});
  res.json({token:sign(user),user:{id:user.id,name:user.name,phone:user.phone,points:user.points}});
});

app.get("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT id,name,phone,points,cash_balance,created_at FROM users WHERE id=?").get(req.user.sub);
  if(!u) return res.status(404).json({error:"User not found"});
  res.json(u);
});

app.get("/api/watches",(req,res)=>{
  res.json(db.prepare("SELECT * FROM watches ORDER BY id DESC").all());
});

app.post("/api/rewards/claim",auth,(req,res)=>{
  const input=String(req.body?.code||"").trim().toUpperCase();
  if(!input) return res.status(400).json({error:"Enter the daily code"});
  const code=db.prepare("SELECT * FROM daily_codes WHERE active_date=? AND code=? AND expires_at>?")
    .get(today(),input,now());
  if(!code) return res.status(400).json({error:"Invalid or expired daily code"});
  try{
    const claim=db.transaction(()=>{
      const existing=db.prepare("SELECT id FROM claims WHERE user_id=? AND active_date=?")
        .get(req.user.sub,today());
      if(existing) throw new Error("You have already claimed today's code");
      const points=weightedPoints();
      db.prepare("INSERT INTO claims(user_id,code_id,points,claimed_at,active_date) VALUES(?,?,?,?,?)")
        .run(req.user.sub,code.id,points,now(),today());
      db.prepare("UPDATE users SET points=points+? WHERE id=?").run(points,req.user.sub);
      db.prepare("INSERT INTO ledger(user_id,type,description,points,created_at) VALUES(?,?,?,?,?)")
        .run(req.user.sub,"Credit","Daily promotional code claim",points,now());
      return points;
    })();
    res.json({success:true,points:claim});
  }catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/ledger",auth,(req,res)=>{
  res.json(db.prepare("SELECT * FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.sub));
});

app.post("/api/admin/login",(req,res)=>{
  const {email,password}=req.body||{};
  if(email!==ADMIN_EMAIL||password!==ADMIN_PASSWORD)
    return res.status(401).json({error:"Invalid admin credentials"});
  res.json({token:jwt.sign({role:"admin"},JWT_SECRET,{expiresIn:"8h"})});
});

app.post("/api/admin/daily-code",adminAuth,(req,res)=>{
  const code=String(req.body?.code||"").trim().toUpperCase();
  const expiry=req.body?.expiresAt;
  if(!/^[A-Z0-9-]{6,32}$/.test(code))
    return res.status(400).json({error:"Invalid code format"});
  const expiresAt=expiry && !Number.isNaN(Date.parse(expiry))
    ? new Date(expiry).toISOString()
    : new Date(Date.now()+24*60*60*1000).toISOString();
  try{
    db.prepare("INSERT INTO daily_codes(code,active_date,expires_at,created_at) VALUES(?,?,?,?)")
      .run(code,today(),expiresAt,now());
    res.json({success:true,code,activeDate:today(),expiresAt});
  }catch{ res.status(409).json({error:"A daily code already exists for today"}); }
});

app.get("/api/admin/daily-code",adminAuth,(req,res)=>{
  res.json(db.prepare("SELECT id,code,active_date,expires_at,created_at FROM daily_codes ORDER BY id DESC LIMIT 30").all());
});

app.post("/api/admin/watches",adminAuth,(req,res)=>{
  const {name,brand,price,gender="Unisex",stock=0,image="",description=""}=req.body||{};
  const p=Number(price), s=Number(stock);
  if(!name||!brand||!Number.isInteger(p)||p<800||p>10000||!Number.isInteger(s)||s<0)
    return res.status(400).json({error:"Invalid watch data"});
  const info=db.prepare(`INSERT INTO watches
    (name,brand,price,gender,stock,image,description,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(name,brand,p,gender,s,image,description,now());
  res.json({success:true,id:Number(info.lastInsertRowid)});
});

app.get("/api/admin/stats",adminAuth,(req,res)=>{
  const users=db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const watches=db.prepare("SELECT COUNT(*) c FROM watches").get().c;
  const claims=db.prepare("SELECT COUNT(*) c FROM claims").get().c;
  const points=db.prepare("SELECT COALESCE(SUM(points),0) s FROM claims").get().s;
  res.json({users,watches,claims,points});
});

app.use(express.static(path.join(__dirname,"public")));

app.listen(PORT,()=>console.log(`HOROLOGIX running on http://localhost:${PORT}`));
