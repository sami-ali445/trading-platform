#!/bin/bash
# سكريبت تجديد الـ database على Render
# يشتغل تلقائي كل 25 يوم

echo "🔄 جاري تجديد قاعدة البيانات..."

# إنشاء database جديد
DB_RESPONSE=$(curl -s -X POST "https://api.render.com/v1/postgres" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"trading-db-renewed","plan":"free","version":"16","ownerId":"tea-d8k3jkjjdbms73f4f5h0"}')

NEW_DB_ID=$(echo $DB_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# انتظار 5 دقائق
sleep 300

# الحصول على connection string
CONN_INFO=$(curl -s "https://api.render.com/v1/postgres/$NEW_DB_ID/connection-info" \
  -H "Authorization: Bearer $RENDER_API_KEY")

NEW_DB_URL=$(echo $CONN_INFO | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['externalConnectionString'])")

# تحديث الـ service
curl -s -X PUT "https://api.render.com/v1/services/srv-d8m7k8gjs32c73dskc90/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "[{\"key\":\"DATABASE_URL\",\"value\":\"$NEW_DB_URL\"}]"

# إعادة نشر
curl -s -X POST "https://api.render.com/v1/services/srv-d8m7k8gjs32c73dskc90/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY"

echo "✅ تم تجديد قاعدة البيانات بنجاح!"
