/**
 * Telegram Support Bot v2.0
 * 
 * Features:
 * - Auto-reply with FAQ
 * - Escalate to human support (admin)
 * - Admin detection: if chat_id = admin, treat as admin reply (not a new ticket)
 * - Admin gets notified via Telegram with user ticket info
 * - Admin replies from web panel OR from Telegram -> bot forwards to user
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8795808560:***';

// Support multiple admin IDs (comma-separated in env)
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_ID || '8916948567')
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);

// Primary admin (first in list) — used for notifications
const ADMIN_TELEGRAM_ID = ADMIN_TELEGRAM_IDS[0];

// Secret token for webhook verification - MUST match what we send to Telegram via setWebhook
// Telegram sends this back in x-telegram-bot-api-secret-token header
const WEBHOOK_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN || 'tp_webhook_secret_2025_secure_random_token_xyz123';

if (!BOT_TOKEN) {
  console.error('[TELEGRAM] FATAL: TELEGRAM_BOT_TOKEN not set!');
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tgSend(method, body) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sendMessage(chatId, text, opts = {}) {
  return tgSend('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...opts });
}

async function setWebhook(url) {
  return tgSend('setWebhook', { url, secret_token: WEBHOOK_SECRET_TOKEN });
}

async function getWebhookInfo() {
  return tgSend('getWebhookInfo', {});
}

async function processUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  }
}

// ============ ADMIN DETECTION ============
function isAdmin(chatId) {
  return ADMIN_TELEGRAM_IDS.includes(String(chatId));
}

// ============ FAQ KNOWLEDGE BASE ============
const FAQ = {
  'ايداع': {
    keywords: ['ايداع', 'deposit', 'اودع', 'شحن', 'شحنة', 'wallet', 'محفظة', 'usdt', 'يو اس دي', 'trc20', 'txid', 'hash'],
    reply: `📥 <b>طريقة الايداع:</b>

1️⃣ ادخل على حسابك في المنصة
2️⃣ اضغط على \"ايداع\"
3️⃣ اختر المبلغ (الحد ادنى $10)
4️⃣ حول USDT على الشبكة TRC20 للمحفظة المعروضة
5️⃣ انسخ الـ TxID من محفظتك والصقه في النموذج
6️⃣ اضغط \"تأكيد الايداع\"

⏰ يتم المراجعة خلال 1-24 ساعة
💰 ارباح اسبوعية 20%`
  },
  'سحب': {
    keywords: ['سحب', 'withdraw', 'اسحب', 'تحويل', 'فلوس', 'ارباح', 'رصيدي', 'balance'],
    reply: `💸 <b>طريقة السحب:</b>

1️⃣ لازم يكون عندك 3 احالات نشطة في نفس الفئة
2️⃣ ادخل على حسابك واضغط \"سحب\"
3️⃣ ادخل المبلغ (الحد الاسبوعي = ارباحك)
4️⃣ اضبط محفظتك وابعث الطلب

⚠️ ملاحظات:
• الحد الاقصى للسحب = 140% من ايداعك
• الدورة 7 اسابيع
• بعد 7 اسابيع تحتاج 3 احالات جديدة`
  },
  'احالات': {
    keywords: ['احالات', 'referral', 'دعوة', 'ادعوا', 'رابط', 'كود', 'code', 'downline', 'فريق'],
    reply: `👥 <b>نظام الاحالات:</b>

• كل مستخدم يحصل على كود احالة خاص
• ارباح الاحالات: المستوى الاول 10%، الثاني 5%
• للسحب تحتاج 3 احالات نشطة في نفس الفئة
• شارك رابط الدعوة مع اصدقائك

📎 رابط الدعوة تجده في حسابك`
  },
  'فئات': {
    keywords: ['فئات', 'tier', 'مستويات', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'vip', 'elite', 'royal', 'legend', 'فئة'],
    reply: `🏆 <b>فئات المنصة:</b>

🥉 Bronze: $10-$49
🥈 Silver: $50-$99
🥇 Gold: $100-$249
💎 Platinum: $250-$499
💠 Diamond: $500-$999
⭐ VIP: $1,000-$2,499
👑 Elite: $2,500-$4,999
🏅 Royal: $5,000-$9,999
🌟 Legend: $10,000+

📈 كل فئة مستقلة بدورة خاصة (7 اسابيع)`
  },
  'تسجيل': {
    keywords: ['تسجيل', 'register', 'حساب', 'انشاء', 'اشتراك', 'دخول', 'login', 'كلمة سر', 'password'],
    reply: `📝 <b>التسجيل في المنصة:</b>

1️⃣ ادخل على الموقع
2️⃣ اضغط \"تسجيل\"
3️⃣ ادخل اسم مستخدم وكلمة سر
4️⃣ استخدم كود احالة (اطلب واحد من الدعم)
5️⃣ اضغط \"تسجيل\"

✅ بعد التسجيل يمكنك الايداع والبدء`
  },
  'مشكلة': {
    keywords: ['مشكلة', 'error', 'bug', 'غلط', 'ما يشتغل', 'لا يعمل', 'فشل', 'failed', 'مشكلة تقنية'],
    reply: `🔧 <b>الدعم الفني:</b>

صفحة المنصة ما تشتغل؟ جرب:
1️⃣ امسح الكاش (Ctrl+Shift+Delete)
2️⃣ حدث الصفحة (F5)
3️⃣ جرب متصفح ثاني
4️⃣ تاكد النت شغال

لو المشكلة مستمرة، اكتب \"دعم\" وسيوصل رسالتك لفريق الدعم 🎧`
  }
};

function findFAQMatch(text) {
  const lower = text.toLowerCase().trim();
  for (const [category, faq] of Object.entries(FAQ)) {
    for (const keyword of faq.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return { category, reply: faq.reply };
      }
    }
  }
  return null;
}

// Helper: get the correct API base URL for server-to-server calls
function getApiUrl() {
  return (process.env.RENDER_EXTERNAL_URL || 'https://trading-platform-iglr.onrender.com').replace(/\/$/, '');
}

// ============ MESSAGE HANDLERS ============
const activeTickets = new Map();

// Track admin's last replied ticket (for web-based tickets without telegram_chat_id)
let adminLastTicket = {};

// Register a ticket for Telegram reply routing (called from supportRoutes.js)
function registerTicket(ticketId, telegramChatId) {
  if (ticketId && telegramChatId) {
    activeTickets.set(telegramChatId, { ticketId, status: 'open', category: 'general', createdAt: Date.now() });
    console.log('[TELEGRAM] Registered ticket:', ticketId, 'for chat:', telegramChatId);
  }
}

async function notifyAdmin(ticketId, userInfo, message, category) {
  if (!ADMIN_TELEGRAM_ID) {
    console.error('[TELEGRAM] notifyAdmin: ADMIN_TELEGRAM_ID is not set!');
    return;
  }
  const adminMsg = `🎫 <b>تذكرة دعم جديدة</b>\n\n` +
    `📋 التذكرة: #${ticketId}\n` +
    `👤 المستخدم: @${userInfo.username || 'مجهول'} (ID: ${userInfo.id})\n` +
    `📂 التصنيف: ${category}\n` +
    `💬 الرسالة:\n${message}`;
  try {
    console.log('[TELEGRAM] notifyAdmin: Sending to admin', ADMIN_TELEGRAM_ID, 'ticket:', ticketId);
    const result = await sendMessage(ADMIN_TELEGRAM_ID, adminMsg);
    console.log('[TELEGRAM] notifyAdmin: Result:', JSON.stringify(result));
  } catch (e) {
    console.error('[TELEGRAM] notifyAdmin: Failed:', e.message);
  }
}

// Handle admin message -> forward to user's ticket as admin reply
async function handleAdminMessage(msg) {
  // CRITICAL: Use msg.text — this is the NEW text the admin just typed
  const text = msg.text || '';
  const chatId = msg.chat.id;

  console.log('[BOT] ===== ADMIN MESSAGE REACHED =====');
  console.log('[BOT] chatId:', String(chatId));
  console.log('[BOT] msg.text (NEW admin reply):', text.substring(0, 200));

  // 0) Extract ticketId from reply_to_message
  let replyTicketId = null;
  if (msg.reply_to_message) {
    const replyText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
    console.log('[BOT] reply_to_message.text:', replyText.substring(0, 300));
    // Match: #WEB-XXXX, #TEST-XXXX, #XXXX, etc. (more flexible regex)
    const ticketMatch = replyText.match(/#([A-Z][A-Z0-9-]{2,})/i);
    if (ticketMatch) {
      replyTicketId = ticketMatch[1].toUpperCase();
      console.log('[BOT] Extracted ticketId from reply:', replyTicketId);
    } else {
      console.log('[BOT] Could NOT extract ticketId from reply');
    }
  } else {
    console.log('[BOT] No reply_to_message — not a reply');
  }

  // 1) Find ticket: reply ticketId > memory > DB
  let targetTicketId = null;

  // Priority 1: ticketId from reply
  if (replyTicketId) {
    targetTicketId = replyTicketId;
    console.log('[BOT] Using ticketId from reply:', targetTicketId);
  }

  // Priority 2: latest open ticket from memory
  if (!targetTicketId && activeTickets.size > 0) {
    let latestTime = 0;
    let latest = null;
    for (const [cid, ticket] of activeTickets.entries()) {
      if (ticket.status === 'open' && ticket.createdAt > latestTime) {
        latestTime = ticket.createdAt;
        latest = { chatId: cid, ...ticket };
      }
    }
    if (latest) {
      targetTicketId = latest.ticketId;
      console.log('[BOT] Using ticketId from memory:', targetTicketId);
    }
  }

  // Priority 2.5: admin's last replied ticket (for web tickets without telegram)
  if (!targetTicketId && adminLastTicket[chatId]) {
    // Check if the last ticket is still open
    try {
      const tgDb = require('./telegramBotDb');
      if (tgDb.getTicket) {
        const lastTicket = await tgDb.getTicket(adminLastTicket[chatId]);
        if (lastTicket && lastTicket.status === 'open') {
          targetTicketId = lastTicket.ticket_id;
          console.log('[BOT] Using admin last replied ticket:', targetTicketId);
        }
      }
    } catch (e) {
      console.warn('[BOT] adminLastTicket check failed:', e.message);
    }
  }

  // Priority 3: latest open ticket from DB (direct DB call to avoid HTTP self-call crash)
  if (!targetTicketId) {
    console.log('[BOT] Priority 3: Searching DB for open tickets...');
    try {
      let dbResult = null;
      try {
        const tgDb = require('./telegramBotDb');
        if (tgDb && tgDb.getOpenTickets) {
          dbResult = await tgDb.getOpenTickets(10);
          console.log('[BOT] Priority 3: DB result:', JSON.stringify(dbResult));
        } else {
          console.warn('[BOT] Priority 3: tgDb.getOpenTickets not available');
        }
      } catch (serverErr) {
        console.warn('[BOT] Priority 3: DB module error:', serverErr.message);
      }

      if (!dbResult) {
        // Fallback to HTTP
        console.log('[BOT] Priority 3: Trying HTTP fallback...');
        const apiUrl = getApiUrl();
        const resp = await fetch(apiUrl + '/api/telegram/open-tickets');
        dbResult = await resp.json();
        console.log('[BOT] Priority 3: HTTP result:', JSON.stringify(dbResult));
      }

      if (dbResult && dbResult.success && dbResult.tickets && dbResult.tickets.length > 0) {
        // Get the first open ticket (oldest created)
        let t = dbResult.tickets[0];
        targetTicketId = t.ticket_id;
        console.log('[BOT] Priority 3: FOUND ticketId:', targetTicketId, 'for user:', t.username);
      } else {
        console.log('[BOT] Priority 3: NO open tickets found');
      }
    } catch (e) {
      console.error('[BOT] Priority 3: DB search failed:', e.message);
    }
  }

  // 2) If we have a ticket, save the admin's NEW text to DB
  if (targetTicketId) {
    console.log('[BOT] Saving admin reply to ticket:', targetTicketId);
    console.log('[BOT] Reply text (msg.text):', text);

    try {
      // Use direct DB call to avoid HTTP self-call issues that cause server crashes
      let saveData = null;
      try {
        const tgDb = require('./telegramBotDb');
        if (tgDb && tgDb.saveMessage) {
          saveData = await tgDb.saveMessage(targetTicketId, 'admin', text);
          console.log('[BOT] Save result (direct):', JSON.stringify(saveData));
        } else {
          console.warn('[BOT] tgDb.saveMessage not available');
        }
      } catch (serverErr) {
        console.warn('[BOT] DB module error, will try HTTP:', serverErr.message);
      }

      // If direct DB save failed or not available, try HTTP fallback
      if (!saveData || !saveData.success) {
        console.log('[BOT] Trying HTTP fallback...');
        const apiUrl = getApiUrl();
        const payload = { ticketId: targetTicketId, sender: 'admin', message: text };
        console.log('[BOT] POST payload:', JSON.stringify(payload));
        const saveResp = await fetch(apiUrl + '/api/support/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        saveData = await saveResp.json();
        console.log('[BOT] Save result (HTTP):', JSON.stringify(saveData));
      }

      if (saveData && saveData.success) {
        console.log('[BOT] Admin reply SAVED to DB successfully!');
        
        // Track which ticket this admin replied to (for future replies without reply_to_message)
        adminLastTicket[chatId] = targetTicketId;
        console.log('[BOT] Updated adminLastTicket for chat:', chatId, '->', targetTicketId);
        
        // Forward reply to the original user via Telegram (if they have telegram linked)
        try {
          const forwardResult = await adminReply(targetTicketId, text);
          if (forwardResult?.success) {
            console.log('[BOT] Admin reply FORWARDED to user via Telegram!');
            await sendMessage(chatId, '✅ تم إرسال ردك بنجاح إلى العميل');
          } else {
            // Ticket saved but user has no telegram or ticket not found
            console.log('[BOT] Reply saved to DB but Telegram forward skipped:', forwardResult?.error || 'no telegram');
            await sendMessage(chatId, '✅ تم حفظ الرد في النظام. العميل سيشاهده عند دخوله المنصة.');
          }
        } catch (fwErr) {
          console.error('[BOT] Forward error:', fwErr.message);
          await sendMessage(chatId, '✅ تم حفظ الرد. العميل سيشاهده في المنصة.');
        }
      } else {
        console.error('[BOT] Save FAILED:', saveData.message);
        await sendMessage(chatId, '❌ فشل إرسال الرد: ' + (saveData.message || 'خطأ غير معروف'));
      }
    } catch (e) {
      console.error('[BOT] Save EXCEPTION:', e.message, e.stack);
      await sendMessage(chatId, '❌ خطأ في الإرسال');
    }
    return;
  }

  // 3) No ticket found
  console.log('[BOT] No ticket found');
  await sendMessage(chatId, '✅ لا توجد تذاكر مفتوحة.\nأرسل رقم التذكرة للرد على عميل.');
}

// Handle user (non-admin) message
async function handleUserMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const username = msg.from?.username || '';
  const userId = msg.from?.id;

  if (text.startsWith('/') && text !== '/start') return;

  if (text === '/start') {
    const welcome = `👋 <b>مرحباً بك في الدعم الفني!</b>

` +
      `انا المساعد الذكي للمنصة 🎧

` +
      `يمكنك سؤالي عن:
` +
      `📥 الايداع والسحب
` +
      `👥 نظام الاحالات
` +
      `🏆 الفئات والمستويات
` +
      `📝 التسجيل
` +
      `🔧 المشاكل التقنية

` +
      `💡 اكتب سؤالك مباشرة وساعدك!
` +
      `لو ما لقيت جواب، اكتب \"دعم\" ويوصلك فريق الدعم`;
    return sendMessage(chatId, welcome);
  }

  const existingTicket = activeTickets.get(chatId);

  if (existingTicket && existingTicket.status === 'open') {
    const ticketId = existingTicket.ticketId;
    if (ADMIN_TELEGRAM_ID) {
      const forwardMsg = `💬 <b>رسالة جديدة في التذكرة #${ticketId}</b>

` +
        `👤 @${username || 'مجهول'}
` +
        `📝 ${text}`;
      try { await sendMessage(ADMIN_TELEGRAM_ID, forwardMsg); } catch (e) {}
    }
    try {
      // Use direct DB call to avoid HTTP self-call issues that cause server crashes
      let msgSaved = false;
      try {
        const tgDb = require('./telegramBotDb');
        if (tgDb.saveMessage) {
          const result = await tgDb.saveMessage(ticketId, 'user', text);
          msgSaved = result?.success;
          console.log('[BOT] User message saved (direct):', JSON.stringify(result));
        }
      } catch (serverErr) {
        console.warn('[BOT] DB module not available for user msg, falling back to HTTP:', serverErr.message);
      }

      if (!msgSaved) {
        const apiUrl = getApiUrl();
        await fetch(`${apiUrl}/api/support/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, sender: 'user', message: text })
        });
      }
    } catch (e) {}
    return sendMessage(chatId, `✅ تم استلام رسالتك! فريق الدعم سيرد عليك قريباً...`);
  }

  const faqMatch = findFAQMatch(text);
  if (faqMatch) {
    if (text.includes('دعم') || text.includes('مساعدة') || text.includes('مو فاهم')) {
      return createTicket(chatId, userId, username, text, 'support_request');
    }
    const replyText = faqMatch.reply + '\\n\\n💡 هل تحتاج مساعدة اكثر؟ اكتب \"دعم\" للتحدث مع فريق الدعم';
    return sendMessage(chatId, replyText);
  }

  return createTicket(chatId, userId, username, text, 'general');
}

// Main message handler - routes to admin or user handler
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  // Debug: always log incoming message
  console.log('[BOT] ===== INCOMING MESSAGE =====');
  console.log('[BOT] chatId:', String(chatId), '| type:', msg.chat?.type);
  console.log('[BOT] ADMIN_TELEGRAM_ID:', String(ADMIN_TELEGRAM_ID));
  console.log('[BOT] isAdmin:', isAdmin(chatId));
  console.log('[BOT] msg.text:', text.substring(0, 100));
  console.log('[BOT] reply_to_message:', msg.reply_to_message ? 'YES' : 'NO');
  if (msg.reply_to_message) {
    console.log('[BOT] reply_to_message.text:', (msg.reply_to_message.text || '').substring(0, 100));
  }

  // TEMP DEBUG: Log ALL incoming messages for setup
  console.log('[DEBUG] Incoming from chatId:', String(chatId), 'text:', text.substring(0, 50));
  recordAdminMessage(chatId, text); // Store ALL messages for debug

  // CRITICAL: Admin check — if chatId matches admin, ALWAYS treat as admin
  if (isAdmin(chatId)) {
    console.log('[BOT] -> Routing to handleAdminMessage');
    await handleAdminMessage(msg);
  } else {
    console.log('[BOT] -> Routing to handleUserMessage');
    await handleUserMessage(msg);
  }
}

async function createTicket(chatId, userId, username, message, category) {
  const ticketId = require('crypto').randomUUID().substring(0, 8).toUpperCase();
  try {
    const apiUrl = getApiUrl();
    await fetch(`${apiUrl}/api/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId, telegramChatId: chatId, telegramUsername: username, message, category })
    });
  } catch (e) {}

  activeTickets.set(chatId, { ticketId, status: 'open', category, createdAt: Date.now() });
  await notifyAdmin(ticketId, { id: userId, username }, message, category);

  const replyText = `🎫 <b>تم فتح تذكرة دعم</b>

` +
    `📋 رقم التذكرة: #${ticketId}
` +
    `📂 التصنيف: ${category === 'support_request' ? 'طلب مساعدة' : 'عام'}

` +
    `💬 فريق الدعم سيرد عليك قريباً...
` +
    `⏰ وقت الرد المتوقع: خلال ساعة`;
  return sendMessage(chatId, replyText);
}

async function adminReply(ticketId, message) {
  for (const [chatId, ticket] of activeTickets.entries()) {
    if (ticket.ticketId === ticketId && ticket.status === 'open') {
      try {
        await sendMessage(chatId, `💬 <b>رد من فريق الدعم:</b>

${message}`);
        return { success: true };
      } catch (e) { return { error: e.message }; }
    }
  }
  try {
    const apiUrl = getApiUrl();
    const resp = await fetch(`${apiUrl}/api/admin/support/tickets/${ticketId}`);
    const data = await resp.json();
    if (data.success && data.ticket && data.ticket.telegram_chat_id) {
      await sendMessage(data.ticket.telegram_chat_id, `💬 <b>رد من فريق الدعم:</b>

${message}`);
      activeTickets.set(data.ticket.telegram_chat_id, { ticketId, status: data.ticket.status, category: data.ticket.category, createdAt: Date.now() });
      return { success: true };
    }
  } catch (e) {}
  return { error: 'Ticket not found or no Telegram chat ID' };
}

async function closeTicket(ticketId) {
  for (const [chatId, ticket] of activeTickets.entries()) {
    if (ticket.ticketId === ticketId) {
      ticket.status = 'closed';
      try { await sendMessage(chatId, `✅ <b>تم إغلاق التذكرة #${ticketId}</b>

شكراً لتواصلك معنا! لو عندك سؤال جديد، تواصل مانا 🎧`); } catch (e) {}
      try {
        const apiUrl = getApiUrl();
        await fetch(`${apiUrl}/api/support/tickets/${ticketId}/close`, { method: 'POST' });
      } catch (e) {}
      activeTickets.delete(chatId);
      return { success: true };
    }
  }
  return { error: 'Ticket not found' };
}

// ============ TELEGRAM SIGNATURE VERIFICATION ============
const crypto = require('crypto');

function verifyTelegramSignature(req) {
  try {
    const headerToken = req.headers['x-telegram-bot-api-secret-token'];
    
    if (!headerToken) {
      console.warn('[WEBHOOK] No secret token header received');
      return false;
    }
    
    // Direct string comparison using timing-safe equal
    const headerBuf = Buffer.from(headerToken);
    const expectedBuf = Buffer.from(WEBHOOK_SECRET_TOKEN);
    
    if (headerBuf.length !== expectedBuf.length) {
      console.warn('[WEBHOOK] Secret token length mismatch');
      return false;
    }
    
    const isValid = crypto.timingSafeEqual(headerBuf, expectedBuf);
    
    if (!isValid) {
      console.warn('[WEBHOOK] Invalid secret token');
    }
    
    return isValid;
  } catch (e) {
    console.error('[WEBHOOK] Signature verification error:', e.message);
    return false;
  }
}

// ============ WEBHOOK SETUP ============
function setupWebhook(app, webhookPath = '/webhook/telegram') {
  // Build full URL from environment (RENDER_EXTERNAL_URL is set by Render automatically)
  var renderUrl = process.env.RENDER_EXTERNAL_URL;
  var baseUrl = process.env.TELEGRAM_WEBHOOK_URL
    || (renderUrl ? renderUrl.replace(/\/$/, '') : null)
    || 'https://trading-platform-iglr.onrender.com';
  var fullUrl = baseUrl + webhookPath;

  // Webhook route with signature verification
  app.post(webhookPath, (req, res) => {
    const incomingToken = req.headers['x-telegram-bot-api-secret-token'];
    
    // Debug logging - always log incoming requests
    console.log('[WEBHOOK] Request from:', req.ip, '| Token:', incomingToken ? 'present' : 'MISSING');
    
    // Verify Telegram signature
    if (!verifyTelegramSignature(req)) {
      console.warn('[WEBHOOK] REJECTED: invalid signature from', req.ip);
      return res.status(403).send('Forbidden');
    }
    
    console.log('[WEBHOOK] ACCEPTED valid update');
    processUpdate(req.body).catch(e => console.error('[WEBHOOK] Error:', e.message));
    
    // Respond immediately to avoid Telegram retries
    res.status(200).json({ ok: true });
  });

  console.log('[TELEGRAM] Bot initialized with signature verification. Admin ID:', ADMIN_TELEGRAM_ID);
  console.log('[TELEGRAM] Webhook URL:', fullUrl);
  
  // Set webhook on startup with retry logic
  // Use setTimeout to ensure server is fully listening before calling Telegram API
  setTimeout(async () => {
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[WEBHOOK] Setting webhook (attempt ${attempt}/${maxRetries})...`);
        console.log(`[WEBHOOK] Target URL: ${fullUrl}`);
        const result = await setWebhook(fullUrl);
        if (result.ok) {
          console.log('[WEBHOOK] ✓ Webhook set successfully to:', fullUrl);
          return;
        } else {
          console.error('[WEBHOOK] setWebhook returned error:', result.description || JSON.stringify(result));
        }
      } catch (e) {
        console.error(`[WEBHOOK] setWebhook attempt ${attempt} failed:`, e.message);
      }
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 3000 * attempt)); // 3s, 6s, 9s, 12s
      }
    }
    console.error('[WEBHOOK] ✗ Failed to set webhook after all retries');
  }, 5000); // wait 5 seconds for server to fully start and bind to port
}

// ============ EXPORTS ============
// Store last admin message for debugging
let lastAdminMessage = null;
const allChatIds = new Set(); // TEMP: capture all chat IDs

function recordAdminMessage(chatId, text) {
  lastAdminMessage = { chatId: String(chatId), text: String(text).substring(0, 100), timestamp: Date.now() };
  allChatIds.add(String(chatId));
}

function getLastAdminMessage() {
  return lastAdminMessage;
}

function getAllChatIds() {
  return Array.from(allChatIds);
}

module.exports = {
  setupWebhook,
  sendMessage,
  adminReply,
  closeTicket,
  notifyAdmin,
  registerTicket,
  activeTickets,
  getLastAdminMessage,
  getAllChatIds,
  setWebhook,
  getWebhookInfo
};
