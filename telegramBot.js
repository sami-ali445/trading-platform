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

const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID; // Your personal Telegram chat ID for notifications

if (!BOT_TOKEN) {
  console.error('[TELEGRAM] FATAL: TELEGRAM_BOT_TOKEN not set!');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ============ FAQ KNOWLEDGE BASE ============
const FAQ = {
  // Deposit related
  'ايداع': {
    keywords: ['ايداع', ' deposit', 'اودع', 'شحن', 'شحنة', 'wallet', 'محفظة', 'usdt', 'يو اس دي', 'trc20', 'txid', 'hash'],
    reply: `📥 *طريقة الايداع:*\n\n1️⃣ ادخل على حسابك في المنصة\n2️⃣ اضغط على "ايداع"\n3️⃣ اختر المبلغ (الحد ادنى \$10)\n4️⃣ حول USDT على الشبكة TRC20 للمحفظة المعروضة\n5️⃣ انسخ الـ TxID من محفظتك والصقه في النموذج\n6️⃣ اضغط "تأكيد الايداع"\n\n⏰ يتم المراجعة خلال 1-24 ساعة\n💰 ارباح اسبوعية 20%`
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
    reply: `🏆 *فئات المنصة:*\n\n🥉 Bronze: \$10-\$49\n🥈 Silver: \$50-\$99\n🥇 Gold: \$100-\$249\n💎 Platinum: \$250-\$499\n💠 Diamond: \$500-\$999\n⭐ VIP: \$1,000-\$2,499\n👑 Elite: \$2,500-\$4,999\n🏅 Royal: \$5,000-\$9,999\n🌟 Legend: \$10,000+\n\n📈 كل فئة مستقلة بدورة خاصة (7 اسابيع)`
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

// ============ SMART FAQ MATCHER ============
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

// Store active tickets in memory (synced with DB via API)
const activeTickets = new Map();

// Send message to admin about new ticket
async function notifyAdmin(ticketId, userInfo, message, category) {
  if (!ADMIN_TELEGRAM_ID) return;
  
  const adminMsg = `🎫 *تذكرة دعم جديدة*\n\n` +
    `📋 التذكرة: #${ticketId}\n` +
    `👤 المستخدم: @${userInfo.username || 'مجهول'} (ID: ${userInfo.id})\n` +
    `📂 التصنيف: ${category}\n` +
    `💬 الرسالة:\n_${message}_\n\n` +
    `✍️ للرد: اضغط على التذكرة في لوحة الادمن`;
  
  try {
    await bot.sendMessage(ADMIN_TELEGRAM_ID, adminMsg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[TELEGRAM] Admin notify failed:', e.message);
  }
}

// Handle incoming message from user
async function handleUserMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const username = msg.from?.username || '';
  const userId = msg.from?.id;
  
  // Ignore commands other than /start
  if (text.startsWith('/') && text !== '/start') return;
  
  if (text === '/start') {
    const welcome = `👋 *مرحباً بك في الدعم الفني!*\n\n` +
      `انا المساعد الذكي للمنصة 🎧\n\n` +
      `يمكنك سؤالني عن:\n` +
      `📥 الايداع والسحب\n` +
      `👥 نظام الاحالات\n` +
      `🏆 الفئات والمستويات\n` +
      `📝 التسجيل\n` +
      `🔧 المشاكل التقنية\n\n` +
      `💡 اكتب سؤالك مباشرة وساعدك!\n` +
      `لو ما لقيت جواب، اكتب "دعم" ويوصلك فريق الدعم`;
    
    return bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
  }
  
  // Check if user has an open ticket
  const existingTicket = activeTickets.get(chatId);
  
  if (existingTicket && existingTicket.status === 'open') {
    // Add message to existing ticket
    const ticketId = existingTicket.ticketId;
    
    // Forward to admin
    if (ADMIN_TELEGRAM_ID) {
      const forwardMsg = `💬 *رسالة جديدة في التذكرة #${ticketId}*\n\n` +
        `👤 @${username || 'مجهول'}\n` +
        `📝 _${text}_`;
      
      try {
        await bot.sendMessage(ADMIN_TELEGRAM_ID, forwardMsg, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('[TELEGRAM] Forward failed:', e.message);
      }
    }
    
    // Save to DB via API
    try {
      const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
      await fetch(`${apiUrl}/api/support/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          sender: 'user',
          message: text
        })
      });
    } catch (e) {
      console.error('[TELEGRAM] Save message failed:', e.message);
    }
    
    // Acknowledge receipt
    return bot.sendMessage(chatId, `✅ تم استلام رسالتك! فريق الدعم سيرد عليك قريباً...`);
  }
  
  // Try FAQ match
  const faqMatch = findFAQMatch(text);
  
  if (faqMatch) {
    // Check if user wants human support
    if (text.includes('دعم') || text.includes('مساعدة') || text.includes('مو فاهم')) {
      // Create ticket for human support
      return createTicket(chatId, userId, username, text, 'support_request');
    }
    
    // Send FAQ reply
    const replyText = faqMatch.reply + '\n\n💡 هل تحتاج مساعدة اكثر؟ اكتب "دعم" للتحدث مع فريق الدعم';
    return bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
  }
  
  // No FAQ match - create ticket for human support
  return createTicket(chatId, userId, username, text, 'general');
}

// Create new support ticket
async function createTicket(chatId, userId, username, message, category) {
  const ticketId = require('crypto').randomUUID().substring(0, 8).toUpperCase();
  
  // Save to DB via API
  try {
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
    await fetch(`${apiUrl}/api/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId,
        telegramChatId: chatId,
        telegramUsername: username,
        message,
        category
      })
    });
  } catch (e) {
    console.error('[TELEGRAM] Create ticket failed:', e.message);
  }
  
  // Store in memory
  activeTickets.set(chatId, {
    ticketId,
    status: 'open',
    category,
    createdAt: Date.now()
  });
  
  // Notify admin
  await notifyAdmin(ticketId, { id: userId, username }, message, category);
  
  // Reply to user
  const replyText = `🎫 *تم فتح تذكرة دعم*\n\n` +
    `📋 رقم التذكرة: #${ticketId}\n` +
    `📂 التصنيف: ${category === 'support_request' ? 'طلب مساعدة' : 'عام'}\n\n` +
    `💬 فريق الدعم سيرد عليك قريباً...\n` +
    `⏰ وقت الرد المتوقع: خلال ساعة`;
  
  return bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
}

// Admin replies to ticket - called from API
async function adminReply(ticketId, message) {
  // Find ticket in memory first
  for (const [chatId, ticket] of activeTickets.entries()) {
    if (ticket.ticketId === ticketId && ticket.status === 'open') {
      try {
        await bot.sendMessage(chatId, `💬 *رد من فريق الدعم:*\n\n${message}`, { parse_mode: 'Markdown' });
        return { success: true };
      } catch (e) {
        console.error('[TELEGRAM] Admin reply failed:', e.message);
        return { error: e.message };
      }
    }
  }

  // If not found in memory, try DB via API
  try {
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
    const resp = await fetch(`${apiUrl}/api/admin/support/tickets/${ticketId}`);
    const data = await resp.json();
    if (data.success && data.ticket && data.ticket.telegram_chat_id) {
      const chatId = data.ticket.telegram_chat_id;
      await bot.sendMessage(chatId, `💬 *رد من فريق الدعم:*\n\n${message}`, { parse_mode: 'Markdown' });
      // Re-add to memory
      activeTickets.set(chatId, {
        ticketId,
        status: data.ticket.status,
        category: data.ticket.category,
        createdAt: Date.now()
      });
      return { success: true };
    }
  } catch (e) {
    console.error('[TELEGRAM] DB lookup failed:', e.message);
  }

  // Fallback: try to find user's telegram_id from users table via ticket username
  try {
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
    const resp = await fetch(`${apiUrl}/api/admin/support/tickets/${ticketId}`);
    const data = await resp.json();
    if (data.success && data.ticket && data.ticket.username) {
      // Get user's telegram info from users table
      const userResp = await fetch(`${apiUrl}/api/admin/users`);
      const userData = await userResp.json();
      if (userData.success && userData.users) {
        const targetUser = userData.users.find(u => u.username === data.ticket.username);
        if (targetUser && targetUser.telegram_id) {
          await bot.sendMessage(targetUser.telegram_id, `💬 *رد من فريق الدعم:*\n\n${message}`, { parse_mode: 'Markdown' });
          // Update ticket with telegram_chat_id for future use
          return { success: true };
        }
      }
    }
  } catch (e) {
    console.error('[TELEGRAM] User lookup fallback failed:', e.message);
  }

  return { error: 'Ticket not found or no Telegram chat ID' };
}

// Close ticket
async function closeTicket(ticketId) {
  for (const [chatId, ticket] of activeTickets.entries()) {
    if (ticket.ticketId === ticketId) {
      ticket.status = 'closed';
      
      try {
        await bot.sendMessage(chatId, `✅ *تم إغلاق التذكرة #${ticketId}*\n\nشكراً لتواصلك معنا! لو عندك سؤال جديد، تواصل مانا 🎧`, { parse_mode: 'Markdown' });
      } catch (e) {}
      
      // Update DB
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
  // Webhook endpoint
  app.post(webhookPath, express.json(), (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  
  // Set webhook URL
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (webhookUrl) {
    bot.setWebHook(webhookUrl + webhookPath).then(() => {
      console.log('[TELEGRAM] Webhook set to:', webhookUrl + webhookPath);
    }).catch(e => {
      console.error('[TELEGRAM] Webhook setup failed:', e.message);
    });
  }
  
  // Register message handler
  bot.on('message', handleUserMessage);
  
  console.log('[TELEGRAM] Bot initialized');
}

// ============ EXPORTS ============
module.exports = {
  bot,
  setupWebhook,
  adminReply,
  closeTicket,
  activeTickets
};
