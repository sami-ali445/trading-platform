#!/bin/bash
# Script to check and set webhook for Telegram bot
# Run: bash /home/kali/Desktop/trading-platform/check-webhook.sh

TOKEN="8795808560:***"
SECRET="tp_webhook_secret_2025_secure_random_token_xyz123"
URL="https://trading-platform-iglr.onrender.com/webhook/telegram"

echo "=== Current webhook status ==="
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
echo ""

echo "=== Deleting old webhook ==="
curl -s "https://api.telegram.org/bot${TOKEN}/deleteWebhook"
echo ""

echo "=== Setting new webhook ==="
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${URL}\",\"secret_token\":\"${SECRET}\",\"max_connections\":40,\"allowed_updates\":[\"message\"]}"
echo ""

echo "=== Verify new webhook ==="
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
echo ""
