#!/bin/bash
# check-db.sh - سكريبت فحص قاعدة البيانات

DB_ID="dpg-d8m7jm3tqb8s73adhb40-a"
SITE_URL="https://trading-platform-iglr.onrender.com"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  فحص قاعدة البيانات - Trading Platform ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# فحص السيرفر أولاً
echo -ne "فحص السيرفر... "
HEALTH=$(curl -s --connect-timeout 10 "$SITE_URL/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q "ok"; then
    echo -e "${GREEN}شغال${NC}"
else
    echo -e "${RED}فيه مشكلة${NC}"
fi

# فحص الـ database
echo -ne "فحص قاعدة البيانات... "
DB_INFO=$(curl -s "https://api.render.com/v1/postgres/$DB_ID" \
  -H "Authorization: Bearer $(cat $HOME/.render_api_key)" \
  -H "Accept: application/json" 2>/dev/null)

EXPIRES=$(echo "$DB_INFO" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('expiresAt','unknown'))
except:
    print('error')
" 2>/dev/null)

if [ "$EXPIRES" = "error" ] || [ -z "$EXPIRES" ]; then
    echo -e "${RED}ما قدرت أتصل${NC}"
    echo ""
    echo "تأكد من:"
    echo "  1. الاتصال بالإنترنت"
    echo "  2. الـ API key صحيح في ~/.render_api_key"
    exit 1
fi

DAYS_LEFT=$(python3 -c "
from datetime import datetime,timezone
try:
    exp = datetime.fromisoformat('${EXPIRES}'.replace('Z','+00:00'))
    now = datetime.now(timezone.utc)
    print(max(0,(exp-now).days))
except:
    print(0)
" 2>/dev/null)

echo -e "${GREEN}متصلة${NC}"
echo ""
echo "تاريخ الانتهاء: $EXPIRES"
echo "الايام المتبقية: $DAYS_LEFT يوم"
echo ""

if [ "$DAYS_LEFT" -le 5 ] && [ "$DAYS_LEFT" -gt 0 ]; then
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  تنبيه: قاعدة البيانات بتنتهي قريب!  ${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "خطوات التجديد:"
    echo "  1. افتح: https://neon.tech"
    echo "  2. سو حساب مجاني"
    echo "  3. انسخ الـ Connection String"
    echo "  4. ابعثه لهرمس"
    echo ""
    echo "الرابط يبقى ثابت: $SITE_URL"
    echo ""
    
    if command -v notify-send > /dev/null 2>&1; then
        notify-send -u critical "تنبيه Trading Platform" "باقي $DAYS_LEFT يوم على انتهاء قاعدة البيانات"
    fi
    
elif [ "$DAYS_LEFT" -le 10 ]; then
    echo -e "${YELLOW}تنبيه: باقي $DAYS_LEFT يوم على الانتهاء${NC}"
    echo ""
else
    echo -e "${GREEN}كل شي تمام! باقي $DAYS_LEFT يوم${NC}"
    echo ""
fi

echo -e "${CYAN}========================================${NC}"
echo ""
