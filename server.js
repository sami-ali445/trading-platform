/**
 * Trading Platform Server v5.8 — Tier Isolation System
 * Each tier is COMPLETELY INDEPENDENT
 * - Separate deposits, cycles, and referrals per tier
 * - Auto-reset every 7 weeks
 * - 3 active downline required from SAME tier or higher
 * - Treasury protection: max 140% withdrawal per tier
 * SECURITY: A+ rating
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

const LOG_FILE = path.join(__dirname, 'security.log');
const logAttack = (type, ip, details) => {
  const entry = `[${new Date().toISOString()}] ${type} | IP: ${ip} | ${details}\n`;
  console.error('[SECURITY]', entry.trim());
  try { fs.appendFileSync(LOG_FILE, entry); } catch {}
};

const app = express();

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], mediaSrc: ["'self'"], frameSrc: ["'none'"] } },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const ct = req.headers['content-type'];
    if (!ct || !ct.includes('application/json')) {
      logAttack('INVALID_CONTENT_TYPE', req.ip, 'Path: ' + req.path);
      return res.status(415).json({ success: false, message: 'Content-Type must be application/json.' });
    }
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
if (!ALLOWED_ORIGIN && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] ALLOWED_ORIGIN not set!');
  process.exit(1);
}
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin === ALLOWED_ORIGIN) return callback(null, true);
    if (process.env.NODE_ENV === 'production' && origin.includes('onrender.com')) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    logAttack('CORS_BLOCKED', origin, 'Blocked: ' + origin);
    return callback(new Error('CORS: not allowed'));
  },
  methods: ['GET', 'POST'],
  credentials: true,
  maxAge: 86400,
}));

app.use((req, res, next) => {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'strict', secure: true, maxAge: 3600000 });
  res.set('X-CSRF-Token', token);
  req.csrfToken = token;
  next();
});

function checkCsrf(req, res, next) {
  if (req.method === 'GET') return next();
  if (req.path.startsWith('/webhook/')) return next();
  const clientToken = req.headers['x-csrf-token'] || req.body?._csrf;
  const cookieToken = req.cookies?.csrf_token;
  if (req.path.startsWith('/api/auth/')) return next();
  if (!clientToken && !cookieToken) return next();
  if (!clientToken || !cookieToken || clientToken !== cookieToken) {
    logAttack('CSRF', req.ip, 'Path: ' + req.path);
    return res.status(403).json({ success: false, message: 'CSRF token invalid.' });
  }
  next();
}

function validateUsername(u) {
  if (typeof u !== 'string') return 'Username must be a string.';
  if (u.length < 3 || u.length > 50) return 'Username must be 3-50 chars.';
  if (!/^[a-zA-Z0-9_\-\u0600-\u06FF]+$/.test(u)) return 'Invalid characters.';
  return null;
}
function validatePassword(p) {
  if (typeof p !== 'string') return 'Password must be a string.';
  if (p.length < 8) return 'Min 8 chars.';
  if (p.length > 128) return 'Too long.';
  return null;
}
function sanitizeTxId(tx) {
  if (typeof tx !== 'string') return null;
  const c = tx.trim().replace(/[^a-fA-F0-9]/g, '');
  return (c.length >= 10 && c.length <= 100) ? c : null;
}

const suspiciousIPs = new Map();
const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of suspiciousIPs) { if (now - r.lastReq > 300000) suspiciousIPs.delete(ip); }
  for (const [u, r] of loginAttempts) { if (r.lockUntil && now > r.lockUntil + 3600000) loginAttempts.delete(u); }
}, 600000);

app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress;
  if (req.path.includes('/auth/') && req.method === 'POST') logAttack('AUTH_ATTEMPT', ip, 'Path: ' + req.path);
  const r = suspiciousIPs.get(ip) || { count: 0, lastReq: 0 };
  const now = Date.now();
  if (now - r.lastReq < 100) { r.count++; if (r.count > 20) { logAttack('BOT', ip, 'Rapid: ' + r.count); return res.status(429).json({ success: false, message: 'Suspicious activity.' }); } }
  else { r.count = 0; }
  r.lastReq = now;
  suspiciousIPs.set(ip, r);
  next();
});

process.on('unhandledRejection', (err) => console.error('[UNHANDLED]', err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT]', err));

const generalLimiter = rateLimit({ windowMs: 15*60*1000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });
const depositLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.username || req.ip });
const withdrawLimiter = rateLimit({ windowMs: 60*60*1000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.username || req.ip });
app.use(generalLimiter);
app.use(checkCsrf);

const PORT = process.env.PORT || 4000;
if (!process.env.JWT_SECRET) console.error('[WARN] JWT_SECRET not set!');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASS_HASH;
const USDT_WALLET = process.env.USDT_WALLET || '';

const LOCKOUT_MAX = 5, LOCKOUT_DUR = 30*60*1000;
function checkLockout(u) {
  const r = loginAttempts.get(u);
  if (!r) return { locked: false };
  if (r.lockUntil && Date.now() < r.lockUntil) return { locked: true, remainingMin: Math.ceil((r.lockUntil - Date.now()) / 60000) };
  loginAttempts.delete(u);
  return { locked: false };
}
function recordFail(u) {
  const r = loginAttempts.get(u) || { count: 0, lockUntil: null };
  r.count++;
  if (r.count >= LOCKOUT_MAX) { r.lockUntil = Date.now() + LOCKOUT_DUR; console.log('[LOCKOUT] ' + u); }
  loginAttempts.set(u, r);
  return r;
}
function recordSuccess(u) { loginAttempts.delete(u); }

const ROOT_REFERRAL_CODES = ['BOOT00'];
const COMM_L1 = 0.10, COMM_L2 = 0.05;
const WEEKLY_PROFIT_PCT = 0.20, CYCLE_WEEKS = 7, MAX_WD_PCT = 1.40, MAX_DEPOSIT = 50000;

const TIERS = {
  bronze:   { level: 1, name: 'Bronze',   minDeposit: 10,   maxDeposit: 49,      label: '$10-$49' },
  silver:   { level: 2, name: 'Silver',   minDeposit: 50,   maxDeposit: 99,      label: '$50-$99' },
  gold:     { level: 3, name: 'Gold',     minDeposit: 100,  maxDeposit: 249,     label: '$100-$249' },
  platinum: { level: 4, name: 'Platinum', minDeposit: 250,  maxDeposit: 499,     label: '$250-$499' },
  diamond:  { level: 5, name: 'Diamond',  minDeposit: 500,  maxDeposit: 999,     label: '$500-$999' },
  vip:      { level: 6, name: 'VIP',      minDeposit: 1000, maxDeposit: 2499,    label: '$1,000-$2,499' },
  elite:    { level: 7, name: 'Elite',    minDeposit: 2500, maxDeposit: 4999,    label: '$2,500-$4,999' },
  royal:    { level: 8, name: 'Royal',    minDeposit: 5000, maxDeposit: 9999,    label: '$5,000-$9,999' },
  legend:   { level: 9, name: 'Legend',   minDeposit: 10000, maxDeposit: Infinity, label: '$10,000+' },
};

function getTierByAmount(a) { const n = Number(a); if (n >= 10000) return TIERS.legend; if (n >= 5000) return TIERS.royal; if (n >= 2500) return TIERS.elite; if (n >= 1000) return TIERS.vip; if (n >= 500) return TIERS.diamond; if (n >= 250) return TIERS.platinum; if (n >= 100) return TIERS.gold; if (n >= 50) return TIERS.silver; if (n >= 10) return TIERS.bronze; return null; }
function getTierKeyByAmount(a) { const n = Number(a); if (n >= 10000) return 'legend'; if (n >= 5000) return 'royal'; if (n >= 2500) return 'elite'; if (n >= 1000) return 'vip'; if (n >= 500) return 'diamond'; if (n >= 250) return 'platinum'; if (n >= 100) return 'gold'; if (n >= 50) return 'silver'; if (n >= 10) return 'bronze'; return null; }
function getTier(k) { return TIERS[k] || null; }
function getWeeklyProfit(a) { return Number(a) * WEEKLY_PROFIT_PCT; }
function getDailyProfit(a) { return getWeeklyProfit(a) / 7; }

// ============ DATABASE ============
let pgPool = null;
let dbConnected = false;

(async function initDB() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('[DB] FATAL: DATABASE_URL not set!'); process.exit(1); }
  try {
    const pg = require('pg');
    const { Pool } = pg;
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3, min: 0,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
    });
    pgPool.on('error', (err) => { console.error('[DB] Pool error:', err.message); dbConnected = false; });
    pgPool.on('connect', () => { console.log('[DB] Client connected'); dbConnected = true; });
    pgPool.query('SELECT 1').then(() => {
      console.log('[DB] PostgreSQL connected OK');
      dbConnected = true;
    }).catch(e => {
      console.error('[DB] Connection test failed:', e.code, e.message);
      dbConnected = false;
    });
    // Add telegram columns if missing
    await pgPool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS telegram_id BIGINT,
      ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(255)
    `);
    console.log('[DB] Telegram columns verified');
  } catch(e) {
    console.error('[DB] Init failed:', e.message);
  }
})();

async function withDb(fn) {
  if (!pgPool) return null;
  const client = await pgPool.connect();
  try { return await fn(client); }
  catch(e) { console.error('[DB] Query error:', e.message); throw e; }
  finally { client.release(); }
}

// ============ TIER ISOLATION HELPERS ============

// Get user's active tiers (tiers with approved deposits)
async function getUserActiveTiers(username) {
  const rows = await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT DISTINCT tier FROM user_tier_deposits WHERE username=$1 AND status=$2',
      [username, 'approved']
    );
    return rows;
  });
  return (rows || []).map(r => r.tier);
}

// Get user's cycle data for a specific tier
async function getTierCycle(username, tier) {
  const rows = await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT * FROM user_tier_cycles WHERE username=$1 AND tier=$2',
      [username, tier]
    );
    return rows;
  });
  if (rows && rows.length > 0) return rows[0];
  // Create default cycle
  const nowMs = Date.now();
  await withDb(async (c) => {
    await c.query(
      'INSERT INTO user_tier_cycles (username, tier, cycle_start, cycle_week, total_withdrawn, weekly_withdrawn, week_start) VALUES ($1,$2,$3,1,0,0,$3) ON CONFLICT (username, tier) DO NOTHING',
      [username, tier, nowMs]
    );
  });
  return { username, tier, cycle_start: nowMs, cycle_week: 1, total_withdrawn: 0, weekly_withdrawn: 0, week_start: nowMs, referrals_count: 0 };
}

// Count approved downline for a specific tier (same tier or higher)
async function countTierReferrals(username, tier) {
  const tierObj = getTier(tier);
  const tierLevel = tierObj ? tierObj.level : 0;

  // Get all tiers at or above this level
  const eligibleTiers = Object.entries(TIERS).filter(([k, v]) => v.level >= tierLevel).map(([k]) => k);

  const rows = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT COUNT(DISTINCT tr.referred_username) as count
       FROM user_tier_referrals tr
       INNER JOIN users u ON u.username = tr.referred_username
       WHERE tr.username = $1
       AND tr.tier = ANY($2)
       AND tr.is_active = TRUE
       AND u.active_plan IS NOT NULL
       AND EXISTS (SELECT 1 FROM user_tier_deposits td WHERE td.username = tr.referred_username AND td.status = 'approved')`,
      [username, eligibleTiers]
    );
    return rows;
  });
  return rows && rows.length > 0 ? parseInt(rows[0].count) : 0;
}

// Check if user can withdraw from a specific tier
async function canWithdrawFromTier(username, tier) {
  const cycle = await getTierCycle(username, tier);
  const nowMs = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // Calculate current cycle week
  let cycleWeek = 1;
  if (cycle.cycle_start > 0) {
    cycleWeek = Math.min(CYCLE_WEEKS, Math.floor((nowMs - cycle.cycle_start) / weekMs) + 1);
  }

  // Check if cycle expired
  if (cycleWeek > CYCLE_WEEKS) {
    return { can: false, reason: 'Cycle expired. Need 3 new referrals.', cycleWeek, referrals: 0 };
  }

  // Count referrals for this tier
  const refCount = await countTierReferrals(username, tier);

  if (refCount < 3) {
    return { can: false, reason: `Need 3 approved downline for ${tier}. Have: ${refCount}/3`, cycleWeek, referrals: refCount };
  }

  return { can: true, cycleWeek, referrals: refCount };
}

// Auto-reset cycles that have expired (run periodically)
async function autoResetExpiredCycles() {
  const nowMs = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const maxCycleMs = CYCLE_WEEKS * weekMs;

  const expired = await withDb(async (c) => {
    const { rows } = await c.query(
      'SELECT username, tier, cycle_start FROM user_tier_cycles WHERE cycle_start > 0 AND ($1 - cycle_start) > $2',
      [nowMs, maxCycleMs]
    );
    return rows;
  });

  if (expired && expired.length > 0) {
    for (const row of expired) {
      await withDb(async (c) => {
        await c.query(
          'UPDATE user_tier_cycles SET cycle_start=$1, cycle_week=1, total_withdrawn=0, weekly_withdrawn=0, week_start=$1, referrals_count=0 WHERE username=$2 AND tier=$3',
          [nowMs, row.username, row.tier]
        );
        // Deactivate old referrals for this tier
        await c.query(
          'UPDATE user_tier_referrals SET is_active=FALSE WHERE username=$1 AND tier=$2',
          [row.username, row.tier]
        );
      });
      console.log(`[AUTO-RESET] Cycle reset for ${row.username} / ${row.tier}`);
    }
  }

  return expired ? expired.length : 0;
}

// Run auto-reset every hour
setInterval(() => {
  autoResetExpiredCycles().catch(e => console.error('[AUTO-RESET ERROR]', e.message));
}, 3600000);

// Run once on startup
autoResetExpiredCycles().catch(() => {});

// ============ Token Blacklist ============
const tokenBlacklist = new Map();
setInterval(() => { const now = Date.now(); for (const [t, exp] of tokenBlacklist) { if (now > exp) tokenBlacklist.delete(t); } }, 300000);
function isTokenBlacklisted(t) { return tokenBlacklist.has(t); }
function blacklistToken(t) { try { const d = jwt.decode(t); tokenBlacklist.set(t, d && d.exp ? d.exp * 1000 : Date.now() + 86400000); } catch { tokenBlacklist.set(t, Date.now() + 86400000); } }
function generateToken(p, req) {
  // Session fingerprint: UA only (ignore IP changes for mobile networks)
  const ua = req?.headers?.['user-agent'] || '';
  const fingerprint = crypto.createHash('sha256')
    .update(ua)
    .digest('hex')
    .substring(0, 16);
  return jwt.sign({ ...p, fp: fingerprint }, JWT_SECRET, { expiresIn: '24h' });
}
function setTokenCookie(res, token) { res.cookie('auth_token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400000, path: '/' }); }
function clearTokenCookie(res) { res.clearCookie('auth_token', { path: '/' }); }

function authenticateToken(req, res, next) {
  const cookieToken = req.cookies?.auth_token;
  const headerToken = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
  const t = cookieToken || headerToken;
  if (!t) return res.status(401).json({ success: false, message: 'No token.' });
  if (isTokenBlacklisted(t)) return res.status(403).json({ success: false, message: 'Token revoked.' });
  jwt.verify(t, JWT_SECRET, (err, u) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token.' });
    // Verify session fingerprint - UA only (allows IP changes on mobile)
    const ua = req.headers['user-agent'] || '';
    const currentFp = crypto.createHash('sha256')
      .update(ua)
      .digest('hex')
      .substring(0, 16);
    if (u.fp && u.fp !== currentFp) {
      logAttack('GHOST_SESSION', req.ip, 'User: ' + u.username + ' FP mismatch');
      return res.status(403).json({ success: false, message: 'Session invalid. Please login again.' });
    }
    req.user = { username: u.username, role: u.role };
    next();
  });
}
function requireAdmin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only.' }); next(); }

// ============ HEALTH ============
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '5.9.1', db: dbConnected, ts: new Date().toISOString() }));

// ============ AUTH ============
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;
    const ue = validateUsername(username); if (ue) return res.status(400).json({ success: false, message: ue });
    const pe = validatePassword(password); if (pe) return res.status(400).json({ success: false, message: pe });
    if (!referralCode || typeof referralCode !== 'string') return res.status(400).json({ success: false, message: 'Referral code required.' });

    const existing = await withDb(async (c) => {
      const { rows } = await c.query('SELECT 1 FROM users WHERE username=$1', [username]);
      return rows.length > 0;
    });
    if (existing) return res.status(400).json({ success: false, message: 'Username exists.' });

    const isRoot = ROOT_REFERRAL_CODES.includes(referralCode.toUpperCase());
    let referrerUsername = 'SYSTEM';
    if (!isRoot) {
      const ref = await withDb(async (c) => {
        const { rows } = await c.query('SELECT username FROM users WHERE referral_code=$1', [referralCode]);
        return rows[0];
      });
      if (!ref) return res.status(400).json({ success: false, message: 'Invalid referral code.' });
      referrerUsername = ref.username;

      // Register referral relationship for all tiers
      const allTiers = Object.keys(TIERS);
      for (const tier of allTiers) {
        await withDb(async (c) => {
          await c.query(
            'INSERT INTO user_tier_referrals (username, referred_username, tier, is_active) VALUES ($1,$2,$3,FALSE) ON CONFLICT DO NOTHING',
            [referrerUsername, username, tier]
          );
        });
      }
    }

    const myCode = crypto.randomBytes(5).toString('hex').toUpperCase() + Date.now().toString(36).toUpperCase();
    const hashedPassword = await bcrypt.hash(password, 12);

    await withDb(async (c) => {
      await c.query(
        'INSERT INTO users (id, username, password, referral_code, referred_by, role) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5)',
        [username, hashedPassword, myCode, referrerUsername, 'user']
      );
    });

    const token = generateToken({ username, role: 'user' });
    setTokenCookie(res, token);
    res.json({ success: true, message: 'Registered.', referralCode: myCode });
  } catch (err) { console.error('[REGISTER]', err); res.status(500).json({ success: false, message: err.message || 'Server error' }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    const ls = checkLockout(username); if (ls.locked) return res.status(423).json({ success: false, message: 'Locked. Try in ' + ls.remainingMin + 'min.' });

    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [username]);
      return rows[0];
    });
    if (!user) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    recordSuccess(username);

    const token = generateToken({ username: user.username, role: user.role || 'user' }, req);
    setTokenCookie(res, token);
    res.json({ success: true, username: user.username, role: user.role || 'user' });
  } catch (err) { console.error('[LOGIN]', err); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/auth/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Required.' });
    const ls = checkLockout(username); if (ls.locked) return res.status(423).json({ success: false, message: 'Locked. Try in ' + ls.remainingMin + 'min.' });

    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1 AND role=$2', [username, 'admin']);
      return rows[0];
    });
    if (!user) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid admin.' }); }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid admin.' }); }
    recordSuccess(username);

    const token = generateToken({ username: user.username, role: 'admin' }, req);
    setTokenCookie(res, token);
    res.json({ success: true, username: user.username, role: 'admin' });
  } catch (err) { console.error('[ADMIN LOGIN]', err); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  const ct = req.cookies?.auth_token;
  const ht = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
  const t = ct || ht; if (t) blacklistToken(t);
  clearTokenCookie(res); res.json({ success: true, message: 'Logged out.' });
});

// ============ TELEGRAM LINKING ============
app.post('/api/user/telegram/link', authenticateToken, async (req, res) => {
  try {
    const { telegramId, telegramUsername } = req.body;
    if (!telegramId && !telegramUsername) {
      return res.status(400).json({ success: false, message: 'Provide telegramId or telegramUsername' });
    }
    
    // Validate telegramId is a number if provided
    let tid = null;
    if (telegramId) {
      tid = parseInt(telegramId);
      if (isNaN(tid) || tid <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid Telegram ID' });
      }
    }
    
    // Normalize username (remove @ if present)
    let username = (telegramUsername || '').trim().replace(/^@/, '');
    
    await withDb(async (c) => {
      await c.query(
        'UPDATE users SET telegram_id = COALESCE($1, telegram_id), telegram_username = COALESCE($2, telegram_username) WHERE username = $3',
        [tid, username || null, req.user.username]
      );
    });
    
    res.json({ 
      success: true, 
      message: 'Telegram account linked successfully',
      telegramId: tid,
      telegramUsername: username
    });
  } catch (err) {
    console.error('[TELEGRAM LINK]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get telegram link status
app.get('/api/user/telegram/status', authenticateToken, async (req, res) => {
  try {
    const user = await withDb(async (c) => {
      const { rows } = await c.query(
        'SELECT telegram_id, telegram_username FROM users WHERE username = $1',
        [req.user.username]
      );
      return rows[0];
    });
    
    res.json({
      success: true,
      linked: !!(user?.telegram_id || user?.telegram_username),
      telegramId: user?.telegram_id || null,
      telegramUsername: user?.telegram_username || null
    });
  } catch (err) {
    console.error('[TELEGRAM STATUS]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Unlink telegram
app.delete('/api/user/telegram/link', authenticateToken, async (req, res) => {
  try {
    await withDb(async (c) => {
      await c.query(
        'UPDATE users SET telegram_id = NULL, telegram_username = NULL WHERE username = $1',
        [req.user.username]
      );
    });
    res.json({ success: true, message: 'Telegram account unlinked' });
  } catch (err) {
    console.error('[TELEGRAM UNLINK]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Required.' });
    const pe = validatePassword(newPassword); if (pe) return res.status(400).json({ success: false, message: pe });
    if (currentPassword === newPassword) return res.status(400).json({ success: false, message: 'Must differ.' });

    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [req.user.username]);
      return rows[0];
    });
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });
    if (!await bcrypt.compare(currentPassword, user.password)) return res.status(401).json({ success: false, message: 'Wrong current.' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await withDb(async (c) => {
      await c.query('UPDATE users SET password=$1 WHERE username=$2', [newHash, user.username]);
    });

    const token = generateToken({ username: user.username, role: user.role });
    setTokenCookie(res, token);
    res.json({ success: true, message: 'Password changed.' });
  } catch (err) { console.error('[CHG PW]', err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// ============ USER PROFILE ============
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [req.user.username]);
      return rows[0];
    });
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });

    // Get all active tiers for this user
    const activeTiers = await getUserActiveTiers(req.user.username);

    // Get cycle data for each active tier
    const tierData = {};
    for (const tier of activeTiers) {
      const cycle = await getTierCycle(req.user.username, tier);
      const canWd = await canWithdrawFromTier(req.user.username, tier);
      const tierObj = getTier(tier);
      const depositAmt = parseFloat(user.deposit_amount) || 0;
      tierData[tier] = {
        cycleWeek: cycle.cycle_week,
        totalWithdrawn: cycle.total_withdrawn,
        weeklyWithdrawn: cycle.weekly_withdrawn,
        canWithdraw: canWd.can,
        withdrawReason: canWd.reason,
        referrals: canWd.referrals,
        weeklyProfit: +getWeeklyProfit(depositAmt).toFixed(2),
        dailyProfit: +getDailyProfit(depositAmt).toFixed(2),
        maxWithdrawal: +(depositAmt * MAX_WD_PCT).toFixed(2),
      };
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        balance: parseFloat(user.balance) || 0,
        totalBalance: parseFloat(user.total_balance) || 0,
        totalCommission: parseFloat(user.total_commission) || 0,
        activePlan: user.active_plan,
        referralCode: user.referral_code,
        referrer: user.referred_by,
        role: user.role || 'user',
        activeTiers: activeTiers,
        tierData: tierData,
        createdAt: user.created_at,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/referrals', authenticateToken, async (req, res) => {
  try {
    const refs = await withDb(async (c) => {
      const { rows } = await c.query('SELECT username, active_plan, referred_by, created_at FROM users WHERE referred_by=$1', [req.user.username]);
      return rows;
    });
    res.json({ success: true, referrals: refs || [] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/tiers', (req, res) => {
  const tiersOut = {};
  for (const [key, t] of Object.entries(TIERS)) {
    const minW = getWeeklyProfit(t.minDeposit);
    const maxW = t.maxDeposit === Infinity ? null : getWeeklyProfit(t.maxDeposit);
    tiersOut[key] = { ...t, level: t.level, weeklyProfitMin: +minW.toFixed(2), weeklyProfitMax: maxW ? +maxW.toFixed(2) : null, cycleWeeks: CYCLE_WEEKS, maxTotalPct: MAX_WD_PCT * 100 };
  }
  res.json({ success: true, tiers: tiersOut, weeklyPct: WEEKLY_PROFIT_PCT * 100 });
});

// ============ DEPOSIT ============
app.post('/api/deposit', authenticateToken, depositLimiter, async (req, res) => {
  try {
    const { amount, txId } = req.body;
    if (amount === null || amount === undefined || amount === '') return res.status(400).json({ success: false, message: 'Amount required.' });
    if (typeof amount !== 'number') { logAttack('DEP_TYPE', req.ip, 'Non-number: ' + typeof amount); return res.status(400).json({ success: false, message: 'Amount must be a number.' }); }
    if (!Number.isFinite(amount)) return res.status(400).json({ success: false, message: 'Must be finite.' });
    if (amount < 10) return res.status(400).json({ success: false, message: 'Min $10.' });
    if (amount > MAX_DEPOSIT) { logAttack('DEP_MAX', req.ip, 'Over: $' + amount); return res.status(400).json({ success: false, message: 'Max $' + MAX_DEPOSIT + '.' }); }
    const amt = Math.round(amount * 100) / 100;
    const tierKey = getTierKeyByAmount(amt);
    if (!tierKey) return res.status(400).json({ success: false, message: 'Invalid amount.' });
    const cleanTxId = sanitizeTxId(txId);
    if (!cleanTxId) return res.status(400).json({ success: false, message: 'Valid TxID required.' });

    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [req.user.username]);
      return rows[0];
    });
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });

    // Create deposit record
    const depositId = crypto.randomUUID();
    await withDb(async (c) => {
      await c.query(
        'INSERT INTO deposits (id, username, tier, amount, tx_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
        [depositId, user.username, tierKey, amt, cleanTxId, 'pending']
      );
      // Also add to tier deposits
      await c.query(
        'INSERT INTO user_tier_deposits (id, username, tier, amount, status, deposit_id, created_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,NOW())',
        [user.username, tierKey, amt, 'pending', depositId]
      );
    });

    res.json({ success: true, message: 'Deposit submitted for ' + tierKey + ' tier.', deposit: { id: depositId, amount: amt, tier: tierKey, status: 'pending' }, wallet: USDT_WALLET });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ WITHDRAW ============
app.post('/api/withdraw', authenticateToken, withdrawLimiter, async (req, res) => {
  try {
    const { amount, tier } = req.body;
    if (amount === null || amount === undefined || amount === '') return res.status(400).json({ success: false, message: 'Amount required.' });
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return res.status(400).json({ success: false, message: 'Must be finite number.' });
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Invalid.' });
    const amt = Math.round(amount * 100) / 100;

    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [req.user.username]);
      return rows[0];
    });
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });

    // Determine which tier to withdraw from
    const targetTier = tier || user.active_plan;
    if (!targetTier) return res.status(400).json({ success: false, message: 'No active plan.' });

    // Check if user has approved deposit in this tier
    const tierDeposit = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM user_tier_deposits WHERE username=$1 AND tier=$2 AND status=$3 LIMIT 1', [user.username, targetTier, 'approved']);
      return rows[0];
    });
    if (!tierDeposit) return res.status(400).json({ success: false, message: 'No approved deposit in ' + targetTier + ' tier.' });

    // Check tier isolation: 3 referrals required for THIS tier
    const canWd = await canWithdrawFromTier(user.username, targetTier);
    if (!canWd.can) return res.status(403).json({ success: false, message: canWd.reason, code: 'REFERRAL_LOCK' });

    // Get cycle data for this tier
    const cycle = await getTierCycle(user.username, targetTier);
    const tierObj = getTier(targetTier);
    const depositAmt = parseFloat(tierDeposit.amount) || 0;
    const weeklyProfit = getWeeklyProfit(depositAmt);

    // Check max withdrawal (140% of tier deposit)
    const maxWd = depositAmt * MAX_WD_PCT;
    if (parseFloat(cycle.total_withdrawn) + amt > maxWd) return res.status(400).json({ success: false, message: 'Max withdrawal for ' + targetTier + ' tier reached. Max: $' + maxWd.toFixed(2), code: 'CYCLE_MAX' });

    // Check weekly cap
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let weeklyWd = parseFloat(cycle.weekly_withdrawn) || 0;
    if (Date.now() - (cycle.week_start || 0) > weekMs) weeklyWd = 0;
    if (weeklyWd + amt > weeklyProfit) return res.status(400).json({ success: false, message: 'Weekly cap for ' + targetTier + ' tier exceeded.', code: 'WEEKLY_CAP' });

    // Check balance
    const balance = parseFloat(user.balance) || 0;
    if (balance < amt) return res.status(400).json({ success: false, message: 'Insufficient balance.', code: 'NO_BALANCE' });

    // Create withdraw record
    const wdId = crypto.randomUUID();
    await withDb(async (c) => {
      await c.query(
        'INSERT INTO withdraws (id, username, amount, status, created_at) VALUES ($1,$2,$3,$4,NOW())',
        [wdId, user.username, amt, 'pending']
      );
      // Update tier cycle
      await c.query(
        'UPDATE user_tier_cycles SET total_withdrawn=total_withdrawn+$1, weekly_withdrawn=$2, cycle_week=$3 WHERE username=$4 AND tier=$5',
        [amt, weeklyWd + amt, canWd.cycleWeek, user.username, targetTier]
      );
    });

    res.json({ success: true, message: 'Withdraw submitted from ' + targetTier + ' tier.', withdraw: { id: wdId, amount: amt, tier: targetTier, status: 'pending' } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN ============

// Helper: Check if user has 3 approved downline for a specific tier
async function checkTierReferrals(username, tier) {
  const tierObj = getTier(tier);
  const tierLevel = tierObj ? tierObj.level : 0;
  const eligibleTiers = Object.entries(TIERS).filter(([k, v]) => v.level >= tierLevel).map(([k]) => k);

  const rows = await withDb(async (c) => {
    const { rows } = await c.query(
      `SELECT DISTINCT tr.referred_username
       FROM user_tier_referrals tr
       INNER JOIN users u ON u.username = tr.referred_username
       WHERE tr.username = $1
       AND tr.tier = ANY($2)
       AND tr.is_active = TRUE
       AND u.active_plan IS NOT NULL
       AND EXISTS (SELECT 1 FROM user_tier_deposits td WHERE td.username = tr.referred_username AND td.status = 'approved')`,
      [username, eligibleTiers]
    );
    return rows;
  });
  return { count: (rows || []).length, approved: (rows || []).map(r => r.referred_username) };
}

async function adminApproveDeposit(depositId) {
  const deps = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM deposits WHERE id=$1', [depositId]);
    return rows;
  });
  if (!deps || !deps.length) return { error: 'Not found.' };
  const deposit = deps[0];
  if (deposit.status !== 'pending') return { error: 'Already processed.' };

  const tierKey = getTierKeyByAmount(parseFloat(deposit.amount));
  const users = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [deposit.username]);
    return rows;
  });
  if (!users || !users.length) return { error: 'User not found.' };
  const user = users[0];

  // Check if this is first deposit for this tier
  const existingTierDeposit = await withDb(async (c) => {
    const { rows } = await c.query('SELECT 1 FROM user_tier_deposits WHERE username=$1 AND tier=$2 AND status=$3 LIMIT 1', [user.username, tierKey, 'approved']);
    return rows.length > 0;
  });

  if (!existingTierDeposit) {
    // First deposit for this tier - check 3 referrals
    const refCheck = await checkTierReferrals(user.username, tierKey);
    const isRootUser = user.referred_by === 'SYSTEM' || !user.referred_by;
    if (!isRootUser && refCheck.count < 3) {
      return { error: `User needs 3 approved downline for ${tierKey} tier. Have: ${refCheck.count}/3. Deposit saved but tier not activated.` };
    }

    // Activate tier for user
    const nowMs = Date.now();
    await withDb(async (c) => {
      await c.query('UPDATE users SET active_plan=$1, deposit_amount=deposit_amount+$2, total_balance=total_balance+$2 WHERE username=$3', [tierKey, parseFloat(deposit.amount), user.username]);
      // Create or update tier cycle
      await c.query(
        'INSERT INTO user_tier_cycles (username, tier, cycle_start, cycle_week, total_withdrawn, weekly_withdrawn, week_start) VALUES ($1,$2,$3,1,0,0,$3) ON CONFLICT (username, tier) DO UPDATE SET cycle_start=$3, cycle_week=1',
        [user.username, tierKey, nowMs]
      );
      // Activate referrals for this tier
      await c.query('UPDATE user_tier_referrals SET is_active=TRUE WHERE referred_username=$1 AND tier=$2', [user.username, tierKey]);
    });
  } else {
    // Additional deposit for existing tier - just add to balance
    await withDb(async (c) => {
      await c.query('UPDATE users SET deposit_amount=deposit_amount+$1, total_balance=total_balance+$1 WHERE username=$2', [parseFloat(deposit.amount), user.username]);
    });
  }

  // Mark deposit as approved
  await withDb(async (c) => {
    await c.query('UPDATE deposits SET status=$1, approved_at=NOW() WHERE id=$2', ['approved', depositId]);
    await c.query('UPDATE user_tier_deposits SET status=$1, approved_at=NOW() WHERE deposit_id=$2', ['approved', depositId]);
  });

  // Commissions
  if (user.referred_by && user.referred_by !== 'SYSTEM') {
    const l1s = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [user.referred_by]);
      return rows;
    });
    if (l1s && l1s.length > 0) {
      const l1 = l1s[0];
      const c1 = parseFloat(deposit.amount) * COMM_L1;
      await withDb(async (c) => {
        await c.query('UPDATE users SET balance=COALESCE(balance,0)+$1, total_commission=COALESCE(total_commission,0)+$1 WHERE username=$2', [c1, l1.username]);
      });
      if (l1.referred_by && l1.referred_by !== 'SYSTEM') {
        const l2s = await withDb(async (c) => {
          const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [l1.referred_by]);
          return rows;
        });
        if (l2s && l2s.length > 0) {
          const c2 = parseFloat(deposit.amount) * COMM_L2;
          await withDb(async (c) => {
            await c.query('UPDATE users SET balance=COALESCE(balance,0)+$1, total_commission=COALESCE(total_commission,0)+$1 WHERE username=$2', [c2, l2s[0].username]);
          });
        }
      }
    }
  }

  return { success: true, deposit };
}

async function adminRejectDeposit(depositId) {
  const deps = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM deposits WHERE id=$1', [depositId]);
    return rows;
  });
  if (!deps || !deps.length) return { error: 'Not found.' };
  if (deps[0].status !== 'pending') return { error: 'Already processed.' };
  await withDb(async (c) => {
    await c.query('UPDATE deposits SET status=$1 WHERE id=$2', ['rejected', depositId]);
    await c.query('UPDATE user_tier_deposits SET status=$1 WHERE deposit_id=$2', ['rejected', depositId]);
  });
  return { success: true };
}

async function adminApproveWithdraw(withdrawId) {
  const wds = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM withdraws WHERE id=$1', [withdrawId]);
    return rows;
  });
  if (!wds || !wds.length) return { error: 'Not found.' };
  const wd = wds[0];
  if (wd.status !== 'pending') return { error: 'Already processed.' };

  const users = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [wd.username]);
    return rows;
  });
  if (!users || !users.length) return { error: 'User not found.' };
  const bal = parseFloat(users[0].balance) || 0;
  if (bal < parseFloat(wd.amount)) return { error: 'Insufficient balance.' };

  await withDb(async (c) => {
    await c.query('UPDATE withdraws SET status=$1 WHERE id=$2', ['approved', withdrawId]);
    await c.query('UPDATE users SET balance=balance-$1, total_balance=total_balance-$1 WHERE username=$2', [parseFloat(wd.amount), wd.username]);
  });
  return { success: true, withdraw: wd };
}

async function adminRejectWithdraw(withdrawId) {
  const wds = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM withdraws WHERE id=$1', [withdrawId]);
    return rows;
  });
  if (!wds || !wds.length) return { error: 'Not found.' };
  const wd = wds[0];
  if (wd.status !== 'pending') return { error: 'Already processed.' };

  await withDb(async (c) => {
    await c.query('UPDATE withdraws SET status=$1 WHERE id=$2', ['rejected', withdrawId]);
  });

  // Restore tier cycle
  const users = await withDb(async (c) => {
    const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [wd.username]);
    return rows;
  });
  if (users && users.length > 0) {
    const u = users[0];
    await withDb(async (c) => {
      await c.query('UPDATE user_tier_cycles SET total_withdrawn=GREATEST(0,total_withdrawn-$1), weekly_withdrawn=GREATEST(0,weekly_withdrawn-$1) WHERE username=$2 AND tier=$3', [parseFloat(wd.amount), u.username, u.active_plan]);
    });
  }
  return { success: true };
}

// Admin endpoints
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users ORDER BY created_at DESC');
      return rows;
    });
    const result = [];
    for (const u of (users || [])) {
      const activeTiers = await getUserActiveTiers(u.username);
      result.push({
        username: u.username,
        balance: parseFloat(u.balance) || 0,
        totalBalance: parseFloat(u.total_balance) || 0,
        totalCommission: parseFloat(u.total_commission) || 0,
        activePlan: u.active_plan,
        activeTiers: activeTiers,
        referralCode: u.referral_code,
        referredBy: u.referred_by,
        role: u.role || 'user',
        createdAt: u.created_at,
      });
    }
    res.json({ success: true, users: result, total: result.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deposits = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM deposits ORDER BY created_at DESC');
      return rows;
    });
    res.json({ success: true, deposits: deposits || [] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await adminApproveDeposit(req.params.id);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, message: 'Approved.', deposit: r.deposit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await adminRejectDeposit(req.params.id);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, message: 'Rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/withdraws', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const withdraws = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM withdraws ORDER BY created_at DESC');
      return rows;
    });
    res.json({ success: true, withdraws: withdraws || [] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await adminApproveWithdraw(req.params.id);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, message: 'Approved.', withdraw: r.withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await adminRejectWithdraw(req.params.id);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, message: 'Rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/transactions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const txns = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM transactions ORDER BY created_at DESC');
      return rows;
    });
    res.json({ success: true, transactions: txns || [] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/action', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, type, action } = req.body;
    let r;
    if (type === 'deposit') r = action === 'Approve' ? await adminApproveDeposit(id) : await adminRejectDeposit(id);
    else if (type === 'withdraw') r = action === 'Approve' ? await adminApproveWithdraw(id) : await adminRejectWithdraw(id);
    else return res.status(400).json({ success: false, message: 'Invalid type.' });
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, message: action + ' successful.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin: Update USDT wallet
app.post('/api/admin/update-wallet', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet || typeof wallet !== 'string') return res.status(400).json({ success: false, message: 'Wallet address required.' });
    // Update in-memory wallet
    process.env.USDT_WALLET = wallet;
    res.json({ success: true, message: 'Wallet updated.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin: Reset user tier cycle
app.post('/api/admin/users/:username/reset-cycle', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { tier } = req.body;
    const username = req.params.username;

    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [username]);
      return rows[0];
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const tiersToReset = tier ? [tier] : Object.keys(TIERS);
    const nowMs = Date.now();

    for (const t of tiersToReset) {
      await withDb(async (c) => {
        await c.query(
          'UPDATE user_tier_cycles SET cycle_start=$1, cycle_week=1, total_withdrawn=0, weekly_withdrawn=0, week_start=$1, referrals_count=0, last_reset_at=NOW() WHERE username=$2 AND tier=$3',
          [nowMs, username, t]
        );
        await c.query('UPDATE user_tier_referrals SET is_active=FALSE WHERE username=$1 AND tier=$2', [username, t]);
      });
    }

    res.json({ success: true, message: 'Cycle reset for ' + username + ' (' + tiersToReset.join(', ') + '). New 7-week cycle started.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin: Get user tier status
app.get('/api/admin/users/:username/tiers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const username = req.params.username;
    const user = await withDb(async (c) => {
      const { rows } = await c.query('SELECT * FROM users WHERE username=$1', [username]);
      return rows[0];
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const tierStatus = {};
    for (const tier of Object.keys(TIERS)) {
      const cycle = await getTierCycle(username, tier);
      const canWd = await canWithdrawFromTier(username, tier);
      const refCheck = await checkTierReferrals(username, tier);

      tierStatus[tier] = {
        hasApprovedDeposit: !!(await withDb(async (c) => {
          const { rows } = await c.query('SELECT 1 FROM user_tier_deposits WHERE username=$1 AND tier=$2 AND status=$3 LIMIT 1', [username, tier, 'approved']);
          return rows.length > 0;
        })),
        cycleWeek: cycle.cycle_week,
        totalWithdrawn: cycle.total_withdrawn,
        weeklyWithdrawn: cycle.weekly_withdrawn,
        canWithdraw: canWd.can,
        withdrawReason: canWd.reason,
        referralsCount: refCheck.count,
        requiredReferrals: 3,
      };
    }

    res.json({ success: true, username, tiers: tierStatus });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ TELEGRAM SUPPORT BOT ============
const { setupSupportRoutes } = require('./supportRoutes');
setupSupportRoutes(app, withDb, authenticateToken, requireAdmin);

// Setup Telegram webhook (always enable)
try {
  const { setupWebhook } = require('./telegramBot');
  setupWebhook(app, '/webhook/telegram');
  console.log('[TELEGRAM] Support bot enabled');
} catch (e) {
  console.error('[TELEGRAM] Init failed:', e.message);
}

// ============ AUTO-BUILD FRONTEND ============
// Build frontend on startup if public folder is missing or stale
const PUBLIC_DIR = path.join(__dirname, 'public');
(function autoBuild() {
  try {
    const publicHtml = path.join(PUBLIC_DIR, 'index.html');
    // Rebuild if index.html references old bundle or doesn't exist
    let needsRebuild = !fs.existsSync(publicHtml);
    if (!needsRebuild) {
      const html = fs.readFileSync(publicHtml, 'utf8');
      // If index.html references a JS file that doesn't exist in public/assets, rebuild
      const jsMatch = html.match(/src="\/assets\/(index-[A-Za-z0-9]+\.js)"/);
      if (jsMatch) {
        const jsFile = path.join(PUBLIC_DIR, 'assets', jsMatch[1]);
        if (!fs.existsSync(jsFile)) needsRebuild = true;
      }
    }
    if (needsRebuild) {
      console.log('[AUTO-BUILD] Rebuilding frontend...');
      const { execSync } = require('child_process');
      execSync('cd frontend && npm run build && cp -r dist/* ../public/', { stdio: 'inherit', timeout: 120000 });
      console.log('[AUTO-BUILD] Frontend rebuilt OK');
    } else {
      console.log('[AUTO-BUILD] Public folder up to date, skipping rebuild');
    }
  } catch (e) {
    console.error('[AUTO-BUILD] Failed:', e.message);
  }
})();

// ============ STATIC FILES ============

// Serve static assets with no-cache
app.use(express.static(PUBLIC_DIR, { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); } }));

// SPA catch-all (exclude /api/, /assets/, and /webhook/)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/assets/') && !req.path.startsWith('/webhook/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    // Read index.html and inline the JS/CSS
    try {
      const htmlPath = path.join(PUBLIC_DIR, 'index.html');
      let html = fs.readFileSync(htmlPath, 'utf8');
      // Inline JS
      const jsFiles = fs.readdirSync(path.join(PUBLIC_DIR, 'assets')).filter(f => f.endsWith('.js'));
      if (jsFiles.length > 0) {
        const jsContent = fs.readFileSync(path.join(PUBLIC_DIR, 'assets', jsFiles[0]), 'utf8');
        html = html.replace(/<script[^>]*src="\/assets\/[^"]*"[^>]*><\/script>/, `<script type="module">${jsContent}</script>`);
      }
      // Inline CSS
      const cssFiles = fs.readdirSync(path.join(PUBLIC_DIR, 'assets')).filter(f => f.endsWith('.css'));
      if (cssFiles.length > 0) {
        const cssContent = fs.readFileSync(path.join(PUBLIC_DIR, 'assets', cssFiles[0]), 'utf8');
        html = html.replace(/<link[^>]*href="\/assets\/[^"]*\.css"[^>]*>/, `<style>${cssContent}</style>`);
      }
      res.send(html);
    } catch (e) {
      console.error('[INLINE] Error:', e.message);
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    }
  } else {
    next();
  }
});

// ============ Global Error Handler ============
app.use((err, req, res, next) => { console.error('[ERROR]', err.message); res.status(500).json({ success: false, message: 'Internal error: ' + err.message }); });

// ============ START ============
const server = app.listen(PORT, '0.0.0.0', () => { console.log('Trading Platform v5.8 - Tier Isolation System running on port ' + PORT); });
server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
// Force rebuild Fri Jun 19 01:42:40 AM EEST 2026
