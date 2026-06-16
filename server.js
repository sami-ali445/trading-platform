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

// Serve frontend static files
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.set('Pragma', 'no-cache'); } }));
app.use((req, res, next) => { if (!req.path.startsWith('/api/')) { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(PUBLIC_DIR, 'index.html')); } else { next(); } });

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('Server on port ' + PORT));


// ============ DATABASE (Supabase REST API — lazy init) ============
const SUPABASE_URL = "https://db.dilzpxhazjlmyniswyzm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbG...lder";
let dbCache = null;

async function getDB() {
  if (dbCache) return dbCache;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/users?select=*&order=created_at.desc', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    });
    if (!res.ok) throw new Error('Supabase error: ' + res.status);
    const users = await res.json();
    const deps = await fetch(SUPABASE_URL + '/rest/v1/deposits?select=*&order=created_at.desc', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    }).then(r => r.json());
    const wds = await fetch(SUPABASE_URL + '/rest/v1/withdraws?select=*&order=created_at.desc', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    }).then(r => r.json());
    dbCache = { users, deposits: deps, withdraws: wds, transactions: [] };
    return dbCache;
  } catch(e) {
    console.error('[DB] Error:', e.message);
    return { users: [], deposits: [], withdraws: [], transactions: [] };
  }
}

async function dbRead() { return await getDB(); }
async function dbWriteDb(d) {
  // For now, just log — we'll implement write later
  console.log('[DB WRITE] Stub — data not persisted');
}

console.log('[DB] Supabase REST API configured (lazy init)');

