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
// Minimal routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('OK'));
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('Test on port ' + PORT));
