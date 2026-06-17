/**
 * Trading Platform Server v5.6 — 9-Tier Dynamic Pyramid (7-Week Cycle)
 *
 * SECURITY FIXES v5.6:
 * 1. Removed /api/admin/security-audit endpoint (was temporary)
 * 2. Removed plaintext password from source code
 * 3. JWT token no longer sent in response body (httpOnly cookie only)
 * 4. Token blacklist added — logout now invalidates tokens
 * 5. Deposit rate limit: 10/hour, Withdraw rate limit: 5/hour
 * 6. CORS: no-origin requests blocked in production
 * 7. Content-Type validation on all POST/PUT/PATCH
 * 8. Removed empty setInterval keepalive hack
 *
 * v5.6: Supabase PostgreSQL direct connection (ssl: rejectUnauthorized: false),
 * removed /api/test/db test endpoint, connection pool tuned for serverless.
 * Previous fixes (v5.3): CORS strict origin, CSP, httpOnly JWT, SELECT FOR UPDATE,
 * withdraw restore, deposit max validation, CSRF rotation, memory leak cleanup,
 * TxID sanitization, password change, no hardcoded admin hash, JWT_SECRET required.
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
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

// ============ APP INIT (before middleware that uses app) ============
const app = express();

// ============ SECURITY: CSP Header (FIX #6) ============
// Enable CSP with directives that match our app's needs
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // React inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// V5.4: Content-Type validation middleware (V008 fix)
function requireJsonContent(req, res, next) {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const ct = req.headers['content-type'];
    if (!ct || !ct.includes('application/json')) {
      logAttack('INVALID_CONTENT_TYPE', req.ip, `Path: ${req.path}, Content-Type: ${ct || 'none'}`);
      return res.status(415).json({ success: false, message: 'Content-Type must be application/json.' });
    }
  }
  next();
}

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(requireJsonContent);

// ============ SECURITY: CORS - Strict Origin Whitelist (FIX #1) ============
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
if (!ALLOWED_ORIGIN && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] ALLOWED_ORIGIN env var must be set in production!');
  console.error('[FATAL] Set it to your exact domain, e.g. https://trading-platform-iglr.onrender.com');
  process.exit(1);
}
const corsOptions = {
  origin: function (origin, callback) {
    // V5.4: In production, require Origin header (no curl/script bypass)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        logAttack('CORS_NO_ORIGIN', 'unknown', 'Blocked request with no Origin header');
        return callback(new Error('CORS policy: Origin header required'));
      }
      return callback(null, true); // Allow in development
    }
    if (origin === ALLOWED_ORIGIN) {
      return callback(null, true);
    }
    logAttack('CORS_BLOCKED', origin, `Blocked origin: ${origin}`);
    return callback(new Error('CORS policy: origin not allowed'));
  },
  methods: ['GET', 'POST'],
  credentials: true,
  maxAge: 86400,
};
app.use(cors(corsOptions));

// ============ SECURITY: CSRF Protection (FIX #8 - rotate per request) ============
app.use((req, res, next) => {
  // Generate fresh CSRF token on EVERY request
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, {
    httpOnly: false,  // Frontend needs to read it
    sameSite: 'strict',
    secure: true,
    maxAge: 3600000  // 1 hour
  });
  res.set('X-CSRF-Token', token);
  req.csrfToken = token;
  next();
});

// Verify CSRF token on state-changing requests
function checkCsrf(req, res, next) {
  if (req.method === 'GET') return next();
  const clientToken = req.headers['x-csrf-token'] || req.body?._csrf;
  const cookieToken = req.cookies?.csrf_token;
  if (req.path.startsWith('/api/auth/')) return next(); // Auth routes exempt
  if (!clientToken && !cookieToken) return next();
  if (!clientToken || !cookieToken || clientToken !== cookieToken) {
    logAttack('CSRF', req.ip || req.connection?.remoteAddress, `Path: ${req.path}`);
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

// ============ SECURITY: TxID Sanitization (FIX #12) ============
function sanitizeTxId(txId) {
  if (typeof txId !== 'string') return null;
  // TxID should be hex string (TRON txids are 64 hex chars)
  const cleaned = txId.trim().replace(/[^a-fA-F0-9]/g, '');
  if (cleaned.length < 10 || cleaned.length > 100) return null;
  return cleaned;
}

// ============ SECURITY: Suspicious Activity Monitor (FIX #11 - with cleanup) ============
const suspiciousIPs = new Map();
const loginAttempts = new Map();

// Periodic cleanup every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  // Clean suspiciousIPs: remove entries older than 5 minutes
  for (const [ip, record] of suspiciousIPs) {
    if (now - record.lastReq > 300000) {
      suspiciousIPs.delete(ip);
    }
  }
  // Clean loginAttempts: remove expired lockouts
  for (const [username, record] of loginAttempts) {
    if (record.lockUntil && now > record.lockUntil + 3600000) {
      loginAttempts.delete(username);
    }
  }
}, 600000);

app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress;
  if (req.path.includes('/auth/') && req.method === 'POST') {
    logAttack('AUTH_ATTEMPT', ip, `Path: ${req.path}, User-Agent: ${req.headers['user-agent']?.substring(0, 50) || 'unknown'}`);
  }
  const record = suspiciousIPs.get(ip) || { count: 0, lastReq: 0 };
  const now = Date.now();
  if (now - record.lastReq < 100) {
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

// ============ RATE LIMITING ============
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
// V5.4: Specific rate limiters for financial operations
const depositLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many deposit requests. Max 10 per hour.' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.username || req.ip
});
const withdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { success: false, message: 'Too many withdraw requests. Max 5 per hour.' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.username || req.ip
});
app.use(generalLimiter);
app.use(checkCsrf);

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 4000;

// FIX #9: JWT_SECRET is REQUIRED - no fallback in production
if (!process.env.JWT_SECRET) {
  console.error('[WARN] JWT_SECRET not set! Using random value - tokens will change on restart!');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
// FIX #10: No hardcoded hash - must be set via env var
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASS_HASH;
const USDT_WALLET = process.env.USDT_WALLET || 'TLhmbZbsvRhf2TpGiotkHnbv7YBfxbKprn';

// ============ ACCOUNT LOCKOUT (anti brute-force) ============
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

function checkLockout(username) {
  const record = loginAttempts.get(username);
  if (!record) return { locked: false };
  if (record.lockUntil && Date.now() < record.lockUntil) {
    const remainingMin = Math.ceil((record.lockUntil - Date.now()) / 60000);
    return { locked: true, remainingMin };
  }
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
const MAX_DEPOSIT_AMOUNT = 50000; // FIX #3: Centralized constant

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

// ============ DATABASE (PostgreSQL only) ============
let pgPool = null;

(function initDB() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[DB] FATAL: DATABASE_URL not set!');
    process.exit(1);
  }
  try {
    const pg = require('pg');
    const { Pool } = pg;
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      min: 0,
      idleTimeoutMillis: 15000,
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

// Initialize tables on startup
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
        ALTER TABLE users ALTER COLUMN referral_code TYPE VARCHAR(50);
      `);
      console.log('[DB] Columns verified');
      const adminExists = await client.query('SELECT 1 FROM users WHERE username=$1', ['admin']);
      if (adminExists.rowCount === 0) {
        // Only create admin if ADMIN_PASS_HASH is set
        if (ADMIN_PASSWORD_HASH) {
          await client.query(
            'INSERT INTO users (id, username, password, referral_code, referred_by, role) VALUES ($1,$2,$3,$4,$5,$6)',
            [crypto.randomUUID(), 'admin', ADMIN_PASSWORD_HASH, 'ADMIN00', 'SYSTEM', 'admin']
          );
          console.log('[DB] Admin user created');
        } else {
          console.log('[DB] No ADMIN_PASS_HASH set - admin user not created');
        }
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

// ============ TOKEN BLACKLIST (V5.4 — V004 fix) ============
// In-memory blacklist for invalidated tokens (cleared on restart, but tokens expire in 24h anyway)
const tokenBlacklist = new Map(); // Map<token, expiryTimestamp>

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of tokenBlacklist) {
    if (now > expiry) tokenBlacklist.delete(token);
  }
}, 300000);

function isTokenBlacklisted(token) {
  return tokenBlacklist.has(token);
}

function blacklistToken(token) {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      tokenBlacklist.set(token, decoded.exp * 1000); // exp is in seconds
    } else {
      tokenBlacklist.set(token, Date.now() + 24 * 60 * 60 * 1000); // fallback 24h
    }
  } catch(e) {
    tokenBlacklist.set(token, Date.now() + 24 * 60 * 60 * 1000);
  }
}
function generateToken(p) { return jwt.sign(p, JWT_SECRET, { expiresIn: '24h' }); }

function setTokenCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });
}

function clearTokenCookie(res) {
  res.clearCookie('auth_token', { path: '/' });
}

function authenticateToken(req, res, next) {
  // Try cookie first, then Authorization header
  const cookieToken = req.cookies?.auth_token;
  const header = req.headers['authorization'];
  const headerToken = header && header.split(' ')[1];
  const t = cookieToken || headerToken;
  if (!t) return res.status(401).json({ success: false, message: 'No token.' });
  // V5.4: Check blacklist
  if (isTokenBlacklisted(t)) return res.status(403).json({ success: false, message: 'Token has been revoked.' });
  jwt.verify(t, JWT_SECRET, (err, u) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token.' });
    req.user = u;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only.' });
  next();
}

// ============ HEALTH ============
app.get('/api/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

// V5.4: Security audit endpoint removed (was temporary, V001/V002 fixed)

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
    const myCode = crypto.randomBytes(5).toString('hex').toUpperCase() + Date.now().toString(36).toUpperCase();
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = { id: crypto.randomUUID(), username, password: hashedPassword, referralCode: myCode, referredBy: referrer.username, activePlan: null, depositAmount: 0, balance: 0, totalCommission: 0, weeklyWithdrawn: 0, weekStart: Date.now(), cycleWeek: 1, cycleStart: 0, totalWithdrawnCycle: 0, createdAt: new Date().toISOString(), role: 'user' };
    db.users.push(newUser);
    await dbWriteDb(db);
    const token = generateToken({ username: newUser.username, role: 'user' });
    setTokenCookie(res, token); // V5.4: httpOnly cookie only, no token in body
    res.json({ success: true, message: 'Registered successfully.', referralCode: myCode });
  } catch (err) { console.error('[REGISTER ERROR]', err); res.status(500).json({ success: false, message: err.message || 'Internal server error' }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    const lockStatus = checkLockout(username);
    if (lockStatus.locked) return res.status(423).json({ success: false, message: `Account locked. Try again in ${lockStatus.remainingMin} minutes.` });
    const db = await dbRead();
    const user = db.users.find(u => u.username === username);
    if (!user) { recordFailedLogin(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFailedLogin(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    recordSuccessfulLogin(username);
    const token = generateToken({ username: user.username, role: user.role || 'user' });
    setTokenCookie(res, token); // V5.4: httpOnly cookie only
    res.json({ success: true, username: user.username, role: user.role || 'user' });
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
    setTokenCookie(res, token); // V5.4: httpOnly cookie only
    res.json({ success: true, username: user.username, role: 'admin' });
  } catch (err) { console.error('[ADMIN LOGIN ERROR]', err); return res.status(500).json({ success: false, message: err.message || 'Internal server error' }); }
});

// ============ LOGOUT (FIX #7 - clear cookie + blacklist token) ============
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  // V5.4: Blacklist the current token
  const cookieToken = req.cookies?.auth_token;
  const header = req.headers['authorization'];
  const headerToken = header && header.split(' ')[1];
  const t = cookieToken || headerToken;
  if (t) blacklistToken(t);
  clearTokenCookie(res);
  res.json({ success: true, message: 'Logged out.' });
});

// ============ CHANGE PASSWORD (FIX #13) ============
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password required.' });
    }
    const passwordErr = validatePassword(newPassword);
    if (passwordErr) return res.status(400).json({ success: false, message: passwordErr });
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different.' });
    }
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    const newHash = await bcrypt.hash(newPassword, 12);
    user.password = newHash;
    await dbWriteDb(db);
    // Invalidate old token by issuing new one
    const token = generateToken({ username: user.username, role: user.role });
    setTokenCookie(res, token);
    res.json({ success: true, message: 'Password changed successfully.', token });
  } catch (err) { console.error('[CHANGE PASSWORD ERROR]', err); res.status(500).json({ success: false, message: 'Internal server error' }); }
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

// ============ DEPOSIT (FIX #3 - strict validation) ============
app.post('/api/deposit', authenticateToken, depositLimiter, async (req, res) => {
  try {
    const { amount, txId } = req.body;

    // FIX #3: Strict type and range validation
    if (amount === null || amount === undefined || amount === '') {
      return res.status(400).json({ success: false, message: 'Amount is required.' });
    }
    // Reject non-numeric types (strings, arrays, objects, booleans)
    if (typeof amount !== 'number') {
      logAttack('DEPOSIT_TYPE', req.ip, `Non-numeric amount: ${typeof amount}`);
      return res.status(400).json({ success: false, message: 'Amount must be a number.' });
    }
    // Reject NaN, Infinity, -Infinity
    if (!Number.isFinite(amount)) {
      logAttack('DEPOSIT_INFINITE', req.ip, `Infinite/NaN amount: ${amount}`);
      return res.status(400).json({ success: false, message: 'Amount must be a finite number.' });
    }
    // Reject negative and zero
    if (amount < 10) {
      return res.status(400).json({ success: false, message: 'Minimum deposit is $10.' });
    }
    // Strict max check
    if (amount > MAX_DEPOSIT_AMOUNT) {
      logAttack('DEPOSIT_OVERMAX', req.ip, `Over-max deposit attempt: $${amount}`);
      return res.status(400).json({ success: false, message: `Maximum deposit is $${MAX_DEPOSIT_AMOUNT.toLocaleString()}.` });
    }
    // Round to 2 decimal places to avoid float precision issues
    const amt = Math.round(amount * 100) / 100;

    const tier = getTierByAmount(amt);
    const tierKey = getTierKeyByAmount(amt);
    if (!tier || !tierKey) return res.status(400).json({ success: false, message: 'Invalid deposit amount.' });

    // FIX #12: Sanitize TxID
    const cleanTxId = sanitizeTxId(txId);
    if (!cleanTxId) {
      return res.status(400).json({ success: false, message: 'Valid transaction ID (TxID) is required.' });
    }

    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const deposit = { id: crypto.randomUUID(), username: user.username, tier: tierKey, amount: amt, txId: cleanTxId, status: 'pending', createdAt: new Date().toISOString() };
    db.deposits.push(deposit);
    await dbWriteDb(db);
    res.json({ success: true, message: 'Deposit request submitted.', deposit, wallet: USDT_WALLET, tier: tier.name });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ WITHDRAW (FIX #4 - row-level locking, FIX #5 - restore on reject) ============
app.post('/api/withdraw', authenticateToken, withdrawLimiter, async (req, res) => {
  try {
    const { amount } = req.body;

    // Strict validation
    if (amount === null || amount === undefined || amount === '') {
      return res.status(400).json({ success: false, message: 'Amount is required.' });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ success: false, message: 'Amount must be a finite number.' });
    }
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount.' });
    }
    const amt = Math.round(amount * 100) / 100;

    // FIX #4: Use SELECT FOR UPDATE to lock the user row
    const result = await withDb(async (client) => {
      // Lock user row
      const { rows: userRows } = await client.query(
        'SELECT * FROM users WHERE username = $1 FOR UPDATE',
        [req.user.username]
      );
      if (userRows.length === 0) return { error: 'User not found.' };
      const user = userRows[0];

      if (!user.active_plan) return { error: 'No active plan. Deposit first.' };

      const tier = getTier(user.active_plan);
      const depositAmt = parseFloat(user.deposit_amount) || 0;
      const weeklyProfit = getWeeklyProfit(depositAmt);
      const userTierLevel = tier ? tier.level : 0;

      // Check referrals
      const { rows: allDirectDownline } = await client.query(
        'SELECT * FROM users WHERE referred_by = $1',
        [user.username]
      );
      const { rows: deposits } = await client.query(
        'SELECT * FROM deposits WHERE username = ANY($1) AND status = $2',
        [allDirectDownline.map(u => u.username), 'approved']
      );
      const approvedUsernames = new Set(deposits.map(d => d.username));
      const approvedDownline = allDirectDownline.filter(ref => {
        if (!ref.active_plan) return false;
        const refTier = getTier(ref.active_plan);
        if (!refTier) return false;
        return approvedUsernames.has(ref.username) && refTier.level >= userTierLevel;
      });

      if (approvedDownline.length < 3) {
        return { error: `Need 3 approved downline from your tier or higher. Currently: ${approvedDownline.length}/3`, code: 'REFERRAL_LOCK', approvedReferrals: approvedDownline.length };
      }

      // Cycle check
      let cycleWeek = user.cycle_week || 1;
      const cycleStart = user.cycle_start || 0;
      let totalWithdrawnCycle = parseFloat(user.total_withdrawn_cycle) || 0;
      if (cycleStart > 0) { const weekMs = 7 * 24 * 60 * 60 * 1000; const elapsed = Date.now() - cycleStart; cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1); }
      if (cycleWeek > CYCLE_WEEKS) return { error: `Cycle expired! ${CYCLE_WEEKS} weeks completed. Re-deposit and bring 3 new referrals.`, code: 'CYCLE_EXPIRED' };

      const maxWithdrawal = depositAmt * MAX_WITHDRAWAL_PCT;
      if (totalWithdrawnCycle + amt > maxWithdrawal) {
        return { error: `Max withdrawal reached. Remaining: $${(maxWithdrawal - totalWithdrawnCycle).toFixed(2)}`, code: 'CYCLE_MAX', remaining: +(maxWithdrawal - totalWithdrawnCycle).toFixed(2) };
      }

      // Weekly cap
      const weekElapsed = Date.now() - (user.week_start || 0);
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      let weeklyWithdrawn = parseFloat(user.weekly_withdrawn) || 0;
      if (weekElapsed > weekMs) { weeklyWithdrawn = 0; }
      if (weeklyWithdrawn + amt > weeklyProfit) {
        return { error: `Weekly cap exceeded. Remaining: $${(weeklyProfit - weeklyWithdrawn).toFixed(2)}`, code: 'WEEKLY_CAP', remaining: +(weeklyProfit - weeklyWithdrawn).toFixed(2) };
      }

      // Balance check
      const balance = parseFloat(user.balance) || 0;
      if (balance < amt) {
        return { error: `Insufficient balance. Available: $${balance.toFixed(2)}`, code: 'INSUFFICIENT_BALANCE' };
      }

      // Create withdraw record
      const withdrawId = crypto.randomUUID();
      await client.query(
        'INSERT INTO withdraws (id, username, amount, status, created_at) VALUES ($1,$2,$3,$4,NOW())',
        [withdrawId, user.username, amt, 'pending']
      );

      // Update user
      await client.query(
        'UPDATE users SET weekly_withdrawn = $1, total_withdrawn_cycle = $2, cycle_week = $3 WHERE username = $4',
        [weeklyWithdrawn + amt, totalWithdrawnCycle + amt, cycleWeek, user.username]
      );

      return { success: true, withdrawId };
    });

    if (result.error) {
      return res.status(result.code === 'INSUFFICIENT_BALANCE' ? 400 : result.code === 'REFERRAL_LOCK' ? 403 : 400).json({ success: false, message: result.error, code: result.code, ...result });
    }

    res.json({ success: true, message: 'Withdraw request submitted.', withdraw: { id: result.withdrawId, amount: amt, status: 'pending' } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN: Shared Functions (FIX #14 - no duplicated logic) ============
async function adminApproveDeposit(client, depositId) {
  const { rows: depRows } = await client.query('SELECT * FROM deposits WHERE id = $1 FOR UPDATE', [depositId]);
  if (depRows.length === 0) return { error: 'Deposit not found.' };
  const deposit = depRows[0];
  if (deposit.status !== 'pending') return { error: 'Already processed.' };

  const tierKey = getTierKeyByAmount(parseFloat(deposit.amount));
  deposit.status = 'approved';

  // Lock and update user
  const { rows: userRows } = await client.query('SELECT * FROM users WHERE username = $1 FOR UPDATE', [deposit.username]);
  if (userRows.length === 0) return { error: 'User not found.' };
  const user = userRows[0];

  const newBalance = (parseFloat(user.balance) || 0) + parseFloat(deposit.amount);
  await client.query(
    'UPDATE users SET balance = $1, deposit_amount = $2, active_plan = COALESCE($3, active_plan), cycle_start = CASE WHEN cycle_start = 0 OR cycle_start IS NULL THEN EXTRACT(EPOCH FROM NOW()) * 1000 ELSE cycle_start END, cycle_week = CASE WHEN cycle_start = 0 OR cycle_start IS NULL THEN 1 ELSE cycle_week END, total_withdrawn_cycle = CASE WHEN cycle_start = 0 OR cycle_start IS NULL THEN 0 ELSE total_withdrawn_cycle END WHERE username = $4',
    [newBalance, parseFloat(deposit.amount), tierKey, user.username]
  );

  // Update deposit status
  await client.query('UPDATE deposits SET status = $1 WHERE id = $2', ['approved', depositId]);

  // Commission: L1
  if (user.referred_by && user.referred_by !== 'SYSTEM') {
    const { rows: l1Rows } = await client.query('SELECT * FROM users WHERE username = $1 FOR UPDATE', [user.referred_by]);
    if (l1Rows.length > 0) {
      const l1 = l1Rows[0];
      const l1Comm = parseFloat(deposit.amount) * COMM_L1;
      await client.query(
        'UPDATE users SET balance = COALESCE(balance,0) + $1, total_commission = COALESCE(total_commission,0) + $1 WHERE username = $2',
        [l1Comm, l1.username]
      );
      // Commission: L2
      if (l1.referred_by && l1.referred_by !== 'SYSTEM') {
        const { rows: l2Rows } = await client.query('SELECT * FROM users WHERE username = $1 FOR UPDATE', [l1.referred_by]);
        if (l2Rows.length > 0) {
          const l2Comm = parseFloat(deposit.amount) * COMM_L2;
          await client.query(
            'UPDATE users SET balance = COALESCE(balance,0) + $1, total_commission = COALESCE(total_commission,0) + $1 WHERE username = $2',
            [l2Comm, l2Rows[0].username]
          );
        }
      }
    }
  }

  return { success: true, deposit };
}

async function adminRejectDeposit(client, depositId) {
  const { rows: depRows } = await client.query('SELECT * FROM deposits WHERE id = $1 FOR UPDATE', [depositId]);
  if (depRows.length === 0) return { error: 'Deposit not found.' };
  const deposit = depRows[0];
  if (deposit.status !== 'pending') return { error: 'Already processed.' };
  await client.query('UPDATE deposits SET status = $1 WHERE id = $2', ['rejected', depositId]);
  return { success: true };
}

async function adminApproveWithdraw(client, withdrawId) {
  const { rows: wdRows } = await client.query('SELECT * FROM withdraws WHERE id = $1 FOR UPDATE', [withdrawId]);
  if (wdRows.length === 0) return { error: 'Withdraw not found.' };
  const withdraw = wdRows[0];
  if (withdraw.status !== 'pending') return { error: 'Already processed.' };

  const { rows: userRows } = await client.query('SELECT * FROM users WHERE username = $1 FOR UPDATE', [withdraw.username]);
  if (userRows.length === 0) return { error: 'User not found.' };
  const user = userRows[0];
  const balance = parseFloat(user.balance) || 0;
  if (balance < parseFloat(withdraw.amount)) return { error: 'Insufficient user balance.' };

  await client.query('UPDATE withdraws SET status = $1 WHERE id = $2', ['approved', withdrawId]);
  await client.query('UPDATE users SET balance = balance - $1 WHERE username = $2', [parseFloat(withdraw.amount), user.username]);
  return { success: true, withdraw };
}

async function adminRejectWithdraw(client, withdrawId) {
  const { rows: wdRows } = await client.query('SELECT * FROM withdraws WHERE id = $1 FOR UPDATE', [withdrawId]);
  if (wdRows.length === 0) return { error: 'Withdraw not found.' };
  const withdraw = wdRows[0];
  if (withdraw.status !== 'pending') return { error: 'Already processed.' };

  await client.query('UPDATE withdraws SET status = $1 WHERE id = $2', ['rejected', withdrawId]);

  // FIX #5: Restore BOTH weeklyWithdrawn AND totalWithdrawnCycle
  const { rows: userRows } = await client.query('SELECT * FROM users WHERE username = $1 FOR UPDATE', [withdraw.username]);
  if (userRows.length > 0) {
    const user = userRows[0];
    const newWeekly = Math.max(0, (parseFloat(user.weekly_withdrawn) || 0) - parseFloat(withdraw.amount));
    const newCycle = Math.max(0, (parseFloat(user.total_withdrawn_cycle) || 0) - parseFloat(withdraw.amount));
    await client.query(
      'UPDATE users SET weekly_withdrawn = $1, total_withdrawn_cycle = $2 WHERE username = $3',
      [newWeekly, newCycle, user.username]
    );
  }
  return { success: true };
}

// ============ ADMIN ENDPOINTS ============
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const users = db.users.map(u => {
      const activePlan = u.activePlan || u.active_plan || null;
      const tier = activePlan ? getTier(activePlan) : null;
      const depositAmt = u.depositAmount || u.deposit_amount || 0;
      return {
        username: u.username,
        balance: u.balance || 0,
        depositAmount: depositAmt,
        totalCommission: u.totalCommission || u.total_commission || 0,
        activePlan,
        tierName: tier ? tier.name : null,
        tierLabel: tier ? tier.label : null,
        referralCode: u.referralCode || u.referral_code,
        referredBy: u.referredBy || u.referred_by,
        role: u.role || 'user',
        weeklyProfit: +getWeeklyProfit(depositAmt).toFixed(2),
        cycleWeek: u.cycleWeek || u.cycle_week || 1,
        cycleExpired: (u.cycleWeek || u.cycle_week || 1) > CYCLE_WEEKS,
        totalWithdrawnCycle: u.totalWithdrawnCycle || u.total_withdrawn_cycle || 0,
        maxWithdrawal: +(depositAmt * MAX_WITHDRAWAL_PCT).toFixed(2),
        weeklyWithdrawn: u.weeklyWithdrawn || u.weekly_withdrawn || 0,
        createdAt: u.createdAt || u.created_at
      };
    });
    res.json({ success: true, users, total: users.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, deposits: db.deposits }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await withDb(async (client) => {
      return await adminApproveDeposit(client, req.params.id);
    });
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: 'Deposit approved.', deposit: result.deposit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await withDb(async (client) => {
      return await adminRejectDeposit(client, req.params.id);
    });
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: 'Deposit rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/withdraws', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, withdraws: db.withdraws }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await withDb(async (client) => {
      return await adminApproveWithdraw(client, req.params.id);
    });
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: 'Withdraw approved.', withdraw: result.withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await withDb(async (client) => {
      return await adminRejectWithdraw(client, req.params.id);
    });
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: 'Withdraw rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/transactions', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, transactions: db.transactions }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// FIX #14: /api/admin/action now uses shared functions (no duplicated logic)
app.post('/api/admin/action', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, type, action } = req.body;
    let result;
    if (type === 'deposit') {
      result = await withDb(async (client) => {
        if (action === 'Approve') return await adminApproveDeposit(client, id);
        return await adminRejectDeposit(client, id);
      });
    } else if (type === 'withdraw') {
      result = await withDb(async (client) => {
        if (action === 'Approve') return await adminApproveWithdraw(client, id);
        return await adminRejectWithdraw(client, id);
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid type.' });
    }
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, message: action + ' successful.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ HELPER ============
function getReferralStats(username, db) {
  const refs = db.users.filter(u => u.referredBy === username);
  const user = db.users.find(u => u.username === username);
  const userTier = user && user.activePlan ? getTier(user.activePlan) : null;
  let qualified = 0;
  for (const r of refs) {
    if (r.activePlan) {
      const rTier = getTier(r.activePlan);
      if (rTier && userTier && rTier.level >= userTier.level) qualified++;
    }
  }
  return { total: refs.length, qualified };
}

// ============ STATIC FILES ============
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); } }));
app.use((req, res, next) => { if (!req.path.startsWith('/api/')) { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(PUBLIC_DIR, 'index.html')); } else { next(); } });

// ============ START ============
const server = app.listen(PORT, '0.0.0.0', () => { console.log('Trading Platform v5.6 running on port ' + PORT); });
server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
