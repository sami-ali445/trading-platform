import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: '/api', withCredentials: true });
// JWT is now in httpOnly cookie (set by server). CSRF token interceptor.
API.interceptors.request.use(c => {
  // Read CSRF token from cookie (not localStorage - more secure)
  const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
  if (csrfMatch) c.headers['X-CSRF-Token'] = csrfMatch[1];
  return c;
});
API.interceptors.response.use(r => {
  // Update CSRF token from response header
  const csrf = r.headers['x-csrf-token'];
  if (csrf) document.cookie = `csrf_token=${csrf}; path=/; SameSite=Strict; Secure`;
  return r;
}, e => {
  if (e.response?.status === 401) { window.location.reload(); }
  return Promise.reject(e);
});

const TIERS = {
  bronze:  { key: 'bronze',  name: 'Bronze 🥉',  deposit: 10,   daily: 0.29,  cap: 2,    minDeposit: 10,  maxDeposit: 49,   color: '#CD7F32', bg: '#2a1f10' },
  silver:  { key: 'silver',  name: 'Silver 🥈',  deposit: 50,   daily: 1.43,  cap: 10,   minDeposit: 50,  maxDeposit: 99,   color: '#C0C0C0', bg: '#1a1a2e' },
  platinum:{ key: 'platinum',name: 'Platinum 🥇', deposit: 100,  daily: 2.86,  cap: 20,   minDeposit: 100, maxDeposit: 499,  color: '#E5E4E2', bg: '#1a1a3e' },
  gold:    { key: 'gold',    name: 'Gold 💎',     deposit: 500,  daily: 14.29, cap: 100,  minDeposit: 500, maxDeposit: null, color: '#FFD700', bg: '#2a2a10' },
};

/* ============ THEME CONTEXT ============ */
const ThemeContext = createContext();
function useTheme() { return useContext(ThemeContext); }

function ThemeProvider({ children }) {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved !== null) setDark(saved === 'dark');
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.style.setProperty('--bg', '#0a0a0f');
      root.style.setProperty('--bg2', '#121218');
      root.style.setProperty('--bg3', '#1a1a2e');
      root.style.setProperty('--card', '#1a1a2e');
      root.style.setProperty('--text', '#ffffff');
      root.style.setProperty('--text2', '#cccccc');
      root.style.setProperty('--text3', '#888888');
      root.style.setProperty('--border', '#333333');
      root.style.setProperty('--border2', '#444444');
      root.style.setProperty('--accent', '#39ff14');
      root.style.setProperty('--accent2', '#007bff');
      root.style.setProperty('--danger', '#dc3545');
      root.style.setProperty('--warning', '#ffc107');
      root.style.setProperty('--gold', '#FFD700');
      root.style.setProperty('--shadow', 'rgba(0,0,0,0.5)');
      root.style.setProperty('--shadowSm', 'rgba(0,0,0,0.3)');
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.style.setProperty('--bg', '#f5f5f7');
      root.style.setProperty('--bg2', '#ffffff');
      root.style.setProperty('--bg3', '#e8e8ed');
      root.style.setProperty('--card', '#ffffff');
      root.style.setProperty('--text', '#1a1a2e');
      root.style.setProperty('--text2', '#333344');
      root.style.setProperty('--text3', '#666677');
      root.style.setProperty('--border', '#d0d0d8');
      root.style.setProperty('--border2', '#b0b0b8');
      root.style.setProperty('--accent', '#00cc6a');
      root.style.setProperty('--accent2', '#0066cc');
      root.style.setProperty('--danger', '#cc3344');
      root.style.setProperty('--warning', '#cc9900');
      root.style.setProperty('--gold', '#cc9900');
      root.style.setProperty('--shadow', 'rgba(0,0,0,0.12)');
      root.style.setProperty('--shadowSm', 'rgba(0,0,0,0.08)');
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  const toggle = useCallback(() => setDark(d => !d), []);
  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

/* ============ TOAST NOTIFICATION CONTEXT ============ */
const ToastContext = createContext();
function useToast() { return useContext(ToastContext); }

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);
  useEffect(() => {
    const msgs = [
      '✅ مستخدم جديد سجل بكود BOOT00!', '💰 إيداع $150 تم تأكيده — أحمد_32***',
      '🔄 مستخدم فعّل خطة Gold — سعد_87***', '📥 إيداع $500 جديد في الانتظار',
      '⭐ مستخدم جديد من السعودية — فهد_15***', '💸 سحب $200 تم معالجته — محمد_44***',
      '🕸️ إحالة جديدة مؤهلة — خالد_63***', '📊 عمولة $25 أُضيفت لحسابك!',
      '🔥 12 مستخدم جديد خلال آخر ساعة', '💎 ترقية خطة إلى Platinum — علي_21***',
      '✅ تحقق ناجح — حسن_78***', '🚀 إيداع $1000 — سلطان_55***',
    ];
    const i = setInterval(() => addToast(msgs[Math.floor(Math.random() * msgs.length)], 'success'), 15000);
    return () => clearInterval(i);
  }, [addToast]);
  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast-msg">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ============ FOMO COUNTDOWN TIMER ============ */
function FomoCountdown() {
  const [visible, setVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 15, s: 0 });
  const [spotsLeft, setSpotsLeft] = useState(7);
  const [flashPhase, setFlashPhase] = useState(0); // 0=hidden, 1=flash-in, 2=countdown
  const hideTimerRef = useRef(null);
  const showTimerRef = useRef(null);

  // Randomized hide/show cycle — hidden 45–120 minutes, then flash 15-min countdown
  useEffect(() => {
    const scheduleCycle = () => {
      // Hidden phase: random 45–120 minutes
      const hideMinutes = 45 + Math.floor(Math.random() * 76); // 45 to 120 inclusive
      const hideDuration = hideMinutes * 60 * 1000;

      setVisible(false);
      setFlashPhase(0);

      hideTimerRef.current = setTimeout(() => {
        // Flash in — show the 15-minute countdown suddenly
        setFlashPhase(1);
        setVisible(true);

        // Fresh 15-minute countdown
        const totalSec = 15 * 60;
        setTimeLeft({
          h: Math.floor(totalSec / 3600),
          m: Math.floor((totalSec % 3600) / 60),
          s: totalSec % 60,
        });
        setSpotsLeft(Math.floor(Math.random() * 8) + 2);

        // After 3s flash animation, switch to steady countdown
        showTimerRef.current = setTimeout(() => {
          setFlashPhase(2);
        }, 3000);
      }, hideDuration);
    };

    scheduleCycle();

    return () => {
      clearTimeout(hideTimerRef.current);
      clearTimeout(showTimerRef.current);
    };
  }, []);

  // Countdown timer — runs when visible in phase 2 (steady countdown)
  useEffect(() => {
    if (!visible || flashPhase !== 2) return;
    const i = setInterval(() => {
      setTimeLeft(prev => {
        let total = prev.h * 3600 + prev.m * 60 + prev.s - 1;
        if (total <= 0) {
          // Countdown hit zero — hide and restart the full random loop
          setVisible(false);
          setFlashPhase(0);
          // Schedule next cycle after a brief pause
          setTimeout(() => {
            const hideMinutes = 45 + Math.floor(Math.random() * 76);
            const hideDuration = hideMinutes * 60 * 1000;
            setVisible(false);
            setFlashPhase(0);
            hideTimerRef.current = setTimeout(() => {
              setFlashPhase(1);
              setVisible(true);
              const totalSec = 15 * 60;
              setTimeLeft({
                h: Math.floor(totalSec / 3600),
                m: Math.floor((totalSec % 3600) / 60),
                s: totalSec % 60,
              });
              setSpotsLeft(Math.floor(Math.random() * 8) + 2);
              showTimerRef.current = setTimeout(() => {
                setFlashPhase(2);
              }, 3000);
            }, hideDuration);
          }, 2000);
          return { h: 0, m: 0, s: 0 };
        }
        return {
          h: Math.floor(total / 3600),
          m: Math.floor((total % 3600) / 60),
          s: total % 60,
        };
      });
    }, 1000);
    return () => clearInterval(i);
  }, [visible, flashPhase]);

  // Spots countdown — only when visible
  useEffect(() => {
    if (!visible) return;
    const i = setInterval(() => {
      setSpotsLeft(prev => {
        if (prev <= 1) return Math.floor(Math.random() * 6) + 2;
        return prev - (Math.random() > 0.5 ? 1 : 0);
      });
    }, 5000 + Math.random() * 8000);
    return () => clearInterval(i);
  }, [visible]);

  const pad = n => String(n).padStart(2, '0');

  if (!visible) return null;

  const isFlashing = flashPhase === 1;

  return (
    <div className={`fomo-box ${isFlashing ? 'fomo-flash-in' : ''}`}>
      <div className="fomo-pulse" />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="fomo-urgency">🔥 عرض مفاجئ — ينتهي خلال دقائق 🔥</div>
        <div className="fomo-offer">⚡ بونص إيداع 15% إضافي ⚡</div>
        <div className="fomo-sub">كل إيداع خلال الوقت المتبقي يحصل على <span className="green">+15%</span> تلقائياً</div>
        <div className="fomo-timer">
          {[{ v: pad(timeLeft.h), l: 'ساعة' }, { v: pad(timeLeft.m), l: 'دقيقة' }, { v: pad(timeLeft.s), l: 'ثانية' }].map((t, i) => (
            <div key={i} className="fomo-digit-wrap">
              <div className={`fomo-digit ${isFlashing ? 'fomo-digit-bounce' : ''}`}>{t.v}</div>
              <div className="fomo-label">{t.l}</div>
            </div>
          ))}
        </div>
        <div className="fomo-spots">⚠️ باقي <span className="red bold">{spotsLeft}</span> مكان فقط لهذا البونص</div>
        <div className="fomo-bar"><div className="fomo-bar-fill" style={{ width: `${Math.max(5, (spotsLeft / 10) * 100)}%` }} /></div>
      </div>
    </div>
  );
}

/* ============ WITHDRAWAL TICKER BAR ============ */
// Module-level callback ref — GlobalStats registers here to receive ticker events
let onNewWithdrawal = null;

function WithdrawalTicker() {
  const scrollRef = useRef(null);
  const [items, setItems] = useState([]);
  const gen = () => {
    const names = ['أحمد','محمد','علي','حسن','خالد','عمر','يوسف','إبراهيم','سعد','فهد','عبدالله','سلطان','ناصر','بدر','طارق','ماجد','وليد','حمد','راشد','سالم','كريم','ياسر','منصور','فيصل','مشاري','تركي','سعود','عادل','نواف','بندر','Liam','Noah','James','Oliver','William','Sofia','Emma','Olivia','Ava','Mia','张伟','王芳','李娜','刘强','陈杰'];
    const amounts = [20,35,50,75,100,150,200,250,300,500,750,1000,1500,2000];
    const n = names[Math.floor(Math.random() * names.length)];
    const id = Math.floor(Math.random() * 9000) + 100;
    const amount = amounts[Math.floor(Math.random() * amounts.length)];
    // Notify GlobalStats of new withdrawal
    if (onNewWithdrawal) onNewWithdrawal(amount);
    return { masked: `${n}_${String(id).slice(0,2)}***`, amount, secondsAgo: Math.floor(Math.random() * 120) + 5, id: Date.now() + Math.random() };
  };
  useEffect(() => {
    setItems(Array.from({ length: 12 }, gen));
    const i = setInterval(() => setItems(prev => [...prev, gen()].slice(-20)), 3000 + Math.random() * 4000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pos = 0, animId;
    const step = () => { pos -= 0.8; if (pos <= -el.scrollWidth / 2) pos = 0; el.style.transform = `translateX(${pos}px)`; animId = requestAnimationFrame(step); };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [items]);
  return (
    <div className="ticker-bar">
      <div className="ticker-label"><span className="ticker-dot" />سحوبات مباشرة</div>
      <div className="ticker-scroll">
        <div ref={scrollRef} className="ticker-content">
          {[...items, ...items].map((item, i) => (
            <span key={`${item.id}-${i}`} className="ticker-item">
              <span className="green">✅</span>
              <span className="bold white">{item.masked}</span>
              <span>سحب</span>
              <span className="gold bold">${item.amount}</span>
              <span className="muted">منذ {item.secondsAgo}ث</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============ GLOBAL PLATFORM STATS (DYNAMIC) ============ */
function GlobalStats() {
  // Base values that grow over time
  const baseRef = useRef({
    users: 12847 + Math.floor(Math.random() * 500),
    deposits: 4829 + Math.floor(Math.random() * 200),
    withdrawals: 3156 + Math.floor(Math.random() * 150),
    volume: 2847500 + Math.floor(Math.random() * 50000),
  });
  const [display, setDisplay] = useState({ users: 0, deposits: 0, withdrawals: 0, volume: 0 });
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  const animDone = useRef(false);

  // Intersection observer — trigger count-up animation once
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  // Count-up animation on first visibility
  useEffect(() => {
    if (!visible || animDone.current) return;
    animDone.current = true;
    const duration = 2000, steps = 60, interval = duration / steps;
    let step = 0;
    const i = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const b = baseRef.current;
      setDisplay({
        users: Math.floor(b.users * eased),
        deposits: Math.floor(b.deposits * eased),
        withdrawals: Math.floor(b.withdrawals * eased),
        volume: Math.floor(b.volume * eased),
      });
      if (step >= steps) clearInterval(i);
    }, interval);
    return () => clearInterval(i);
  }, [visible]);

  // Dynamic increment interval — runs continuously after first visibility
  useEffect(() => {
    if (!visible) return;
    const i = setInterval(() => {
      const b = baseRef.current;
      // Realistic random increments
      b.users += Math.floor(Math.random() * 3) + 1;        // +1-3 users
      if (Math.random() > 0.4) b.deposits += 1;              // ~60% chance +1 deposit
      b.volume += Math.floor(Math.random() * 2500) + 500;   // +500-3000 volume
      setDisplay({ ...baseRef.current });
    }, 4000); // every 4 seconds
    return () => clearInterval(i);
  }, [visible]);

  // Listen for withdrawal ticker events
  useEffect(() => {
    onNewWithdrawal = (amount) => {
      baseRef.current.withdrawals += 1;
      baseRef.current.volume += amount;
      setDisplay({ ...baseRef.current });
    };
    return () => { onNewWithdrawal = null; };
  }, []);

  const fmt = n => n.toLocaleString('en-US');

  return (
    <div ref={ref} className="stats-grid">
      <div className="stat-card accent-border">
        <div className="stat-icon">👥</div>
        <div className="stat-value accent">{fmt(display.users)}</div>
        <div className="stat-label">مستخدم نشط</div>
      </div>
      <div className="stat-card blue-border">
        <div className="stat-icon">📥</div>
        <div className="stat-value blue">{fmt(display.deposits)}</div>
        <div className="stat-label">إيداع ناجح</div>
      </div>
      <div className="stat-card gold-border">
        <div className="stat-icon">📤</div>
        <div className="stat-value gold">{fmt(display.withdrawals)}</div>
        <div className="stat-label">سحب معالج</div>
      </div>
      <div className="stat-card green-border">
        <div className="stat-icon">💰</div>
        <div className="stat-value green">${fmt(display.volume)}</div>
        <div className="stat-label">حجم التداول</div>
      </div>
    </div>
  );
}

/* ============ CRYPTO CONVERTER ============ */
function CryptoConverter() {
  const [from, setFrom] = useState('USDT');
  const [to, setTo] = useState('BTC');
  const [amount, setAmount] = useState('100');
  const [result, setResult] = useState(null);

  // Fixed conversion rates (approximate)
  const rates = {
    'USDT/BTC': 0.000015, 'USDT/ETH': 0.00028, 'USDT/TRX': 8.5, 'USDT/SYP': 13000,
    'BTC/USDT': 67000, 'BTC/ETH': 18.7, 'BTC/TRX': 565000, 'BTC/SYP': 870000000,
    'ETH/USDT': 3580, 'ETH/BTC': 0.0535, 'ETH/TRX': 30200, 'ETH/SYP': 465000000,
    'TRX/USDT': 0.118, 'TRX/BTC': 0.00000177, 'TRX/ETH': 0.000033, 'TRX/SYP': 1530,
    'SYP/USDT': 0.000077, 'SYP/BTC': 0.00000000115, 'SYP/ETH': 0.00000000215, 'SYP/TRX': 0.000654,
  };

  const convert = useCallback(() => {
    const key = `${from}/${to}`;
    const rate = rates[key] || 0;
    const val = parseFloat(amount) || 0;
    setResult((val * rate).toFixed(8).replace(/\.?0+$/, ''));
  }, [from, to, amount]);

  useEffect(() => { convert(); }, [convert]);

  const currencies = ['USDT', 'BTC', 'ETH', 'TRX', 'SYP'];
  const symbols = { USDT: '₮', BTC: '₿', ETH: 'Ξ', TRX: 'TRX', SYP: '£' };

  return (
    <div className="tc">
      <h3>🔄 محول العملات الرقمية</h3>
      <div className="converter-box">
        <div className="converter-row">
          <div className="converter-field">
            <label>من</label>
            <input className="inp" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="المبلغ" />
            <select className="inp" value={from} onChange={e => setFrom(e.target.value)}>
              {currencies.map(c => <option key={c} value={c}>{symbols[c]} {c}</option>)}
            </select>
          </div>
          <button className="converter-swap" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
          <div className="converter-field">
            <label>إلى</label>
            <div className="converter-result">{result || '0'} <span className="muted">{symbols[to]}{to}</span></div>
            <select className="inp" value={to} onChange={e => setTo(e.target.value)}>
              {currencies.filter(c => c !== from).map(c => <option key={c} value={c}>{symbols[c]} {c}</option>)}
            </select>
          </div>
        </div>
        <div className="converter-rate">
          1 {from} = {(rates[`${from}/${to}`] || 0).toFixed(8).replace(/\.?0+$/, '')} {to}
        </div>
      </div>
    </div>
  );
}

/* ============ ANALYTICS PANEL ============ */
function AnalyticsPanel({ user }) {
  const [chartData, setChartData] = useState([]);
  const [hoveredBar, setHoveredBar] = useState(null);
  useEffect(() => {
    const days = []; let cumulative = 0;
    const tier = user.activePlan ? TIERS[user.activePlan] : null;
    const base = tier ? tier.daily : 2;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const noise = (Math.random() - 0.3) * base * 0.8;
      const comm = Math.random() > 0.6 ? Math.random() * 15 : 0;
      const daily = Math.max(0, base + noise + comm);
      cumulative += daily;
      days.push({ date: d.toLocaleDateString('ar', { weekday: 'short' }), daily: +daily.toFixed(2), cumulative: +cumulative.toFixed(2) });
    }
    setChartData(days);
  }, [user.activePlan]);

  const maxD = Math.max(...chartData.map(d => d.daily), 1);
  const total = chartData.reduce((s, d) => s + d.daily, 0);
  const avg = chartData.length ? total / chartData.length : 0;
  const growth = chartData.length >= 2 ? (((chartData[chartData.length - 1].cumulative - chartData[0].daily) / Math.max(chartData[0].daily, 1)) * 100).toFixed(0) : 0;

  return (
    <div className="tc">
      <h3>📈 تحليلات الأرباح — آخر 30 يوم</h3>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="stat-card green-border"><div className="stat-label">إجمالي الأرباح</div><div className="stat-value green">${total.toFixed(2)}</div></div>
        <div className="stat-card blue-border"><div className="stat-label">متوسط يومي</div><div className="stat-value blue">${avg.toFixed(2)}</div></div>
        <div className="stat-card gold-border"><div className="stat-label">نسبة النمو</div><div className="stat-value gold">+{growth}%</div></div>
      </div>
      <div className="chart-box">
        <div className="chart-title">📊 الأرباح اليومية ($)</div>
        <div className="bar-chart">
          {chartData.map((d, i) => (
            <div key={i} className="bar-wrap" onMouseEnter={() => setHoveredBar(i)} onMouseLeave={() => setHoveredBar(null)}>
              {hoveredBar === i && <div className="bar-tooltip">{d.date}: ${d.daily}</div>}
              <div className={`bar ${hoveredBar === i ? 'bar-hl' : ''}`} style={{ height: `${Math.max(4, (d.daily / maxD) * 100)}px` }} />
              {i % 5 === 0 && <div className="bar-label">{d.date}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="chart-box">
        <div className="chart-title">📉 الأرباح التراكمية ($)</div>
        <svg width="100%" height="80" viewBox="0 0 400 80" preserveAspectRatio="none">
          <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#39ff14" stopOpacity="0.3" /><stop offset="100%" stopColor="#39ff14" stopOpacity="0" /></linearGradient></defs>
          <path d={`M0,80 ${chartData.map((d, i) => { const x = (i / Math.max(chartData.length - 1, 1)) * 400; const m = Math.max(...chartData.map(dd => dd.cumulative), 1); return `L${x},${80 - (d.cumulative / m) * 70}`; }).join(' ')} L400,80 Z`} fill="url(#lg)" />
          <polyline fill="none" stroke="#39ff14" strokeWidth="2" points={chartData.map((d, i) => { const x = (i / Math.max(chartData.length - 1, 1)) * 400; const m = Math.max(...chartData.map(dd => dd.cumulative), 1); return `${x},${80 - (d.cumulative / m) * 70}`; }).join(' ')} />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginTop: 4 }}><span>30 يوم</span><span className="green bold">الحالي: ${chartData[chartData.length - 1]?.cumulative.toFixed(2) || '0.00'}</span></div>
      </div>
    </div>
  );
}

/* ============ FAQ / KNOWLEDGE BASE ============ */
function KnowledgeBase() {
  const [openIdx, setOpenIdx] = useState(null);
  const [copied, setCopied] = useState(false);
  const faqs = [
    { q: '🔐 كيف أنشئ محفظة USDT (TRC20)؟', a: (<div><p style={{ marginBottom: 8 }}>لاستقبال USDT على شبكة TRON (TRC20):</p><ol className="faq-list"><li>حمّل <strong className="green">Trust Wallet</strong> أو <strong className="green">TronLink</strong></li><li>أنشئ محفظة واحفظ <strong>العبارة السرية</strong></li><li>فعّل <strong>USDT (TRC20)</strong></li><li>انسخ العنوان — يبدأ بـ <code className="gold">T...</code></li></ol></div>) },
    { q: '📥 كيف أودع USDT في المنصة؟', a: (<div><p style={{ marginBottom: 8 }}>أرسل إلى شبكة <strong className="gold">TRC20</strong>:</p><div className="copy-row"><code className="green">TLhmbZbsvRhf2TpGiotkHnbv7YBfxbKprn</code><button className={`btn-sm ${copied ? 'btn-green' : 'btn-blue'}`} onClick={() => { navigator.clipboard.writeText('TLhmbZbsvRhf2TpGiotkHnbv7YBfxbKprn'); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? '✅ تم!' : '📋 نسخ'}</button></div><p className="warning-text">⚠️ استخدم TRC20 فقط!</p></div>) },
    { q: '🏅 كيف أفعّل خطة؟', a: (<div><ol className="faq-list"><li>أودع مبلغ الخطة</li><li>اذهب إلى <strong className="green">🏅 الخطط</strong></li><li>اضغط <strong>"تفعيل"</strong></li></ol><div className="tier-compare">{Object.values(TIERS).map(t => (<div key={t.key} className="tier-row"><span style={{ color: t.color }}>{t.name}</span><span>${t.deposit} → ${t.daily}/يوم</span></div>))}</div></div>) },
    { q: '🕸️ كيف يعمل نظام الإحالة؟', a: (<div><div className="comm-box"><div className="comm-row"><span>المستوى 1 (مباشر)</span><span className="green bold">10%</span></div><div className="comm-row"><span>المستوى 2 (فرعي)</span><span className="green bold">5%</span></div></div><p className="muted">⚠️ الإحالات يجب أن تكون بنفس مستواك أو أعلى</p></div>) },
    { q: '📤 كيف أسحب أرباحي؟', a: (<div><ul className="faq-list"><li>تفعيل خطة</li><li><strong>3 إحالات مؤهلة</strong></li><li>عدم تجاوز الحد الأسبوعي</li></ul><p className="warning-text">💡 كل ما زادت إحالاتك ارتفع حدك!</p></div>) },
    { q: '🔒 هل المنصة آمنة؟', a: (<div>{['تشفير JWT + bcrypt','حماية Rate Limiting','تشفير HTTPS عبر Cloudflare','محفظة TRC20 مؤمنة','تحقق يدوي من كل معاملة'].map((t, i) => (<div key={i} className="security-item"><span className="green">✅</span> {t}</div>))}</div>) },
  ];
  return (
    <div className="tc">
      <h3>📚 قاعدة المعرفة — الأسئلة الشائعة</h3>
      <div className="faq-list-wrap">
        {faqs.map((faq, idx) => (
          <div key={idx} className={`faq-item ${openIdx === idx ? 'faq-open' : ''}`}>
            <button className="faq-q" onClick={() => setOpenIdx(openIdx === idx ? null : idx)}>
              <span>{faq.q}</span><span className={`faq-plus ${openIdx === idx ? 'faq-plus-rot' : ''}`}>+</span>
            </button>
            {openIdx === idx && <div className="faq-a">{faq.a}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ GRID ICON SVG ============ */
function GridIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: 'middle', marginLeft: 8, filter: 'drop-shadow(0 0 6px rgba(255,215,0,0.7)) drop-shadow(0 0 12px rgba(255,215,0,0.4))' }}>
      <defs>
        <linearGradient id="gridGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFD700" />
          <stop offset="50%" stopColor="#FFA500" />
          <stop offset="100%" stopColor="#FFD700" />
        </linearGradient>
        <linearGradient id="gridGold2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFEC8B" />
          <stop offset="100%" stopColor="#DAA520" />
        </linearGradient>
        <filter id="gridGlow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Outer frame */}
      <rect x="4" y="4" width="56" height="56" rx="6" stroke="url(#gridGold)" strokeWidth="2" fill="none" filter="url(#gridGlow)" />
      {/* Inner grid lines - horizontal */}
      <line x1="4" y1="22" x2="60" y2="22" stroke="url(#gridGold2)" strokeWidth="1" opacity="0.7" />
      <line x1="4" y1="42" x2="60" y2="42" stroke="url(#gridGold2)" strokeWidth="1" opacity="0.7" />
      {/* Inner grid lines - vertical */}
      <line x1="22" y1="4" x2="22" y2="60" stroke="url(#gridGold2)" strokeWidth="1" opacity="0.7" />
      <line x1="42" y1="4" x2="42" y2="60" stroke="url(#gridGold2)" strokeWidth="1" opacity="0.7" />
      {/* Center diamond */}
      <polygon points="32,16 46,32 32,48 18,32" fill="url(#gridGold)" opacity="0.25" stroke="url(#gridGold)" strokeWidth="1.5" filter="url(#gridGlow)" />
      {/* Corner nodes */}
      <circle cx="12" cy="12" r="3" fill="#FFD700" filter="url(#gridGlow)" />
      <circle cx="52" cy="12" r="3" fill="#FFD700" filter="url(#gridGlow)" />
      <circle cx="12" cy="52" r="3" fill="#FFD700" filter="url(#gridGlow)" />
      <circle cx="52" cy="52" r="3" fill="#FFD700" filter="url(#gridGlow)" />
      {/* Mid-edge nodes */}
      <circle cx="32" cy="8" r="2" fill="#FFA500" opacity="0.8" />
      <circle cx="32" cy="56" r="2" fill="#FFA500" opacity="0.8" />
      <circle cx="8" cy="32" r="2" fill="#FFA500" opacity="0.8" />
      <circle cx="56" cy="32" r="2" fill="#FFA500" opacity="0.8" />
      {/* Center dot */}
      <circle cx="32" cy="32" r="4" fill="#FFD700" filter="url(#gridGlow)" />
      <circle cx="32" cy="32" r="2" fill="#FFEC8B" />
    </svg>
  );
}

/* ============ THEME TOGGLE COMPONENT ============ */
function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button className="theme-toggle" onClick={toggle} title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}>
      <div className={`theme-track ${dark ? 'theme-dark' : 'theme-light'}`}>
        <div className="theme-thumb">{dark ? '🌙' : '☀️'}</div>
      </div>
    </button>
  );
}

/* ============ MAIN APP ============ */
export default function Platform() {
  const [view, setView] = useState('landing');
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } });
  // Token is now in httpOnly cookie - we just track login state
  const [isLoggedIn, setIsLoggedIn] = useState(!!document.cookie.match(/auth_token=/));
  useEffect(() => { if (isLoggedIn && user) setView(user.isAdmin ? 'admin' : 'dashboard'); }, [isLoggedIn, user]);
  const logout = () => {
    // Call server to clear cookie
    API.post('/auth/logout').catch(() => {});
    localStorage.removeItem('user');
    setIsLoggedIn(false);
    setUser(null);
    setView('landing');
  }
  return (
    <ThemeProvider>
      <ToastProvider>
        {view === 'landing' && <><Landing onNav={setView} /><WithdrawalTicker /></>}
        {view === 'login' && <Login onLogin={(t, u) => { setIsLoggedIn(true); setUser(u); }} onNav={setView} />}
        {view === 'register' && <Register onNav={setView} />}
        {view === 'admin-login' && <AdminLogin onLogin={(t, u) => { setIsLoggedIn(true); setUser(u); }} onNav={setView} />}
        {view === 'dashboard' && user && <><Dashboard user={user} onLogout={logout} /><WithdrawalTicker /></>}
        {view === 'admin' && user && <Admin onLogout={logout} />}
        {!['landing','login','register','admin-login','dashboard','admin'].includes(view) && <><Landing onNav={setView} /><WithdrawalTicker /></>}
      </ToastProvider>
    </ThemeProvider>
  );
}

/* ============ SHARED STYLES ============ */
const s = {
  page: { fontFamily: 'sans-serif', background: 'var(--bg)', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text)', direction: 'rtl' },
  card: { background: 'var(--card)', padding: 30, borderRadius: 16, width: 400, textAlign: 'center', border: '1px solid var(--border)', boxShadow: '0 8px 32px var(--shadow)' },
  inp: { width: '100%', padding: 12, marginBottom: 12, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  err: { background: '#3a1a1a', color: '#ff6b6b', padding: 10, borderRadius: 8, marginBottom: 15, fontSize: 13 },
  btn: (bg) => ({ width: '100%', padding: 12, background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 'bold', cursor: 'pointer', marginTop: 5 }),
  link: { color: 'var(--accent)', fontSize: 13, marginTop: 10, cursor: 'pointer', textDecoration: 'underline' },
  bb: { marginTop: 15, padding: 8, background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border2)', borderRadius: 5, cursor: 'pointer', width: '100%' },
  dash: { fontFamily: 'sans-serif', background: 'var(--bg)', minHeight: '100vh', color: 'var(--text)', direction: 'rtl', padding: '20px', paddingBottom: 56 },
  dh: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 },
  lo: { padding: '8px 16px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  bc: (border) => ({ background: 'var(--bg3)', padding: 25, borderRadius: 16, textAlign: 'center', marginBottom: 10, border: `1px solid ${border || 'var(--accent)'}` }),
  ba: { fontSize: 42, fontWeight: 'bold', color: 'var(--accent)', margin: '10px 0', textShadow: '0 0 20px rgba(57,255,20,0.3)' },
  ta: { padding: '10px 16px', background: 'var(--accent2)', color: '#fff', border: '1px solid var(--accent2)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  tb: { padding: '10px 16px', background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  tc: { background: 'var(--bg3)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' },
  msg: { padding: 12, background: '#1a2a1a', borderRadius: 8, marginBottom: 15, fontSize: 14, border: '1px solid var(--accent)' },
  stat: (bg) => ({ background: bg || 'var(--bg3)', padding: 15, borderRadius: 10, flex: 1, minWidth: 100, textAlign: 'center', border: '1px solid var(--border)' }),
};

function FormCard({ title, err, children, footer }) {
  return <div style={s.page}><div style={s.card}><h2 style={{ marginBottom: 20, color: 'var(--accent)' }}>{title}</h2>{err && <div style={s.err}>{err}</div>}{children}{footer}</div></div>;
}

/* ============ LANDING ============ */
function Landing({ onNav }) {
  return (
    <div style={s.page}>
      <div className="landing-wrap">
        <FomoCountdown />
        <GlobalStats />
        <h1 className="landing-title">
          <GridIcon />
          Golden Grid
        </h1>
        <p className="landing-sub">Golden Grid - منصة الاستثمار الذكية</p>
        <div className="tier-badges">
          {Object.values(TIERS).map(t => <span key={t.key} className="tier-badge" style={{ background: t.bg, borderColor: t.color, color: t.color }}>{t.name}</span>)}
        </div>
        <div className="landing-btns">
          <button style={s.btn('#007bff')} onClick={() => onNav('login')}>تسجيل الدخول</button>
          <button style={s.btn('#28a745')} onClick={() => onNav('register')}>إنشاء حساب جديد</button>
          <button style={s.btn('#dc3545')} onClick={() => onNav('admin-login')}>لوحة الإدارة 🔒</button>
        </div>
        <div className="landing-features">
          <span>🔐 JWT+bcrypt</span><span>💰 USDT TRC20</span><span>🕸️ 4-Tier Pyramid</span><span>🔒 Tier-Matching</span>
        </div>
      </div>
    </div>
  );
}

/* ============ LOGIN ============ */
function Login({ onLogin, onNav }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [load, setLoad] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    if (!u || !p) return setErr('ملء الحقول!'); setLoad(true); setErr('');
    try {
      const r = await API.post('/auth/login', { username: u, password: p });
      if (r.data.success) {
        // Token is now in httpOnly cookie set by server
        try {
          const prof = await API.get('/user/profile');
          if (prof.data.success) {
            localStorage.setItem('user', JSON.stringify(prof.data.user));
            onLogin(r.data.token, prof.data.user);
          } else {
            onLogin(r.data.token, r.data.user);
          }
        } catch {
          onLogin(r.data.token, r.data.user);
        }
      }
    } catch (e) { setErr(e.response?.data?.message || 'خطأ!'); }
    setLoad(false);
  };
  return <FormCard title="تسجيل الدخول" err={err} footer={<><p style={s.link} onClick={() => onNav('register')}>سجل الآن</p><button style={s.bb} onClick={() => onNav('landing')}>← العودة</button></>}>
    <input style={s.inp} placeholder="اسم المستخدم" value={u} onChange={e => setU(e.target.value)} />
    <input style={s.inp} type="password" placeholder="كلمة المرور" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
    <button style={s.btn('#007bff')} onClick={go} disabled={load}>{load ? '⏳...' : '🔑 دخول'}</button>
  </FormCard>;
}

/* ============ REGISTER ============ */
function Register({ onNav }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [cp, setCp] = useState('');
  const [ref, setRef] = useState(() => { try { return new URLSearchParams(window.location.search).get('ref') || ''; } catch { return ''; } });
  const [load, setLoad] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    const refCode = ref.trim().toUpperCase();
    if (!u || !p || !cp || !refCode) return setErr('جميع الحقول مطلوبة بما فيها كود الإحالة!');
    if (p !== cp) return setErr('كلمتا المرور غير متطابقتين!');
    if (p.length < 8) return setErr('8 أحرف على الأقل!');
    setLoad(true); setErr('');
    try {
      const r = await API.post('/auth/register', { username: u, password: p, referralCode: refCode });
      if (r.data.success) { alert(`✅ تم التسجيل!\nكود الإحالة: ${r.data.referralCode}`); onNav('login'); }
    } catch (e) {
      const msg = e.response?.data?.message || 'خطأ في الاتصال بالسيرفر!';
      setErr(msg);
    }
    setLoad(false);
  };
  return <FormCard title="إنشاء حساب جديد" err={err} footer={<><p style={s.link} onClick={() => onNav('login')}>لديك حساب؟</p><button style={s.bb} onClick={() => onNav('landing')}>← العودة</button></>}>
    <input style={s.inp} placeholder="اسم المستخدم" value={u} onChange={e => setU(e.target.value)} />
    <input style={s.inp} type="password" placeholder="كلمة المرور (8+)" value={p} onChange={e => setP(e.target.value)} />
    <input style={s.inp} type="password" placeholder="تأكيد كلمة المرور" value={cp} onChange={e => setCp(e.target.value)} />
    <input style={{ ...s.inp, borderColor: ref ? 'var(--accent)' : 'var(--border)' }} placeholder="🔗 كود الإحالة (مطلوب)" value={ref} onChange={e => setRef(e.target.value.toUpperCase())} />
    {ref && <p style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>✅ تم تطبيق كود الإحالة تلقائياً من رابط الدعوة</p>}
    {!ref && <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>كود الإحالة مطلوب — اطلبه من الشخص الذي دعاك</p>}
    <button style={s.btn('#28a745')} onClick={go} disabled={load}>{load ? '⏳...' : '📝 إنشاء الحساب'}</button>
  </FormCard>;
}

/* ============ ADMIN LOGIN ============ */
function AdminLogin({ onLogin, onNav }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [load, setLoad] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setLoad(true); setErr(''); try { const r = await API.post('/auth/admin/login', { username: u, password: p }); if (r.data.success) { localStorage.setItem('user', JSON.stringify({ username: 'admin', isAdmin: true })); onLogin(null, { username: 'admin', isAdmin: true }); } } catch (e) { setErr(e.response?.data?.message || 'خطأ!'); } setLoad(false); };
  return <FormCard title="🔒 لوحة الإدارة" err={err} footer={<button style={s.bb} onClick={() => onNav('landing')}>← العودة</button>}>
    <input style={s.inp} placeholder="اسم المدير" value={u} onChange={e => setU(e.target.value)} />
    <input style={s.inp} type="password" placeholder="كلمة مرور المدير" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
    <button style={s.btn('#dc3545')} onClick={go} disabled={load}>{load ? '⏳...' : '🛡️ دخول'}</button>
  </FormCard>;
}

/* ============ DASHBOARD ============ */
function Dashboard({ user: initUser, onLogout }) {
  // Normalize all numeric fields from API (PostgreSQL returns DECIMAL as strings)
  const normalizedUser = {
    ...initUser,
    balance: Number(initUser?.balance ?? 0),
    totalCommission: Number(initUser?.totalCommission ?? 0),
    totalProfit: Number(initUser?.totalProfit ?? 0),
    weeklyWithdrawn: Number(initUser?.weeklyWithdrawn ?? 0),
    depositAmount: Number(initUser?.depositAmount ?? 0),
    totalWithdrawnCycle: Number(initUser?.totalWithdrawnCycle ?? 0),
    maxWithdrawal: Number(initUser?.maxWithdrawal ?? 0),
    remainingWithdrawal: Number(initUser?.remainingWithdrawal ?? 0),
    dailyProfit: Number(initUser?.dailyProfit ?? 0),
    weeklyProfit: Number(initUser?.weeklyProfit ?? 0),
  };
  const [user, setUser] = useState(normalizedUser);
  const [tab, setTab] = useState('wallet');
  const [depAmount, setDepAmount] = useState('');
  const [depTx, setDepTx] = useState('');
  const [depLoading, setDepLoading] = useState(false);
  const [wdAmt, setWdAmt] = useState('');
  const [msg, setMsg] = useState('');
  const [refs, setRefs] = useState({ referrals: [], qualified: 0, total: 0, minRequired: 3 });
  const [txns, setTxns] = useState([]);
  const [copied, setCopied] = useState(false);
  const [activating, setActivating] = useState(null);

  const refresh = async () => { try { const r = await API.get('/user/profile'); if (r.data.success) setUser({ ...r.data.user, balance: Number(r.data.user?.balance ?? 0), totalCommission: Number(r.data.user?.totalCommission ?? 0), totalProfit: Number(r.data.user?.totalProfit ?? 0), weeklyWithdrawn: Number(r.data.user?.weeklyWithdrawn ?? 0), depositAmount: Number(r.data.user?.depositAmount ?? 0), totalWithdrawnCycle: Number(r.data.user?.totalWithdrawnCycle ?? 0), maxWithdrawal: Number(r.data.user?.maxWithdrawal ?? 0), remainingWithdrawal: Number(r.data.user?.remainingWithdrawal ?? 0), dailyProfit: Number(r.data.user?.dailyProfit ?? 0), weeklyProfit: Number(r.data.user?.weeklyProfit ?? 0) }); } catch {} };
  const loadRefs = async () => { try { const r = await API.get('/user/referrals'); if (r.data.success) setRefs(r.data); } catch {} };
  const loadTxns = async () => { try { const r = await API.get('/user/transactions'); if (r.data.success) setTxns(r.data.transactions); } catch {} };
  useEffect(() => { refresh(); loadRefs(); loadTxns(); const i = setInterval(refresh, 15000); return () => clearInterval(i); }, []);

  const copyRef = () => { navigator.clipboard.writeText(user.referralCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const doDeposit = async () => {
    const amt = Number(depAmount);
    if (!amt || amt < 10) { setMsg('❌ الحد الأدنى للإيداع $10!'); return; }
    if (!depTx || !depTx.trim()) { setMsg('❌ أدخل رقم المعاملة (TxID) من Tronscan!'); return; }
    setDepLoading(true); setMsg('');
    try {
      const r = await API.post('/deposit', { amount: amt, txId: depTx.trim() });
      setMsg(`✅ ${r.data.message} | الخطة: ${r.data.tier || ''}`);
      setDepAmount(''); setDepTx('');
      refresh();
    } catch (e) {
      console.error('[DEPOSIT ERROR]', e);
      setMsg(`❌ ${e.response?.data?.message || 'خطأ في الاتصال بالسيرفر!'}`);
    }
    setDepLoading(false);
  };
  const doWithdraw = async () => {
    if (!wdAmt || Number(wdAmt) <= 0) { setMsg('❌ أدخل مبلغ صحيح أكبر من صفر!'); return; }
    try {
      const r = await API.post('/withdraw', { amount: Number(wdAmt) });
      setMsg(`✅ ${r.data.message}`);
      setWdAmt(''); refresh();
    } catch (e) {
      console.error('[WITHDRAW ERROR]', e);
      setMsg(`❌ ${e.response?.data?.message || 'خطأ في الاتصال بالسيرفر!'}`);
    }
  };
  const activatePlan = async (tierKey) => { setActivating(tierKey); try { const r = await API.post('/activate-plan', { tier: tierKey }); setMsg(`✅ ${r.data.message}`); refresh(); } catch (e) { setMsg(`❌ ${e.response?.data?.message || 'خطأ'}`); } setActivating(null); };

  const tier = user.activePlan ? TIERS[user.activePlan] : null;
  const canWd = user.canWithdraw && !user.windowExpired;
  const weeklyRemaining = tier ? Number(((tier.cap || 0) - Number(user.weeklyWithdrawn ?? 0)).toFixed(2)) : 0;

  const tabs = [
    { key: 'wallet', label: '💰 المحفظة' }, { key: 'analytics', label: '📈 التحليلات' },
    { key: 'converter', label: '🔄 المحول' }, { key: 'deposit', label: '📥 إيداع' },
    { key: 'withdraw', label: '📤 سحب' }, { key: 'tiers', label: '🏅 الخطط' },
    { key: 'referrals', label: '🕸️ الإحالة' }, { key: 'faq', label: '📚 المساعدة' },
    { key: 'history', label: '📋 السجل' },
  ];

  return (
    <div style={s.dash}>
      <div style={s.dh}>
        <h2 className="dash-title"><GridIcon /> Golden Grid {tier && <span style={{ color: tier.color, fontSize: 16 }}>| {tier.name}</span>}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <button style={s.lo} onClick={onLogout}>خروج</button>
        </div>
      </div>

      <FomoCountdown />

      <div style={s.bc(tier ? tier.color : 'var(--accent)')}>
        <div style={{ fontSize: 14, color: 'var(--text3)' }}>رصيدك الحالي</div>
        <div style={s.ba}>${user.balance?.toFixed(2) || '0.00'}</div>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>
          💰 عمولات: <span style={{ color: 'var(--accent)' }}>${(user.totalCommission || 0).toFixed(2)}</span>
          {tier && <> | 📈 أرباح: <span style={{ color: 'var(--accent)' }}>${(user.totalProfit || 0).toFixed(2)}</span></>}
          {' '}| 👤 {user.username}
        </div>
      </div>

      <div style={{ ...s.bc('#007bff'), padding: 15 }}>
        <div style={{ fontSize: 13, marginBottom: 8 }}>🔗 كود الإحالة الخاص بك:</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <code style={{ color: 'var(--accent)', fontSize: 20, fontWeight: 'bold', letterSpacing: 3 }}>{user.referralCode}</code>
          <button style={{ padding: '6px 14px', background: copied ? '#28a745' : '#007bff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }} onClick={copyRef}>{copied ? '✅' : '📋 نسخ'}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>شارك الكود واحصل على 10% من إيداعات المُحَالين!</div>
      </div>

      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? 'tab-active' : 'tab-inactive'}`} onClick={() => { setTab(t.key); if (t.key === 'referrals') loadRefs(); if (t.key === 'history') loadTxns(); }}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      {tab === 'wallet' && (<div style={s.tc}><h3>📊 معلومات الحساب</h3><Row l="الرصيد" v={`$${user.balance?.toFixed(2)}`} /><Row l="العمولات" v={`$${(user.totalCommission || 0).toFixed(2)}`} c="var(--accent)" /><Row l="إجمالي الأرباح" v={`$${(user.totalProfit || 0).toFixed(2)}`} c="var(--accent)" /><Row l="الخطة" v={tier ? tier.name : 'لم تفعّل بعد'} c={tier ? tier.color : 'var(--danger)'} />{tier && <Row l="الأرباح اليومية" v={`$${tier.daily}/يوم`} c="var(--accent)" />}<Row l="الإحالات النشطة" v={`${user.activeReferrals || 0} / 3`} c={(user.activeReferrals || 0) >= 3 ? 'var(--accent)' : 'var(--danger)'} /><Row l="إجمالي الإحالات" v={`${user.totalReferrals || 0}`} /><Row l="فتح الأرباح" v={user.referralProfitUnlocked ? '🔓 مفتوح' : '🔒 مقفل'} c={user.referralProfitUnlocked ? 'var(--accent)' : 'var(--danger)'} />{tier && <Row l="الحد الأسبوعي" v={`$${user.weeklyWithdrawn || 0} / $${tier.cap}`} />}<Row l="حالة السحب" v={canWd ? '🔓 مفتوح' : '🔒 مقفل'} c={canWd ? 'var(--accent)' : 'var(--danger)'} />{user.referrer && <Row l="المُحيل" v={user.referrer} c="var(--accent2)" />}</div>)}
      {tab === 'analytics' && <AnalyticsPanel user={user} />}
      {tab === 'converter' && <CryptoConverter />}
      {tab === 'faq' && <KnowledgeBase />}

      {tab === 'deposit' && (<div style={s.tc}><h3 style={{ color: '#28a745' }}>📥 إيداع USDT (TRC20)</h3><div style={{ background: 'var(--bg2)', padding: 15, borderRadius: 10, margin: '15px 0', border: '1px dashed var(--accent)' }}><p style={{ fontSize: 12, color: 'var(--text3)' }}>عنوان المحفظة (TRC20):</p><code style={{ color: 'var(--accent)', wordBreak: 'break-all', fontSize: 12 }}>TLhmbZbsvRhf2TpGiotkHnbv7YBfxbKprn</code></div><hr style={{ borderColor: 'var(--border)', margin: '15px 0' }} /><p style={{ fontSize: 13, color: 'var(--warning)' }}>⚠️ أرسل المبلغ للمحفظة أعلاه ثم أدخل المبلغ وTxID:</p><div style={{ background: 'var(--bg3)', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 12 }}><strong>نطاقات الخطط:</strong> Bronze $10-49 ($4/week) | Silver $50-99 ($8/week) | Platinum $100-499 ($20/week) | Gold $500+ ($100/week)</div><input style={{ ...s.inp, borderColor: Number(depAmount) >= 10 ? 'var(--accent)' : 'var(--danger)' }} type="number" placeholder="المبلغ (الحد الأدنى $10)" value={depAmount} onChange={e => setDepAmount(e.target.value)} min="10" /><div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{Number(depAmount) >= 10 ? 'الخطة: ' + (Number(depAmount) >= 500 ? 'Gold - $100/week' : Number(depAmount) >= 100 ? 'Platinum - $20/week' : Number(depAmount) >= 50 ? 'Silver - $8/week' : 'Bronze - $4/week') : 'أدخل المبلغ لعرض الخانة'}</div><input style={s.inp} placeholder="TxID من Tronscan" value={depTx} onChange={e => setDepTx(e.target.value)} /><button style={{ ...s.btn('#28a745'), opacity: depLoading ? 0.7 : 1 }} onClick={doDeposit} disabled={depLoading}>{depLoading ? 'جاري الإرسال...' : 'تأكيد الإيداع'}</button></div>)}

      {tab === 'withdraw' && (<div style={s.tc}><h3 style={{ color: 'var(--danger)' }}>📤 سحب الأرباح</h3>{user.windowExpired && <div className="warn-box warn-red"><strong>انتهت فترة التشغيل (90 يوم)!</strong> تواصل مع الإدارة.</div>}{!tier && <div className="warn-box warn-red">⚠️ فعّل خطة أولاً لتتمكن من السحب</div>}{tier && !user.windowExpired && !canWd && <div className="warn-box warn-red"><strong>السحب مقفل!</strong> تحتاج 3 إحالات مباشرة مؤكدة (بإيداع موافق عليه) على الأقل.<br />حالياً: {user.approvedDownlineCount || 0} / 3</div>}{tier && canWd && !user.windowExpired && <div className="warn-box warn-green">✅ السحب مفتوح | الحد الأسبوعي: ${weeklyRemaining} متبقي من ${tier.cap}$</div>}{user.windowExpiresAt && !user.windowExpired && <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 8 }}>تنتهي فترة التشغيل: {new Date(user.windowExpiresAt).toLocaleDateString('ar')}</div>}<input style={s.inp} placeholder={`المبلغ (الحد الأقصى: $${weeklyRemaining})`} type="number" value={wdAmt} onChange={e => setWdAmt(e.target.value)} disabled={!tier || !canWd || user.windowExpired} /><button style={{ ...s.btn('#dc3545'), opacity: (tier && canWd && !user.windowExpired) ? 1 : 0.5 }} onClick={doWithdraw} disabled={!tier || !canWd || user.windowExpired}>💸 طلب السحب</button></div>)}

      {tab === 'tiers' && (<div style={s.tc}><h3>🏅 اختر خطتك</h3>{user.activePlan && <p style={{ color: tier?.color, marginBottom: 15 }}>✅ خطتك الحالية: {tier?.name}</p>}<div className="tiers-grid">{Object.values(TIERS).map(t => (<div key={t.key} className="tier-card" style={{ background: t.bg, borderColor: user.activePlan === t.key ? t.color : 'var(--border)' }}><div className="tier-icon">{t.name.split(' ')[1]}</div><div className="tier-name" style={{ color: t.color }}>{t.name.split(' ')[0]}</div><div className="tier-deposit">{t.maxDeposit === null ? '$' + t.minDeposit + '+' : '$' + t.minDeposit + '-$' + t.maxDeposit}</div><div className="tier-label">نطاق الإيداع</div><div className="tier-profit">${t.daily}/يوم</div><div className="tier-label">أرباح حية</div><div className="tier-req">🔒 {t.minReferrals} إحالات {t.key === 'gold' ? 'Gold' : t.key === 'platinum' ? 'Platinum+' : t.key === 'silver' ? 'Silver+' : 'Bronze+'}</div><div className="tier-cap">📤 ${t.cap}/أسبوع</div>{!user.activePlan && (<button style={{ ...s.btn(t.color), marginTop: 10, fontSize: 13, padding: 8 }} onClick={() => activatePlan(t.key)} disabled={activating === t.key || user.balance < t.deposit}>{activating === t.key ? '⏳...' : user.balance >= t.deposit ? 'تفعيل' : 'تحتاج $' + (t.deposit - user.balance)}</button>)}{user.activePlan === t.key && <div style={{ color: t.color, marginTop: 10, fontWeight: 'bold' }}>✅ نشطة</div>}</div>))}</div></div>)}

      {tab === 'referrals' && (<div style={s.tc}><h3>🕸️ شبكة الإحالة</h3>
        {/* Referral Code & Link Section */}
        <div style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', padding: 20, borderRadius: 14, border: '1px solid var(--accent)', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: 'var(--text3)', marginBottom: 10 }}>🔗 كود الدعوة الخاص بك</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <code style={{ color: 'var(--accent)', fontSize: 28, fontWeight: 'bold', letterSpacing: 4, background: 'rgba(57,255,20,0.1)', padding: '8px 20px', borderRadius: 8, border: '1px dashed var(--accent)' }}>{user.referralCode}</code>
            <button style={{ padding: '10px 18px', background: copied ? '#28a745' : '#007bff', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 'bold' }} onClick={copyRef}>{copied ? '✅ تم النسخ!' : '📋 نسخ الكود'}</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>📎 رابط الدعوة (شاركه مع أصدقائك):</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <code style={{ color: '#007bff', fontSize: 12, background: 'rgba(0,123,255,0.1)', padding: '8px 14px', borderRadius: 6, border: '1px dashed #007bff', wordBreak: 'break-all', flex: 1, minWidth: 200 }}>{window.location.origin}?ref={user.referralCode}</code>
            <button style={{ padding: '8px 14px', background: '#007bff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }} onClick={() => { navigator.clipboard.writeText(window.location.origin + '?ref=' + user.referralCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>📎 نسخ الرابط</button>
          </div>
        </div>

        {/* Progress to Unlock */}
        <div style={{ background: user.referralProfitUnlocked ? 'linear-gradient(135deg, #0a2a1a 0%, #0a3a1a 100%)' : 'linear-gradient(135deg, #2a1a1a 0%, #3a2a1a 100%)', padding: 20, borderRadius: 14, border: `1px solid ${user.referralProfitUnlocked ? 'var(--accent)' : 'var(--danger)'}`, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 'bold' }}>{user.referralProfitUnlocked ? '🔓 الأرباح مفتوحة!' : '🔒 الأرباح مقفلة'}</span>
            <span style={{ fontSize: 18, fontWeight: 'bold', color: user.referralProfitUnlocked ? 'var(--accent)' : 'var(--danger)' }}>{user.activeReferrals || 0} / 3</span>
          </div>
          {/* Progress Bar */}
          <div style={{ width: '100%', height: 12, background: 'rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ width: `${Math.min(100, ((user.activeReferrals || 0) / 3) * 100)}%`, height: '100%', background: user.referralProfitUnlocked ? 'linear-gradient(90deg, #39ff14, #00cc6a)' : 'linear-gradient(90deg, #ffc107, #ff9800)', borderRadius: 6, transition: 'width 0.5s ease' }} />
          </div>
          {!user.referralProfitUnlocked && <div style={{ fontSize: 13, color: 'var(--warning)' }}>⚠️ ادعُ {3 - (user.activeReferrals || 0)} أشخاص إضافيين على الأقل (بإيداع موافق عليه) لفتح الأرباح</div>}
          {user.referralProfitUnlocked && <div style={{ fontSize: 13, color: 'var(--accent)' }}>✅ تهانينا! أرباحك مفتوحة الآن يمكنك السحب</div>}
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}><div style={s.stat()}><span>إجمالي</span><strong>{user.totalReferrals || 0}</strong></div><div style={s.stat('#1a2a1a')}><span>مؤهل</span><strong style={{ color: 'var(--accent)' }}>{user.activeReferrals || 0}</strong></div><div style={s.stat()}><span>عمولات</span><strong style={{ color: 'var(--accent)' }}>${(user.totalCommission || 0).toFixed(2)}</strong></div></div>

        {/* Referrals List */}
        <h4 style={{ marginTop: 20 }}>📋 المُحَالون ({refs.referrals?.length || 0}):</h4>
        {(!refs.referrals || refs.referrals.length === 0) ? <p style={{ color: 'var(--text3)' }}>لم تدعُ أحداً بعد. شارك كود الدعوة الخاص بك!</p> : refs.referrals.map(r => (<div key={r.username} className="ref-row" style={{ borderRightColor: r.activePlan ? 'var(--accent)' : 'var(--danger)' }}><span>👤 {r.username}</span><span>{r.activePlan ? '✅ مؤهل' : '⏳ بدون إيداع'}</span><span style={{ fontSize: 11, color: 'var(--text3)' }}>{r.activePlan || 'بدون خطة'}</span><span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(r.createdAt).toLocaleDateString('ar')}</span></div>))}

        {/* Commission Rules */}
        <div style={{ marginTop: 15, padding: 12, background: '#152238', borderRadius: 8, border: '1px dashed #007bff' }}><p style={{ fontSize: 13, color: 'var(--text3)' }}>📊 قواعد العمولات:</p><p style={{ fontSize: 12 }}>• 10% للمُحيل المباشر (Level 1)</p><p style={{ fontSize: 12 }}>• 5% لمُحيل المُحيل (Level 2)</p><p style={{ fontSize: 12 }}>• الإحالات يجب أن تكون بنفس مستواك أو أعلى</p><p style={{ fontSize: 12, marginTop: 6, color: 'var(--warning)' }}>⚠️ الأرباح تنفتح بعد 3 إحالات نشطة (بإيداع موافق عليه)</p></div>
      </div>)}

      {tab === 'history' && (<div style={s.tc}><h3>📋 سجل المعاملات</h3>{txns.length === 0 ? <p style={{ color: 'var(--text3)' }}>لا توجد معاملات.</p> : txns.slice().reverse().map(t => (<div key={t.id} className="txn-row"><span>{t.type.includes('deposit') ? '📥' : t.type.includes('withdraw') ? '📤' : t.type.includes('commission') ? '💰' : t.type.includes('plan') ? '🏅' : '⚙️'} {t.type}</span><span>{t.amount > 0 ? `$${t.amount}` : ''}</span><span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(t.timestamp).toLocaleString('ar')}</span></div>))}</div>)}
    </div>
  );
}

function Row({ l, v, c }) {
  return <div className="info-row"><span style={{ color: 'var(--text3)' }}>{l}</span><strong style={{ color: c || 'var(--text)' }}>{v}</strong></div>;
}

/* ============ ADMIN ============ */
function Admin({ onLogout }) {
  const [tab, setTab] = useState('requests');
  const [reqs, setReqs] = useState({ deposits: [], withdraws: [] });
  const [users, setUsers] = useState([]);
  const [txns, setTxns] = useState([]);
  const [nWallet, setNWallet] = useState('');
  const [msg, setMsg] = useState('');
  const [notifSound] = useState(() => {
    try { return new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQo6l9/Ss2QdBz2Y3dKyaB8F'); } catch { return null; }
  });
  const prevPendingRef = useRef(0);

  const pendingDeposits = (reqs.deposits || []).filter(d => d.status === 'pending').length;
  const pendingWithdraws = (reqs.withdraws || []).filter(w => w.status === 'pending').length;
  const totalPending = pendingDeposits + pendingWithdraws;

  const refresh = async () => {
    try {
      const [dr, wr] = await Promise.all([API.get('/admin/deposits'), API.get('/admin/withdraws')]);
      const newDeposits = dr.data.deposits || [];
      const newWithdraws = wr.data.withdraws || [];
      const newPending = newDeposits.filter(d => d.status === 'pending').length + newWithdraws.filter(w => w.status === 'pending').length;
      if (prevPendingRef.current > 0 && newPending > prevPendingRef.current && notifSound) {
        try { notifSound.play().catch(() => {}); } catch {}
      }
      prevPendingRef.current = newPending;
      setReqs({ deposits: newDeposits, withdraws: newWithdraws });
    } catch {}
  };
  const loadUsers = async () => { try { const r = await API.get('/admin/users'); if (r.data.success) setUsers(r.data.users || []); } catch(e) { console.error('[ADMIN USERS ERROR]', e.response?.data || e.message); setUsers([]); } };
  const loadTxns = async () => { try { const r = await API.get('/admin/transactions'); if (r.data.success) setTxns(r.data.transactions || []); } catch(e) { console.error('[ADMIN TXNS ERROR]', e.response?.data || e.message); setTxns([]); } };

  useEffect(() => { refresh(); loadUsers(); loadTxns(); const i = setInterval(refresh, 10000); return () => clearInterval(i); }, []);

  const act = async (id, type, action) => { try { await API.post('/admin/action', { id, type, action }); setMsg(`✅ ${action === 'Approve' ? 'موافقة' : 'رفض'}`); refresh(); } catch { setMsg('❌ خطأ'); } };
  const updWallet = async () => { try { await API.post('/admin/update-wallet', { wallet: nWallet }); setMsg('✅ تم التحديث'); setNWallet(''); refresh(); } catch { setMsg('❌ خطأ'); } };

  const tabLabel = (t) => {
    if (t === 'requests') return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        📋 الطلبات
        {totalPending > 0 && (
          <span style={{
            background: '#dc3545', color: '#fff', borderRadius: 10,
            padding: '1px 7px', fontSize: 11, fontWeight: 'bold',
            animation: 'badgePulse 1.5s infinite',
          }}>{totalPending}</span>
        )}
      </span>
    );
    if (t === 'users') return '👥 المستخدمين';
    if (t === 'settings') return '⚙️ الإعدادات';
    return '📊 السجلات';
  };

  return (
    <div style={s.dash}>
      <div style={s.dh}>
        <h2 style={{ color: 'var(--danger)' }}>🛡️ لوحة الإدارة</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {totalPending > 0 && (
            <span style={{
              background: '#dc3545', color: '#fff', borderRadius: 8,
              padding: '4px 12px', fontSize: 13, fontWeight: 'bold',
              animation: 'badgePulse 1.5s infinite',
            }}>
              🔔 {totalPending} طلب جديد
            </span>
          )}
          <ThemeToggle />
          <button style={s.lo} onClick={onLogout}>خروج</button>
        </div>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div style={s.stat()}><span>👥 المستخدمين</span><strong>{users.length}</strong></div>
        <div style={s.stat(pendingDeposits > 0 ? '#1a2a1a' : null)}><span>📥 إيداعات معلقة</span><strong style={{ color: pendingDeposits > 0 ? '#28a745' : 'var(--text)' }}>{pendingDeposits}</strong></div>
        <div style={s.stat(pendingWithdraws > 0 ? '#2a1a1a' : null)}><span>📤 سحوبات معلقة</span><strong style={{ color: pendingWithdraws > 0 ? '#dc3545' : 'var(--text)' }}>{pendingWithdraws}</strong></div>
        <div style={s.stat(totalPending > 0 ? '#2a1a2a' : null)}><span>🔔 إجمالي معلق</span><strong style={{ color: totalPending > 0 ? '#ffc107' : 'var(--text)' }}>{totalPending}</strong></div>
      </div>
      <div className="tab-bar">
        {['requests', 'users', 'settings', 'logs'].map(t => (
          <button key={t} className={`tab-btn ${tab === t ? 'tab-active' : 'tab-inactive'}`} onClick={() => { setTab(t); if (t === 'users') loadUsers(); if (t === 'logs') loadTxns(); }}>
            {tabLabel(t)}
          </button>
        ))}
      </div>
      {msg && <div style={s.msg}>{msg}</div>}
      {tab === 'requests' && <div style={s.tc}><h3 style={{ color: '#28a745' }}>📥 طلبات الإيداع ({pendingDeposits})</h3>{(reqs.deposits || []).filter(d => d.status === 'pending').length === 0 ? <p style={{ color: 'var(--text3)' }}>لا توجد طلبات معلقة.</p> : reqs.deposits.filter(d => d.status === 'pending').map(d => (<div key={d.id} className="admin-req" style={{ borderRight: '3px solid #28a745', animation: 'reqSlideIn 0.3s ease' }}><div><strong>👤 {d.username}</strong> | ${d.amount} | <code style={{ fontSize: 11 }}>{d.txId}</code> | <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(d.createdAt).toLocaleString('ar')}</span></div><div className="admin-actions"><button className="btn-approve" onClick={() => act(d.id, 'deposit', 'Approve')}>✅ موافقة</button><button className="btn-reject" onClick={() => act(d.id, 'deposit', 'Reject')}>❌ رفض</button></div></div>))}<h3 style={{ color: 'var(--danger)', marginTop: 20 }}>📤 طلبات السحب ({pendingWithdraws})</h3>{(reqs.withdraws || []).filter(w => w.status === 'pending').length === 0 ? <p style={{ color: 'var(--text3)' }}>لا توجد طلبات معلقة.</p> : reqs.withdraws.filter(w => w.status === 'pending').map(w => (<div key={w.id} className="admin-req" style={{ borderRight: '3px solid #dc3545', animation: 'reqSlideIn 0.3s ease' }}><div><strong>👤 {w.username}</strong> | ${w.amount} | <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(w.createdAt).toLocaleString('ar')}</span></div><div className="admin-actions"><button className="btn-approve" onClick={() => act(w.id, 'withdraw', 'Approve')}>💸 موافقة</button><button className="btn-reject" onClick={() => act(w.id, 'withdraw', 'Reject')}>❌ رفض</button></div></div>))}</div>}
      {tab === 'users' && <div style={s.tc}><h3>👥 المستخدمين ({users.length})</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>المستخدم</th><th>الرصيد</th><th>الخطة</th><th>العمولات</th><th>الإحالات</th></tr></thead><tbody>{users.map(u => <tr key={u.username}><td>{u.username}</td><td>${Number(u.balance||0).toFixed(2)}</td><td>{u.activePlan || '—'}</td><td style={{ color: 'var(--accent)' }}>${Number(u.totalCommission||0).toFixed(2)}</td><td>{u.activeReferrals || 0}/{u.totalReferrals || 0}</td></tr>)}</tbody></table></div></div>}
      {tab === 'settings' && <div style={s.tc}><h3>⚙️ الإعدادات</h3><h4 style={{ marginTop: 15 }}>محفظة USDT</h4><input style={s.inp} value={nWallet} onChange={e => setNWallet(e.target.value)} placeholder="عنوان TRC20" /><button style={s.btn('#007bff')} onClick={updWallet}>تحديث</button></div>}
      {tab === 'logs' && <div style={s.tc}><h3>📊 السجلات ({txns.length})</h3>{txns.slice().reverse().map(t => (<div key={t.id} className="txn-row"><span>{t.type.includes('deposit') ? '📥' : t.type.includes('withdraw') ? '📤' : t.type.includes('commission') ? '💰' : t.type.includes('plan') ? '🏅' : '⚙️'} {t.type}</span><span>{t.username} | {t.amount > 0 ? `$${t.amount}` : ''}</span><span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(t.timestamp).toLocaleString('ar')}</span></div>))}</div>}
    </div>
  );
}
