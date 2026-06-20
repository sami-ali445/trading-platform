#!/bin/bash
# fix-bot.sh - سكريبت إصلاح البوت
# يشتغل من مجلد المشروع: cd /home/kali/Desktop/trading-platform

echo "=== 1. الدخول لمجلد المشروع ==="
cd /home/kali/Desktop/trading-platform

echo "=== 2. التأكد من أن المجلد صحيح ==="
pwd

echo "=== 3. حفظ نسخة احتياطية ==="
cp telegramBot.js telegramBot.js.backup
cp supportRoutes.js supportRoutes.js.backup
cp server.js server.js.backup
echo "✅ نسخ احتياطية محفوظة"

echo "=== 4. التحقق من الملفات الحالية ==="
echo "telegramBot.js حجم: $(wc -c < telegramBot.js) bytes"
echo "supportRoutes.js حجم: $(wc -c < supportRoutes.js) bytes"
echo "server.js حجم: $(wc -c < server.js) bytes"

echo "=== 5. التحقق من git status ==="
git status

echo "=== 6. التحقق من آخر commit ==="
git log --oneline -1

echo ""
echo "✅ السكريبت جاهز!"
echo "الملفات الحالية لم تتعدل - بس تم إنشاء نسخ احتياطية"
echo ""
echo "الخطوة التالية: اكتب الامر اللي تبيه وأنا أنفذه"
