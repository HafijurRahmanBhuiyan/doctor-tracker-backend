#!/bin/bash
# Lightweight check of the general rate limiter. Starts nothing: the API has to
# be running already (BASE_URL).

BASE_URL=${BASE_URL:-http://localhost:5001/api/v1}
ENV_FILE="$(dirname "$0")/../.env"
ADMIN_EMAIL=$(grep "^ADMIN_EMAIL=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '[:space:]')
ADMIN_PASSWORD=$(grep "^ADMIN_PASSWORD=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')
RATE_LIMIT_MAX=$(grep "^RATE_LIMIT_MAX=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')
RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-600}
HEALTH_REQUESTS=50

FAILED=0

# ---------- health checks are never throttled ----------
OK=0
for _ in $(seq 1 $HEALTH_REQUESTS); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")
  [ "$CODE" = "200" ] && OK=$((OK + 1))
done
if [ "$OK" = "$HEALTH_REQUESTS" ]; then
  echo "PASS: $HEALTH_REQUESTS x GET /health returned 200 (no 429)"
else
  echo "FAIL: only $OK/$HEALTH_REQUESTS health checks returned 200"
  FAILED=$((FAILED + 1))
fi

# ---------- RateLimit-* headers on a normal request ----------
TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r '.data.token // empty')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "FAIL: login failed (no token)"
  exit 1
fi

HEADERS=$(curl -s -D - -o /dev/null "$BASE_URL/doctors?limit=1" -H "Authorization: Bearer $TOKEN")
echo "--- headers of GET /doctors ---"
printf '%s\n' "$HEADERS" | grep -iE '^(HTTP/|ratelimit-|retry-after|x-ratelimit-)'

LIMIT=$(printf '%s\n' "$HEADERS" | grep -i '^ratelimit-limit:' | tail -n1 | tr -d '\r' | awk '{print $2}')
if [ "$LIMIT" = "$RATE_LIMIT_MAX" ]; then
  echo "PASS: RateLimit-Limit == RATE_LIMIT_MAX ($RATE_LIMIT_MAX)"
else
  echo "FAIL: RateLimit-Limit ($LIMIT) != RATE_LIMIT_MAX ($RATE_LIMIT_MAX)"
  FAILED=$((FAILED + 1))
fi

if printf '%s\n' "$HEADERS" | grep -qi '^x-ratelimit-'; then
  echo "FAIL: legacy X-RateLimit-* headers are still sent"
  FAILED=$((FAILED + 1))
else
  echo "PASS: no legacy X-RateLimit-* headers"
fi

# ---------- summary ----------
echo ""
echo "=== Summary ==="
echo "FAILED: $FAILED"
[ "$FAILED" -gt 0 ] && exit 1
exit 0
