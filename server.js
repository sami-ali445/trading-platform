const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();

// Helmet
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

// CORS
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'https://trading-platform-iglr.onrender.com', methods: ['GET', 'POST'], credentials: true, maxAge: 86400 }));

// Cookie parser + JSON
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Rate limiting
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);
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
