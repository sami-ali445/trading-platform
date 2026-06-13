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
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));

const app = express();
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

const ROOT_REFERRAL_CODES = ['BOOT00'];
const COMM_ADMIN = 0.20;
const COMM_L1 = 0.10;
const COMM_L2 = 0.05;

// ============ CYCLE CONSTANTS ============
const WEEKLY_PROFIT_PCT = 0.20;  // 20% per week
const CYCLE_WEEKS = 7;           // total cycle: 7 weeks
const CAPITAL_WEEKS = 5;         // weeks 1-5 = capital return
const MAX_WITHDRAWAL_PCT = 1.40; // 140% of deposit (100% capital + 40% profit)

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

function getWeeklyProfit(depositAmount) {
  return Number(depositAmount) * WEEKLY_PROFIT_PCT;
}

function getDailyProfit(depositAmount) {
  return getWeeklyProfit(depositAmount) / 7;
}

// ============ DATABASE ============
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
  (async () => {
    try {
      await pgPool.query(`
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
      const adminExists = await pgPool.query('SELECT 1 FROM users WHERE username=$1', ['admin']);
      if (adminExists.rowCount === 0) {
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

async function dbRead() {
  if (USE_PG && pgPool) {
    const { rows: users } = await pgPool.query('SELECT * FROM users ORDER BY created_at DESC');
    const { rows: deposits } = await pgPool.query('SELECT * FROM deposits ORDER BY created_at DESC');
    const { rows: withdraws } = await pgPool.query('SELECT * FROM withdraws ORDER BY created_at DESC');
    const { rows: transactions } = await pgPool.query('SELECT * FROM transactions ORDER BY created_at DESC');
    return { users, deposits, withdraws, transactions };
  }
  return readDB();
}

async function dbWriteDb(d) {
  if (USE_PG && pgPool) {
    for (const u of d.users) {
      await pgPool.query(`
        INSERT INTO users (id, username, password, referral_code, referred_by, active_plan, deposit_amount, balance, total_commission, weekly_withdrawn, week_start, cycle_week, cycle_start, total_withdrawn_cycle, role, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (username) DO UPDATE SET
          balance=EXCLUDED.balance, active_plan=EXCLUDED.active_plan, deposit_amount=EXCLUDED.deposit_amount,
          total_commission=EXCLUDED.total_commission, weekly_withdrawn=EXCLUDED.weekly_withdrawn,
          week_start=EXCLUDED.week_start, cycle_week=EXCLUDED.cycle_week, cycle_start=EXCLUDED.cycle_start,
          total_withdrawn_cycle=EXCLUDED.total_withdrawn_cycle, role=EXCLUDED.role
      `, [u.id || crypto.randomUUID(), u.username, u.password,
          u.referralCode || u.referral_code, u.referredBy || u.referred_by,
          u.activePlan || u.active_plan, u.depositAmount || u.deposit_amount || 0,
          u.balance || 0, u.totalCommission || 0,
          u.weeklyWithdrawn || 0, u.weekStart || 0,
          u.cycleWeek || 1, u.cycleStart || 0, u.totalWithdrawnCycle || u.total_withdrawn_cycle || 0,
          u.role || 'user',
          u.createdAt || u.created_at || new Date().toISOString()]);
    }
    for (const dep of d.deposits) {
      await pgPool.query(`
        INSERT INTO deposits (id, username, tier, amount, tx_id, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status
      `, [dep.id || crypto.randomUUID(), dep.username, dep.tier,
          dep.amount, dep.txId || dep.tx_id || 'manual', dep.status,
          dep.createdAt || dep.created_at || new Date().toISOString()]);
    }
    for (const w of d.withdraws) {
      await pgPool.query(`
        INSERT INTO withdraws (id, username, amount, status, created_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status
      `, [w.id || crypto.randomUUID(), w.username, w.amount,
          w.status, w.createdAt || w.created_at || new Date().toISOString()]);
    }
    return;
  }
  writeDB(d);
}

// ============ JWT ============
function generateToken(p) { return jwt.sign(p, JWT_SECRET, { expiresIn: '24h' }); }

function authenticateToken(req, res, next) {
  const h = req.headers['authorization'];
  const t = h && h.split(' ')[1];
  if (!t) return res.status(401).json({ success: false, message: 'No token.' });
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
    const isRootCode = ROOT_REFERRAL_CODES.includes(referralCode.toUpperCase());
    const referrer = isRootCode ? { username: 'SYSTEM', referralCode: referralCode.toUpperCase() } : db.users.find(u => u.referralCode === referralCode);
    if (!referrer) return res.status(400).json({ success: false, message: 'Invalid referral code.' });
    const myCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
      id: crypto.randomUUID(), username, password: hashedPassword,
      referralCode: myCode, referredBy: referrer.username,
      activePlan: null, depositAmount: 0, balance: 0, totalCommission: 0,
      weeklyWithdrawn: 0, weekStart: Date.now(),
      cycleWeek: 1, cycleStart: 0, totalWithdrawnCycle: 0,
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

// ============ USER PROFILE ============
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const tier = user.activePlan ? getTier(user.activePlan) : null;
    const depositAmt = user.depositAmount || 0;
    const weeklyProfit = getWeeklyProfit(depositAmt);
    const dailyProfit = getDailyProfit(depositAmt);

    // Count qualified referrals (same tier+, with approved deposit)
    const userTierLevel = tier ? tier.level : 0;
    const allDirectDownline = db.users.filter(u => u.referredBy === user.username);
    const approvedDownline = allDirectDownline.filter(ref => {
      if (!ref.activePlan) return false;
      const refTier = getTier(ref.activePlan);
      if (!refTier) return false;
      const hasApproved = db.deposits.some(d => d.username === ref.username && d.status === 'approved');
      return hasApproved && refTier.level >= userTierLevel;
    });
    const approvedDownlineCount = approvedDownline.length;
    const canWithdraw = approvedDownlineCount >= 3;

    // Cycle tracking
    let cycleWeek = user.cycleWeek || 1;
    const cycleStart = user.cycleStart || 0;
    const totalWithdrawnCycle = user.totalWithdrawnCycle || 0;

    if (cycleStart > 0) {
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - cycleStart;
      cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1);
      if (cycleWeek !== user.cycleWeek) {
        user.cycleWeek = cycleWeek;
      }
    }

    const cycleExpired = cycleWeek > CYCLE_WEEKS;
    const maxWithdrawal = depositAmt * MAX_WITHDRAWAL_PCT;

    res.json({
      success: true,
      user: {
        username: user.username,
        balance: user.balance,
        depositAmount: depositAmt,
        totalCommission: user.totalCommission || 0,
        activePlan: user.activePlan,
        tierName: tier ? tier.name : null,
        tierLabel: tier ? tier.label : null,
        referralCode: user.referralCode,
        referrer: user.referredBy,
        dailyProfit: +dailyProfit.toFixed(2),
        weeklyProfit: +weeklyProfit.toFixed(2),
        canWithdraw,
        approvedDownlineCount,
        requiredReferrals: 3,
        cycleWeek,
        cycleTotalWeeks: CYCLE_WEEKS,
        cycleExpired,
        totalWithdrawnCycle,
        maxWithdrawal: +maxWithdrawal.toFixed(2),
        remainingWithdrawal: +Math.max(0, maxWithdrawal - totalWithdrawnCycle).toFixed(2),
        weeklyWithdrawn: user.weeklyWithdrawn || 0,
        createdAt: user.createdAt,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ REFERRALS ============
app.get('/api/user/referrals', authenticateToken, async (req, res) => {
  try {
    const db = await dbRead();
    const refs = db.users.filter(u => u.referredBy === req.user.username);
    res.json({ success: true, referrals: refs.map(r => ({ username: r.username, activePlan: r.activePlan, createdAt: r.createdAt })) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ TIERS ============
app.get('/api/tiers', (req, res) => {
  const tiersOut = {};
  for (const [key, t] of Object.entries(TIERS)) {
    const minW = getWeeklyProfit(t.minDeposit);
    const maxW = t.maxDeposit === Infinity ? null : getWeeklyProfit(t.maxDeposit);
    tiersOut[key] = {
      ...t,
      level: t.level,
      weeklyProfitMin: +minW.toFixed(2),
      weeklyProfitMax: maxW ? +maxW.toFixed(2) : null,
      cycleWeeks: CYCLE_WEEKS,
      maxTotalPct: MAX_WITHDRAWAL_PCT * 100,
    };
  }
  res.json({ success: true, tiers: tiersOut, weeklyPct: WEEKLY_PROFIT_PCT * 100 });
});

// ============ DEPOSIT ============
app.post('/api/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, txId } = req.body;
    const amt = Number(amount);
    if (!amt || amt < 10) return res.status(400).json({ success: false, message: 'Minimum deposit is $10.' });
    const tier = getTierByAmount(amt);
    const tierKey = getTierKeyByAmount(amt);
    if (!tier || !tierKey) return res.status(400).json({ success: false, message: 'Invalid deposit amount.' });
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
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });
    const db = await dbRead();
    const user = db.users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!user.activePlan) return res.status(400).json({ success: false, message: 'No active plan. Deposit first.' });

    const tier = getTier(user.activePlan);
    const depositAmt = user.depositAmount || 0;
    const weeklyProfit = getWeeklyProfit(depositAmt);

    // STRICT REFERRAL LOCK: 3 approved downline from same tier+
    const userTierLevel = tier ? tier.level : 0;
    const allDirectDownline = db.users.filter(u => u.referredBy === user.username);
    const approvedDownline = allDirectDownline.filter(ref => {
      if (!ref.activePlan) return false;
      const refTier = getTier(ref.activePlan);
      if (!refTier) return false;
      const hasApproved = db.deposits.some(d => d.username === ref.username && d.status === 'approved');
      return hasApproved && refTier.level >= userTierLevel;
    });
    const approvedDownlineCount = approvedDownline.length;

    if (approvedDownlineCount < 3) {
      return res.status(403).json({
        success: false,
        message: 'Referral lock! Need 3 approved downline from your tier or higher. Currently: ' + approvedDownlineCount + '/3',
        code: 'REFERRAL_LOCK',
        approvedReferrals: approvedDownlineCount,
        required: 3,
      });
    }

    // CYCLE CHECK: 7-week limit
    let cycleWeek = user.cycleWeek || 1;
    const cycleStart = user.cycleStart || 0;
    let totalWithdrawnCycle = user.totalWithdrawnCycle || 0;

    if (cycleStart > 0) {
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - cycleStart;
      cycleWeek = Math.min(CYCLE_WEEKS, Math.floor(elapsed / weekMs) + 1);
    }

    if (cycleWeek > CYCLE_WEEKS) {
      return res.status(403).json({
        success: false,
        message: 'Cycle expired! ' + CYCLE_WEEKS + ' weeks completed. You must re-deposit and bring 3 new referrals.',
        code: 'CYCLE_EXPIRED',
        cycleWeek,
      });
    }

    // MAX WITHDRAWAL CHECK: 140% of deposit
    const maxWithdrawal = depositAmt * MAX_WITHDRAWAL_PCT;
    if (totalWithdrawnCycle + amt > maxWithdrawal) {
      return res.status(400).json({
        success: false,
        message: 'Maximum withdrawal for this cycle reached. Remaining: $' + (maxWithdrawal - totalWithdrawnCycle).toFixed(2),
        code: 'CYCLE_MAX',
        remaining: +(maxWithdrawal - totalWithdrawnCycle).toFixed(2),
      });
    }

    // WEEKLY PROFIT CAP
    const weekElapsed = Date.now() - (user.weekStart || 0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    let weeklyWithdrawn = user.weeklyWithdrawn || 0;
    if (weekElapsed > weekMs) { weeklyWithdrawn = 0; user.weekStart = Date.now(); }
    if (weeklyWithdrawn + amt > weeklyProfit) {
      return res.status(400).json({
        success: false,
        message: 'Weekly profit cap exceeded. Remaining this week: $' + (weeklyProfit - weeklyWithdrawn).toFixed(2),
        code: 'WEEKLY_CAP',
        remaining: +(weeklyProfit - weeklyWithdrawn).toFixed(2),
        weeklyProfit: +weeklyProfit.toFixed(2),
      });
    }

    // Check balance
    if (user.balance < amt) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance. Available: $' + user.balance.toFixed(2),
        code: 'INSUFFICIENT_BALANCE',
      });
    }

    const withdraw = {
      id: crypto.randomUUID(), username: user.username, amount: amt,
      status: 'pending', createdAt: new Date().toISOString(),
    };
    db.withdraws.push(withdraw);
    user.weeklyWithdrawn = weeklyWithdrawn + amt;
    user.totalWithdrawnCycle = totalWithdrawnCycle + amt;
    user.cycleWeek = cycleWeek;
    await dbWriteDb(db);
    res.json({ success: true, message: 'Withdraw request submitted. Pending admin approval.', withdraw });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN: USERS ============
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await dbRead();
    const users = db.users.map(u => {
      const tier = u.activePlan ? getTier(u.activePlan) : null;
      const depositAmt = u.depositAmount || 0;
      return {
        username: u.username,
        balance: u.balance,
        depositAmount: depositAmt,
        totalCommission: u.totalCommission || 0,
        activePlan: u.activePlan,
        tierName: tier ? tier.name : null,
        referralCode: u.referralCode,
        referredBy: u.referredBy,
        weeklyProfit: +getWeeklyProfit(depositAmt).toFixed(2),
        cycleWeek: u.cycleWeek || 1,
        cycleExpired: (u.cycleWeek || 1) > CYCLE_WEEKS,
        totalWithdrawnCycle: u.totalWithdrawnCycle || 0,
        maxWithdrawal: +(depositAmt * MAX_WITHDRAWAL_PCT).toFixed(2),
        createdAt: u.createdAt,
      };
    });
    res.json({ success: true, users, total: users.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============ ADMIN: DEPOSITS ============
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
    const tierKey = getTierKeyByAmount(deposit.amount);
    deposit.status = 'approved';
    user.balance = (user.balance || 0) + deposit.amount;
    user.depositAmount = deposit.amount;
    if (tierKey) user.activePlan = tierKey;
    // Start cycle on first approved deposit
    if (!user.cycleStart || user.cycleStart === 0) {
      user.cycleStart = Date.now();
      user.cycleWeek = 1;
      user.totalWithdrawnCycle = 0;
    }
    // Commission distribution
    if (user.referredBy) {
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

// ============ ADMIN: WITHDRAWS ============
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

// ============ ADMIN ACTION ============
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
          const tierKey = getTierKeyByAmount(deposit.amount);
          user.balance = (user.balance || 0) + deposit.amount;
          user.depositAmount = deposit.amount;
          if (tierKey) user.activePlan = tierKey;
          if (!user.cycleStart || user.cycleStart === 0) {
            user.cycleStart = Date.now();
            user.cycleWeek = 1;
            user.totalWithdrawnCycle = 0;
          }
          if (user.referredBy) {
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
        const user = db.users.find(u => u.username === withdraw.username);
        if (user) {
          user.weeklyWithdrawn = (user.weeklyWithdrawn || 0) - withdraw.amount;
          if (user.weeklyWithdrawn < 0) user.weeklyWithdrawn = 0;
        }
      }
    }
    await dbWriteDb(db);
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
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  }
}));

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
  console.log('');
  console.log('========================================');
  console.log('  Trading Platform Server v5.0');
  console.log('  9-Tier Dynamic Pyramid (7-Week Cycle)');
  console.log('  Bronze $10-49 | Silver $50-99 | Gold $100-249');
  console.log('  Platinum $250-499 | Diamond $500-999 | VIP $1K-2.4K');
  console.log('  Elite $2.5K-4.9K | Royal $5K-9.9K | Legend $10K+');
  console.log('  Weekly Profit: 20% | Cycle: 7 weeks');
  console.log('  STRICT: < 3 same-tier referrals = NO PAYOUT');
  console.log('  Week 7 = LOCKED -> re-deposit + 3 new referrals');
  console.log('========================================');
  console.log('  Port: ' + PORT + ' | Admin: ' + ADMIN_USERNAME);
  console.log('========================================');
  console.log('');
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
setInterval(function() {}, 60000);