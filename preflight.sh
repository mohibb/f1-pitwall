#!/bin/bash

BASE_URL="http://localhost:8000"
PASS="✅"
FAIL="❌"
ALL_GOOD=true
COOKIE_JAR="/tmp/f1_preflight_cookies.txt"

echo ""
echo "═══════════════════════════════════"
echo "   F1 Pit Wall — Preflight Check   "
echo "═══════════════════════════════════"
echo ""

# 1. Server running
if pgrep -f "uvicorn" > /dev/null; then
    echo "$PASS Server is running"
else
    echo "$FAIL Server is NOT running — run: bash start.sh"
    ALL_GOOD=false
fi

# 2. Cloudflare tunnel running
if pgrep -f "cloudflared" > /dev/null; then
    echo "$PASS Cloudflare tunnel is active"
else
    echo "$FAIL Cloudflare tunnel is NOT running"
    ALL_GOOD=false
fi

# 3. /api/health responds
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health")
if [ "$HEALTH" = "200" ]; then
    echo "$PASS /api/health responded 200"
else
    echo "$FAIL /api/health returned $HEALTH"
    ALL_GOOD=false
fi

# 4. /api/health details
HEALTH_BODY=$(curl -s "$BASE_URL/api/health")
MODE=$(echo "$HEALTH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('mode','unknown'))" 2>/dev/null)
UPTIME=$(echo "$HEALTH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uptime','unknown'))" 2>/dev/null)
LAST_UPDATE=$(echo "$HEALTH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('last_update','unknown'))" 2>/dev/null)

if [ -n "$MODE" ] && [ "$MODE" != "unknown" ]; then
    echo "$PASS Mode: $MODE"
else
    echo "$FAIL Could not read mode from /api/health"
    ALL_GOOD=false
fi

echo "   Uptime: $UPTIME"
echo "   Last update: $LAST_UPDATE"

# 5. Login to get cookie
rm -f "$COOKIE_JAR"
LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -c "$COOKIE_JAR" \
    -X POST "$BASE_URL/login" \
    -d "username=mohibb&password=f1pitwall2026" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -L)

# 6. /api/state with cookie
STATE=$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$COOKIE_JAR" \
    "$BASE_URL/api/state")

if [ "$STATE" = "200" ]; then
    echo "$PASS /api/state responded 200"
else
    echo "$FAIL /api/state returned $STATE (login status: $LOGIN_STATUS)"
    ALL_GOOD=false
fi

# Summary
echo ""
echo "───────────────────────────────────"
if [ "$ALL_GOOD" = true ]; then
    echo "   ✅ All checks passed. Good to go!"
else
    echo "   ❌ Some checks failed. Fix before session."
fi
echo "───────────────────────────────────"
echo ""

rm -f "$COOKIE_JAR"
