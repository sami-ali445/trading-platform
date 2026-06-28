# Trading Platform (جولدن غريد) - دليل الإعداد النهائي
## الإصدار 5.9.1 | آخر تحديث: 2026-06-28

---

## 1. إعدادات البوت والـ Webhook

### التوكنات والمفاتيح
| المتغير | القيمة | الوصف |
|---------|--------|-------|
| `TELEGRAM_BOT_TOKEN` | `8795808560:***` | توكن البوت الأساسي |
| `TELEGRAM_SECRET_TOKEN` | `tp_webhook_secret_2025_secure_random_token_xyz123` | سري للتحقق من الـ webhook |
| `ADMIN_TELEGRAM_ID` | `8916948567,555666777` | أرقام الأدمن (مفصولة بفاصلة) |
| `RENDER_EXTERNAL_URL` | `https://trading-platform-iglr.onrender.com` | رابط السيرفر الخارجي |

### آلية الـ Webhook التلقائية
- عند تشغيل السيرفر، يتم تلقائياً استدعاء `setWebhook` بعد 5 ثوانٍ (لضمان جاهزية المنفذ)
- إذا فشل الـ setWebhook، يتم إعادة المحاولة 5 مرات مع تأخير (3s, 6s, 9s, 12s, 15s)
- يمكن إعادة ضبط الـ webhook يدوياً عبر: `POST /api/telegram/set-webhook`
- للتحقق من حالة الـ webhook: `GET /api/telegram/webhook-info`

### ملاحظات مهمة
- التوكن مقنع (masked) في الـ Agent — لا يمكن استدعاء Telegram API مباشرة
- كل عمليات الـ webhook تتم من السيرفر مباشرة باستخدام الـ env vars
- في حالة فشل الـ webhook، يتم إرسال الخطأ في الـ response للمستخدم

---

## 2. نظام الدعم الفني (Support System)

### آلية العمل
```
عميل يرسل من الموقع → تذكرة تُنشأ في DB → إشعار للأدمن عبر التلغرام
أدمن يرد من التلغرام → الرد يُحفظ في DB → العميل يشاهده في الموقع (كل 8 ثوانٍ)
```

### أولويات تحديد التذكرة عند رد الأدمن
1. **reply_to_message** — إذا كان الأدمن يرد على رسالة معينة
2. **activeTickets** — التذاكر المفتوحة في ذاكرة البوت (للتلغرام)
3. **adminLastTicket** — آخر تذكرة رد عليها الأدمن (للتذكر)
4. **DB Fallback** — أول تذكرة مفتوحة في قاعدة البيانات

### Direct DB Calls (بدون HTTP)
البوت يستخدم `telegramBotDb.js` للوصول المباشر لقاعدة البيانات بدون HTTP self-calls:
- `saveMessage(ticketId, sender, message)` — حفظ رسالة
- `getOpenTickets(limit)` — جلب التذاكر المفتوحة
- `getTicket(ticketId)` — جلب تذكرة محددة
- `findUserByName(username)` — البحث عن مستخدم

### تحديث الفرونت إند
- يتم تحديث الرسائل تلقائياً كل 8 ثوانٍ
- إذا كان للعميل `ticketId` مخزن، يتم إرساله في الـ query للمطابقة الدقيقة
- إذا ما في `ticketId`، يتم البحث بـ `username` فقط

---

## 3. الـ API Endpoints

### للأدمن (تتطلب auth)
| Endpoint | Method | الوصف |
|----------|--------|-------|
| `/api/admin/support/tickets` | GET | جلب كل التذاكر |
| `/api/admin/support/tickets/:id` | GET | جلب تذكرة مع رسائلها |
| `/api/admin/support/tickets/:id/reply` | POST | رد على تذكرة |
| `/api/admin/support/tickets/:id/close` | POST | إغلاق تذكرة |
| `/api/admin/support/tickets/:id/reopen` | POST | إعادة فتح تذكرة |
| `/api/admin/support/stats` | GET | إحصائيات التذاكر |

### للمستخدمين (تتطلب auth)
| Endpoint | Method | الوصف |
|----------|--------|-------|
| `/api/user/support/ticket` | GET | جلب تذكرة المستخدم الحالية |
| `/api/user/support/message` | POST | إرسال رسالة جديدة |
| `/api/user/support/new-ticket` | POST | فتح تذكرة جديدة |

### للبوت (عامة/داخلي)
| Endpoint | Method | الوصف |
|----------|--------|-------|
| `/api/telegram/open-tickets` | GET | جلب التذاكر المفتوحة (للبوت) |
| `/api/telegram/set-webhook` | POST | إعادة ضبط الـ webhook |
| `/api/telegram/webhook-info` | GET | حالة الـ webhook |
| `/api/telegram/last-admin-message` | GET | آخر رسالة من الأدمن (للتجربة) |
| `/api/telegram/all-chat-ids` | GET | كل الـ chat IDs (للتجربة) |
| `/api/telegram/health` | GET | فحص صحي + ضبط webhook |

---

## 4. هيكل الملفات المهمة

```
trading-platform/
├── server.js              # السيرفر الرئيسي + تصدير DB functions للبوت
├── telegramBot.js         # بوت التلغرام + معالجة الرسائل + webhook setup
├── telegramBotDb.js       # Shared module لـ direct DB calls
├── supportRoutes.js       # API  routes لنظام الدعم
├── frontend/
│   └── src/
│       ├── SupportChat.jsx    # مكون الدعم للمستخدمين (8s refresh)
│       └── AdminSupport.jsx   # لوحة الأدمن
├── public/                # الملفات المبنية (frontend/dist)
└── render.yaml            # إعدادات Render
```

---

## 5. استكشاف الأخطاء

### المشكلة: الرد من التلغرام ما يوصل للموقع
**الأسباب المحتملة:**
1. الـ webhook ممسوح → الحل: `POST /api/telegram/set-webhook`
2. الكاش قديم → الحل: إعادة تشغيل السيرفر من Render Dashboard
3. التذكرة مغلقة → الحل: `POST /api/admin/support/tickets/:id/reopen`

**خطوات التشغيل:**
1. تأكد إن الـ webhook شغال: `GET /api/telegram/webhook-info`
2. تأكد إن التذكرة مفتوحة: `GET /api/telegram/open-tickets`
3. جرب الحفظ مباشرة: `POST /api/support/messages` مع `ticketId` صحيح
4. تحقق من الـ logs في Render Dashboard

### المشكلة: الـ webhook ينفصل بعد كل deploy
**الحل:** تم إضافة `ensureWebhook` التلقائي عند الـ startup + retry logic

### المشكلة: السيرفر ينهار عند استقبال رسالة من التلغرام
**السبب:** HTTP self-calls كانت تسبب crash
**الحل:** تم التحويل إلى direct DB calls عبر `telegramBotDb.js`

---

## 6. أوامر مفيدة

```bash
# إعادة بناء الفرونت إند
npm run build

# تشغيل السيرفر محلياً
node server.js

# فحص حالة السيرفر
curl https://trading-platform-iglr.onrender.com/api/health

# فحص الـ webhook
curl https://trading-platform-iglr.onrender.com/api/telegram/webhook-info

# إعادة ضبط الـ webhook يدوياً
curl -X POST https://trading-platform-iglr.onrender.com/api/telegram/set-webhook
```

---

## 7. ملخص التعديلات الأخيرة (2026-06-28)

1. ✅ إضافة `ensureWebhook()` التلقائي مع retry logic
2. ✅ إنشاء `telegramBotDb.js` للـ direct DB calls
3. ✅ إزالة كل الـ HTTP self-calls من البوت
4. ✅ تحسين `loadTicket` في الفرونت إند لدعم `ticketId` query
5. ✅ إضافة `adminLastTicket` لتذكر آخر تذكرة رد عليها الأدمن
6. ✅ تحسين error handling في كل عمليات الحفظ
7. ✅ إضافة validation في `saveMessage` للتأكد من وجود التذكرة
8. ✅ تغيير ترتيب البحث في `getOpenTickets` إلى `created_at ASC`

---

تم التوثيق بواسطة: Hermes Agent
التاريخ: 2026-06-28
