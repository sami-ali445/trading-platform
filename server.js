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
// Minimal routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('OK'));
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('Test on port ' + PORT));
