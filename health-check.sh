#!/bin/bash
# Trading Platform - Health Check & Alert Script
# Run daily via cron

LOG_FILE="/home/kali/Desktop/trading-platform/health-check.log"
URL="https://trading-platform-iglr.onrender.com/api/health"

echo "=== Health Check: $(date) ===" >> $LOG_FILE

# Check if site is up
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $URL 2>/dev/null)
echo "HTTP Status: $HTTP_CODE" >> $LOG_FILE

if [ "$HTTP_CODE" != "200" ]; then
    echo "⚠️ ALERT: Site is DOWN! HTTP $HTTP_CODE" >> $LOG_FILE
    # Send notification (if telegram bot is configured)
    # curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=⚠️ Trading Platform DOWN! HTTP $HTTP_CODE"
fi

# Check database connectivity
DB_CHECK=$(curl -s $URL | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('db','unknown'))" 2>/dev/null)
echo "Database: $DB_CHECK" >> $LOG_FILE

if [ "$DB_CHECK" != "True" ] && [ "$DB_CHECK" != "true" ]; then
    echo "⚠️ ALERT: Database connection issue!" >> $LOG_FILE
fi

# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
echo "Disk Usage: ${DISK_USAGE}%" >> $LOG_FILE

if [ "$DISK_USAGE" -gt 90 ]; then
    echo "⚠️ ALERT: Disk usage is ${DISK_USAGE}%!" >> $LOG_FILE
fi

echo "---" >> $LOG_FILE
