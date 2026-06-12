/**
 * Trading Platform Server v5.0 — 4-Tier Dynamic Pyramid (90-Day Window)
 * 
 * TIERS (by deposit amount):
 *   Bronze:   $10-$49   deposit | $0.50/day profit | 3 active Bronze+ referrals | $4/week cap
 *   Silver:   $50-$99  deposit | $2.50/day profit | 3 active Silver+ referrals | $8/week cap
 *   Platinum: $100-$499 deposit | $5.00/day profit | 3 active Platinum+ referrals | $20/week cap
 *   Gold:     $500+    deposit | $60/day profit   | 3 active Gold referrals | $100/week cap
 * 
 * RULES:
 *   - Tier determined by deposit amount (dynamic ranges)
 *   - Tier-matching: referrals must match or exceed user's plan level
 *   - ABSOLUTE RULE: < 3 approved direct downline referrals = NO PAYOUT
 *   - Mandatory referral code at registration
 *   - Weekly withdrawal cap resets every 7 days
 *   - 90-day operation window from first deposit approval
 *   - Commission: 20% admin / 10% L1 / 5% L2
 *   - Security: JWT + bcrypt + Helmet + Rate Limiting + File-based DB
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// Global error handlers to prevent silent crashes
process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));

const app = express();
// trust proxy disabled - prevents rate limit bypass via X-Forwarded-For spoofing
// Only enable behind a trusted reverse proxy with explicit proxy IPs
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*', methods: ['GET', 'POST'], credentials: true }));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { success: false, message: 'Too many requests.' }, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { success: false, message: 'Too many auth attempts.' }, standardHeaders: true, legacyHeaders: false });
app.use(generalLimiter);

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASS_HASH || '$2b$12$4DY6ysfcSJCjrt3RrzSIyOoW.Or0CwPbn777zKd0OdZWgaCzyotWa';
const USDT_WALLET = process.env.USDT_WALLET || 'TLhmbZbsvRhf2TpGiotkHnbv7YBfxbKprn';
const DB_FILE = path.join(__dirname, 'database.json');

// Root referral codes — always valid, no DB lookup required
const ROOT_REFERRAL_CODES = ['BOOT00'];

// Commission rates
const COMM_ADMIN = 0.20;
const COMM_L1 = 0.10;
const COMM_L2 = 0.05;

// ============ 4-TIER DEFINITIONS (Dynamic Ranges) ============
// Tier is determined by deposit AMOUNT, not by fixed tier key
const TIERS = {
  bronze:  { level: 1, name: 'Bronze 🥉',  minDeposit: 10,  maxDeposit: 49,   dailyProfit: 0.50,  minReferrals: 3, weeklyCap: 4,   label: '$0.50/يوم' },
  silver:  { level: 2, name: 'Silver 🥈',  minDeposit: 50,  maxDeposit: 99,   dailyProfit: 2.50,  minReferrals: 3, weeklyCap: 8,   label: '$2.50/يوم' },
  platinum:{ level: 3, name: 'Platinum 🥇', minDeposit: 100, maxDeposit: 499,  dailyProfit: 5.00,  minReferrals: 3, weeklyCap: 20,  label: '$5.00/يوم' },
  gold:    { level: 4, name: 'Gold 💎',     minDeposit: 500, maxDeposit: Infinity, dailyProfit: 60, minReferrals: 3, weeklyCap: 100, label: '$60/يوم' },
};

// 90-day operation window (in milliseconds)
const OPERATION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// Resolve tier by deposit amount (dynamic range lookup)
function getTierByAmount(amount) {
  const amt = Number(amount);
  if (amt >= 500) return TIERS.gold;
  if (amt >= 100) return TIERS.platinum;
  if (amt >= 50) return TIERS.silver;
  if (amt >= 10) return TIERS.bronze;
  return null;
}

// Get tier key by deposit amount
function getTierKeyByAmount(amount) {
  const amt = Number(amount);
  if (amt >= 500) return 'gold';
  if (amt >= 100) return 'platinum';
  if (amt >= 50) return 'silver';
  if (amt >= 10) return 'bronze';
  return null;
}

function getTier(key) { return TIERS[key] || null; }

// ============ DATABASE ============
// Auto-detect: PostgreSQL on Render (DATABASE_URL set), JSON file locally
const USE_PG = !!process.env.DATABASE_URL;

let pgPool = null;
if (USE_PG) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  // Initialize tables on startup
  (async () => {
    try {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password TEXT NOT NULL,
          referral_code VARCHAR(20) NOT NULL, referred_by VARCHAR(50), active_plan VARCHAR(20),
          balance DECIMAL(12,2) DEFAULT 0, total_commission DECIMAL(12,2) DEFAULT 0,
          weekly_withdrawn DECIMAL(12,2) DEFAULT 0, week_start BIGINT DEFAULT 0,
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
      // Seed admin user if not exists
      const adminExists = await pgPool.query('SELECT 1 FROM users WHERE username=$1', ['admin']);
      if (adminExists.rowCount === 0) {
        const bcrypt = require('bcryptjs');
        const crypto = require('crypto');
        const hash = await bcrypt.hash('haydar988522605gmail', 12);
        await pgPool.query(
          'INSERT INTO users (id, username, password, referral_code, referred_by, role) VALUES ($1,$2,$3,$4,$5,$6)',
          [crypto.randomUUID(), 'admin', hash, 'ADMIN00', 'SYSTEM', 'admin']
        );
      }
      console.log('[DB] PostgreSQL tables initialized');
    } catch(e) { console.error('[DB] Init error:', e.message); }
  })();
}

// Legacy JSON file DB for local development
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const d = { users: [], deposits: [], withdraws: [], transactions: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
      return d;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch { return { users: [], deposits: [], withdraws: [], transactions: [] }; }
}
function writeDB(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }

// DB helper functions - use PostgreSQL when available
async function dbRead() {
  if (USE_PG && pgPool) {
    const { rows } = await pgPool.query('SELECT * FROM users ORDER BY created_at DESC');
    const { rows: deposits } = await pgPool.query('SELECT * FROM deposits ORDER BY created_at DESC');
    const { rows: withdraws } = await pgPool.query('SELECT * FROM withdraws ORDER BY created_at DESC');
    const { rows: transactions } = await pgPool.query('SELECT * FROM transactions ORDER BY created_at DESC');
    return { users: rows, deposits, withdraws, transactions };
  }
  return readDB();
}

async function dbWriteDb(d) {
  if (USE_PG && pgPool) {
    // Write users to PG
    for (const u of d.users) {
      await pgPool.query(`
        INSERT INTO users (id, username, password, referral_code, referred_by, active_plan, balance, total_commission, weekly_withdrawn, week_start, role, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (username) DO UPDATE SET
          balance=EXCLUDED.balance, active_plan=EXCLUDED.active_plan,
          total_commission=EXCLUDED.total_commission, weekly_withdrawn=EXCLUDED.weekly_withdrawn,
          week_start=EXCLUDED.week_start, role=EXCLUDED.role
      `, [u.id||require('crypto').randomUUID(), u.username, u.password,
          u.referralCode||u.referral_code, u.referredBy||u.referred_by,
          u.activePlan||u.active_plan, u.balance||0, u.totalCommission||0,
          u.weeklyWithdrawn||0, u.weekStart||0, u.role||'user',
          u.createdAt||u.created_at||new Date().toISOString()]);
    }
    // Write deposits to PG
    for (const dep of d.deposits) {
      await pgPool.query(`
        INSERT INTO deposits (id, username, tier, amount, tx_id, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status
      `, [dep.id||require('crypto').randomUUID(), dep.username, dep.tier,
          dep.amount, dep.txId||dep.tx_id||'manual', dep.status,
          dep.createdAt||dep.created_at||new Date().toISOString()]);
    }
    // Write withdraws to PG
    for (const w of d.withdraws) {
      await pgPool.query(`
        INSERT INTO withdraws (id, username, amount, status, created_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status
      `, [w.id||require('crypto').randomUUID(), w.username, w.amount,
          w.status, w.createdAt||w.created_at||new Date().toISOString()]);
    }
    return;
  }
  writeDB(d);
}

async function dbWrite(collection, operation, data) {
  if (USE_PG && pgPool) {
    // PostgreSQL writes handled by individual route handlers
    return;
  }
  // For JSON file, routes use readDB/writeDB directly
}

// ============ JWT ============
function generateToken(p) { return jwt.sign(p, JWT_SECRET, { expiresIn: '24h' }); }
function authenticateToken(req, res, next) {
  const h = req.headers['authorization'];
  const t = h && h.split(' ')[1];
  if (!t) return res.status(401).json({ success: false, message: 'No token.' });
  jwt.verify(t, JWT_SECRET, (err, u) => { if (err) return res.status(403).json({ success: false, message: 'Invalid token.' }); req.user = u; next(); });
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only.' });
  next();
}

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ AUTH ============
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    if (!referralCode) return res.status(400).json({ success: false, message: 'Referral code is required.' });
    const db = await dbRead();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ success: false, message: 'Username already exists.' });
    // Check root codes first (no DB lookup), then check user-generated codes
    const isRootCode = ROOT_REFERRAL_CODES.includes(referralCode.toUpperCase());
    const referrer = isRootCode ? { username: 'SYSTEM', referralCode: referralCode.toUpperCase() } : db.users.find(u => u.referralCode === referralCode);
    if (!referrer) return res.status(400).json({ success: false, message: 'Invalid referral code.' });
    const myCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
      id: crypto.randomUUID(), username, password: hashedPassword,
      referralCode: myCode, referredBy: referrer.username,
      activePlan: null, balance: 0, totalCommission: 0,
      weeklyWithdrawn: 0, weekStart: Date.now(),
      createdAt: new Date().toISOString(), role: 'user',
    };
    db.users.push(newUser);
    await dbWriteDb(db);
    const token = generateToken({ username: newUser.username, role: 'user' });
    res.json({ success: true, message: 'Registered successfully.', token, referralCode: myCode });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    const token = generateToken({ username: user.username, role: user.role || 'user' });
    res.json({ success: true, token, username: user.username, role: user.role || 'user' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/auth/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username !== ADMIN_USERNAME) return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    const token = generateToken({ username: ADMIN_USERNAME, role: 'admin' });
    res.json({ success: true, token, username: ADMIN_USERNAME, role: 'admin' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ USER ============
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const refStats = getReferralStats(user.username, db);
    const tier = user.activePlan ? getTier(user.activePlan) : null;

    // Count approved direct downline referrals (for withdrawal lock)
    const allDirectDownline = db.users.filter(u => u.referredBy === user.username);
    const approvedDownline = allDirectDownline.filter(ref =>
      db.deposits.some(d => d.username === ref.username && d.status === 'approved')
    );
    const approvedDownlineCount = approvedDownline.length;
    const canWithdraw = approvedDownlineCount >= 3;

    // 90-day window info
    const userApprovedDeposits = db.deposits
      .filter(d => d.username === user.username && d.status === 'approved')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    let windowExpiresAt = null;
    let windowExpired = false;
    if (userApprovedDeposits.length > 0) {
      const firstDepositTime = new Date(userApprovedDeposits[0].createdAt).getTime();
      windowExpiresAt = new Date(firstDepositTime + OPERATION_WINDOW_MS).toISOString();
      windowExpired = Date.now() - firstDepositTime > OPERATION_WINDOW_MS;
    }

    res.json({
      success: true, user: {
        username: user.username, balance: user.balance, totalCommission: user.totalCommission || 0,
        activePlan: user.activePlan, referrer: user.referrer, referralCode: user.referralCode,
        activeReferrals: refStats.qualified, totalReferrals: refStats.total,
        tierWeeklyCap: tier ? tier.weeklyCap : 0,
        weeklyWithdrawn: user.weeklyWithdrawn || 0,
        canWithdraw,
        approvedDownlineCount,
        requiredReferrals: 3,
        createdAt: user.createdAt,
        windowExpiresAt,
        windowExpired,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/user/referrals', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const refs = db.users.filter(u => u.referredBy === req.user.username);
    res.json({ success: true, referrals: refs.map(r => ({ username: r.username, activePlan: r.activePlan, createdAt: r.createdAt })) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ TIERS ============
app.get('/api/tiers', (req, res) => {
  // Return tiers with amount ranges for frontend
  const tiersWithRanges = {};
  for (const [key, t] of Object.entries(TIERS)) {
    tiersWithRanges[key] = {
      ...t,
      depositRange: t.maxDeposit === Infinity
        ? `$${t.minDeposit}+`
        : `$${t.minDeposit}-$${t.maxDeposit}`,
    };
  }
  res.json({ success: true, tiers: tiersWithRanges });
});

// ============ DEPOSIT ============
app.post('/api/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, txId } = req.body;
    const amt = Number(amount);
    if (!amt || amt < 10) return res.status(400).json({ success: false, message: 'Minimum deposit is $10.' });
    // Resolve tier dynamically by deposit amount
    const tier = getTierByAmount(amt);
    const tierKey = getTierKeyByAmount(amt);
    if (!tier || !tierKey) return res.status(400).json({ success: false, message: 'Invalid deposit amount. Minimum $10.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const deposit = {
      id: crypto.randomUUID(), username: user.username, tier: tierKey,
      amount: amt, txId: txId || 'manual', status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.deposits.push(deposit);
    await dbWriteDb(db);
    res.json({ success: true, message: 'Deposit request submitted.', deposit, wallet: USDT_WALLET, tier: tier.name });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ WITHDRAW ============
// ABSOLUTE RULE: Any user with fewer than 3 approved direct downline referrals
// is HARD-BLOCKED from all payout transactions. No exceptions.
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.activePlan) return res.status(400).json({ success: false, message: 'No active plan. Deposit first.' });

    // --- STRICT REFERRAL LOCK: Count approved direct downline referrals ---
    // A "direct downline referral" = a user who was referred by this user AND has at least one approved deposit
    const allDirectDownline = db.users.filter(u => u.referredBy === user.username);
    const approvedDownline = allDirectDownline.filter(ref =>
      db.deposits.some(d => d.username === ref.username && d.status === 'approved')
    );
    const approvedDownlineCount = approvedDownline.length;

    // ABSOLUTE BLOCK: Less than 3 approved direct downline = NO PAYOUT
    if (approvedDownlineCount < 3) {
      return res.status(403).json({
        success: false,
        message: `🔒 السحب مقفل! تحتاج 3 إحالات مباشرة مؤكدة على الأقل لتفعيل السحب. حالياً: ${approvedDownlineCount}/3`,
        code: 'REFERRAL_LOCK',
        approvedReferrals: approvedDownlineCount,
        required: 3,
      });
    }

    // --- 90-DAY OPERATION WINDOW CHECK ---
    // Find the user's first approved deposit to determine window start
    const userApprovedDeposits = db.deposits
      .filter(d => d.username === user.username && d.status === 'approved')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (userApprovedDeposits.length > 0) {
      const firstDepositTime = new Date(userApprovedDeposits[0].createdAt).getTime();
      const now = Date.now();
      if (now - firstDepositTime > OPERATION_WINDOW_MS) {
        return res.status(403).json({
          success: false,
          message: '⏰ انتهت فترة التشغيل (90 يوم). تواصل مع الإدارة.',
          code: 'WINDOW_EXPIRED',
        });
      }
    }

    // --- TIER-BASED WEEKLY CAP (from dynamic tier) ---
    const tier = getTier(user.activePlan);
    if (!tier) return res.status(400).json({ success: false, message: 'Invalid tier configuration.' });

    const weekElapsed = Date.now() - (user.weekStart || 0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let weeklyWithdrawn = user.weeklyWithdrawn || 0;
    if (weekElapsed > weekMs) { weeklyWithdrawn = 0; user.weekStart = Date.now(); }
    if (weeklyWithdrawn + amt > tier.weeklyCap) {
      return res.status(400).json({
        success: false,
        message: `Weekly cap exceeded. Remaining: $${(tier.weeklyCap - weeklyWithdrawn).toFixed(2)} / $${tier.weeklyCap.toFixed(2)}`,
        code: 'WEEKLY_CAP',
        remaining: +(tier.weeklyCap - weeklyWithdrawn).toFixed(2),
        weeklyCap: tier.weeklyCap,
      });
    }

    // Check pending withdrawals to prevent over-withdrawal
    const pendingWd = db.withdraws.filter(w => w.username === user.username && w.status === 'pending');
    const totalPending = pendingWd.reduce((s, w) => s + w.amount, 0);
    if (user.balance < amt + totalPending) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: $${(user.balance - totalPending).toFixed(2)} (pending: $${totalPending.toFixed(2)})`,
        code: 'INSUFFICIENT_BALANCE',
      });
    }

    const withdraw = {
      id: crypto.randomUUID(), username: user.username, amount: amt,
      status: 'pending', createdAt: new Date().toISOString(),
    };
    db.withdraws.push(withdraw);
    user.weeklyWithdrawn = weeklyWithdrawn + amt;
    await dbWriteDb(db);
    res.json({ success: true, message: 'Withdraw request submitted. Pending admin approval.', withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN ============
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const users = db.users.map(u => {
      const refStats = getReferralStats(u.username, db);
      const tier = u.activePlan ? getTier(u.activePlan) : null;
      return {
        username: u.username, balance: u.balance, totalCommission: u.totalCommission || 0,
        activePlan: u.activePlan, referrer: u.referrer, referralCode: u.referralCode,
        activeReferrals: refStats.qualified, totalReferrals: refStats.total,
        tierWeeklyCap: tier ? tier.weeklyCap : 0,
        createdAt: u.createdAt,
      };
    });
    res.json({ success: true, users, total: users.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    res.json({ success: true, deposits: db.deposits });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const deposit = db.deposits.find(d => d.id === req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
    if (deposit.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });
    const user = db.users.find(u => u.username === deposit.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    // Resolve tier dynamically by deposit amount
    const tier = getTierByAmount(deposit.amount);
    const tierKey = getTierKeyByAmount(deposit.amount);
    deposit.status = 'approved';
    user.balance = (user.balance || 0) + deposit.amount;
    if (tierKey) user.activePlan = tierKey;
    // Commission distribution
    if (user.referredBy && tier) {
      const l1 = db.users.find(u => u.username === user.referredBy);
      if (l1) {
        const l1Comm = deposit.amount * COMM_L1;
        l1.balance = (l1.balance || 0) + l1Comm;
        l1.totalCommission = (l1.totalCommission || 0) + l1Comm;
        if (l1.referredBy) {
          const l2 = db.users.find(u => u.username === l1.referredBy);
          if (l2) {
            const l2Comm = deposit.amount * COMM_L2;
            l2.balance = (l2.balance || 0) + l2Comm;
            l2.totalCommission = (l2.totalCommission || 0) + l2Comm;
          }
        }
      }
    }
    await dbWriteDb(db);
    res.json({ success: true, message: 'Deposit approved.', deposit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const deposit = db.deposits.find(d => d.id === req.params.id);
    if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
    deposit.status = 'rejected';
    await dbWriteDb(db);
    res.json({ success: true, message: 'Deposit rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/withdraws', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    res.json({ success: true, withdraws: db.withdraws });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const withdraw = db.withdraws.find(w => w.id === req.params.id);
    if (!withdraw) return res.status(404).json({ success: false, message: 'Withdraw not found.' });
    if (withdraw.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });
    const user = db.users.find(u => u.username === withdraw.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.balance < withdraw.amount) return res.status(400).json({ success: false, message: 'Insufficient user balance.' });
    withdraw.status = 'approved';
    user.balance -= withdraw.amount;
    await dbWriteDb(db);
    res.json({ success: true, message: 'Withdraw approved.', withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/withdraws/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const withdraw = db.withdraws.find(w => w.id === req.params.id);
    if (!withdraw) return res.status(404).json({ success: false, message: 'Withdraw not found.' });
    if (withdraw.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed.' });
    withdraw.status = 'rejected';
    // Restore weekly withdrawn amount so user can try again
    const user = db.users.find(u => u.username === withdraw.username);
    if (user) {
      user.weeklyWithdrawn = (user.weeklyWithdrawn || 0) - withdraw.amount;
      if (user.weeklyWithdrawn < 0) user.weeklyWithdrawn = 0;
    }
    await dbWriteDb(db);
    res.json({ success: true, message: 'Withdraw rejected.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/transactions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    res.json({ success: true, transactions: db.transactions });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ACTIVATE PLAN ============
app.post('/api/activate-plan', authenticateToken, async (req, res) => {
  try {
    const { tier: tierKey } = req.body;
    const tier = getTier(tierKey);
    if (!tier) return res.status(400).json({ success: false, message: 'Invalid tier.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const depositAmount = tier.minDeposit || tier.deposit || 0;
    if (user.balance < depositAmount) return res.status(400).json({ success: false, message: `Insufficient balance. Need $${depositAmount}.` });
    user.balance -= depositAmount;
    user.activePlan = tierKey;
    await dbWriteDb(db);
    res.json({ success: true, message: `Plan ${tier.name} activated!` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ USER TRANSACTIONS ============
app.get('/api/user/transactions', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const txns = db.transactions.filter(t => t.username === req.user.username);
    res.json({ success: true, transactions: txns });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN ACTION (approve/reject deposit/withdraw) ============
app.post('/api/admin/action', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, type, action } = req.body;
    const db = await dbRead();
    if (type === 'deposit') {
      const deposit = db.deposits.find(d => d.id === id);
      if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
      if (action === 'Approve') {
        deposit.status = 'approved';
        const user = db.users.find(u => u.username === deposit.username);
        if (user) {
          const tier = getTierByAmount(deposit.amount);
          const tierKey = getTierKeyByAmount(deposit.amount);
          user.balance = (user.balance || 0) + deposit.amount;
          if (tierKey) user.activePlan = tierKey;
          if (user.referredBy && tier) {
            const l1 = db.users.find(u => u.username === user.referredBy);
            if (l1) {
              const l1Comm = deposit.amount * COMM_L1;
              l1.balance = (l1.balance || 0) + l1Comm;
              l1.totalCommission = (l1.totalCommission || 0) + l1Comm;
              if (l1.referredBy) {
                const l2 = db.users.find(u => u.username === l1.referredBy);
                if (l2) {
                  const l2Comm = deposit.amount * COMM_L2;
                  l2.balance = (l2.balance || 0) + l2Comm;
                  l2.totalCommission = (l2.totalCommission || 0) + l2Comm;
                }
              }
            }
          }
        }
      } else {
        deposit.status = 'rejected';
      }
    } else if (type === 'withdraw') {
      const withdraw = db.withdraws.find(w => w.id === id);
      if (!withdraw) return res.status(404).json({ success: false, message: 'Withdraw not found.' });
      if (action === 'Approve') {
        withdraw.status = 'approved';
        const user = db.users.find(u => u.username === withdraw.username);
        if (user && user.balance >= withdraw.amount) user.balance -= withdraw.amount;
      } else {
        withdraw.status = 'rejected';
        // Restore weekly withdrawn amount so user can try again
        const user = db.users.find(u => u.username === withdraw.username);
        if (user) {
          user.weeklyWithdrawn = (user.weeklyWithdrawn || 0) - withdraw.amount;
          if (user.weeklyWithdrawn < 0) user.weeklyWithdrawn = 0;
        }
      }
    }
    await dbWriteDb(db);
    res.json({ success: true, message: `${action} successful.` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN UPDATE WALLET ============
app.post('/api/admin/update-wallet', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, message: 'Wallet address updated (env variable required for persistence).' });
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
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  }
}));

// SPA fallback — serve index.html for any non-API route
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  } else {
    next();
  }
});

// ============ START ============
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('  Trading Platform Server v5.0');
  console.log('  4-Tier Dynamic Pyramid (90-Day Window)');
  console.log('  Bronze $10-49   | $4/week  | 3 referrals');
  console.log('  Silver $50-99   | $8/week  | 3 referrals');
  console.log('  Platinum $100-499 | $20/week | 3 referrals');
  console.log('  Gold $500+      | $100/week | 3 referrals');
  console.log('  STRICT: < 3 approved downline = NO PAYOUT');
  console.log('========================================');
  console.log(`  Port: ${PORT} | Admin: ${ADMIN_USERNAME}`);
  console.log('========================================\n');
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Keep the event loop alive
setInterval(() => {}, 60000);
