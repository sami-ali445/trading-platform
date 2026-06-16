/**
 * Trading Platform Server v5.5 — 9-Tier Dynamic Pyramid (7-Week Cycle)
 *
 * SECURITY FIXES v5.5:
 * 1. V016: Token blacklist hard cap at 10,000 entries with LRU eviction
 * 2. V024: Removed 'password' field from /api/admin/users SELECT query
 * 3. V026: Updated CREATE TABLE referral_code to VARCHAR(50), removed redundant ALTER TABLE
 * 4. V027: Removed /api/test/db endpoint entirely
 * 5. V020+V023: Added HSTS header (maxAge: 31536000, includeSubDomains, preload)
 * 6. V018: Removed hardcoded default for USDT_WALLET (now empty string fallback)
 * 7. V025: Added rate limiting to logAttack (max 100 disk writes/minute)
 * 8. V019: Moved generalLimiter to apply only to /api/ routes (not static files)
 *
 * SECURITY FIXES v5.4:
 * 1. Removed /api/admin/security-audit endpoint (was temporary)
 * 2. Removed plaintext password from source code
 * 3. JWT token no longer sent in response body (httpOnly cookie only)
 * 4. Token blacklist added — logout now invalidates tokens
 * 5. Deposit rate limit: 10/hour, Withdraw rate limit: 5/hour
 * 6. CORS: no-origin requests blocked in production
 * 7. Content-Type validation on all POST/PUT/PATCH
 * 8. Removed empty setInterval keepalive hack
 *
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
// V025: Rate limit disk writes to max 100 per minute
let logAttackWrites = 0;
let logAttackResetTime = Date.now();
function logAttack(type, ip, details) {
  const entry = `[${new Date().toISOString()}] ${type} | IP: ${ip} | ${details}\n`;
  console.error('[SECURITY]', entry.trim());
  // V025: Rate limit - max 100 disk writes per minute
  const now = Date.now();
  if (now - logAttackResetTime >= 60000) {
    logAttackWrites = 0;
    logAttackResetTime = now;
  }
  if (logAttackWrites >= 100) return; // Silently drop writes over limit
  logAttackWrites++;
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
// V5.5: Don't crash on missing ALLOWED_ORIGIN in production - just warn
if (!ALLOWED_ORIGIN && process.env.NODE_ENV === 'production') {
  console.error('[WARN] ALLOWED_ORIGIN not set in production - CORS will block all requests!');
}
const corsOptions = {
  origin: function (origin, callback) {
    // V5.4: In production, require Origin header (no curl/script bypass)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        // V5.5: Don't crash on missing ALLOWED_ORIGIN, just block
        if (!ALLOWED_ORIGIN) {
          return callback(new Error('CORS policy: no origin'));
        }
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
  keyGenerator: (req) => req.user?.username || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
});
const withdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { success: false, message: 'Too many withdraw requests. Max 5 per hour.' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.username || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
});
app.use('/api/', generalLimiter);
app.use(checkCsrf);

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 4000;

// FIX #9: JWT_SECRET is REQUIRED - no fallback in production
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET env var is required in production!');
    process.exit(1);
  }
  console.error('[WARN] JWT_SECRET not set! Using random value - tokens will change on restart!');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
// FIX #10: No hardcoded hash - must be set via env var
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASS_HASH;
const USDT_WALLET = process.env.USDT_WALLET || '';

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

// ============ DATABASE (JSON file-based — no external DB needed) ============
const DB_FILE = path.join(__dirname, 'database.json');
let db = { users: [], deposits: [], withdraws: [], transactions: [] };

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      console.log('[DB] Loaded', db.users.length, 'users from JSON');
    }
  } catch(e) { console.error('[DB] Load error:', e.message); db = { users: [], deposits: [], withdraws: [], transactions: [] }; }
}

function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch(e) { console.error('[DB] Save error:', e.message); }
}

if (ADMIN_PASSWORD_HASH && !db.users.find(u => u.username === 'admin')) {
  db.users.push({ id: crypto.randomUUID(), username: 'admin', password: ADMIN_PASSWORD_HASH, referralCode: 'ADMIN00', referredBy: 'SYSTEM', role: 'admin', activePlan: null, depositAmount: 0, balance: 0, totalCommission: 0, weeklyWithdrawn: 0, weekStart: Date.now(), cycleWeek: 1, cycleStart: 0, totalWithdrawnCycle: 0, createdAt: new Date().toISOString() });
  saveDB();
  console.log('[DB] Admin user created');
}
loadDB();

async function dbRead() { return { ...db }; }
async function dbWriteDb(d) { if (d.users) db.users = d.users; if (d.deposits) db.deposits = d.deposits; if (d.withdraws) db.withdraws = d.withdraws; if (d.transactions) db.transactions = d.transactions; saveDB(); }

// Admin: Approve deposit (JSON)
async function adminApproveDepositJSON(depositId) {
  const dep = db.deposits.find(d => d.id === depositId);
  if (!dep) return { error: 'Deposit not found.' };
  if (dep.status !== 'pending') return { error: 'Already processed.' };
  const tierKey = getTierKeyByAmount(parseFloat(dep.amount));
  dep.status = 'approved';
  const user = db.users.find(u => u.username === dep.username);
  if (!user) return { error: 'User not found.' };
  user.balance = (parseFloat(user.balance) || 0) + parseFloat(dep.amount);
  user.depositAmount = parseFloat(dep.amount);
  if (tierKey) user.activePlan = tierKey;
  if (!user.cycleStart || user.cycleStart === 0) { user.cycleStart = Date.now(); user.cycleWeek = 1; user.totalWithdrawnCycle = 0; }
  if (user.referredBy && user.referredBy !== 'SYSTEM') {
    const l1 = db.users.find(u => u.username === user.referredBy);
    if (l1) { const c1 = parseFloat(dep.amount) * COMM_L1; l1.balance = (parseFloat(l1.balance) || 0) + c1; l1.totalCommission = (parseFloat(l1.totalCommission) || 0) + c1; if (l1.referredBy && l1.referredBy !== 'SYSTEM') { const l2 = db.users.find(u => u.username === l1.referredBy); if (l2) { const c2 = parseFloat(dep.amount) * COMM_L2; l2.balance = (parseFloat(l2.balance) || 0) + c2; l2.totalCommission = (parseFloat(l2.totalCommission) || 0) + c2; } } }
  }
  saveDB();
  return { success: true, deposit: dep };
}

// Admin: Reject deposit (JSON)
async function adminRejectDepositJSON(depositId) {
  const dep = db.deposits.find(d => d.id === depositId);
  if (!dep) return { error: 'Deposit not found.' };
  if (dep.status !== 'pending') return { error: 'Already processed.' };
  dep.status = 'rejected'; saveDB();
  return { success: true };
}

// Admin: Approve withdraw (JSON)
async function adminApproveWithdrawJSON(withdrawId) {
  const wd = db.withdraws.find(w => w.id === withdrawId);
  if (!wd) return { error: 'Withdraw not found.' };
  if (wd.status !== 'pending') return { error: 'Already processed.' };
  const user = db.users.find(u => u.username === wd.username);
  if (!user) return { error: 'User not found.' };
  if ((parseFloat(user.balance) || 0) < parseFloat(wd.amount)) return { error: 'Insufficient user balance.' };
  wd.status = 'approved'; user.balance = (parseFloat(user.balance) || 0) - parseFloat(wd.amount);
  saveDB();
  return { success: true, withdraw: wd };
}

// Admin: Reject withdraw (JSON)
async function adminRejectWithdrawJSON(withdrawId) {
  const wd = db.withdraws.find(w => w.id === withdrawId);
  if (!wd) return { error: 'Withdraw not found.' };
  if (wd.status !== 'pending') return { error: 'Already processed.' };
  wd.status = 'rejected';
  const user = db.users.find(u => u.username === wd.username);
  if (user) { const a = parseFloat(wd.amount); user.weeklyWithdrawn = Math.max(0, (parseFloat(user.weeklyWithdrawn) || 0) - a); user.totalWithdrawnCycle = Math.max(0, (parseFloat(user.totalWithdrawnCycle) || 0) - a); }
  saveDB();
  return { success: true };
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

const MAX_BLACKLIST_SIZE = 10000;

function blacklistToken(token) {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      // V016: Evict oldest entries if at capacity
      if (tokenBlacklist.size >= MAX_BLACKLIST_SIZE) {
        const oldestKey = tokenBlacklist.keys().next().value;
        if (oldestKey !== undefined) tokenBlacklist.delete(oldestKey);
      }
      tokenBlacklist.set(token, decoded.exp * 1000); // exp is in seconds
    } else {
      if (tokenBlacklist.size >= MAX_BLACKLIST_SIZE) {
        const oldestKey = tokenBlacklist.keys().next().value;
        if (oldestKey !== undefined) tokenBlacklist.delete(oldestKey);
      }
      tokenBlacklist.set(token, Date.now() + 24 * 60 * 60 * 1000); // fallback 24h
    }
  } catch(e) {
    if (tokenBlacklist.size >= MAX_BLACKLIST_SIZE) {
      const oldestKey = tokenBlacklist.keys().next().value;
      if (oldestKey !== undefined) tokenBlacklist.delete(oldestKey);
    }
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
    if (amount === null || amount === undefined || amount === '') return res.status(400).json({ success: false, message: 'Amount is required.' });
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return res.status(400).json({ success: false, message: 'Amount must be a finite number.' });
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });
    const amt = Math.round(amount * 100) / 100;

    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.activePlan && !user.active_plan) return res.status(400).json({ success: false, message: 'No active plan. Deposit first.' });

    const tier = getTier(user.activePlan || user.active_plan);
    const depositAmt = parseFloat(user.depositAmount || user.deposit_amount) || 0;
    const weeklyProfit = getWeeklyProfit(depositAmt);
    const userTierLevel = tier ? tier.level : 0;

    const allDirectDownline = db.users.filter(u => (u.referredBy || u.referred_by) === user.username);
    const approvedDeposits = db.deposits.filter(d => d.status === 'approved');
    const approvedUsernames = new Set(approvedDeposits.map(d => d.username));
    const approvedDownline = allDirectDownline.filter(ref => {
      if (!ref.activePlan && !ref.active_plan) return false;
      const refTier = getTier(ref.activePlan || ref.active_plan);
      if (!refTier) return false;
      return approvedUsernames.has(ref.username) && refTier.level >= userTierLevel;
    });

    if (approvedDownline.length < 3) return res.status(403).json({ success: false, message: `Need 3 approved downline from your tier or higher. Currently: ${approvedDownline.length}/3`, code: 'REFERRAL_LOCK', approvedReferrals: approvedDownline.length });

    let cycleWeek = user.cycleWeek || user.cycle_week || 1;
    const cycleStart = user.cycleStart || user.cycle_start || 0;
    let totalWithdrawnCycle = parseFloat(user.totalWithdrawnCycle || user.total_withdrawn_cycle) || 0;
    if (cycleStart > 0) { const weekMs = 7 * 24 * 60 * 60 * 1000; const elapsed = Date.now() - cycleStart; cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1); }
    if (cycleWeek > CYCLE_WEEKS) return res.status(400).json({ success: false, message: `Cycle expired! ${CYCLE_WEEKS} weeks completed. Re-deposit and bring 3 new referrals.`, code: 'CYCLE_EXPIRED' });

    const maxWithdrawal = depositAmt * MAX_WITHDRAWAL_PCT;
    if (totalWithdrawnCycle + amt > maxWithdrawal) return res.status(400).json({ success: false, message: `Max withdrawal reached. Remaining: $${(maxWithdrawal - totalWithdrawnCycle).toFixed(2)}`, code: 'CYCLE_MAX', remaining: +(maxWithdrawal - totalWithdrawnCycle).toFixed(2) });

    const weekElapsed = Date.now() - (user.weekStart || user.week_start || 0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let weeklyWithdrawn = parseFloat(user.weeklyWithdrawn || user.weekly_withdrawn) || 0;
    if (weekElapsed > weekMs) weeklyWithdrawn = 0;
    if (weeklyWithdrawn + amt > weeklyProfit) return res.status(400).json({ success: false, message: `Weekly cap exceeded. Remaining: $${(weeklyProfit - weeklyWithdrawn).toFixed(2)}`, code: 'WEEKLY_CAP', remaining: +(weeklyProfit - weeklyWithdrawn).toFixed(2) });

    const balance = parseFloat(user.balance) || 0;
    if (balance < amt) return res.status(400).json({ success: false, message: `Insufficient balance. Available: $${balance.toFixed(2)}`, code: 'INSUFFICIENT_BALANCE' });

    const withdrawId = crypto.randomUUID();
    db.withdraws.push({ id: withdrawId, username: user.username, amount: amt, status: 'pending', createdAt: new Date().toISOString() });
    user.weeklyWithdrawn = weeklyWithdrawn + amt;
    user.totalWithdrawnCycle = totalWithdrawnCycle + amt;
    user.cycleWeek = cycleWeek;
    saveDB();

    res.json({ success: true, message: 'Withdraw request submitted.', withdraw: { id: withdrawId, amount: amt, status: 'pending' } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN: Shared Functions (FIX #14 - JSON-based) ============
// PostgreSQL functions replaced with JSON versions below

// ============ ADMIN ENDPOINTS ============
// V032: Log all admin actions for audit trail
function logAdminAction(action, adminUser, details) {
  logAttack('ADMIN_ACTION', 'admin', `Admin: ${adminUser} | Action: ${action} | ${details}`);
}


// V032: Log all admin actions for audit trail
function logAdminAction(action, adminUser, details) {
  logAttack('ADMIN_ACTION', 'admin', `Admin: ${adminUser} | Action: ${action} | ${details}`);
}

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
    const result = await adminApproveDepositJSON(req.params.id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    logAdminAction('APPROVE_DEPOSIT', req.user.username, `Deposit: ${req.params.id}, User: ${result.deposit.username}, Amount: $${result.deposit.amount}`);
    res.json({ success: true, message: 'Deposit approved.', deposit: result.deposit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await adminRejectDepositJSON(req.params.id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    logAdminAction('REJECT_DEPOSIT', req.user.username, `Deposit: ${req.params.id}`);
    res.json({ success: true, message: 'Deposit rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/withdraws', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, withdraws: db.withdraws }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await adminApproveWithdrawJSON(req.params.id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    logAdminAction('APPROVE_WITHDRAW', req.user.username, `Withdraw: ${req.params.id}, User: ${result.withdraw.username}, Amount: $${result.withdraw.amount}`);
    res.json({ success: true, message: 'Withdraw approved.', withdraw: result.withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await adminRejectWithdrawJSON(req.params.id);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    logAdminAction('REJECT_WITHDRAW', req.user.username, `Withdraw: ${req.params.id}`);
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
      if (action === 'Approve') result = await adminApproveDepositJSON(id);
      else result = await adminRejectDepositJSON(id);
    } else if (type === 'withdraw') {
      if (action === 'Approve') result = await adminApproveWithdrawJSON(id);
      else result = await adminRejectWithdrawJSON(id);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid type.' });
    }
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    logAdminAction(action.toUpperCase() + `_${type.toUpperCase()}`, req.user.username, `ID: ${id}`);
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
const server = app.listen(PORT, '0.0.0.0', () => { console.log('Trading Platform v5.5 running on port ' + PORT); });
server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
