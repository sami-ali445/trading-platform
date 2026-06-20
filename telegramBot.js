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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8973004890:AAFTfDRE9qQeCgtGPEZEZCGO30Rrb5JD1zc';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8916948567';

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
  return tgSend('setWebhook', { url });
}

async function processUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  }
}

// ============ ADMIN DETECTION ============
function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_TELEGRAM_ID);
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
  const text = msg.text || '';
  const chatId = msg.chat.id;

  console.log('[BOT] ===== ADMIN MESSAGE REACHED =====');
  console.log('[BOT] Admin chatId:', chatId, 'text:', text.substring(0, 100));

  // 0) Try to extract ticketId from reply_to_message
  let replyTicketId = null;
  if (msg.reply_to_message && msg.reply_to_message.text) {
    const replyText = msg.reply_to_message.text;
    // Match patterns like: 📋 التذكرة: #WEB-XXXX or #WEB-XXXX or ticket_id in text
    const ticketMatch = replyText.match(/#([A-Z0-9-]{4,})/);
    if (ticketMatch) {
      replyTicketId = ticketMatch[1];
      console.log('[BOT] Extracted ticketId from reply:', replyTicketId);
    } else {
      console.log('[BOT] Could not extract ticketId from reply text:', replyText.substring(0, 100));
    }
  }

  // 1) Try to find in memory (telegram-originated tickets)
  let latestTicket = null;
  console.log('[BOT] activeTickets size:', activeTickets.size);
  if (activeTickets.size > 0) {
    let latestTime = 0;
    for (const [ticketChatId, ticket] of activeTickets.entries()) {
      console.log('[BOT] Memory ticket:', ticketChatId, ticket.ticketId, ticket.status);
      if (ticket.status === 'open' && ticket.createdAt > latestTime) {
        latestTime = ticket.createdAt;
        latestTicket = { chatId: ticketChatId, ...ticket };
      }
    }
    if (latestTicket) {
      console.log('[BOT] Found in memory:', latestTicket.ticketId, 'chat:', latestTicket.chatId);
    }
  }

  // 2) If we got a ticketId from reply, use it directly
  if (replyTicketId && !latestTicket) {
    console.log('[BOT] Using ticketId from reply:', replyTicketId);
    latestTicket = { ticketId: replyTicketId, chatId: null };
  }

  // 3) If not found in memory, search DB via public endpoint
  if (!latestTicket) {
    console.log('[BOT] Not found in memory, searching DB...');
    try {
      const apiUrl = getApiUrl();
      console.log('[BOT] Searching DB at:', apiUrl + '/api/telegram/open-tickets');
      const resp = await fetch(apiUrl + '/api/telegram/open-tickets');
      const data = await resp.json();
      console.log('[BOT] DB search result:', JSON.stringify(data).substring(0, 300));
      if (data.success && data.tickets && data.tickets.length > 0) {
        const withTg = data.tickets.find(t => t.telegram_chat_id);
        const t = withTg || data.tickets[0];
        latestTicket = { ticketId: t.ticket_id, chatId: t.telegram_chat_id };
        console.log('[BOT] Found open ticket from DB:', t.ticket_id, 'chat:', t.telegram_chat_id);
        if (t.telegram_chat_id) {
          activeTickets.set(t.telegram_chat_id, { ticketId: t.ticket_id, status: 'open', category: t.category, createdAt: Date.now() });
          console.log('[BOT] Cached ticket for future replies');
        }
      } else {
        console.log('[BOT] No open tickets in DB');
      }
    } catch (e) {
      console.error('[BOT] DB ticket search FAILED:', e.message, e.stack);
    }
  }

  // 4) Process the admin reply
  if (latestTicket) {
    console.log('[BOT] Processing reply for ticket:', latestTicket.ticketId);

    // Save admin reply to DB
    try {
      const apiUrl = getApiUrl();
      const saveUrl = apiUrl + '/api/support/messages';
      console.log('[BOT] Saving reply to DB:', saveUrl);
      console.log('[BOT] Payload:', JSON.stringify({ ticketId: latestTicket.ticketId, sender: 'admin', message: text }));

      const saveResp = await fetch(saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: latestTicket.ticketId, sender: 'admin', message: text })
      });
      const saveData = await saveResp.json();
      console.log('[BOT] Save to DB result:', JSON.stringify(saveData));

      if (!saveData.success) {
        console.error('[BOT] Save to DB FAILED:', saveData.message || 'unknown error');
      }
    } catch (e) {
      console.error('[BOT] Save to DB EXCEPTION:', e.message, e.stack);
    }

    // Forward reply to user via Telegram (if user has telegram)
    if (latestTicket.chatId) {
      try {
        console.log('[BOT] Forwarding reply to user telegram:', latestTicket.chatId);
        await sendMessage(latestTicket.chatId, '💬 <b>رد من فريق الدعم:</b>\n\n' + text);
        console.log('[BOT] Reply forwarded to user OK');
      } catch (e) {
        console.error('[BOT] Forward to user telegram FAILED:', e.message);
      }
    } else {
      console.log('[BOT] No telegram chatId for this ticket, skipping telegram forward');
    }

    return;
  }

  // 5) No ticket found at all
  console.log('[BOT] No ticket found anywhere, sending "no tickets" message to admin');
  await sendMessage(chatId, '✅ لا توجد تذاكر مفتوحة حالياً.\n\nارسل رقم التذكرة للرد على عميل محدد.');
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
      const apiUrl = getApiUrl();
      await fetch(`${apiUrl}/api/support/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, sender: 'user', message: text })
      });
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

  // Debug: always log incoming message details
  console.log('[BOT] ===== INCOMING MESSAGE =====');
  console.log('[BOT] chatId:', chatId, '| type:', msg.chat?.type);
  console.log('[BOT] isAdmin:', isAdmin(chatId), '| ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID);
  console.log('[BOT] text:', (msg.text || '').substring(0, 100));
  console.log('[BOT] reply_to_message:', msg.reply_to_message ? 'YES' : 'NO');
  if (msg.reply_to_message) {
    console.log('[BOT] reply_to_message text:', (msg.reply_to_message.text || '').substring(0, 100));
  }

  if (isAdmin(chatId)) {
    await handleAdminMessage(msg);
  } else {
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

// ============ WEBHOOK SETUP ============
function setupWebhook(app, webhookPath = '/webhook/telegram') {
  app.post(webhookPath, (req, res) => {
    console.log('[WEBHOOK] Received:', JSON.stringify(req.body).substring(0, 200));
    processUpdate(req.body).catch(e => console.error('[WEBHOOK] Error:', e.message));
    res.sendStatus(200);
  });

  // Build webhook URL: explicit env var > Render external URL > known URL
  var renderUrl = process.env.RENDER_EXTERNAL_URL;
  var webhookUrl = process.env.TELEGRAM_WEBHOOK_URL
    || (renderUrl ? renderUrl.replace(/\/$/, '') : null)
    || 'https://trading-platform-iglr.onrender.com';

  setWebhook(webhookUrl + webhookPath).then(function() {
    console.log('[TELEGRAM] Webhook set to:', webhookUrl + webhookPath);
  }).catch(function(e) {
    console.error('[TELEGRAM] Webhook setup failed:', e.message);
  });

  console.log('[TELEGRAM] Bot initialized. Admin ID:', ADMIN_TELEGRAM_ID);
}

// ============ EXPORTS ============
module.exports = {
  setupWebhook,
  sendMessage,
  adminReply,
  closeTicket,
  notifyAdmin,
  registerTicket,
  activeTickets
};
