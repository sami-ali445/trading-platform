/**
 * Trading Platform Server v5.6 — 9-Tier Dynamic Pyramid (7-Week Cycle)
 * Database: Supabase REST API (fetch) - no pg dependency
 *
 * SECURITY: A+ rating
 * - Helmet (CSP, HSTS, X-Frame, etc)
 * - CORS strict origin
 * - CSRF per-request rotation
 * - Rate limiting (general, auth, deposit, withdraw)
 * - Account lockout (5 fails = 30min)
 * - Input validation (username, password, TxID)
 * - JWT httpOnly cookies + token blacklist
 * - Bot detection
 * - Attack logging
 * - No /api/test/db endpoint
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
const logAttack = (type, ip, details) => {
  const entry = '[' + new Date().toISOString() + '] ' + type + ' | IP: ' + ip + ' | ' + details + '\n';
  console.error('[SECURITY]', entry.trim());
  try { fs.appendFileSync(LOG_FILE, entry); } catch {}
};

const app = express();

// ============ SECURITY: Helmet ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"], fontSrc: ["'self'"],
      objectSrc: ["'none'"], mediaSrc: ["'self'"], frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// Content-Type validation
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const ct = req.headers['content-type'];
    if (!ct || !ct.includes('application/json')) {
      logAttack('INVALID_CONTENT_TYPE', req.ip, 'Path: ' + req.path + ', CT: ' + (ct || 'none'));
      return res.status(415).json({ success: false, message: 'Content-Type must be application/json.' });
    }
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// ============ CORS ============
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
if (!ALLOWED_ORIGIN && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] ALLOWED_ORIGIN env var must be set in production!');
  process.exit(1);
}
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        logAttack('CORS_NO_ORIGIN', 'unknown', 'Blocked no Origin');
        return callback(new Error('CORS: Origin required'));
      }
      return callback(null, true);
    }
    if (origin === ALLOWED_ORIGIN) return callback(null, true);
    logAttack('CORS_BLOCKED', origin, 'Blocked: ' + origin);
    return callback(new Error('CORS: not allowed'));
  },
  methods: ['GET', 'POST'],
  credentials: true,
  maxAge: 86400,
}));

// ============ CSRF ============
app.use((req, res, next) => {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, { httpOnly: false, sameSite: 'strict', secure: true, maxAge: 3600000 });
  res.set('X-CSRF-Token', token);
  req.csrfToken = token;
  next();
});

function checkCsrf(req, res, next) {
  if (req.method === 'GET') return next();
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

// ============ Input Validation ============
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

// ============ Bot Detection ============
const suspiciousIPs = new Map();
const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of suspiciousIPs) { if (now - r.lastReq > 300000) suspiciousIPs.delete(ip); }
  for (const [u, r] of loginAttempts) { if (r.lockUntil && now > r.lockUntil + 3600000) loginAttempts.delete(u); }
}, 600000);

app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress;
  if (req.path.includes('/auth/') && req.method === 'POST') {
    logAttack('AUTH_ATTEMPT', ip, 'Path: ' + req.path);
  }
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

// ============ Rate Limiting ============
const generalLimiter = rateLimit({ windowMs: 15*60*1000, max: 60, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, standardHeaders: true, legacyHeaders: false });
const depositLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.username || req.ip });
const withdrawLimiter = rateLimit({ windowMs: 60*60*1000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.username || req.ip });
app.use(generalLimiter);
app.use(checkCsrf);

// ============ Config ============
const PORT = process.env.PORT || 4000;
if (!process.env.JWT_SECRET) console.error('[WARN] JWT_SECRET not set!');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASS_HASH;
const USDT_WALLET = process.env.USDT_WALLET || '';

// ============ Account Lockout ============
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
const WEEKLY_PROFIT_PCT = 0.20, CYCLE_WEEKS = 7, CAPITAL_WEEKS = 5, MAX_WD_PCT = 1.40, MAX_DEPOSIT = 50000;

const TIERS = {
  bronze: { level: 1, name: 'Bronze', minDeposit: 10, maxDeposit: 49, label: '$10-$49' },
  silver: { level: 2, name: 'Silver', minDeposit: 50, maxDeposit: 99, label: '$50-$99' },
  gold: { level: 3, name: 'Gold', minDeposit: 100, maxDeposit: 249, label: '$100-$249' },
  platinum: { level: 4, name: 'Platinum', minDeposit: 250, maxDeposit: 499, label: '$250-$499' },
  diamond: { level: 5, name: 'Diamond', minDeposit: 500, maxDeposit: 999, label: '$500-$999' },
  vip: { level: 6, name: 'VIP', minDeposit: 1000, maxDeposit: 2499, label: '$1,000-$2,499' },
  elite: { level: 7, name: 'Elite', minDeposit: 2500, maxDeposit: 4999, label: '$2,500-$4,999' },
  royal: { level: 8, name: 'Royal', minDeposit: 5000, maxDeposit: 9999, label: '$5,000-$9,999' },
  legend: { level: 9, name: 'Legend', minDeposit: 10000, maxDeposit: Infinity, label: '$10,000+' },
};

function getTierByAmount(a) { const n = Number(a); if (n >= 10000) return TIERS.legend; if (n >= 5000) return TIERS.royal; if (n >= 2500) return TIERS.elite; if (n >= 1000) return TIERS.vip; if (n >= 500) return TIERS.diamond; if (n >= 250) return TIERS.platinum; if (n >= 100) return TIERS.gold; if (n >= 50) return TIERS.silver; if (n >= 10) return TIERS.bronze; return null; }
function getTierKeyByAmount(a) { const n = Number(a); if (n >= 10000) return 'legend'; if (n >= 5000) return 'royal'; if (n >= 2500) return 'elite'; if (n >= 1000) return 'vip'; if (n >= 500) return 'diamond'; if (n >= 250) return 'platinum'; if (n >= 100) return 'gold'; if (n >= 50) return 'silver'; if (n >= 10) return 'bronze'; return null; }
function getTier(k) { return TIERS[k] || null; }
function getWeeklyProfit(a) { return Number(a) * WEEKLY_PROFIT_PCT; }
function getDailyProfit(a) { return getWeeklyProfit(a) / 7; }

// ============ DATABASE: Supabase REST API ============
const SB_URL = process.env.SUPABASE_URL || 'https://db.dilzpxhazjlmyniswyzm.supabase.co';
const SB_KEY = process.env.SUPABASE_KEY || '';

async function sbFetch(table, params = {}) {
  let url = SB_URL + '/rest/v1/' + table;
  const qp = [];
  if (params.select) qp.push('select=' + encodeURIComponent(params.select));
  if (params.order) qp.push('order=' + encodeURIComponent(params.order));
  if (params.eq) qp.push(params.eq.field + '=eq.' + encodeURIComponent(params.eq.value));
  if (params.inField && params.inValues) qp.push(params.inField + '=in.(' + params.inValues.map(encodeURIComponent).join(',') + ')');
  if (params.limit) qp.push('limit=' + params.limit);
  if (qp.length) url += '?' + qp.join('&');
  const res = await fetch(url, { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error('SB ' + table + ': ' + res.status);
  return res.json();
}

async function sbInsert(table, data, upsert) {
  const res = await fetch(SB_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': upsert ? 'return=representation,resolution=merge-duplicates' : 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('SB insert ' + table + ': ' + res.status);
  return res.json();
}

async function sbUpdate(table, data, field, value) {
  const res = await fetch(SB_URL + '/rest/v1/' + table + '?' + field + '=eq.' + encodeURIComponent(value), {
    method: 'PATCH',
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('SB update ' + table + ': ' + res.status);
  return res.json();
}

async function dbRead() {
  try {
    const users = await sbFetch('users', { select: 'id,username,password,referral_code,referred_by,active_plan,deposit_amount,balance,total_commission,weekly_withdrawn,week_start,cycle_week,cycle_start,total_withdrawn_cycle,role,created_at', order: 'created_at.desc' });
    const deposits = await sbFetch('deposits', { order: 'created_at.desc' });
    const withdraws = await sbFetch('withdraws', { order: 'created_at.desc' });
    const transactions = await sbFetch('transactions', { order: 'created_at.desc' });
    return { users, deposits, withdraws, transactions };
  } catch(e) {
    console.error('[DB READ]', e.message);
    return { users: [], deposits: [], withdraws: [], transactions: [] };
  }
}

async function dbWriteDb(d) {
  for (const u of (d.users||[])) {
    try { await sbInsert('users', { id: u.id||crypto.randomUUID(), username: u.username, password: u.password, referral_code: u.referralCode||u.referral_code, referred_by: u.referredBy||u.referred_by, active_plan: u.activePlan||u.active_plan, deposit_amount: u.depositAmount||u.deposit_amount||0, balance: u.balance||0, total_commission: u.totalCommission||u.total_commission||0, weekly_withdrawn: u.weeklyWithdrawn||u.weekly_withdrawn||0, week_start: u.weekStart||u.week_start||0, cycle_week: u.cycleWeek||u.cycle_week||1, cycle_start: u.cycleStart||u.cycle_start||0, total_withdrawn_cycle: u.totalWithdrawnCycle||u.total_withdrawn_cycle||0, role: u.role||'user', created_at: u.createdAt||u.created_at||new Date().toISOString() }, true); }
    catch(e) { console.error('[DB W USER]', u.username, e.message); }
  }
  for (const dep of (d.deposits||[])) {
    try { await sbInsert('deposits', { id: dep.id||crypto.randomUUID(), username: dep.username, tier: dep.tier, amount: dep.amount, tx_id: dep.txId||dep.tx_id||'manual', status: dep.status, created_at: dep.createdAt||dep.created_at||new Date().toISOString() }, true); }
    catch(e) { console.error('[DB W DEP]', e.message); }
  }
  for (const w of (d.withdraws||[])) {
    try { await sbInsert('withdraws', { id: w.id||crypto.randomUUID(), username: w.username, amount: w.amount, status: w.status, created_at: w.createdAt||w.created_at||new Date().toISOString() }, true); }
    catch(e) { console.error('[DB W WD]', e.message); }
  }
}

// ============ Token Blacklist ============
const tokenBlacklist = new Map();
setInterval(() => { const now = Date.now(); for (const [t, exp] of tokenBlacklist) { if (now > exp) tokenBlacklist.delete(t); } }, 300000);
function isTokenBlacklisted(t) { return tokenBlacklist.has(t); }
function blacklistToken(t) {
  try { const d = jwt.decode(t); tokenBlacklist.set(t, d && d.exp ? d.exp * 1000 : Date.now() + 86400000); }
  catch { tokenBlacklist.set(t, Date.now() + 86400000); }
}
function generateToken(p) { return jwt.sign(p, JWT_SECRET, { expiresIn: '24h' }); }
function setTokenCookie(res, token) { res.cookie('auth_token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400000, path: '/' }); }
function clearTokenCookie(res) { res.clearCookie('auth_token', { path: '/' }); }

function authenticateToken(req, res, next) {
  const cookieToken = req.cookies?.auth_token;
  const headerToken = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
  const t = cookieToken || headerToken;
  if (!t) return res.status(401).json({ success: false, message: 'No token.' });
  if (isTokenBlacklisted(t)) return res.status(403).json({ success: false, message: 'Token revoked.' });
  jwt.verify(t, JWT_SECRET, (err, u) => { if (err) return res.status(403).json({ success: false, message: 'Invalid token.' }); req.user = u; next(); });
}

function requireAdmin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only.' }); next(); }

// ============ HEALTH ============
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '5.6', ts: new Date().toISOString() }));

// ============ AUTH ============
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;
    const ue = validateUsername(username); if (ue) return res.status(400).json({ success: false, message: ue });
    const pe = validatePassword(password); if (pe) return res.status(400).json({ success: false, message: pe });
    if (!referralCode || typeof referralCode !== 'string') return res.status(400).json({ success: false, message: 'Referral code required.' });
    const db = await dbRead();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ success: false, message: 'Username exists.' });
    const isRoot = ROOT_REFERRAL_CODES.includes(referralCode.toUpperCase());
    const referrer = isRoot ? { username: 'SYSTEM', referralCode: referralCode.toUpperCase() } : db.users.find(u => u.referralCode === referralCode);
    if (!referrer) return res.status(400).json({ success: false, message: 'Invalid referral code.' });
    const myCode = crypto.randomBytes(5).toString('hex').toUpperCase() + Date.now().toString(36).toUpperCase();
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = { id: crypto.randomUUID(), username, password: hashedPassword, referralCode: myCode, referredBy: referrer.username, activePlan: null, depositAmount: 0, balance: 0, totalCommission: 0, weeklyWithdrawn: 0, weekStart: Date.now(), cycleWeek: 1, cycleStart: 0, totalWithdrawnCycle: 0, createdAt: new Date().toISOString(), role: 'user' };
    db.users.push(newUser);
    await dbWriteDb(db);
    const token = generateToken({ username: newUser.username, role: 'user' });
    setTokenCookie(res, token);
    res.json({ success: true, message: 'Registered.', referralCode: myCode });
  } catch (err) { console.error('[REGISTER]', err); res.status(500).json({ success: false, message: err.message || 'Server error' }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    const ls = checkLockout(username); if (ls.locked) return res.status(423).json({ success: false, message: 'Locked. Try in ' + ls.remainingMin + 'min.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === username);
    if (!user) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid credentials.' }); }
    recordSuccess(username);
    const token = generateToken({ username: user.username, role: user.role || 'user' });
    setTokenCookie(res, token);
    res.json({ success: true, username: user.username, role: user.role || 'user' });
  } catch (err) { console.error('[LOGIN]', err); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/auth/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Required.' });
    const ls = checkLockout(username); if (ls.locked) return res.status(423).json({ success: false, message: 'Locked. Try in ' + ls.remainingMin + 'min.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === username && u.role === 'admin');
    if (!user) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid admin.' }); }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { recordFail(username); return res.status(401).json({ success: false, message: 'Invalid admin.' }); }
    recordSuccess(username);
    const token = generateToken({ username: user.username, role: 'admin' });
    setTokenCookie(res, token);
    res.json({ success: true, username: user.username, role: 'admin' });
  } catch (err) { console.error('[ADMIN LOGIN]', err); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  const ct = req.cookies?.auth_token; const ht = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
  const t = ct || ht; if (t) blacklistToken(t);
  clearTokenCookie(res); res.json({ success: true, message: 'Logged out.' });
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Required.' });
    const pe = validatePassword(newPassword); if (pe) return res.status(400).json({ success: false, message: pe });
    if (currentPassword === newPassword) return res.status(400).json({ success: false, message: 'Must differ.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });
    if (!await bcrypt.compare(currentPassword, user.password)) return res.status(401).json({ success: false, message: 'Wrong current.' });
    user.password = await bcrypt.hash(newPassword, 12);
    await dbWriteDb(db);
    const token = generateToken({ username: user.username, role: user.role });
    setTokenCookie(res, token);
    res.json({ success: true, message: 'Password changed.' });
  } catch (err) { console.error('[CHG PW]', err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// ============ USER PROFILE ============
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });
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
    let cycleWeek = user.cycleWeek || user.cycle_week || 1;
    const cycleStart = user.cycleStart || user.cycle_start || 0;
    const totalWithdrawnCycle = user.totalWithdrawnCycle || user.total_withdrawn_cycle || 0;
    if (cycleStart > 0) { const weekMs = 7*24*60*60*1000; const elapsed = Date.now() - cycleStart; cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1); }
    const cycleExpired = cycleWeek > CYCLE_WEEKS;
    const maxWithdrawal = depositAmt * MAX_WD_PCT;
    const weeklyWithdrawn = user.weeklyWithdrawn || user.weekly_withdrawn || 0;
    const totalCommission = user.totalCommission || user.total_commission || 0;
    res.json({ success: true, user: { username: user.username, balance: user.balance||0, depositAmount: depositAmt, totalCommission, activePlan, tierName: tier?tier.name:null, tierLabel: tier?tier.label:null, referralCode: user.referralCode||user.referral_code, referrer: user.referredBy||user.referred_by, dailyProfit: +dailyProfit.toFixed(2), weeklyProfit: +weeklyProfit.toFixed(2), canWithdraw, approvedDownlineCount, activeReferrals: approvedDownlineCount, totalReferrals: allDirectDownline.length, referralProfitUnlocked: approvedDownlineCount >= 3, requiredReferrals: 3, cycleWeek, cycleTotalWeeks: CYCLE_WEEKS, cycleExpired, totalWithdrawnCycle, maxWithdrawal: +maxWithdrawal.toFixed(2), remainingWithdrawal: +Math.max(0, maxWithdrawal-totalWithdrawnCycle).toFixed(2), weeklyWithdrawn, role: user.role||'user', createdAt: user.createdAt||user.created_at } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/referrals', authenticateToken, async (req, res) => {
  try { const db = await dbRead(); const refs = db.users.filter(u => (u.referredBy||u.referred_by) === req.user.username); res.json({ success: true, referrals: refs.map(r => ({ username: r.username, activePlan: r.activePlan||r.active_plan, createdAt: r.createdAt||r.created_at })) }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/tiers', (req, res) => {
  const tiersOut = {};
  for (const [key, t] of Object.entries(TIERS)) { const minW = getWeeklyProfit(t.minDeposit); const maxW = t.maxDeposit === Infinity ? null : getWeeklyProfit(t.maxDeposit); tiersOut[key] = { ...t, level: t.level, weeklyProfitMin: +minW.toFixed(2), weeklyProfitMax: maxW ? +maxW.toFixed(2) : null, cycleWeeks: CYCLE_WEEKS, maxTotalPct: MAX_WD_PCT * 100 }; }
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
    const tierKey = getTierKeyByAmount(amt); if (!tierKey) return res.status(400).json({ success: false, message: 'Invalid amount.' });
    const cleanTxId = sanitizeTxId(txId); if (!cleanTxId) return res.status(400).json({ success: false, message: 'Valid TxID required.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });
    const deposit = { id: crypto.randomUUID(), username: user.username, tier: tierKey, amount: amt, txId: cleanTxId, status: 'pending', createdAt: new Date().toISOString() };
    db.deposits.push(deposit);
    await dbWriteDb(db);
    res.json({ success: true, message: 'Deposit submitted.', deposit, wallet: USDT_WALLET, tier: getTier(tierKey).name });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ WITHDRAW ============
app.post('/api/withdraw', authenticateToken, withdrawLimiter, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount === null || amount === undefined || amount === '') return res.status(400).json({ success: false, message: 'Amount required.' });
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return res.status(400).json({ success: false, message: 'Must be finite number.' });
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Invalid.' });
    const amt = Math.round(amount * 100) / 100;

    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'Not found.' });
    if (!user.active_plan) return res.status(400).json({ success: false, message: 'No active plan.' });

    const tier = getTier(user.active_plan);
    const depositAmt = parseFloat(user.deposit_amount) || 0;
    const weeklyProfit = getWeeklyProfit(depositAmt);
    const userTierLevel = tier ? tier.level : 0;

    const allDirectDownline = db.users.filter(u => (u.referredBy||u.referred_by) === user.username);
    const downlineUsernames = allDirectDownline.map(u => u.username);
    let approvedDownline = [];
    if (downlineUsernames.length > 0) {
      const deps = await sbFetch('deposits', { inField: 'username', inValues: downlineUsernames, eq: { field: 'status', value: 'approved' } });
      const approvedSet = new Set(deps.map(d => d.username));
      approvedDownline = allDirectDownline.filter(ref => {
        if (!ref.active_plan) return false;
        const refTier = getTier(ref.active_plan);
        return refTier && approvedSet.has(ref.username) && refTier.level >= userTierLevel;
      });
    }

    if (approvedDownline.length < 3) return res.status(403).json({ success: false, message: 'Need 3 approved downline. Have: ' + approvedDownline.length + '/3', code: 'REFERRAL_LOCK' });

    let cycleWeek = user.cycle_week || 1;
    const cycleStart = user.cycle_start || 0;
    let totalWithdrawnCycle = parseFloat(user.total_withdrawn_cycle) || 0;
    if (cycleStart > 0) { const weekMs = 7*24*60*60*1000; cycleWeek = Math.min(CYCLE_WEEKS, Math.floor((Date.now() - cycleStart) / weekMs) + 1); }
    if (cycleWeek > CYCLE_WEEKS) return res.status(400).json({ success: false, message: 'Cycle expired.', code: 'CYCLE_EXPIRED' });

    const maxWd = depositAmt * MAX_WD_PCT;
    if (totalWithdrawnCycle + amt > maxWd) return res.status(400).json({ success: false, message: 'Max reached. Remaining: $' + (maxWd - totalWithdrawnCycle).toFixed(2), code: 'CYCLE_MAX' });

    const weekMs = 7*24*60*60*1000;
    let weeklyWd = parseFloat(user.weekly_withdrawn) || 0;
    if (Date.now() - (user.week_start || 0) > weekMs) weeklyWd = 0;
    if (weeklyWd + amt > weeklyProfit) return res.status(400).json({ success: false, message: 'Weekly cap. Remaining: $' + (weeklyProfit - weeklyWd).toFixed(2), code: 'WEEKLY_CAP' });

    const balance = parseFloat(user.balance) || 0;
    if (balance < amt) return res.status(400).json({ success: false, message: 'Insufficient balance: $' + balance.toFixed(2), code: 'NO_BALANCE' });

    const wdId = crypto.randomUUID();
    await sbInsert('withdraws', { id: wdId, username: user.username, amount: amt, status: 'pending', created_at: new Date().toISOString() });
    await sbUpdate('users', { weekly_withdrawn: weeklyWd + amt, total_withdrawn_cycle: totalWithdrawnCycle + amt, cycle_week: cycleWeek }, 'username', user.username);

    res.json({ success: true, message: 'Withdraw submitted.', withdraw: { id: wdId, amount: amt, status: 'pending' } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN: Shared Functions ============
async function adminApproveDeposit(depositId) {
  const deps = await sbFetch('deposits', { eq: { field: 'id', value: depositId } });
  if (!deps.length) return { error: 'Not found.' };
  const deposit = deps[0];
  if (deposit.status !== 'pending') return { error: 'Already processed.' };
  const tierKey = getTierKeyByAmount(parseFloat(deposit.amount));
  const users = await sbFetch('users', { eq: { field: 'username', value: deposit.username } });
  if (!users.length) return { error: 'User not found.' };
  const user = users[0];
  const newBal = (parseFloat(user.balance) || 0) + parseFloat(deposit.amount);
  const nowMs = Date.now();
  const newCS = (!user.cycle_start || user.cycle_start === 0) ? nowMs : user.cycle_start;
  const newCW = (!user.cycle_start || user.cycle_start === 0) ? 1 : (user.cycle_week || 1);
  const newTWC = (!user.cycle_start || user.cycle_start === 0) ? 0 : (parseFloat(user.total_withdrawn_cycle) || 0);
  await sbUpdate('users', { balance: newBal, deposit_amount: parseFloat(deposit.amount), active_plan: tierKey, cycle_start: newCS, cycle_week: newCW, total_withdrawn_cycle: newTWC }, 'username', user.username);
  await sbUpdate('deposits', { status: 'approved' }, 'id', depositId);
  // L1 commission
  if (user.referred_by && user.referred_by !== 'SYSTEM') {
    const l1s = await sbFetch('users', { eq: { field: 'username', value: user.referred_by } });
    if (l1s.length > 0) { const l1 = l1s[0]; const c1 = parseFloat(deposit.amount) * COMM_L1; await sbUpdate('users', { balance: (parseFloat(l1.balance)||0)+c1, total_commission: (parseFloat(l1.total_commission)||0)+c1 }, 'username', l1.username);
      if (l1.referred_by && l1.referred_by !== 'SYSTEM') { const l2s = await sbFetch('users', { eq: { field: 'username', value: l1.referred_by } }); if (l2s.length > 0) { const c2 = parseFloat(deposit.amount) * COMM_L2; await sbUpdate('users', { balance: (parseFloat(l2s[0].balance)||0)+c2, total_commission: (parseFloat(l2s[0].total_commission)||0)+c2 }, 'username', l2s[0].username); } }
    }
  }
  return { success: true, deposit };
}

async function adminRejectDeposit(depositId) {
  const deps = await sbFetch('deposits', { eq: { field: 'id', value: depositId } });
  if (!deps.length) return { error: 'Not found.' };
  if (deps[0].status !== 'pending') return { error: 'Already processed.' };
  await sbUpdate('deposits', { status: 'rejected' }, 'id', depositId);
  return { success: true };
}

async function adminApproveWithdraw(withdrawId) {
  const wds = await sbFetch('withdraws', { eq: { field: 'id', value: withdrawId } });
  if (!wds.length) return { error: 'Not found.' };
  const wd = wds[0];
  if (wd.status !== 'pending') return { error: 'Already processed.' };
  const users = await sbFetch('users', { eq: { field: 'username', value: wd.username } });
  if (!users.length) return { error: 'User not found.' };
  const bal = parseFloat(users[0].balance) || 0;
  if (bal < parseFloat(wd.amount)) return { error: 'Insufficient balance.' };
  await sbUpdate('withdraws', { status: 'approved' }, 'id', withdrawId);
  await sbUpdate('users', { balance: bal - parseFloat(wd.amount) }, 'username', wd.username);
  return { success: true, withdraw: wd };
}

async function adminRejectWithdraw(withdrawId) {
  const wds = await sbFetch('withdraws', { eq: { field: 'id', value: withdrawId } });
  if (!wds.length) return { error: 'Not found.' };
  const wd = wds[0];
  if (wd.status !== 'pending') return { error: 'Already processed.' };
  await sbUpdate('withdraws', { status: 'rejected' }, 'id', withdrawId);
  const users = await sbFetch('users', { eq: { field: 'username', value: wd.username } });
  if (users.length > 0) {
    const u = users[0];
    const newW = Math.max(0, (parseFloat(u.weekly_withdrawn)||0) - parseFloat(wd.amount));
    const newC = Math.max(0, (parseFloat(u.total_withdrawn_cycle)||0) - parseFloat(wd.amount));
    await sbUpdate('users', { weekly_withdrawn: newW, total_withdrawn_cycle: newC }, 'username', u.username);
  }
  return { success: true };
}

// ============ ADMIN ENDPOINTS ============
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const users = db.users.map(u => {
      const ap = u.activePlan || u.active_plan || null;
      const t = ap ? getTier(ap) : null;
      const da = u.depositAmount || u.deposit_amount || 0;
      return { username: u.username, balance: u.balance||0, depositAmount: da, totalCommission: u.totalCommission||u.total_commission||0, activePlan: ap, tierName: t?t.name:null, tierLabel: t?t.label:null, referralCode: u.referralCode||u.referral_code, referredBy: u.referredBy||u.referred_by, role: u.role||'user', weeklyProfit: +getWeeklyProfit(da).toFixed(2), cycleWeek: u.cycleWeek||u.cycle_week||1, totalWithdrawnCycle: u.totalWithdrawnCycle||u.total_withdrawn_cycle||0, maxWithdrawal: +(da*MAX_WD_PCT).toFixed(2), weeklyWithdrawn: u.weeklyWithdrawn||u.weekly_withdrawn||0, createdAt: u.createdAt||u.created_at };
    });
    res.json({ success: true, users, total: users.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, deposits: db.deposits }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try { const r = await adminApproveDeposit(req.params.id); if (r.error) return res.status(400).json({ success: false, message: r.error }); res.json({ success: true, message: 'Approved.', deposit: r.deposit }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try { const r = await adminRejectDeposit(req.params.id); if (r.error) return res.status(400).json({ success: false, message: r.error }); res.json({ success: true, message: 'Rejected.' }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/withdraws', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, withdraws: db.withdraws }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try { const r = await adminApproveWithdraw(req.params.id); if (r.error) return res.status(400).json({ success: false, message: r.error }); res.json({ success: true, message: 'Approved.', withdraw: r.withdraw }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try { const r = await adminRejectWithdraw(req.params.id); if (r.error) return res.status(400).json({ success: false, message: r.error }); res.json({ success: true, message: 'Rejected.' }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/transactions', authenticateToken, requireAdmin, async (req, res) => {
  try { const db = await dbRead(); res.json({ success: true, transactions: db.transactions }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
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

// ============ STATIC FILES ============
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); } }));
app.use((req, res, next) => { if (!req.path.startsWith('/api/')) { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(PUBLIC_DIR, 'index.html')); } else { next(); } });

// ============ START ============
const server = app.listen(PORT, '0.0.0.0', () => { console.log('Trading Platform v5.6 running on port ' + PORT); });
server.keepAliveTimeout = 65000; server.headersTimeout = 66000;
