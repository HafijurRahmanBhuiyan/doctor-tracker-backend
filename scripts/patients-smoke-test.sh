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
    resp=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" \
      "${auth_args[@]}")
  fi
  HTTP=$(printf '%s' "$resp" | tail -n1)
  BODY=$(printf '%s' "$resp" | sed '$d')
}

assert_status() {
  if [ "$HTTP" = "$2" ]; then
    pass "$1 (HTTP $HTTP)"
  else
    fail "$1 (expected HTTP $2, got HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
  fi
}

jqt() {
  printf '%s' "$BODY" | jq -e "$@" > /dev/null 2>&1
}

jqr() {
  printf '%s' "$BODY" | jq -r "$1" 2>/dev/null
}

TOKEN=""
DOC_A_ID=""
DOC_B_ID=""
P1_ID=""
P2_ID=""

COND_A="PatientsSmokeFlu"
COND_B="PatientsSmokeCold"
COND_UPDATED="PatientsSmokeUpdated"

# ---------- Login ----------
req POST "$BASE_URL/auth/login" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
TOKEN=$(jqr '.data.token // empty')
if [ "$HTTP" = "200" ] && [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
  pass "login (HTTP 200, token received)"
else
  fail "login (HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
  echo ""
  echo "=== Summary ==="
  echo "PASSED: $PASSED"
  echo "FAILED: $FAILED"
  exit 1
fi

# ---------- Setup: doctors A and B ----------
req POST "$BASE_URL/doctors" '{"name":"Patients Smoke Doc A","specialization":"Cardiology","hospital":"Patients Smoke Hospital A","phone":"1110001110","email":"patients.smoke.a@example.com"}'
if [ "$HTTP" = "201" ]; then
  DOC_A_ID=$(jqr '.data.doctor._id // empty')
  pass "setup: create doctor A (HTTP 201)"
else
  fail "setup: create doctor A (HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
fi
req POST "$BASE_URL/doctors" '{"name":"Patients Smoke Doc B","specialization":"Neurology","hospital":"Patients Smoke Hospital B","phone":"2220002220","email":"patients.smoke.b@example.com"}'
if [ "$HTTP" = "201" ]; then
  DOC_B_ID=$(jqr '.data.doctor._id // empty')
  pass "setup: create doctor B (HTTP 201)"
else
  fail "setup: create doctor B (HTTP $HTTP) body=$(printf '%.200s' "$BODY")"
fi

# ---------- Create patient P1 (doctor A) ----------
req POST "$BASE_URL/patients" "{\"name\":\"Alpha Smoke Patient\",\"age\":30,\"gender\":\"female\",\"phone\":\"3000000001\",\"condition\":\"$COND_A\",\"doctorId\":\"$DOC_A_ID\"}"
assert_status "create patient" "201"
P1_ID=$(jqr '.data.patient._id // empty')
if [ -n "$P1_ID" ] && [ "$(jqr '.data.patient.doctor._id')" = "$DOC_A_ID" ] && [ "$(jqr '.data.patient.age')" = "30" ]; then
  pass "create patient content (age 30, doctor A populated)"
else
  fail "create patient content body=$(printf '%.200s' "$BODY")"
fi

# ---------- Create patient P2 (doctor B) ----------
req POST "$BASE_URL/patients" "{\"name\":\"Beta Smoke Patient\",\"age\":50,\"gender\":\"male\",\"phone\":\"3000000002\",\"condition\":\"$COND_B\",\"doctorId\":\"$DOC_B_ID\"}"
assert_status "create patient under doctor B" "201"
P2_ID=$(jqr '.data.patient._id // empty')

# ---------- Validation error (bad age > 130) ----------
req POST "$BASE_URL/patients" "{\"name\":\"Bad\",\"age\":200,\"gender\":\"other\",\"phone\":\"1\",\"condition\":\"X\",\"doctorId\":\"$DOC_A_ID\"}"
assert_status "validation error age 200 (>130)" "400"

# ---------- Nonexistent doctorId ----------
req POST "$BASE_URL/patients" '{"name":"Orphan Patient","age":20,"gender":"male","phone":"9999999999","condition":"Orphan","doctorId":"000000000000000000000000"}'
assert_status "nonexistent doctorId" "404"

# ---------- List with pagination meta ----------
req GET "$BASE_URL/patients?page=1&limit=10"
if [ "$HTTP" = "200" ] && jqt '.meta.page == 1 and .meta.limit == 10 and (.meta.total | type == "number") and (.meta.totalPages | type == "number")'; then
  pass "list pagination meta (page/limit/total/totalPages)"
else
  fail "list pagination meta body=$(printf '%.200s' "$BODY")"
fi

# ---------- Search by name returns the right patient ----------
req GET "$BASE_URL/patients?search=Alpha%20Smoke%20Patient&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg p1 "$P1_ID" --arg p2 "$P2_ID" \
  'any(.data[]; ._id == $p1) and (all(.data[]; ._id != $p2))'; then
  pass "search by name returns P1 and not P2"
else
  fail "search by name body=$(printf '%.200s' "$BODY")"
fi

# ---------- Search by condition returns the right patient ----------
req GET "$BASE_URL/patients?search=$COND_B&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg p1 "$P1_ID" --arg p2 "$P2_ID" \
  'any(.data[]; ._id == $p2) and (all(.data[]; ._id != $p1))'; then
  pass "search by condition returns P2 and not P1"
else
  fail "search by condition body=$(printf '%.200s' "$BODY")"
fi

# ---------- Condition filter: only that condition ----------
req GET "$BASE_URL/patients?condition=$COND_B&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg c "$COND_B" '(.data | length) >= 1 and all(.data[]; .condition == $c)'; then
  pass "condition filter: only $COND_B"
else
  fail "condition filter body=$(printf '%.200s' "$BODY")"
fi

# ---------- Doctor filter: only doctor A's patients, includes P1 ----------
req GET "$BASE_URL/patients?doctor=$DOC_A_ID&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg d "$DOC_A_ID" --arg p1 "$P1_ID" --arg p2 "$P2_ID" \
  '(.data | length) >= 1 and all(.data[]; .doctor._id == $d) and any(.data[]; ._id == $p1) and all(.data[]; ._id != $p2)'; then
  pass "doctor filter: only doctor A's patients, P1 in and P2 out"
else
  fail "doctor filter body=$(printf '%.200s' "$BODY")"
fi

# ---------- Gender filter ----------
req GET "$BASE_URL/patients?gender=male&doctor=$DOC_B_ID&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg p2 "$P2_ID" \
  '(.data | length) >= 1 and all(.data[]; .gender == "male") and any(.data[]; ._id == $p2)'; then
  pass "gender filter: all male, P2 included"
else
  fail "gender filter body=$(printf '%.200s' "$BODY")"
fi

# ---------- Date filter ----------
FROM_YESTERDAY=$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
FROM_TOMORROW=$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
req GET "$BASE_URL/patients?from=$FROM_YESTERDAY&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg p1 "$P1_ID" 'any(.data[]; ._id == $p1)'; then
  pass "date filter from=yesterday includes P1"
else
  fail "date filter from=yesterday body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/patients?from=$FROM_TOMORROW&limit=50"
if [ "$HTTP" = "200" ] && jqt '(.data | length) == 0 and .meta.total == 0'; then
  pass "date filter from=tomorrow returns 0 items"
else
  fail "date filter from=tomorrow body=$(printf '%.200s' "$BODY")"
fi

# ---------- Limit capped at 50 ----------
req GET "$BASE_URL/patients?limit=200"
if [ "$HTTP" = "200" ]; then
  LIM=$(jqr '.meta.limit // 0')
  if [ "$LIM" -le 50 ]; then
    pass "limit > 50 capped to $LIM"
  else
    fail "limit not capped (got $LIM)"
  fi
else
  fail "limit cap (HTTP $HTTP)"
fi

# ---------- sortBy=age order=asc is really ascending ----------
req GET "$BASE_URL/patients?search=Smoke%20Patient&sortBy=age&order=asc&limit=50"
if [ "$HTTP" = "200" ] && jqt '([.data[].age]) as $a | ($a | length) >= 2 and $a == ($a | sort)'; then
  pass "sortBy=age order=asc returns ages ascending"
else
  fail "sortBy age asc body=$(printf '%.200s' "$BODY")"
fi

# ---------- Populated doctor: name + specialization only, no email/phone leak ----------
req GET "$BASE_URL/patients?search=Alpha%20Smoke%20Patient&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg p1 "$P1_ID" \
  'any(.data[]; ._id == $p1 and .doctor.name == "Patients Smoke Doc A" and .doctor.specialization == "Cardiology" and ((.doctor | has("email")) | not) and ((.doctor | has("phone")) | not))'; then
  pass "populated doctor has name+specialization only (no email/phone)"
else
  fail "populated doctor fields body=$(printf '%.200s' "$BODY")"
fi

# ---------- Get one ----------
req GET "$BASE_URL/patients/$P1_ID"
if [ "$HTTP" = "200" ] && jqt --arg p1 "$P1_ID" '.data.patient._id == $p1 and .data.patient.name == "Alpha Smoke Patient"'; then
  pass "get one patient content"
else
  fail "get one patient body=$(printf '%.200s' "$BODY")"
fi

# ---------- Update (verify persisted with GET) ----------
req PUT "$BASE_URL/patients/$P1_ID" "{\"condition\":\"$COND_UPDATED\"}"
if [ "$HTTP" = "200" ] && jqt --arg c "$COND_UPDATED" '.data.patient.condition == $c'; then
  pass "update patient returns updated condition"
else
  fail "update patient body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/patients/$P1_ID"
if [ "$HTTP" = "200" ] && jqt --arg c "$COND_UPDATED" '.data.patient.condition == $c'; then
  pass "update persisted (GET shows new condition)"
else
  fail "update persisted body=$(printf '%.200s' "$BODY")"
fi

# ---------- Reassign to doctor B and verify ----------
req PUT "$BASE_URL/patients/$P1_ID" "{\"doctorId\":\"$DOC_B_ID\"}"
if [ "$HTTP" = "200" ] && jqt --arg d "$DOC_B_ID" '.data.patient.doctor._id == $d'; then
  pass "reassign to doctor B (response shows doctor B)"
else
  fail "reassign to doctor B body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/patients/$P1_ID"
if [ "$HTTP" = "200" ] && jqt --arg d "$DOC_B_ID" '.data.patient.doctor._id == $d'; then
  pass "reassign persisted (GET shows doctor B)"
else
  fail "reassign persisted body=$(printf '%.200s' "$BODY")"
fi
req GET "$BASE_URL/patients?doctor=$DOC_B_ID&search=Alpha%20Smoke%20Patient&limit=50"
if [ "$HTTP" = "200" ] && jqt --arg p1 "$P1_ID" 'any(.data[]; ._id == $p1)'; then
  pass "P1 now shows under doctor B list"
else
  fail "P1 under doctor B list body=$(printf '%.200s' "$BODY")"
fi

# ---------- filters/options includes the test conditions ----------
req GET "$BASE_URL/patients/filters/options"
if [ "$HTTP" = "200" ] && jqt --arg c1 "$COND_B" --arg c2 "$COND_UPDATED" \
  '(.data.conditions | type == "array") and (.data.conditions | index($c1) != null) and (.data.conditions | index($c2) != null)'; then
  pass "filters/options includes test conditions"
else
  fail "filters/options body=$(printf '%.200s' "$BODY")"
fi

# ---------- Invalid id / unknown id / no token ----------
req GET "$BASE_URL/patients/notanid"
assert_status "invalid ObjectId" "400"
req GET "$BASE_URL/patients/000000000000000000000000"
assert_status "unknown id" "404"
TOKEN_SAVED="$TOKEN"; TOKEN=""
req GET "$BASE_URL/patients"
TOKEN="$TOKEN_SAVED"
assert_status "no token" "401"

# ---------- Delete patient, then GET -> 404 ----------
req DELETE "$BASE_URL/patients/$P1_ID"
assert_status "delete patient" "200"
req GET "$BASE_URL/patients/$P1_ID"
assert_status "GET after delete returns" "404"

# ---------- Cleanup ----------
if [ -n "$P2_ID" ]; then
  curl -s -X DELETE "$BASE_URL/patients/$P2_ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
fi
for D in "$DOC_A_ID" "$DOC_B_ID"; do
  if [ -n "$D" ]; then
    curl -s -X DELETE "$BASE_URL/doctors/$D" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  fi
done
# Sweep leftovers from previous failed runs
for E in patients.smoke.a@example.com patients.smoke.b@example.com; do
  req GET "$BASE_URL/doctors?search=$E&limit=50"
  for ID in $(jqr '.data[]._id // empty'); do
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
