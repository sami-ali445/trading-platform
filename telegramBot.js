/**
 * Telegram Support Bot v1.0
 * 
 * Features:
 * - Auto-reply with FAQ
 * - Escalate to human support (admin)
 * - Anonymous: user only sees "bot" responses
 * - Admin gets notified via Telegram with user ticket info
 * - Admin replies from web panel, bot forwards to user
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8973004890:***';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

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
  return tgSend('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...opts });
}

async function setWebhook(url) {
  return tgSend('setWebhook', { url });
}

async function processUpdate(update) {
  if (update.message) {
    await handleUserMessage(update.message);
  }
}

// ============ FAQ KNOWLEDGE BASE ============
const FAQ = {
  'ايداع': {
    keywords: ['ايداع', 'deposit', 'اودع', 'شحن', 'شحنة', 'wallet', 'محفظة', 'usdt', 'يو اس دي', 'trc20', 'txid', 'hash'],
    reply: `📥 *طريقة الايداع:*\n\n1️⃣ ادخل على حسابك في المنصة\n2️⃣ اضغط على "ايداع"\n3️⃣ اختر المبلغ (الحد ادنى $10)\n4️⃣ حول USDT على الشبكة TRC20 للمحفظة المعروضة\n5️⃣ انسخ الـ TxID من محفظتك والصقه في النموذج\n6️⃣ اضغط "تأكيد الايداع"\n\n⏰ يتم المراجعة خلال 1-24 ساعة\n💰 ارباح اسبوعية 20%`
  },
  'سحب': {
    keywords: ['سحب', 'withdraw', 'اسحب', 'تحويل', 'فلوس', 'ارباح', 'رصيدي', 'balance'],
    reply: `💸 *طريقة السحب:*\n\n1️⃣ لازم يكون عندك 3 احالات نشطة في نفس الفئة\n2️⃣ ادخل على حسابك واضغط "سحب"\n3️⃣ ادخل المبلغ (الحد الاسبوعي = ارباحك)\n4️⃣ اضبط محفظتك وابعث الطلب\n\n⚠️ ملاحظات:\n• الحد الاقصى للسحب = 140% من ايداعك\n• الدورة 7 اسابيع\n• بعد 7 اسابيع تحتاج 3 احالات جديدة`
  },
  'احالات': {
    keywords: ['احالات', 'referral', 'دعوة', 'ادعوا', 'رابط', 'كود', 'code', 'downline', 'فريق'],
    reply: `👥 *نظام الاحالات:*\n\n• كل مستخدم يحصل على كود احالة خاص\n• ارباح الاحالات: المستوى الاول 10%، الثاني 5%\n• للسحب تحتاج 3 احالات نشطة في نفس الفئة\n• شارك رابط الدعوة مع اصدقائك\n\n📎 رابط الدعوة تجده في حسابك`
  },
  'فئات': {
    keywords: ['فئات', 'tier', 'مستويات', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'vip', 'elite', 'royal', 'legend', 'فئة'],
    reply: `🏆 *فئات المنصة:*\n\n🥉 Bronze: $10-$49\n🥈 Silver: $50-$99\n🥇 Gold: $100-$249\n💎 Platinum: $250-$499\n💠 Diamond: $500-$999\n⭐ VIP: $1,000-$2,499\n👑 Elite: $2,500-$4,999\n🏅 Royal: $5,000-$9,999\n🌟 Legend: $10,000+\n\n📈 كل فئة مستقلة بدورة خاصة (7 اسابيع)`
  },
  'تسجيل': {
    keywords: ['تسجيل', 'register', 'حساب', 'انشاء', 'اشتراك', 'دخول', 'login', 'كلمة سر', 'password'],
    reply: `📝 *التسجيل في المنصة:*\n\n1️⃣ ادخل على الموقع\n2️⃣ اضغط "تسجيل"\n3️⃣ ادخل اسم مستخدم وكلمة سر\n4️⃣ استخدم كود احالة (اطلب واحد من الدعم)\n5️⃣ اضغط "تسجيل"\n\n✅ بعد التسجيل يمكنك الايداع والبدء`
  },
  'مشكلة': {
    keywords: ['مشكلة', 'error', 'bug', 'غلط', 'ما يشتغل', 'لا يعمل', 'فشل', 'failed', 'مشكلة تقنية'],
    reply: `🔧 *الدعم الفني:*\n\nصفحة المنصة ما تشتغل؟ جرب:\n1️⃣ امسح الكاش (Ctrl+Shift+Delete)\n2️⃣ حدث الصفحة (F5)\n3️⃣ جرب متصفح ثاني\n4️⃣ تاكد النت شغال\n\nلو المشكلة مستمرة، اكتب "دعم" وسيوصل رسالتك لفريق الدعم 🎧`
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

// ============ MESSAGE HANDLERS ============
const activeTickets = new Map();

async function notifyAdmin(ticketId, userInfo, message, category) {
  if (!ADMIN_TELEGRAM_ID) return;
  const adminMsg = `🎫 *تذكرة دعم جديدة*\n\n` +
    `📋 التذكرة: #${ticketId}\n` +
    `👤 المستخدم: @${userInfo.username || 'مجهول'} (ID: ${userInfo.id})\n` +
    `📂 التصنيف: ${category}\n` +
    `💬 الرسالة:\n_${message}_\n\n` +
    `✍️ للرد: اضغط على التذكرة في لوحة الادمن`;
  try {
    await sendMessage(ADMIN_TELEGRAM_ID, adminMsg);
  } catch (e) {
    console.error('[TELEGRAM] Admin notify failed:', e.message);
  }
}

async function handleUserMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const username = msg.from?.username || '';
  const userId = msg.from?.id;

  if (text.startsWith('/') && text !== '/start') return;

  if (text === '/start') {
    const welcome = `👋 *مرحباً بك في الدعم الفني!*\n\n` +
      `انا المساعد الذكي للمنصة 🎧\n\n` +
      `يمكنك سؤالي عن:\n` +
      `📥 الايداع والسحب\n` +
      `👥 نظام الاحالات\n` +
      `🏆 الفئات والمستويات\n` +
      `📝 التسجيل\n` +
      `🔧 المشاكل التقنية\n\n` +
      `💡 اكتب سؤالك مباشرة وساعدك!\n` +
      `لو ما لقيت جواب، اكتب "دعم" ويوصلك فريق الدعم`;
    return sendMessage(chatId, welcome);
  }

  const existingTicket = activeTickets.get(chatId);

  if (existingTicket && existingTicket.status === 'open') {
    const ticketId = existingTicket.ticketId;
    if (ADMIN_TELEGRAM_ID) {
      const forwardMsg = `💬 *رسالة جديدة في التذكرة #${ticketId}*\n\n` +
        `👤 @${username || 'مجهول'}\n` +
        `📝 _${text}_`;
      try { await sendMessage(ADMIN_TELEGRAM_ID, forwardMsg); } catch (e) {}
    }
    try {
      const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
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
    const replyText = faqMatch.reply + '\n\n💡 هل تحتاج مساعدة اكثر؟ اكتب "دعم" للتحدث مع فريق الدعم';
    return sendMessage(chatId, replyText);
  }

  return createTicket(chatId, userId, username, text, 'general');
}

async function createTicket(chatId, userId, username, message, category) {
  const ticketId = require('crypto').randomUUID().substring(0, 8).toUpperCase();
  try {
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
    await fetch(`${apiUrl}/api/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId, telegramChatId: chatId, telegramUsername: username, message, category })
    });
  } catch (e) {}

  activeTickets.set(chatId, { ticketId, status: 'open', category, createdAt: Date.now() });
  await notifyAdmin(ticketId, { id: userId, username }, message, category);

  const replyText = `🎫 *تم فتح تذكرة دعم*\n\n` +
    `📋 رقم التذكرة: #${ticketId}\n` +
    `📂 التصنيف: ${category === 'support_request' ? 'طلب مساعدة' : 'عام'}\n\n` +
    `💬 فريق الدعم سيرد عليك قريباً...\n` +
    `⏰ وقت الرد المتوقع: خلال ساعة`;
  return sendMessage(chatId, replyText);
}

async function adminReply(ticketId, message) {
  for (const [chatId, ticket] of activeTickets.entries()) {
    if (ticket.ticketId === ticketId && ticket.status === 'open') {
      try {
        await sendMessage(chatId, `💬 *رد من فريق الدعم:*\n\n${message}`);
        return { success: true };
      } catch (e) { return { error: e.message }; }
    }
  }
  try {
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
    const resp = await fetch(`${apiUrl}/api/admin/support/tickets/${ticketId}`);
    const data = await resp.json();
    if (data.success && data.ticket && data.ticket.telegram_chat_id) {
      await sendMessage(data.ticket.telegram_chat_id, `💬 *رد من فريق الدعم:*\n\n${message}`);
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
      try { await sendMessage(chatId, `✅ *تم إغلاق التذكرة #${ticketId}*\n\nشكراً لتواصلك معنا! لو عندك سؤال جديد، تواصل مانا 🎧`); } catch (e) {}
      try {
        const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
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

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (webhookUrl) {
    setWebhook(webhookUrl + webhookPath).then(() => {
      console.log('[TELEGRAM] Webhook set to:', webhookUrl + webhookPath);
    }).catch(e => {
      console.error('[TELEGRAM] Webhook setup failed:', e.message);
    });
  }

  console.log('[TELEGRAM] Bot initialized');
}

// ============ EXPORTS ============
module.exports = {
  setupWebhook,
  adminReply,
  closeTicket,
  activeTickets
};
