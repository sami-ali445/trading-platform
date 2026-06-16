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


// ============ DATABASE (Supabase REST API — no pg needed) ============
const SUPABASE_URL = "https://db.dilzpxhazjlmyniswyzm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTczNTAwMDAwMCwiZXhwIjoyMDUwMDAwMDB9.placeholder";

async function supabaseFetch(path, options = {}) {
  const url = SUPABASE_URL + path;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw new Error('Supabase error: ' + res.status);
  return res.json();
}

async function dbRead() {
  try {
    const users = await supabaseFetch('/rest/v1/users?select=*&order=created_at.desc');
    const deposits = await supabaseFetch('/rest/v1/deposits?select=*&order=created_at.desc');
    const withdraws = await supabaseFetch('/rest/v1/withdraws?select=*&order=created_at.desc');
    return { users, deposits, withdraws, transactions: [] };
  } catch(e) {
    console.error('[DB READ] Failed:', e.message);
    return { users: [], deposits: [], withdraws: [], transactions: [] };
  }
}

async function dbWriteDb(d) {
  try {
    if (d.users) {
      for (const u of d.users) {
        await supabaseFetch('/rest/v1/users?username=eq.' + encodeURIComponent(u.username), {
          method: 'PUT',
          body: JSON.stringify(u)
        });
      }
    }
    if (d.deposits) {
      for (const dep of d.deposits) {
        await supabaseFetch('/rest/v1/deposits?id=eq.' + dep.id, {
          method: 'PUT',
          body: JSON.stringify(dep)
        });
      }
    }
    if (d.withdraws) {
      for (const w of d.withdraws) {
        await supabaseFetch('/rest/v1/withdraws?id=eq.' + w.id, {
          method: 'PUT',
          body: JSON.stringify(w)
        });
      }
    }
  } catch(e) {
    console.error('[DB WRITE] Failed:', e.message);
  }
}

// Initialize admin user
(async function initAdmin() {
  try {
    const admins = await supabaseFetch('/rest/v1/users?username=eq.admin&select=id');
    if (admins.length === 0 && process.env.ADMIN_PASS_HASH) {
      await supabaseFetch('/rest/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          id: crypto.randomUUID(), username: 'admin', password: process.env.ADMIN_PASS_HASH,
          referral_code: 'ADMIN00', referred_by: 'SYSTEM', role: 'admin',
          active_plan: null, deposit_amount: 0, balance: 0, total_commission: 0,
          weekly_withdrawn: 0, week_start: Date.now(), cycle_week: 1, cycle_start: 0,
          total_withdrawn_cycle: 0, created_at: new Date().toISOString()
        })
      });
      console.log('[DB] Admin user created');
    }
  } catch(e) { console.error('[DB] Admin init error:', e.message); }
})();

console.log('[DB] Supabase REST API initialized');

