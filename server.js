/**
 * Trading Platform Server v5.0 — 9-Tier Dynamic Pyramid (7-Week Cycle)
 *
 * TIERS (by deposit amount):
 *   Bronze:   $10-$49    | 20%/week | 3 referrals from Bronze+
 *   Silver:   $50-$99    | 20%/week | 3 referrals from Silver+
 *   Gold:     $100-$249  | 20%/week | 3 referrals from Gold+
 *   Platinum: $250-$499  | 20%/week | 3 referrals from Platinum+
 *   Diamond:  $500-$999  | 20%/week | 3 referrals from Diamond+
 *   VIP:      $1,000-$2,499 | 20%/week | 3 referrals from VIP+
 *   Elite:    $2,500-$4,999 | 20%/week | 3 referrals from Elite+
 *   Royal:    $5,000-$9,999 | 20%/week | 3 referrals from Royal+
 *   Legend:   $10,000+   | 20%/week | 3 referrals from Legend
 *
 * RULES:
 *   - Tier determined by deposit amount (dynamic ranges)
 *   - Weekly profit = 20% of deposit amount
 *   - 5 weeks = return 100% of capital
 *   - Week 6-7 = pure profit (40% extra)
 *   - Week 7 ends -> account locked -> must re-deposit + 3 new referrals
 *   - STRICT: < 3 approved downline referrals from same tier+ = NO PAYOUT
 *   - Mandatory referral code at registration
 *   - Commission: 20% admin / 10% L1 / 5% L2
 *   - Security: JWT + bcrypt + Helmet + Rate Limiting
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// ============ SECURITY: Attack Logger ============
const LOG_FILE = path.join(__dirname, 'security.log');
function logAttack(type, ip, details) {
  const entry = `[${new Date().toISOString()}] ${type} | IP: ${ip} | ${details}\n`;
  console.error('[SECURITY]', entry.trim());
  try { fs.appendFileSync(LOG_FILE, entry); } catch {}
}

// ============ SECURITY: CSRF Protection ============
// Generate CSRF token and set as cookie
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, { httpOnly: true, sameSite: 'strict', secure: true, maxAge: 86400000 });
    req.csrfToken = token;
  }
  next();
});

// Verify CSRF token on state-changing requests
function checkCsrf(req, res, next) {
  if (req.method === 'GET') return next();
  const clientToken = req.headers['x-csrf-token'] || req.body?._csrf;
  const cookieToken = req.cookies?.csrf_token;
  if (req.path.startsWith('/api/auth/')) return next(); // Auth routes exempt (no session yet)
  if (!clientToken || !cookieToken || clientToken !== cookieToken) {
    logAttack('CSRF', req.ip || req.connection?.remoteAgent, `Path: ${req.path}`);
    return res.status(403).json({ success: false, message: 'CSRF token invalid.' });
  }
  next();
}

// ============ SECURITY: Input Validation ============
function validateUsername(username) {
  if (typeof username !== 'string') return 'Username must be a string.';
  if (username.length < 3 || username.length > 50) return 'Username must be 3-50 characters.';
  if (!/^[a-zA-Z0-9_\-\u0600-\u06FF]+$/.test(username)) return 'Username contains invalid characters.';
  return null;
}
function validatePassword(password) {
  if (typeof password !== 'string') return 'Password must be a string.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password too long.';
  return null;
}

// ============ SECURITY: Suspicious Activity Monitor ============
const suspiciousIPs = new Map();
app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress;
  // Log requests to auth endpoints
  if (req.path.includes('/auth/') && req.method === 'POST') {
    logAttack('AUTH_ATTEMPT', ip, `Path: ${req.path}, User-Agent: ${req.headers['user-agent']?.substring(0, 50) || 'unknown'}`);
  }
  // Detect rapid sequential requests (potential automation)
  const record = suspiciousIPs.get(ip) || { count: 0, lastReq: 0 };
  const now = Date.now();
  if (now - record.lastReq < 100) { // Less than 100ms between requests
    record.count++;
    if (record.count > 20) {
      logAttack('BOT_DETECTED', ip, `Rapid requests: ${record.count} in <2s`);
      return res.status(429).json({ success: false, message: 'Suspicious activity detected.' });
    }
  } else {
    record.count = 0;
  }
  record.lastReq = now;
  suspiciousIPs.set(ip, record);
  next();
});

process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));

const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*', methods: ['GET', 'POST'], credentials: true }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60,
  message: { success: false, message: 'Too many requests. Try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});
app.use(generalLimiter);

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 4000;

// CRITICAL: JWT_SECRET MUST be set as env var on Render
// Without this, tokens change on every restart (all users logged out)
if (!process.env.JWT_SECRET) {
  console.error('[WARN] JWT_SECRET not set! Using random value - tokens will change on restart!');
  console.error('[WARN] Set JWT_SECRET env var on Render immediately!');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASS_HASH || '$2b$12$4DY6ysfcSJCjrt3RrzSIyOoW.Or0CwPbn777zKd0OdZWgaCzyotWa';
const USDT_WALLET = process.env.USDT_WALLET || 'TLhmbZbsvRhf2TpGiotkHnbv7YBfxbKprn';

// ============ ACCOUNT LOCKOUT (anti brute-force) ============
const loginAttempts = new Map(); // username -> { count, lockUntil }
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function checkLockout(username) {
  const record = loginAttempts.get(username);
  if (!record) return { locked: false };
  if (record.lockUntil && Date.now() < record.lockUntil) {
    const remainingMin = Math.ceil((record.lockUntil - Date.now()) / 60000);
    return { locked: true, remainingMin };
  }
  // Lock expired, reset
  loginAttempts.delete(username);
  return { locked: false };
}

function recordFailedLogin(username) {
  const record = loginAttempts.get(username) || { count: 0, lockUntil: null };
  record.count++;
  if (record.count >= LOCKOUT_MAX_ATTEMPTS) {
    record.lockUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.log(`[LOCKOUT] Account locked: ${username} for 30min (${record.count} failed attempts)`);
  }
  loginAttempts.set(username, record);
  return record;
}

function recordSuccessfulLogin(username) {
  loginAttempts.delete(username);
}

const ROOT_REFERRAL_CODES = ['BOOT00'];
const COMM_ADMIN = 0.20;
const COMM_L1 = 0.10;
const COMM_L2 = 0.05;

// ============ CYCLE CONSTANTS ============
const WEEKLY_PROFIT_PCT = 0.20;
const CYCLE_WEEKS = 7;
const CAPITAL_WEEKS = 5;
const MAX_WITHDRAWAL_PCT = 1.40;

// ============ 9-TIER DEFINITIONS ============
const TIERS = {
  bronze:   { level: 1, name: 'Bronze',   minDeposit: 10,     maxDeposit: 49,      label: '$10-$49' },
  silver:   { level: 2, name: 'Silver',   minDeposit: 50,     maxDeposit: 99,      label: '$50-$99' },
  gold:     { level: 3, name: 'Gold',     minDeposit: 100,    maxDeposit: 249,     label: '$100-$249' },
  platinum: { level: 4, name: 'Platinum', minDeposit: 250,    maxDeposit: 499,     label: '$250-$499' },
  diamond:  { level: 5, name: 'Diamond',  minDeposit: 500,    maxDeposit: 999,     label: '$500-$999' },
  vip:      { level: 6, name: 'VIP',      minDeposit: 1000,   maxDeposit: 2499,    label: '$1,000-$2,499' },
  elite:    { level: 7, name: 'Elite',    minDeposit: 2500,   maxDeposit: 4999,    label: '$2,500-$4,999' },
  royal:    { level: 8, name: 'Royal',    minDeposit: 5000,   maxDeposit: 9999,    label: '$5,000-$9,999' },
  legend:   { level: 9, name: 'Legend',   minDeposit: 10000,  maxDeposit: Infinity, label: '$10,000+' },
};

function getTierByAmount(amount) {
  const amt = Number(amount);
  if (amt >= 10000) return TIERS.legend;
  if (amt >= 5000) return TIERS.royal;
  if (amt >= 2500) return TIERS.elite;
  if (amt >= 1000) return TIERS.vip;
  if (amt >= 500) return TIERS.diamond;
  if (amt >= 250) return TIERS.platinum;
  if (amt >= 100) return TIERS.gold;
  if (amt >= 50) return TIERS.silver;
  if (amt >= 10) return TIERS.bronze;
  return null;
}

function getTierKeyByAmount(amount) {
  const amt = Number(amount);
  if (amt >= 10000) return 'legend';
  if (amt >= 5000) return 'royal';
  if (amt >= 2500) return 'elite';
  if (amt >= 1000) return 'vip';
  if (amt >= 500) return 'diamond';
  if (amt >= 250) return 'platinum';
  if (amt >= 100) return 'gold';
  if (amt >= 50) return 'silver';
  if (amt >= 10) return 'bronze';
  return null;
}

function getTier(key) { return TIERS[key] || null; }
function getWeeklyProfit(depositAmount) { return Number(depositAmount) * WEEKLY_PROFIT_PCT; }
function getDailyProfit(depositAmount) { return getWeeklyProfit(depositAmount) / 7; }

// ============ DATABASE (PostgreSQL only - no JSON fallback) ============
let pgPool = null;

(function initDB() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[DB] FATAL: DATABASE_URL not set!');
    return;
  }
  try {
    const pg = require('pg');
    const { Pool } = pg;
    
    // Parse connection string to check sslmode
    const needsSsl = dbUrl.includes('sslmode=require') || dbUrl.includes('ssl=true');
    
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: false,
      max: 2,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    
    pgPool.on('error', (err) => console.error('[DB] Pool error:', err.message));
    pgPool.on('connect', () => console.log('[DB] New client connected'));
    
    pgPool.query('SELECT 1 as test').then((result) => {
      console.log('[DB] PostgreSQL connected OK');
    }).catch(e => {
      console.error('[DB] PG test failed:', e.code, e.message);
    });
  } catch(e) {
    console.error('[DB] PG init failed:', e.message);
  }
})();

// Initialize tables on startup (with retry for Render cold starts)
(async function initTables() {
  if (!pgPool) {
    console.error('[DB] Skipping table init - no pool');
    return;
  }
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log('[DB] Table init attempt', attempt);
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password TEXT NOT NULL,
          referral_code VARCHAR(20) NOT NULL, referred_by VARCHAR(50), active_plan VARCHAR(20),
          deposit_amount DECIMAL(12,2) DEFAULT 0,
          balance DECIMAL(12,2) DEFAULT 0, total_commission DECIMAL(12,2) DEFAULT 0,
          weekly_withdrawn DECIMAL(12,2) DEFAULT 0, week_start BIGINT DEFAULT 0,
          cycle_week INTEGER DEFAULT 1, cycle_start BIGINT DEFAULT 0,
          total_withdrawn_cycle DECIMAL(12,2) DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(), role VARCHAR(20) DEFAULT 'user'
        );
        CREATE TABLE IF NOT EXISTS deposits (
          id UUID PRIMARY KEY, username VARCHAR(50) NOT NULL, tier VARCHAR(20) NOT NULL,
          amount DECIMAL(12,2) NOT NULL, tx_id VARCHAR(100), status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS withdraws (
          id UUID PRIMARY KEY, username VARCHAR(50) NOT NULL, amount DECIMAL(12,2) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS transactions (
          id UUID PRIMARY KEY, username VARCHAR(50) NOT NULL, type VARCHAR(20) NOT NULL,
          amount DECIMAL(12,2) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('[DB] Tables created successfully');
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(12,2) DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS cycle_week INTEGER DEFAULT 1;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS cycle_start BIGINT DEFAULT 0;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS total_withdrawn_cycle DECIMAL(12,2) DEFAULT 0;
      `);
      console.log('[DB] Columns verified');
      const adminExists = await client.query('SELECT 1 FROM users WHERE username=$1', ['admin']);
      if (adminExists.rowCount === 0) {
        const hash = await bcrypt.hash('haydar988522605gmail', 12);
        await client.query(
          'INSERT INTO users (id, username, password, referral_code, referred_by, role) VALUES ($1,$2,$3,$4,$5,$6)',
          [crypto.randomUUID(), 'admin', hash, 'ADMIN00', 'SYSTEM', 'admin']
        );
        console.log('[DB] Admin user created');
      } else {
        console.log('[DB] Admin user already exists');
      }
      return;
    } catch(e) {
      console.error('[DB] Init tables attempt', attempt, 'failed:', e.message, e.code);
      if (attempt < maxRetries) {
        const delay = 3000 * attempt;
        console.log('[DB] Retrying in', delay, 'ms...');
        await new Promise(r => setTimeout(r, delay));
      }
    } finally {
      client.release();
    }
  }
})();

// All DB operations go through PostgreSQL - NO JSON fallback
// Use Client per request for Render free tier reliability
async function withDb(fn) {
  if (!pgPool) {
    console.error('[DB] No pool!');
    return null;
  }
  const client = await pgPool.connect();
  try {
    const result = await fn(client);
    return result;
  } catch(e) {
    console.error('[DB] Query error:', e.message, e.code);
    throw e;
  } finally {
    client.release();
  }
}

async function dbRead() {
  try {
    return await withDb(async (client) => {
      const { rows: users } = await client.query('SELECT id, username, password, referral_code, referred_by, active_plan, COALESCE(deposit_amount,0) as deposit_amount, balance, total_commission, weekly_withdrawn, week_start, COALESCE(cycle_week,1) as cycle_week, COALESCE(cycle_start,0) as cycle_start, COALESCE(total_withdrawn_cycle,0) as total_withdrawn_cycle, role, created_at FROM users ORDER BY created_at DESC');
      const { rows: deposits } = await client.query('SELECT * FROM deposits ORDER BY created_at DESC');
      const { rows: withdraws } = await client.query('SELECT * FROM withdraws ORDER BY created_at DESC');
      const { rows: transactions } = await client.query('SELECT * FROM transactions ORDER BY created_at DESC');
      return { users, deposits, withdraws, transactions };
    }) || { users: [], deposits: [], withdraws: [], transactions: [] };
  } catch(e) {
    console.error('[DB READ] Failed:', e.message);
    return { users: [], deposits: [], withdraws: [], transactions: [] };
  }
}

async function dbWriteDb(d) {
  if (!pgPool) { console.error('[DB WRITE] No pool!'); return; }
  const client = await pgPool.connect();
  try {
    for (const u of d.users) {
      try {
        await client.query(`INSERT INTO users (id, username, password, referral_code, referred_by, active_plan, deposit_amount, balance, total_commission, weekly_withdrawn, week_start, cycle_week, cycle_start, total_withdrawn_cycle, role, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (username) DO UPDATE SET balance=EXCLUDED.balance, active_plan=EXCLUDED.active_plan, deposit_amount=EXCLUDED.deposit_amount, total_commission=EXCLUDED.total_commission, weekly_withdrawn=EXCLUDED.weekly_withdrawn, week_start=EXCLUDED.week_start, cycle_week=EXCLUDED.cycle_week, cycle_start=EXCLUDED.cycle_start, total_withdrawn_cycle=EXCLUDED.total_withdrawn_cycle, role=EXCLUDED.role`, [u.id || crypto.randomUUID(), u.username, u.password, u.referralCode || u.referral_code, u.referredBy || u.referred_by, u.activePlan || u.active_plan, u.depositAmount || u.deposit_amount || 0, u.balance || 0, u.totalCommission || 0, u.weeklyWithdrawn || 0, u.weekStart || 0, u.cycleWeek || 1, u.cycleStart || 0, u.totalWithdrawnCycle || u.total_withdrawn_cycle || 0, u.role || 'user', u.createdAt || u.created_at || new Date().toISOString()]);
      } catch(e) { console.error('[DB WRITE USER ERROR]', u.username, e.message); }
    }
    for (const dep of d.deposits) {
      try { await client.query('INSERT INTO deposits (id, username, tier, amount, tx_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status', [dep.id || crypto.randomUUID(), dep.username, dep.tier, dep.amount, dep.txId || dep.tx_id || 'manual', dep.status, dep.createdAt || dep.created_at || new Date().toISOString()]); } catch(e) { console.error('[DB WRITE DEPOSIT ERROR]', e.message); }
    }
    for (const w of d.withdraws) {
      try { await client.query('INSERT INTO withdraws (id, username, amount, status, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status', [w.id || crypto.randomUUID(), w.username, w.amount, w.status, w.createdAt || w.created_at || new Date().toISOString()]); } catch(e) { console.error('[DB WRITE WITHDRAW ERROR]', e.message); }
    }
  } finally {
    client.release();
  }
}

// ============ JWT ============
function generateToken(p) { return jwt.sign(p, JWT_SECRET, { expiresIn: '24h' }); }
function authenticateToken(req, res, next) {
  const h = req.headers['authorization'];
  const t = h && h.split(' ')[1];
  if (!t) return res.status(401).json({ success: false, message: 'No token.' });
  jwt.verify(t, JWT_SECRET, (err, u) => { if (err) return res.status(403).json({ success: false, message: 'Invalid token.' }); req.user = u; next(); });
}
function requireAdmin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only.' }); next(); }

// ============ HEALTH ============
app.get('/api/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

// ============ EMERGENCY: Create admin if missing ============
app.get('/api/fix/admin', async (req, res) => {
  if (!pgPool) return res.json({ success: false, error: 'No pool' });
  try {
    const client = await pgPool.connect();
    try {
      const adminCheck = await client.query('SELECT id, username, role FROM users WHERE username=$1', ['admin']);
      if (adminCheck.rowCount > 0) {
        return res.json({ success: true, message: 'Admin already exists', user: adminCheck.rows[0] });
      }
      const hash = await bcrypt.hash('haydar988522605gmail', 12);
      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO users (id, username, password, referral_code, referred_by, role) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, 'admin', hash, 'ADMIN00', 'SYSTEM', 'admin']
      );
      return res.json({ success: true, message: 'Admin user created', id });
    } finally {
      client.release();
    }
  } catch(e) {
    return res.json({ success: false, error: e.message, code: e.code });
  }
});

// ============ DB TEST ============
app.get('/api/test/db', async (req, res) => {
  try {
    if (!pgPool) {
      return res.json({ mode: 'NO_DB', error: 'PostgreSQL pool not initialized', warning: 'DATABASE_URL not set!' });
    }
    const result = await pgPool.query('SELECT COUNT(*) FROM users');
    return res.json({ mode: 'PostgreSQL', userCount: parseInt(result.rows[0].count), status: 'connected' });
  } catch(e) {
    return res.json({ mode: 'PostgreSQL', error: e.message, status: 'error' });
  }
});

// ============ AUTH ============
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;
    // Validate inputs
    const usernameErr = validateUsername(username);
    if (usernameErr) return res.status(400).json({ success: false, message: usernameErr });
    const passwordErr = validatePassword(password);
    if (passwordErr) return res.status(400).json({ success: false, message: passwordErr });
    if (!referralCode || typeof referralCode !== 'string') return res.status(400).json({ success: false, message: 'Referral code is required.' });
    const db = await dbRead();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ success: false, message: 'Username already exists.' });
    const isRootCode = ROOT_REFERRAL_CODES.includes(referralCode.toUpperCase());
    const referrer = isRootCode ? { username: 'SYSTEM', referralCode: referralCode.toUpperCase() } : db.users.find(u => u.referralCode === referralCode);
    if (!referrer) return res.status(400).json({ success: false, message: 'Invalid referral code.' });
    const myCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = { id: crypto.randomUUID(), username, password: hashedPassword, referralCode: myCode, referredBy: referrer.username, activePlan: null, depositAmount: 0, balance: 0, totalCommission: 0, weeklyWithdrawn: 0, weekStart: Date.now(), cycleWeek: 1, cycleStart: 0, totalWithdrawnCycle: 0, createdAt: new Date().toISOString(), role: 'user' };
    db.users.push(newUser);
    await dbWriteDb(db);
    const token = generateToken({ username: newUser.username, role: 'user' });
    res.json({ success: true, message: 'Registered successfully.', token, referralCode: myCode });
  } catch (err) { console.error('[REGISTER ERROR]', err); res.status(500).json({ success: false, message: err.message || 'Internal server error' }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    // Check lockout
    const lockStatus = checkLockout(username);
    if (lockStatus.locked) return res.status(423).json({ success: false, message: `Account locked. Try again in ${lockStatus.remainingMin} minutes.` });
    const db = await dbRead();
    const user = db.users.find(u => u.username === username);
    if (!user) { recordFailedLogin(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFailedLogin(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    recordSuccessfulLogin(username);
    const token = generateToken({ username: user.username, role: user.role || 'user' });
    res.json({ success: true, token, username: user.username, role: user.role || 'user' });
  } catch (err) { console.error('[LOGIN ERROR]', err); res.status(500).json({ success: false, message: err.message || 'Internal server error' }); }
});

app.post('/api/auth/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    const lockStatus = checkLockout(username);
    if (lockStatus.locked) return res.status(423).json({ success: false, message: `Account locked. Try again in ${lockStatus.remainingMin} minutes.` });
    const db = await dbRead();
    const user = db.users.find(u => u.username === username && u.role === 'admin');
    if (!user) { recordFailedLogin(username); return res.status(401).json({ success: false, message: 'Invalid admin credentials.' }); }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFailedLogin(username); return res.status(401).json({ success: false, message: 'Invalid admin credentials.' }); }
    recordSuccessfulLogin(username);
    const token = generateToken({ username: user.username, role: 'admin' });
    res.json({ success: true, token, username: user.username, role: 'admin' });
  } catch (err) { console.error('[ADMIN LOGIN ERROR]', err); return res.status(500).json({ success: false, message: err.message || 'Internal server error' }); }
});

// ============ USER PROFILE ============
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const activePlan = user.activePlan || user.active_plan || null;
    const tier = activePlan ? getTier(activePlan) : null;
    const depositAmt = user.depositAmount || user.deposit_amount || 0;
    const weeklyProfit = getWeeklyProfit(depositAmt);
    const dailyProfit = getDailyProfit(depositAmt);
    const userTierLevel = tier ? tier.level : 0;
    const allDirectDownline = db.users.filter(u => (u.referredBy || u.referred_by) === user.username);
    const approvedDownline = allDirectDownline.filter(ref => {
      const refPlan = ref.activePlan || ref.active_plan || null;
      if (!refPlan) return false;
      const refTier = getTier(refPlan);
      if (!refTier) return false;
      const hasApproved = db.deposits.some(d => d.username === ref.username && d.status === 'approved');
      return hasApproved && refTier.level >= userTierLevel;
    });
    const approvedDownlineCount = approvedDownline.length;
    const canWithdraw = approvedDownlineCount >= 3;
    const referralProfitUnlocked = approvedDownlineCount >= 3;
    let cycleWeek = user.cycleWeek || user.cycle_week || 1;
    const cycleStart = user.cycleStart || user.cycle_start || 0;
    const totalWithdrawnCycle = user.totalWithdrawnCycle || user.total_withdrawn_cycle || 0;
    if (cycleStart > 0) { const weekMs = 7 * 24 * 60 * 60 * 1000; const elapsed = Date.now() - cycleStart; cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1); }
    const cycleExpired = cycleWeek > CYCLE_WEEKS;
    const maxWithdrawal = depositAmt * MAX_WITHDRAWAL_PCT;
    const weeklyWithdrawn = user.weeklyWithdrawn || user.weekly_withdrawn || 0;
    const totalCommission = user.totalCommission || user.total_commission || 0;
    res.json({ success: true, user: { username: user.username, balance: user.balance || 0, depositAmount: depositAmt, totalCommission, activePlan, tierName: tier ? tier.name : null, tierLabel: tier ? tier.label : null, referralCode: user.referralCode || user.referral_code, referrer: user.referredBy || user.referred_by, dailyProfit: +dailyProfit.toFixed(2), weeklyProfit: +weeklyProfit.toFixed(2), canWithdraw, approvedDownlineCount, activeReferrals: approvedDownlineCount, totalReferrals: allDirectDownline.length, referralProfitUnlocked, requiredReferrals: 3, cycleWeek, cycleTotalWeeks: CYCLE_WEEKS, cycleExpired, totalWithdrawnCycle, maxWithdrawal: +maxWithdrawal.toFixed(2), remainingWithdrawal: +Math.max(0, maxWithdrawal - totalWithdrawnCycle).toFixed(2), weeklyWithdrawn, role: user.role || 'user', createdAt: user.createdAt || user.created_at } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/referrals', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const refs = db.users.filter(u => (u.referredBy || u.referred_by) === req.user.username);
    res.json({ success: true, referrals: refs.map(r => ({ username: r.username, activePlan: r.activePlan || r.active_plan, createdAt: r.createdAt || r.created_at })) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/tiers', (req, res) => {
  const tiersOut = {};
  for (const [key, t] of Object.entries(TIERS)) { const minW = getWeeklyProfit(t.minDeposit); const maxW = t.maxDeposit === Infinity ? null : getWeeklyProfit(t.maxDeposit); tiersOut[key] = { ...t, level: t.level, weeklyProfitMin: +minW.toFixed(2), weeklyProfitMax: maxW ? +maxW.toFixed(2) : null, cycleWeeks: CYCLE_WEEKS, maxTotalPct: MAX_WITHDRAWAL_PCT * 100 }; }
  res.json({ success: true, tiers: tiersOut, weeklyPct: WEEKLY_PROFIT_PCT * 100 });
});

app.post('/api/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, txId } = req.body; const amt = Number(amount);
    if (!amt || amt < 10) return res.status(400).json({ success: false, message: 'Minimum deposit is $10.' });
    const tier = getTierByAmount(amt); const tierKey = getTierKeyByAmount(amt);
    if (!tier || !tierKey) return res.status(400).json({ success: false, message: 'Invalid deposit amount.' });
    const db = await dbRead(); const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const deposit = { id: crypto.randomUUID(), username: user.username, tier: tierKey, amount: amt, txId: txId || 'manual', status: 'pending', createdAt: new Date().toISOString() };
    db.deposits.push(deposit); await dbWriteDb(db);
    res.json({ success: true, message: 'Deposit request submitted.', deposit, wallet: USDT_WALLET, tier: tier.name });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body; const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });
    const db = await dbRead(); const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.activePlan) return res.status(400).json({ success: false, message: 'No active plan. Deposit first.' });
    const tier = getTier(user.activePlan); const depositAmt = user.depositAmount || 0; const weeklyProfit = getWeeklyProfit(depositAmt);
    const userTierLevel = tier ? tier.level : 0;
    const allDirectDownline = db.users.filter(u => u.referredBy === user.username);
    const approvedDownline = allDirectDownline.filter(ref => { if (!ref.activePlan) return false; const refTier = getTier(ref.activePlan); if (!refTier) return false; const hasApproved = db.deposits.some(d => d.username === ref.username && d.status === 'approved'); return hasApproved && refTier.level >= userTierLevel; });
    if (approvedDownline.length < 3) return res.status(403).json({ success: false, message: 'Need 3 approved downline from your tier or higher. Currently: ' + approvedDownline.length + '/3', code: 'REFERRAL_LOCK', approvedReferrals: approvedDownline.length, required: 3 });
    let cycleWeek = user.cycleWeek || 1; const cycleStart = user.cycleStart || 0; let totalWithdrawnCycle = user.totalWithdrawnCycle || 0;
    if (cycleStart > 0) { const weekMs = 7 * 24 * 60 * 60 * 1000; const elapsed = Date.now() - cycleStart; cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1); }
    if (cycleWeek > CYCLE_WEEKS) return res.status(403).json({ success: false, message: 'Cycle expired! ' + CYCLE_WEEKS + ' weeks completed. Re-deposit and bring 3 new referrals.', code: 'CYCLE_EXPIRED' });
    const maxWithdrawal = depositAmt * MAX_WITHDRAWAL_PCT;
    if (totalWithdrawnCycle + amt > maxWithdrawal) return res.status(400).json({ success: false, message: 'Max withdrawal reached. Remaining: $' + (maxWithdrawal - totalWithdrawnCycle).toFixed(2), code: 'CYCLE_MAX', remaining: +(maxWithdrawal - totalWithdrawnCycle).toFixed(2) });
    const weekElapsed = Date.now() - (user.weekStart || 0); const weekMs = 7 * 24 * 60 * 60 * 1000; let weeklyWithdrawn = user.weeklyWithdrawn || 0;
    if (weekElapsed > weekMs) { weeklyWithdrawn = 0; user.weekStart = Date.now(); }
    if (weeklyWithdrawn + amt > weeklyProfit) return res.status(400).json({ success: false, message: 'Weekly cap exceeded. Remaining: $' + (weeklyProfit - weeklyWithdrawn).toFixed(2), code: 'WEEKLY_CAP', remaining: +(weeklyProfit - weeklyWithdrawn).toFixed(2), weeklyProfit: +weeklyProfit.toFixed(2) });
    if (user.balance < amt) return res.status(400).json({ success: false, message: 'Insufficient balance. Available: $' + user.balance.toFixed(2), code: 'INSUFFICIENT_BALANCE' });
    const withdraw = { id: crypto.randomUUID(), username: user.username, amount: amt, status: 'pending', createdAt: new Date().toISOString() };
    db.withdraws.push(withdraw); user.weeklyWithdrawn = weeklyWithdrawn + amt; user.totalWithdrawnCycle = totalWithdrawnCycle + amt; user.cycleWeek = cycleWeek;
    await dbWriteDb(db); res.json({ success: true, message: 'Withdraw request submitted.', withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN ============
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const users = db.users.map(u => {
      const activePlan = u.activePlan || u.active_plan || null;
      const tier = activePlan ? getTier(activePlan) : null;
      const depositAmt = u.depositAmount || u.deposit_amount || 0;
      const totalCommission = u.totalCommission || u.total_commission || 0;
      const weeklyWithdrawn = u.weeklyWithdrawn || u.weekly_withdrawn || 0;
      const cycleWeek = u.cycleWeek || u.cycle_week || 1;
      const totalWithdrawnCycle = u.totalWithdrawnCycle || u.total_withdrawn_cycle || 0;
      const referredBy = u.referredBy || u.referred_by || null;
      const referralCode = u.referralCode || u.referral_code || null;
      return {
        username: u.username,
        balance: u.balance || 0,
        depositAmount: depositAmt,
        totalCommission,
        activePlan,
        tierName: tier ? tier.name : null,
        tierLabel: tier ? tier.label : null,
        referralCode,
        referredBy,
        role: u.role || 'user',
        weeklyProfit: +getWeeklyProfit(depositAmt).toFixed(2),
        cycleWeek,
        cycleExpired: cycleWeek > CYCLE_WEEKS,
        totalWithdrawnCycle,
        maxWithdrawal: +(depositAmt * MAX_WITHDRAWAL_PCT).toFixed(2),
        weeklyWithdrawn,
        createdAt: u.createdAt || u.created_at
      };
    });
    res.json({ success: true, users, total: users.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => { try { const db = await dbRead(); res.json({ success: true, deposits: db.deposits }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

app.post('/api/admin/deposits/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead(); const deposit = db.deposits.find(d => d.id === req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
    if (deposit.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });
    const user = db.users.find(u => u.username === deposit.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const tierKey = getTierKeyByAmount(deposit.amount); deposit.status = 'approved';
    user.balance = (user.balance || 0) + deposit.amount;
    user.depositAmount = deposit.amount;
    if (tierKey) user.activePlan = tierKey;
    const cycleStart = user.cycleStart || user.cycle_start || 0;
    if (!cycleStart || cycleStart === 0) { user.cycleStart = Date.now(); user.cycleWeek = 1; user.totalWithdrawnCycle = 0; }
    const userReferrer = user.referredBy || user.referred_by;
    if (userReferrer) { const l1 = db.users.find(u => u.username === userReferrer); if (l1) { const l1Comm = deposit.amount * COMM_L1; l1.balance = (l1.balance || 0) + l1Comm; l1.totalCommission = (l1.totalCommission || 0) + l1Comm; const l1Referrer = l1.referredBy || l1.referred_by; if (l1Referrer) { const l2 = db.users.find(u => u.username === l1Referrer); if (l2) { const l2Comm = deposit.amount * COMM_L2; l2.balance = (l2.balance || 0) + l2Comm; l2.totalCommission = (l2.totalCommission || 0) + l2Comm; } } } }
    await dbWriteDb(db); res.json({ success: true, message: 'Deposit approved.', deposit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, requireAdmin, async (req, res) => { try { const db = await dbRead(); const deposit = db.deposits.find(d => d.id === req.params.id); if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' }); deposit.status = 'rejected'; await dbWriteDb(db); res.json({ success: true, message: 'Deposit rejected.' }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

app.get('/api/admin/withdraws', authenticateToken, requireAdmin, async (req, res) => { try { const db = await dbRead(); res.json({ success: true, withdraws: db.withdraws }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

app.post('/api/admin/withdraws/:id/approve', authenticateToken, requireAdmin, async (req, res) => { try { const db = await dbRead(); const withdraw = db.withdraws.find(w => w.id === req.params.id); if (!withdraw) return res.status(404).json({ success: false, message: 'Withdraw not found.' }); if (withdraw.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' }); const user = db.users.find(u => u.username === withdraw.username); if (!user) return res.status(404).json({ success: false, message: 'User not found.' }); if (user.balance < withdraw.amount) return res.status(400).json({ success: false, message: 'Insufficient user balance.' }); withdraw.status = 'approved'; user.balance -= withdraw.amount; await dbWriteDb(db); res.json({ success: true, message: 'Withdraw approved.', withdraw }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

app.post('/api/admin/withdraws/:id/reject', authenticateToken, requireAdmin, async (req, res) => { try { const db = await dbRead(); const withdraw = db.withdraws.find(w => w.id === req.params.id); if (!withdraw) return res.status(404).json({ success: false, message: 'Withdraw not found.' }); if (withdraw.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' }); withdraw.status = 'rejected'; const user = db.users.find(u => u.username === withdraw.username); if (user) { user.weeklyWithdrawn = (user.weeklyWithdrawn || 0) - withdraw.amount; if (user.weeklyWithdrawn < 0) user.weeklyWithdrawn = 0; } await dbWriteDb(db); res.json({ success: true, message: 'Withdraw rejected.' }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

app.get('/api/admin/transactions', authenticateToken, requireAdmin, async (req, res) => { try { const db = await dbRead(); res.json({ success: true, transactions: db.transactions }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

app.post('/api/admin/action', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, type, action } = req.body; const db = await dbRead();
    if (type === 'deposit') {
      const deposit = db.deposits.find(d => d.id === id); if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
      if (action === 'Approve') { deposit.status = 'approved'; const user = db.users.find(u => u.username === deposit.username); if (user) { const tierKey = getTierKeyByAmount(deposit.amount); user.balance = (user.balance || 0) + deposit.amount; user.depositAmount = deposit.amount; if (tierKey) user.activePlan = tierKey; if (!user.cycleStart || user.cycleStart === 0) { user.cycleStart = Date.now(); user.cycleWeek = 1; user.totalWithdrawnCycle = 0; } if (user.referredBy) { const l1 = db.users.find(u => u.username === user.referredBy); if (l1) { const l1Comm = deposit.amount * COMM_L1; l1.balance = (l1.balance || 0) + l1Comm; l1.totalCommission = (l1.totalCommission || 0) + l1Comm; if (l1.referredBy) { const l2 = db.users.find(u => u.username === l1.referredBy); if (l2) { const l2Comm = deposit.amount * COMM_L2; l2.balance = (l2.balance || 0) + l2Comm; l2.totalCommission = (l2.totalCommission || 0) + l2Comm; } } } } } } else { deposit.status = 'rejected'; }
    } else if (type === 'withdraw') {
      const withdraw = db.withdraws.find(w => w.id === id); if (!withdraw) return res.status(404).json({ success: false, message: 'Withdraw not found.' });
      if (action === 'Approve') { withdraw.status = 'approved'; const user = db.users.find(u => u.username === withdraw.username); if (user && user.balance >= withdraw.amount) user.balance -= withdraw.amount; } else { withdraw.status = 'rejected'; const user = db.users.find(u => u.username === withdraw.username); if (user) { user.weeklyWithdrawn = (user.weeklyWithdrawn || 0) - withdraw.amount; if (user.weeklyWithdrawn < 0) user.weeklyWithdrawn = 0; } }
    }
    await dbWriteDb(db); res.json({ success: true, message: action + ' successful.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ HELPER ============
function getReferralStats(username, db) { const refs = db.users.filter(u => u.referredBy === username); const user = db.users.find(u => u.username === username); const userTier = user && user.activePlan ? getTier(user.activePlan) : null; let qualified = 0; for (const r of refs) { if (r.activePlan) { const rTier = getTier(r.activePlan); if (rTier && userTier && rTier.level >= userTier.level) qualified++; } } return { total: refs.length, qualified }; }

// ============ STATIC FILES ============
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); } }));
app.use((req, res, next) => { if (!req.path.startsWith('/api/')) { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(PUBLIC_DIR, 'index.html')); } else { next(); } });

// ============ START ============
const server = app.listen(PORT, '0.0.0.0', () => { console.log('Trading Platform v5.0 running on port ' + PORT); });
server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
setInterval(function() {}, 60000);
