#!/bin/bash
# ============================================
# سكريبت مراقبة وتجديد قاعدة البيانات
# يشتغل بضغطة زر - يتحقق من التاريخ ويذكّرك
# ============================================

RENDER_API_KEY="rnd_...5f"
DB_ID="dpg-d8m7jm3tqb8s73adhb40-a"
SVC_ID="srv-d8m7k8gjs32c73dskc90"
OWNER_ID="tea-d8k3jkjjdbms73f4f5h0"
DB_CREATED="2026-06-12"
DAYS_TOTAL=30
WARN_BEFORE=5

# حساب الأيام
TODAY=$(date -u +%Y-%m-%d)
DAYS_PASSED=$(( ( $(date -d "$TODAY" +%s) - $(date -d "$DB_CREATED" +%s) ) / 86400 ))
DAYS_LEFT=$(( DAYS_TOTAL - DAYS_PASSED ))

echo "============================================"
echo "  📊 حالة قاعدة البيانات"
echo "============================================"
echo "  📅 تاريخ الإنشاء: $DB_CREATED"
echo "  ⏰ الأيام المنقضية: $DAYS_PASSED يوم"
echo "  ⏳ المتبقي: $DAYS_LEFT يوم"
echo "  🔗 الرابط: https://trading-platform-iglr.onrender.com"
echo "============================================"

if [ $DAYS_LEFT -le $WARN_BEFORE ] && [ $DAYS_LEFT -gt 0 ]; then
    echo ""
    echo "  ⚠️  تنبيه! باقي $DAYS_LEFT يوم على انتهاء قاعدة البيانات!"
    echo ""
    echo "  🔧 خطوات التجديد (سهلة):"
    echo "  1️⃣  افتح الرابط: https://neon.tech أو https://app.supabase.com"
    echo "  2️⃣  سوّي مشروع جديد وانسخ الـ connection string"
    echo "  3️⃣  ابعثه لهرمس وأنا أعدّل كل شي تلقائي"
    echo ""
    echo "  💡 أو شغّل هذا السكريبت بالأمر:"
    echo "     bash ~/Desktop/trading-platform/auto-renew.sh"
    echo ""
    
    read -p "  🚀 تبي أجدد لك الحين؟ (y/n): " ANSWER
    if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
        echo ""
        echo "  🔄 جاري إنشاء قاعدة بيانات جديدة..."
        
        # إنشاء database جديد
        NEW_DB=$(curl -s -X POST "https://api.render.com/v1/postgres" \
          -H "Authorization: Bearer $RENDER_API_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"name\":\"trading-db-$(date +%Y%m%d)\",\"plan\":\"free\",\"version\":\"16\",\"ownerId\":\"$OWNER_ID\"}")
        
        NEW_DB_ID=$(echo "$NEW_DB" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null)
        
        if [ "$NEW_DB_ID" = "?" ] || [ -z "$NEW_DB_ID" ]; then
            echo "  ❌ فشل الإنشاء. جرب يدوي من: https://dashboard.render.com"
            exit 1
        fi
        
        echo "  ✅ تم إنشاء قاعدة بيانات جديدة! ID: $NEW_DB_ID"
        echo "  ⏳ جاري الانتظار 3 دقائق لين تكون جاهزة..."
        
        # انتظار 3 دقائق
        for i in 1 2 3; do
            sleep 60
            echo "     ...دقيقة $i"
        done
        
        # الحصول على connection string
        CONN_INFO=$(curl -s "https://api.render.com/v1/postgres/$NEW_DB_ID/connection-info" \
          -H "Authorization: Bearer $RENDER_API_KEY")
        
        NEW_DB_URL=$(echo "$CONN_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('externalConnectionString',''))" 2>/dev/null)
        
        if [ -z "$NEW_DB_URL" ]; then
            echo "  ❌ ما قدرت أحصل على الـ connection string"
            echo "  📋 روح على: https://dashboard.render.com/d/$NEW_DB_ID-a"
            exit 1
        fi
        
        echo "  ✅ تم الحصول على الـ connection string"
        
        # تحديث الـ service
        echo "  🔧 جاري تحديث السيرفر..."
        curl -s -X PUT "https://api.render.com/v1/services/$SVC_ID/env-vars" \
          -H "Authorization: Bearer $RENDER_API_KEY" \
          -H "Content-Type: application/json" \
          -d "[{\"key\":\"DATABASE_URL\",\"value\":\"$NEW_DB_URL\"}]" > /dev/null
        
        # إعادة نشر
        echo "  🚀 جاري إعادة النشر..."
        curl -s -X POST "https://api.render.com/v1/services/$SVC_ID/deploys" \
          -H "Authorization: Bearer $RENDER_API_KEY" > /dev/null
        
        echo ""
        echo "  ✅✅✅ تم التجديد بنجاح! ✅✅✅"
        echo "  🔗 الرابط يبقى شغال: https://trading-platform-iglr.onrender.com"
        echo "  ⏰ تاريخ التجديد القادم: $(date -u -d "+25 days" +%Y-%m-%d)"
    fi

elif [ $DAYS_LEFT -le 0 ]; then
    echo ""
    echo "  ❌ انتهت قاعدة البيانات! المنصة ما تشتغل الحين."
    echo "  🚀 شغّل السكريبت بالأمر: bash ~/Desktop/trading-platform/auto-renew.sh"
    echo "  واختار 'y' للتجديد الفوري"
else
    echo ""
    echo "  ✅ كل شي تمام! باقي $DAYS_LEFT يوم"
    echo "  📅 تاريخ التجديد القادم: $(date -u -d "+$((DAYS_LEFT - WARN_BEFORE)) days" +%Y-%m-%d)"
fi

echo ""
echo "============================================"
