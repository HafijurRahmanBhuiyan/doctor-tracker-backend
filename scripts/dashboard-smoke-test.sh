#!/bin/bash

BASE_URL=${BASE_URL:-http://localhost:5001/api/v1}
ENV_FILE="$(dirname "$0")/../.env"
ADMIN_EMAIL=$(grep "^ADMIN_EMAIL=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '[:space:]')
ADMIN_PASSWORD=$(grep "^ADMIN_PASSWORD=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '[:space:]')

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "Failed to read admin credentials from .env"
  exit 1
fi

PASSED=0
FAILED=0

pass() {
  echo "PASS: $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "FAIL: $1"
  FAILED=$((FAILED + 1))
}

# req METHOD URL [JSON_BODY] -> sets HTTP and BODY
req() {
  local method="$1" url="$2" data="$3" resp
  local auth_args=()
  if [ -n "$TOKEN" ]; then
    auth_args=(-H "Authorization: Bearer $TOKEN")
  fi
  if [ -n "$data" ]; then
    resp=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Content-Type: application/json" \
      "${auth_args[@]}" \
      -d "$data")
  else
    resp=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" "${auth_args[@]}")
  fi
  HTTP=$(printf '%s' "$resp" | tail -n1)
  BODY=$(printf '%s' "$resp" | sed '$d')
}

jqt() {
  printf '%s' "$BODY" | jq -e "$@" > /dev/null 2>&1
}

jqr() {
  printf '%s' "$BODY" | jq -r "$1" 2>/dev/null
}

TOKEN=""

# ---------- 401 without token ----------
req GET "$BASE_URL/dashboard/stats"
if [ "$HTTP" = "401" ]; then
  pass "401 without token (HTTP 401)"
else
  fail "401 without token (got HTTP $HTTP)"
fi

# ---------- Login ----------
resp=$(curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(printf '%s' "$resp" | jq -r '.data.token // empty')
if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
  pass "login (token received)"
else
  fail "login (no token) body=$(printf '%.200s' "$resp")"
  echo ""
  echo "=== Summary ==="
  echo "PASSED: $PASSED"
  echo "FAILED: $FAILED"
  exit 1
fi

# ---------- Fetch stats ----------
req GET "$BASE_URL/dashboard/stats"
if [ "$HTTP" != "200" ]; then
  fail "dashboard/stats (HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
  echo ""
  echo "=== Summary ==="
  echo "PASSED: $PASSED"
  echo "FAILED: $FAILED"
  exit 1
fi
pass "dashboard/stats (HTTP 200)"
STATS="$BODY"

# ---------- totals match list meta totals ----------
req GET "$BASE_URL/doctors?limit=1"
DOCTORS_TOTAL=$(jqr '.meta.total // -1')
req GET "$BASE_URL/patients?limit=1"
PATIENTS_TOTAL=$(jqr '.meta.total // -1')
if [ "$(printf '%s' "$STATS" | jq -r '.data.totals.doctors')" = "$DOCTORS_TOTAL" ]; then
  pass "totals.doctors == GET /doctors meta.total ($DOCTORS_TOTAL)"
else
  fail "totals.doctors ($(printf '%s' "$STATS" | jq -r '.data.totals.doctors')) != meta.total ($DOCTORS_TOTAL)"
fi
if [ "$(printf '%s' "$STATS" | jq -r '.data.totals.patients')" = "$PATIENTS_TOTAL" ]; then
  pass "totals.patients == GET /patients meta.total ($PATIENTS_TOTAL)"
else
  fail "totals.patients ($(printf '%s' "$STATS" | jq -r '.data.totals.patients')) != meta.total ($PATIENTS_TOTAL)"
fi

# ---------- patientsOverTime: 30 entries, ascending unique dates, sum == patientsAddedLast30Days ----------
if printf '%s' "$STATS" | jq -e '
  (.data.patientsOverTime | length) == 30
  and ([.data.patientsOverTime[].date] as $d
       | $d == ($d | sort)
       and ($d | unique | length) == ($d | length))
  and ([.data.patientsOverTime[].count] | add) == .data.patientsAddedLast30Days
' > /dev/null 2>&1; then
  pass "patientsOverTime: 30 entries, ascending unique dates, sum == patientsAddedLast30Days"
else
  fail "patientsOverTime structure/sum body=$(printf '%.300s' "$STATS")"
fi

# ---------- doctorsOverTime: exactly 6 entries ----------
if printf '%s' "$STATS" | jq -e '(.data.doctorsOverTime | length) == 6' > /dev/null 2>&1; then
  pass "doctorsOverTime has exactly 6 entries"
else
  fail "doctorsOverTime length=$(printf '%s' "$STATS" | jq -r '.data.doctorsOverTime | length')"
fi

# ---------- patientsPerDoctor: <=10, sorted desc by count, each has name ----------
if printf '%s' "$STATS" | jq -e '
  (.data.patientsPerDoctor | length) <= 10
  and all(.data.patientsPerDoctor[]; (.name | type) == "string" and (.name | length) > 0)
  and ([.data.patientsPerDoctor[].count] as $c | $c == ($c | sort | reverse))
' > /dev/null 2>&1; then
  pass "patientsPerDoctor: <=10, desc by count, each has name"
else
  fail "patientsPerDoctor structure body=$(printf '%.300s' "$STATS")"
fi

# ---------- conditionDistribution: <=7 entries, sum == totals.patients ----------
if printf '%s' "$STATS" | jq -e '
  (.data.conditionDistribution | length) <= 7
  and ([.data.conditionDistribution[].count] | add // 0) == .data.totals.patients
' > /dev/null 2>&1; then
  pass "conditionDistribution: <=7 entries, sum == totals.patients"
else
  fail "conditionDistribution len=$(printf '%s' "$STATS" | jq -r '.data.conditionDistribution | length') sum=$(printf '%s' "$STATS" | jq -r '[.data.conditionDistribution[].count] | add // 0') totals=$(printf '%s' "$STATS" | jq -r '.data.totals.patients')"
fi

# ---------- genderDistribution sum == totals.patients ----------
if printf '%s' "$STATS" | jq -e '
  ([.data.genderDistribution[].count] | add // 0) == .data.totals.patients
' > /dev/null 2>&1; then
  pass "genderDistribution sum == totals.patients"
else
  fail "genderDistribution sum=$(printf '%s' "$STATS" | jq -r '[.data.genderDistribution[].count] | add // 0') totals=$(printf '%s' "$STATS" | jq -r '.data.totals.patients')"
fi

# ---------- recentPatients: <=5, sorted newest first ----------
if printf '%s' "$STATS" | jq -e '
  (.data.recentPatients | length) <= 5
  and ([.data.recentPatients[].createdAt] as $c | $c == ($c | sort | reverse))
' > /dev/null 2>&1; then
  pass "recentPatients: <=5, sorted newest first"
else
  fail "recentPatients structure body=$(printf '%.300s' "$STATS")"
fi

# ---------- from/to range: single day returns 1 entry ----------
TODAY=$(date -u +%Y-%m-%d)
req GET "$BASE_URL/dashboard/stats?from=$TODAY&to=$TODAY"
if [ "$HTTP" = "200" ] && jqt '(.data.patientsOverTime | length) == 1'; then
  pass "from=to=today: patientsOverTime has 1 entry"
else
  fail "from=to=today body=$(printf '%.300s' "$BODY")"
fi

# ---------- invalid date returns 400 ----------
req GET "$BASE_URL/dashboard/stats?from=not-a-date"
if [ "$HTTP" = "400" ]; then
  pass "invalid date returns 400 (HTTP 400)"
else
  fail "invalid date (expected 400, got HTTP $HTTP)"
fi

# ---------- date-only range: records created NOW are inside from=to=today ----------
TOMORROW=$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d '1 day' +%Y-%m-%d 2>/dev/null)
RANGE_DOCTOR_EMAIL="dashboard.range@example.com"

# Sweep leftovers from a previous failed run so the create always succeeds
req GET "$BASE_URL/doctors?search=$RANGE_DOCTOR_EMAIL&limit=50"
for ID in $(jqr '.data[]._id // empty'); do
  curl -s -X DELETE "$BASE_URL/doctors/$ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
done

req POST "$BASE_URL/doctors" "{\"name\":\"Dashboard Range Doc\",\"specialization\":\"Cardiology\",\"hospital\":\"Dashboard Range Hospital\",\"phone\":\"9090909090\",\"email\":\"$RANGE_DOCTOR_EMAIL\"}"
RANGE_DOCTOR_ID=$(jqr '.data.doctor._id // empty')
req POST "$BASE_URL/patients" "{\"name\":\"Dashboard Range Patient\",\"age\":33,\"gender\":\"other\",\"phone\":\"9090909091\",\"condition\":\"DashboardRangeCondition\",\"doctorId\":\"$RANGE_DOCTOR_ID\"}"
RANGE_PATIENT_ID=$(jqr '.data.patient._id // empty')
if [ -n "$RANGE_DOCTOR_ID" ] && [ -n "$RANGE_PATIENT_ID" ]; then
  pass "setup: created doctor + patient now for the date range test"
else
  fail "setup: create doctor + patient body=$(printf '%.200s' "$BODY")"
fi

# A date-only `to` means the end of that UTC day, so the patient created now is included
req GET "$BASE_URL/dashboard/stats?from=$TODAY&to=$TODAY"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg day "$TODAY" \
  '(.data.patientsOverTime | length) == 1
   and .data.patientsOverTime[0].date == $day
   and .data.patientsOverTime[0].count >= 1' > /dev/null 2>&1; then
  pass "from=to=today (date-only): 1 patientsOverTime bucket for today with count >= 1"
else
  fail "from=to=today (date-only) body=$(printf '%.300s' "$BODY")"
fi

# from after to is rejected
req GET "$BASE_URL/dashboard/stats?from=$TOMORROW&to=$TODAY"
if [ "$HTTP" = "400" ]; then
  pass "inverted range (from > to) returns 400 (HTTP 400)"
else
  fail "inverted range (expected 400, got HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
fi

# ---------- cleanup: remove the doctor + patient created for the range test ----------
if [ -n "$RANGE_PATIENT_ID" ]; then
  curl -s -X DELETE "$BASE_URL/patients/$RANGE_PATIENT_ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
fi
if [ -n "$RANGE_DOCTOR_ID" ]; then
  curl -s -X DELETE "$BASE_URL/doctors/$RANGE_DOCTOR_ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
fi
req GET "$BASE_URL/doctors?search=$RANGE_DOCTOR_EMAIL&limit=50"
if [ "$HTTP" = "200" ] && [ "$(jqr '.data | length')" = "0" ]; then
  pass "cleanup: no leftover range test doctors"
else
  fail "cleanup: leftover range test doctor(s) body=$(printf '%.200s' "$BODY")"
fi

# ---------- calling twice returns same totals ----------
req GET "$BASE_URL/dashboard/stats"
STATS2="$BODY"
T1=$(printf '%s' "$STATS" | jq -c '.data.totals')
T2=$(printf '%s' "$STATS2" | jq -c '.data.totals')
if [ "$T1" = "$T2" ]; then
  pass "two calls return same totals ($T1)"
else
  fail "totals differ between calls: $T1 vs $T2"
fi

echo ""
echo "=== Summary ==="
echo "PASSED: $PASSED"
echo "FAILED: $FAILED"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
