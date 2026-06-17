# Trading Platform - Complete Status & Notes
# Last updated: June 17, 2026

## USER PROFILE
- Syrian security researcher and full-stack developer
- Company: shamlogix.com
- Admin: admin / haydar988522605gmail
- Does NOT own a credit card — needs no-card free-tier services only
- Prefers agent creates accounts for external services
- Gets frustrated with multi-step terminal commands — run everything yourself
- Uses Kali Linux XFCE with ibus Arabic
- Deploys via Cloudflare Tunnel (ngrok blocked in Syria)

## PLATFORM v5.8 (LIVE)
- URL: https://trading-platform-iglr.onrender.com
- Render service: srv-d8m7k8gjs32c73dskc90
- GitHub: sami-ali445/trading-platform
- API key: ~/.render_api_key

## DATABASE
- Neon PostgreSQL (free tier, IPv4 compatible)
- Connection: postgresql://neondb_owner:***@ep-twilight-mud-ad6ptlo4-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
- Neon API key: napi_i3tubun4zup1fxq2sp3gup5d0syagn58odp62m5231jtno2uqenl1jfn1h5ifeh1
- Tables: users, deposits, withdraws, transactions, user_tier_deposits, user_tier_cycles, user_tier_referrals

## SECURITY A+
- Helmet (CSP, HSTS, X-Frame)
- CORS strict origin (allows onrender.com)
- CSRF per-request rotation
- Rate limiting (200 general, 20 auth, 10 deposit, 5 withdraw)
- Account lockout (5 fails = 30min)
- JWT httpOnly cookies + token blacklist
- Bot detection
- Attack logging

## TIER ISOLATION SYSTEM
- Each tier COMPLETELY INDEPENDENT
- 3 active downline from SAME tier or higher per tier
- Auto-reset every 7 weeks
- Max 140% withdrawal per tier

## 9 TIERS
- Bronze $10-49, Silver $50-99, Gold $100-249, Platinum $250-499
- Diamond $500-999, VIP $1000-2499, Elite $2500-4999
- Royal $5000-9999, Legend $10000+
- Weekly profit: 20%, L1 commission: 10%, L2: 5%

## KNOWN ISSUES
- Admin users tab may cause black screen (needs browser console debug)
- CSRF blocks curl but works in browser
- Frontend may have Arabic username issues

## PENDING
- Telegram Bot (waiting for @BotFather API Token)
