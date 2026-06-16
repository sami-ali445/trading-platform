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

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Test route
app.get('/api/test', (req, res) => res.json({ test: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('Test server on port ' + PORT));


// ============ DATABASE (PostgreSQL — non-blocking) ============
let pgPool = null;

(function initDB() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('[DB] No DATABASE_URL, skipping');
    return;
  }
  try {
    const pg = require('pg');
    const { Pool } = pg;
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: false,
      max: 3,
      connectionTimeoutMillis: 10000,
    });
    pgPool.on('error', (err) => console.error('[DB] Pool error:', err.message));
    pgPool.query('SELECT 1').then(() => {
      console.log('[DB] PostgreSQL connected OK');
    }).catch(e => {
      console.error('[DB] PostgreSQL connection failed:', e.message);
    });
  } catch(e) {
    console.error('[DB] Init error:', e.message);
  }
})();

async function withDb(fn) {
  if (!pgPool) return null;
  const client = await pgPool.connect();
  try { return await fn(client); }
  catch(e) { console.error('[DB] Query error:', e.message); throw e; }
  finally { client.release(); }
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
  if (!pgPool) return;
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
  } finally { client.release(); }
}

// Initialize tables on startup (non-blocking)
(async function initTables() {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password TEXT NOT NULL,
        referral_code VARCHAR(50) NOT NULL, referred_by VARCHAR(50), active_plan VARCHAR(20),
        deposit_amount DECIMAL(12,2) DEFAULT 0, balance DECIMAL(12,2) DEFAULT 0,
        total_commission DECIMAL(12,2) DEFAULT 0, weekly_withdrawn DECIMAL(12,2) DEFAULT 0,
        week_start BIGINT DEFAULT 0, cycle_week INTEGER DEFAULT 1, cycle_start BIGINT DEFAULT 0,
        total_withdrawn_cycle DECIMAL(12,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(),
        role VARCHAR(20) DEFAULT 'user'
      );
      CREATE TABLE IF NOT EXISTS deposits (id UUID PRIMARY KEY, username VARCHAR(50) NOT NULL, tier VARCHAR(20) NOT NULL, amount DECIMAL(12,2) NOT NULL, tx_id VARCHAR(100), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS withdraws (id UUID PRIMARY KEY, username VARCHAR(50) NOT NULL, amount DECIMAL(12,2) NOT NULL, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS transactions (id UUID PRIMARY KEY, username VARCHAR(50) NOT NULL, type VARCHAR(20) NOT NULL, amount DECIMAL(12,2) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW());
    `);
    console.log('[DB] Tables created/verified');
    const adminExists = await client.query("SELECT 1 FROM users WHERE username=$1", ['admin']);
    if (adminExists.rowCount === 0 && process.env.ADMIN_PASS_HASH) {
      await client.query('INSERT INTO users (id, username, password, referral_code, referred_by, role) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), 'admin', process.env.ADMIN_PASS_HASH, 'ADMIN00', 'SYSTEM', 'admin']);
      console.log('[DB] Admin user created');
    }
  } catch(e) { console.error('[DB] Table init error:', e.message); }
  finally { client.release(); }
})();

