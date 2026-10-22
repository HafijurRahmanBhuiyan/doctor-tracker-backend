#!/bin/bash

BASE_URL=${BASE_URL:-http://localhost:5001/api/v1}
ENV_FILE="$(dirname "$0")/../.env"
ADMIN_EMAIL=$(grep "^ADMIN_EMAIL=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '[:space:]')
ADMIN_PASSWORD=$(grep "^ADMIN_PASSWORD=" "$ENV_FILE" | cut -d'=' -f2 | tr -d '[:space:]')
MONGO_URI=$(grep "^MONGO_URI=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')

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
    resp=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" \
      "${auth_args[@]}")
  fi
  HTTP=$(printf '%s' "$resp" | tail -n1)
  BODY=$(printf '%s' "$resp" | sed '$d')
}

# assert_status NAME EXPECTED
assert_status() {
  if [ "$HTTP" = "$2" ]; then
    pass "$1 (HTTP $HTTP)"
  else
    fail "$1 (expected HTTP $2, got HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
  fi
}

# assert_true NAME (run a jq -e test on $BODY afterwards via explicit ifs)

TOKEN=""
DOC_ID=""      # doctor A (smoke doc)
PAT_ID=""      # patient under doctor A
DOC_B_ID=""    # second doctor (wrong-doctor delete test)
DOC_C_ID=""    # cascade test doctor

# ---------- Login ----------
req POST "$BASE_URL/auth/login" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
TOKEN=$(printf '%s' "$BODY" | jq -r '.data.token // empty' 2>/dev/null)
if [ "$HTTP" = "200" ] && [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
  pass "login (HTTP 200, token received)"
else
  fail "login (HTTP $HTTP, token=$TOKEN) body=$(printf '%.200s' "$BODY")"
  echo ""
  echo "=== Summary ==="
  echo "PASSED: $PASSED"
  echo "FAILED: $FAILED"
  exit 1
fi

# ---------- Create doctor A ----------
req POST "$BASE_URL/doctors" '{"name":"Smoke Test Doc","specialization":"Cardiology","hospital":"Smoke Hospital","phone":"1111111111","email":"smoke.test.doc@example.com"}'
assert_status "create doctor" "201"
DOC_ID=$(printf '%s' "$BODY" | jq -r '.data.doctor._id // empty')
if [ -n "$DOC_ID" ] && [ "$(printf '%s' "$BODY" | jq -r '.data.doctor.email')" = "smoke.test.doc@example.com" ] \
   && [ "$(printf '%s' "$BODY" | jq -r '.data.doctor.specialization')" = "Cardiology" ]; then
  pass "create doctor content (email + specialization match)"
else
  fail "create doctor content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Duplicate email ----------
req POST "$BASE_URL/doctors" '{"name":"Smoke Test Doc2","specialization":"Cardiology","hospital":"Smoke Hospital","phone":"2222222222","email":"smoke.test.doc@example.com"}'
assert_status "duplicate email" "409"

# ---------- Validation error ----------
req POST "$BASE_URL/doctors" '{"name":"Bad Doc"}'
assert_status "validation error bad body" "400"

# ---------- List doctors with pagination ----------
req GET "$BASE_URL/doctors?page=1&limit=10"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e '.meta.page == 1 and .meta.limit == 10 and (.meta.total | type == "number") and (.meta.totalPages | type == "number")' > /dev/null 2>&1; then
  pass "list doctors pagination meta (page/limit/total/totalPages)"
else
  fail "list doctors pagination meta body=$(printf '%.200s' "$BODY")"
fi

# ---------- Search: >=1 item and smoke doctor present ----------
req GET "$BASE_URL/doctors?search=Smoke"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg id "$DOC_ID" '(.data | length) >= 1 and any(.data[]; ._id == $id)' > /dev/null 2>&1; then
  pass "search: >=1 item and smoke doctor included"
else
  fail "search content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Specialization filter: every doctor has that specialization ----------
req GET "$BASE_URL/doctors?specialization=Cardiology&limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e '(.data | length) >= 1 and all(.data[]; .specialization == "Cardiology")' > /dev/null 2>&1; then
  pass "specialization filter: all results are Cardiology"
else
  fail "specialization filter content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Hospital filter ----------
req GET "$BASE_URL/doctors?hospital=Smoke%20Hospital&limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e 'all(.data[]; .hospital == "Smoke Hospital")' > /dev/null 2>&1; then
  pass "hospital filter: all results are Smoke Hospital"
else
  fail "hospital filter content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Date filter: from=yesterday includes smoke doctor ----------
FROM_YESTERDAY=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
FROM_TOMORROW=$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
req GET "$BASE_URL/doctors?from=$FROM_YESTERDAY&limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg id "$DOC_ID" 'any(.data[]; ._id == $id)' > /dev/null 2>&1; then
  pass "date filter from=yesterday includes smoke doctor"
else
  fail "date filter from=yesterday body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/doctors?from=$FROM_TOMORROW&limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e '(.data | length) == 0 and .meta.total == 0' > /dev/null 2>&1; then
  pass "date filter from=tomorrow returns 0 items"
else
  fail "date filter from=tomorrow body=$(printf '%.200s' "$BODY")"
fi

# ---------- Date-only range: `to` must mean the END of that Asia/Dhaka day ----------
# The smoke doctor is created NOW, so a date-only `to` = today has to include it.
# Today/tomorrow are computed in Asia/Dhaka, the timezone of the API.
TODAY=$(TZ=Asia/Dhaka date +%Y-%m-%d)
TOMORROW=$(TZ=Asia/Dhaka date -v+1d +%Y-%m-%d 2>/dev/null || TZ=Asia/Dhaka date -d '1 day' +%Y-%m-%d 2>/dev/null)
req GET "$BASE_URL/doctors?from=$TODAY&to=$TODAY&limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg id "$DOC_ID" 'any(.data[]; ._id == $id)' > /dev/null 2>&1; then
  pass "date-only from=to=today includes the smoke doctor (end-of-day semantics)"
else
  fail "date-only from=to=today body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/doctors?from=$TOMORROW&to=$TOMORROW&limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg id "$DOC_ID" 'all(.data[]; ._id != $id)' > /dev/null 2>&1; then
  pass "date-only from=to=tomorrow excludes the smoke doctor"
else
  fail "date-only from=to=tomorrow body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/doctors?from=$TOMORROW&to=$TODAY"
assert_status "date-only inverted range (from > to)" "400"
req GET "$BASE_URL/doctors?from=not-a-date"
assert_status "date-only invalid date" "400"

# ---------- Limit > 50 capped ----------
req GET "$BASE_URL/doctors?limit=100"
if [ "$HTTP" = "200" ]; then
  LIM=$(printf '%s' "$BODY" | jq -r '.meta.limit // 0')
  if [ "$LIM" -le 50 ]; then
    pass "limit > 50 capped to $LIM"
  else
    fail "limit not capped (got $LIM)"
  fi
else
  fail "limit cap (HTTP $HTTP)"
fi

# ---------- Filters options ----------
req GET "$BASE_URL/doctors/filters/options"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e '(.data.specializations | type == "array") and (.data.hospitals | type == "array") and (.data.specializations | index("Cardiology") != null)' > /dev/null 2>&1; then
  pass "filters/options: arrays include Cardiology"
else
  fail "filters/options content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Get one doctor with patientCount ----------
req GET "$BASE_URL/doctors/$DOC_ID"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e '.data.doctor.patientCount | type == "number"' > /dev/null 2>&1; then
  pass "get doctor includes numeric patientCount"
else
  fail "get doctor patientCount body=$(printf '%.200s' "$BODY")"
fi

# ---------- Update doctor ----------
req PUT "$BASE_URL/doctors/$DOC_ID" '{"hospital":"Updated Hospital"}'
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e '.data.doctor.hospital == "Updated Hospital"' > /dev/null 2>&1; then
  pass "update doctor returns updated hospital"
else
  fail "update doctor content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Invalid / unknown / no token ----------
req GET "$BASE_URL/doctors/invalidid"
assert_status "invalid ObjectId" "400"
req GET "$BASE_URL/doctors/000000000000000000000000"
assert_status "unknown id" "404"
TOKEN_SAVED="$TOKEN"; TOKEN=""
req GET "$BASE_URL/doctors"
TOKEN="$TOKEN_SAVED"
assert_status "no token" "401"

# ---------- Add patient under doctor A ----------
req POST "$BASE_URL/doctors/$DOC_ID/patients" '{"name":"Test Patient","age":25,"gender":"female","phone":"3333333333","condition":"Flu"}'
assert_status "add patient" "201"
PAT_ID=$(printf '%s' "$BODY" | jq -r '.data.patient._id // empty')
if [ -n "$PAT_ID" ] && [ "$(printf '%s' "$BODY" | jq -r '.data.patient.doctor')" = "$DOC_ID" ]; then
  pass "add patient content (belongs to doctor A)"
else
  fail "add patient content body=$(printf '%.200s' "$BODY")"
fi

# ---------- List doctor's patients with search ----------
req GET "$BASE_URL/doctors/$DOC_ID/patients?search=Flu"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg id "$PAT_ID" '(.data | length) >= 1 and any(.data[]; ._id == $id)' > /dev/null 2>&1; then
  pass "list patients search=Flu finds the patient"
else
  fail "list patients search content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Wrong-doctor delete: patient of A via doctor B -> 404, patient survives ----------
req POST "$BASE_URL/doctors" '{"name":"Smoke Doctor B","specialization":"Neurology","hospital":"Smoke Hospital B","phone":"2223334444","email":"smoke.doc.b@example.com"}'
if [ "$HTTP" = "201" ]; then
  DOC_B_ID=$(printf '%s' "$BODY" | jq -r '.data.doctor._id // empty')
  pass "create doctor B (HTTP 201)"
else
  fail "create doctor B (HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
fi
req DELETE "$BASE_URL/doctors/$DOC_B_ID/patients/$PAT_ID"
assert_status "delete patient through wrong doctor id" "404"
req GET "$BASE_URL/doctors/$DOC_ID/patients?limit=50"
if [ "$HTTP" = "200" ] && printf '%s' "$BODY" | jq -e --arg id "$PAT_ID" 'any(.data[]; ._id == $id)' > /dev/null 2>&1; then
  pass "patient still exists under doctor A after wrong-doctor delete"
else
  fail "patient missing after wrong-doctor delete body=$(printf '%.200s' "$BODY")"
fi

# ---------- Delete patient (correct doctor) ----------
req DELETE "$BASE_URL/doctors/$DOC_ID/patients/$PAT_ID"
assert_status "delete patient" "200"

# ---------- Cascade delete: doctor C with 2 patients, verify via mongosh ----------
req POST "$BASE_URL/doctors" '{"name":"Smoke Cascade Doc","specialization":"Ortho","hospital":"Cascade Hospital","phone":"5556667777","email":"smoke.cascade@example.com"}'
DOC_C_ID=$(printf '%s' "$BODY" | jq -r '.data.doctor._id // empty')
req POST "$BASE_URL/doctors/$DOC_C_ID/patients" '{"name":"Cascade Patient 1","age":30,"gender":"male","phone":"6666666661","condition":"Back Pain"}'
req POST "$BASE_URL/doctors/$DOC_C_ID/patients" '{"name":"Cascade Patient 2","age":45,"gender":"other","phone":"6666666662","condition":"Knee Injury"}'
if [ "$HTTP" = "201" ]; then
  pass "cascade setup: doctor C with 2 patients"
else
  fail "cascade setup body=$(printf '%.200s' "$BODY")"
fi
req DELETE "$BASE_URL/doctors/$DOC_C_ID"
assert_status "delete doctor (cascade)" "200"
if command -v mongosh > /dev/null 2>&1 && [ -n "$MONGO_URI" ]; then
  COUNT=$(mongosh "$MONGO_URI" --quiet --eval "db.patients.countDocuments({doctor: ObjectId('$DOC_C_ID')})" 2>/dev/null | tail -n1 | tr -d '[:space:]')
  if [ "$COUNT" = "0" ]; then
    pass "cascade verified in MongoDB (countDocuments = 0)"
  else
    fail "cascade verify in MongoDB (countDocuments = '$COUNT', expected 0)"
  fi
else
  fail "cascade verify skipped (mongosh or MONGO_URI unavailable)"
fi

# ---------- Cleanup all test data ----------
for D in "$DOC_ID" "$DOC_B_ID" "$DOC_C_ID"; do
  if [ -n "$D" ]; then
    curl -s -X DELETE "$BASE_URL/doctors/$D" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  fi
done
# Ensure no leftovers with the smoke emails
for E in smoke.test.doc@example.com smoke.doc.b@example.com smoke.cascade@example.com; do
  req GET "$BASE_URL/doctors?search=$E&limit=50"
  LEFT=$(printf '%s' "$BODY" | jq -r '.data[]._id // empty' 2>/dev/null)
  for ID in $LEFT; do
    curl -s -X DELETE "$BASE_URL/doctors/$ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  done
done

echo ""
echo "=== Summary ==="
echo "PASSED: $PASSED"
echo "FAILED: $FAILED"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
