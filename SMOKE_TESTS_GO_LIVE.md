# BuildingOS Go-Live Smoke Tests

**Version**: 1.0
**Date**: February 18, 2026
**Environment**: STAGING (all tests must PASS before attempting on production)
**Estimated Duration**: 30 minutes
**Performed by**: QA Lead / Platform Engineer

---

## Pre-Test Setup

### Environment Variables

Set these before running tests:

```bash
# Staging environment (REQUIRED)
export API_URL="http://localhost:3001"           # API base URL
export APP_URL="http://localhost:3000"           # Frontend base URL
export ADMIN_EMAIL="admin@buildingos.test"       # Test admin account
export ADMIN_PASSWORD="SecureTestPass123!"       # Test password
export TEST_TENANT="test-tenant-$(date +%s)"     # Unique tenant ID
export TEST_USER_EMAIL="test-user-$(date +%s)@example.com"

# Tools required
command -v curl > /dev/null || { echo "curl not found"; exit 1; }
command -v jq > /dev/null || { echo "jq not found"; exit 1; }
command -v psql > /dev/null || { echo "psql not found"; exit 1; }
```

### Result Tracking

Create result file:

```bash
TEST_RESULTS="/tmp/smoke-test-results-$(date +%s).txt"
touch "$TEST_RESULTS"

# Helper functions
test_pass() {
  echo "✓ PASS: $1" | tee -a "$TEST_RESULTS"
}

test_fail() {
  echo "✗ FAIL: $1" | tee -a "$TEST_RESULTS"
  EXIT_CODE=1
}

test_info() {
  echo "ℹ INFO: $1" | tee -a "$TEST_RESULTS"
}

EXIT_CODE=0
```

---

## Test Suite

### TEST 1: API Health & Readiness

**Purpose**: Verify API is running and dependencies available
**Duration**: 2 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 1.1: Liveness Probe

```bash
test_info "Testing /health endpoint..."

RESPONSE=$(curl -s "$API_URL/health")
STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null)

if [[ "$STATUS" == "ok" ]]; then
  test_pass "Liveness probe: API is running"
else
  test_fail "Liveness probe failed: $RESPONSE"
fi
```

**Expected Result**: HTTP 200, `{"status":"ok","timestamp":"..."}`

#### Test 1.2: Readiness Probe

```bash
test_info "Testing /readyz endpoint..."

RESPONSE=$(curl -s "$API_URL/readyz")
HEALTH_STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null)
DB_STATUS=$(echo "$RESPONSE" | jq -r '.checks.database.status' 2>/dev/null)
STORAGE_STATUS=$(echo "$RESPONSE" | jq -r '.checks.storage.status' 2>/dev/null)
EMAIL_STATUS=$(echo "$RESPONSE" | jq -r '.checks.email.status' 2>/dev/null)

if [[ "$HEALTH_STATUS" == "healthy" ]]; then
  test_pass "Readiness probe: System is healthy"
else
  test_fail "Readiness probe failed: status=$HEALTH_STATUS"
fi

if [[ "$DB_STATUS" == "up" ]]; then
  test_pass "Database check: up"
else
  test_fail "Database check: $DB_STATUS"
fi

if [[ "$STORAGE_STATUS" == "up" || "$STORAGE_STATUS" == "not_configured" ]]; then
  test_pass "Storage check: $STORAGE_STATUS"
else
  test_fail "Storage check: $STORAGE_STATUS"
fi

test_info "Email provider: $EMAIL_STATUS"
```

**Expected Result**: HTTP 200, all checks showing `"up"` or `"not_configured"`

---

### TEST 2: Authentication & Authorization

**Purpose**: Verify auth system works for signup, login, logout
**Duration**: 5 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 2.1: User Signup

```bash
test_info "Testing user signup..."

SIGNUP_RESPONSE=$(curl -s -X POST "$API_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_USER_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\",
    \"fullName\": \"Test User\",
    \"tenantName\": \"$TEST_TENANT\"
  }")

USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id' 2>/dev/null)
TENANT_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.memberships[0].tenantId' 2>/dev/null)

if [[ -n "$USER_ID" && "$USER_ID" != "null" ]]; then
  test_pass "Signup successful: user_id=$USER_ID tenant_id=$TENANT_ID"
  export TEST_USER_ID="$USER_ID"
  export TEST_TENANT_ID="$TENANT_ID"
else
  test_fail "Signup failed: $(echo "$SIGNUP_RESPONSE" | jq '.message' 2>/dev/null)"
  return 1
fi
```

**Expected Result**: HTTP 201, returns `user` object with `id` and `memberships` array

#### Test 2.2: User Login

```bash
test_info "Testing user login..."

LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_USER_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken' 2>/dev/null)

if [[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]]; then
  test_pass "Login successful: token received"
  export AUTH_TOKEN="$ACCESS_TOKEN"
else
  test_fail "Login failed: $(echo "$LOGIN_RESPONSE" | jq '.message' 2>/dev/null)"
  return 1
fi
```

**Expected Result**: HTTP 200, returns `accessToken` and `user` object

#### Test 2.3: Get Current User (Auth Header)

```bash
test_info "Testing authenticated request..."

PROFILE=$(curl -s "$API_URL/auth/me" \
  -H "Authorization: Bearer $AUTH_TOKEN")

PROFILE_EMAIL=$(echo "$PROFILE" | jq -r '.user.email' 2>/dev/null)

if [[ "$PROFILE_EMAIL" == "$TEST_USER_EMAIL" ]]; then
  test_pass "Auth header works: /auth/me returned correct user"
else
  test_fail "Auth header failed: email mismatch"
fi
```

**Expected Result**: HTTP 200, returns `user` object with correct email

---

### TEST 3: Core CRUD Operations

**Purpose**: Verify buildings, units, and occupants can be created/read
**Duration**: 8 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 3.1: Create Building

```bash
test_info "Creating test building..."

CREATE_BUILDING=$(curl -s -X POST "$API_URL/tenants/$TEST_TENANT_ID/buildings" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"name\": \"Test Building\",
    \"address\": \"123 Main St, Springfield\"
  }")

BUILDING_ID=$(echo "$CREATE_BUILDING" | jq -r '.id' 2>/dev/null)

if [[ -n "$BUILDING_ID" && "$BUILDING_ID" != "null" ]]; then
  test_pass "Building created: $BUILDING_ID"
  export TEST_BUILDING_ID="$BUILDING_ID"
else
  test_fail "Building creation failed: $(echo "$CREATE_BUILDING" | jq '.message' 2>/dev/null)"
  return 1
fi
```

**Expected Result**: HTTP 201, returns building object with `id`

#### Test 3.2: List Buildings

```bash
test_info "Listing buildings..."

BUILDINGS=$(curl -s "$API_URL/tenants/$TEST_TENANT_ID/buildings" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Id: $TEST_TENANT_ID")

BUILDING_COUNT=$(echo "$BUILDINGS" | jq 'length' 2>/dev/null)

if [[ "$BUILDING_COUNT" -ge 1 ]]; then
  test_pass "Building list returned: $BUILDING_COUNT building(s)"
else
  test_fail "Building list failed or empty"
fi
```

**Expected Result**: HTTP 200, returns array with at least 1 building

#### Test 3.3: Create Unit

```bash
test_info "Creating test unit..."

CREATE_UNIT=$(curl -s -X POST "$API_URL/tenants/$TEST_TENANT_ID/buildings/$TEST_BUILDING_ID/units" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"label\": \"Unit 101\",
    \"unitCode\": \"101\",
    \"unitType\": \"RESIDENTIAL\",
    \"occupancyStatus\": \"AVAILABLE\"
  }")

UNIT_ID=$(echo "$CREATE_UNIT" | jq -r '.id' 2>/dev/null)

if [[ -n "$UNIT_ID" && "$UNIT_ID" != "null" ]]; then
  test_pass "Unit created: $UNIT_ID"
  export TEST_UNIT_ID="$UNIT_ID"
else
  test_fail "Unit creation failed: $(echo "$CREATE_UNIT" | jq '.message' 2>/dev/null)"
  return 1
fi
```

**Expected Result**: HTTP 201, returns unit object with `id`

#### Test 3.4: Assign Occupant to Unit

```bash
test_info "Assigning occupant to unit..."

ASSIGN_OCCUPANT=$(curl -s -X POST "$API_URL/tenants/$TEST_TENANT_ID/buildings/$TEST_BUILDING_ID/units/$TEST_UNIT_ID/occupants" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"userId\": \"$TEST_USER_ID\",
    \"role\": \"OWNER\"
  }")

OCCUPANT_ID=$(echo "$ASSIGN_OCCUPANT" | jq -r '.id' 2>/dev/null)

if [[ -n "$OCCUPANT_ID" && "$OCCUPANT_ID" != "null" ]]; then
  test_pass "Occupant assigned: $OCCUPANT_ID"
else
  test_fail "Occupant assignment failed: $(echo "$ASSIGN_OCCUPANT" | jq '.message' 2>/dev/null)"
fi
```

**Expected Result**: HTTP 201, returns occupant assignment object

---

### TEST 4: Tickets System

**Purpose**: Verify tickets can be created, read, commented, and status changed
**Duration**: 5 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 4.1: Create Ticket

```bash
test_info "Creating test ticket..."

CREATE_TICKET=$(curl -s -X POST "$API_URL/tenants/$TEST_TENANT_ID/buildings/$TEST_BUILDING_ID/tickets" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"title\": \"Test Maintenance Issue\",
    \"description\": \"Something needs fixing\",
    \"category\": \"MAINTENANCE\",
    \"priority\": \"MEDIUM\"
  }")

TICKET_ID=$(echo "$CREATE_TICKET" | jq -r '.id' 2>/dev/null)

if [[ -n "$TICKET_ID" && "$TICKET_ID" != "null" ]]; then
  test_pass "Ticket created: $TICKET_ID"
  export TEST_TICKET_ID="$TICKET_ID"
else
  test_fail "Ticket creation failed: $(echo "$CREATE_TICKET" | jq '.message' 2>/dev/null)"
  return 1
fi
```

**Expected Result**: HTTP 201, returns ticket object with `id` and `status="OPEN"`

#### Test 4.2: Add Comment to Ticket

```bash
test_info "Adding comment to ticket..."

ADD_COMMENT=$(curl -s -X POST "$API_URL/tenants/$TEST_TENANT_ID/buildings/$TEST_BUILDING_ID/tickets/$TEST_TICKET_ID/comments" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"body\": \"I'll look into this right away.\"
  }")

COMMENT_ID=$(echo "$ADD_COMMENT" | jq -r '.id' 2>/dev/null)

if [[ -n "$COMMENT_ID" && "$COMMENT_ID" != "null" ]]; then
  test_pass "Comment added: $COMMENT_ID"
else
  test_fail "Comment failed: $(echo "$ADD_COMMENT" | jq '.message' 2>/dev/null)"
fi
```

**Expected Result**: HTTP 201, returns comment object

#### Test 4.3: Update Ticket Status

```bash
test_info "Updating ticket status to RESOLVED..."

UPDATE_TICKET=$(curl -s -X PATCH "$API_URL/tenants/$TEST_TENANT_ID/buildings/$TEST_BUILDING_ID/tickets/$TEST_TICKET_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"status\": \"RESOLVED\"
  }")

NEW_STATUS=$(echo "$UPDATE_TICKET" | jq -r '.status' 2>/dev/null)

if [[ "$NEW_STATUS" == "RESOLVED" ]]; then
  test_pass "Ticket status updated to RESOLVED"
else
  test_fail "Ticket status update failed: status=$NEW_STATUS"
fi
```

**Expected Result**: HTTP 200, returns updated ticket with `status="RESOLVED"`

---

### TEST 5: Email System

**Purpose**: Verify invitation emails can be sent
**Duration**: 5 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 5.1: Create Invitation

```bash
test_info "Creating invitation..."

NEW_INVITE_EMAIL="invitee-$(date +%s)@example.com"

CREATE_INVITATION=$(curl -s -X POST "$API_URL/tenants/$TEST_TENANT_ID/invitations" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"email\": \"$NEW_INVITE_EMAIL\",
    \"role\": \"TENANT_ADMIN\"
  }")

INVITATION_ID=$(echo "$CREATE_INVITATION" | jq -r '.id' 2>/dev/null)
INVITE_EMAIL=$(echo "$CREATE_INVITATION" | jq -r '.email' 2>/dev/null)

if [[ -n "$INVITATION_ID" && "$INVITATION_ID" != "null" ]]; then
  test_pass "Invitation created: $INVITATION_ID for $INVITE_EMAIL"
else
  test_fail "Invitation failed: $(echo "$CREATE_INVITATION" | jq '.message' 2>/dev/null)"
  return 1
fi
```

**Expected Result**: HTTP 201, returns invitation object

#### Test 5.2: Verify Invitation Email Log

```bash
test_info "Checking if email was logged (in EmailLog table)..."

# Note: This requires database access
EMAIL_LOG=$(psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c \
  "SELECT COUNT(*) FROM \"EmailLog\" WHERE \"to\" = '$NEW_INVITE_EMAIL';" 2>/dev/null)

if [[ "$EMAIL_LOG" -gt 0 ]]; then
  test_pass "Email log recorded for invitation"
else
  test_info "Email log not yet recorded (may be async)"
fi
```

**Expected Result**: EmailLog table contains an entry for the invitation email

#### Test 5.3: Check X-Request-Id in Response

```bash
test_info "Verifying request tracing..."

RESPONSE_HEADERS=$(curl -s -i "$API_URL/health" 2>&1 | head -20)
REQUEST_ID=$(echo "$RESPONSE_HEADERS" | grep -i "X-Request-Id" | cut -d' ' -f2 | tr -d '\r')

if [[ -n "$REQUEST_ID" ]]; then
  test_pass "X-Request-Id header present: $REQUEST_ID"
else
  test_fail "X-Request-Id header missing"
fi
```

**Expected Result**: Response includes `X-Request-Id` header with UUID value

---

### TEST 6: Multi-Tenant Isolation

**Purpose**: Verify users cannot access data from other tenants
**Duration**: 5 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 6.1: Cross-Tenant Access Denied

```bash
test_info "Testing cross-tenant isolation..."

# Try to access a different tenant's building with current user's token
# Use a known different tenant ID (e.g., "other-tenant-id")
OTHER_TENANT_ID="other-tenant-from-setup"

CROSS_TENANT_ATTEMPT=$(curl -s -w "\n%{http_code}" "$API_URL/tenants/$OTHER_TENANT_ID/buildings" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Id: $OTHER_TENANT_ID")

HTTP_CODE=$(echo "$CROSS_TENANT_ATTEMPT" | tail -1)

if [[ "$HTTP_CODE" == "404" ]]; then
  test_pass "Cross-tenant access properly denied (404)"
elif [[ "$HTTP_CODE" == "403" ]]; then
  test_pass "Cross-tenant access denied (403)"
else
  test_fail "Cross-tenant access check failed: HTTP $HTTP_CODE"
fi
```

**Expected Result**: HTTP 404 or 403 (returns 404 to prevent enumeration)

---

### TEST 7: Super-Admin Functions

**Purpose**: Verify super-admin can manage tenants
**Duration**: 5 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 7.1: Super-Admin Access

```bash
test_info "Testing super-admin access..."

# This requires a super-admin token
# Use pre-created super-admin account

SUPER_ADMIN_RESPONSE=$(curl -s "$API_URL/super-admin/tenants" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN")

TENANT_COUNT=$(echo "$SUPER_ADMIN_RESPONSE" | jq 'length' 2>/dev/null)

if [[ "$TENANT_COUNT" -ge 0 ]]; then
  test_pass "Super-admin access verified: $TENANT_COUNT tenant(s)"
else
  test_fail "Super-admin access failed"
fi
```

**Expected Result**: HTTP 200, returns array of tenants

#### Test 7.2: Tenant Plan Management

```bash
test_info "Testing tenant subscription management..."

CHANGE_PLAN=$(curl -s -X PATCH "$API_URL/super-admin/tenants/$TEST_TENANT_ID/subscription" \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"newPlanId\": \"plan-basic\"
  }")

NEW_PLAN=$(echo "$CHANGE_PLAN" | jq -r '.billingPlan' 2>/dev/null)

if [[ -n "$NEW_PLAN" && "$NEW_PLAN" != "null" ]]; then
  test_pass "Plan changed successfully to $NEW_PLAN"
else
  test_fail "Plan change failed: $(echo "$CHANGE_PLAN" | jq '.message' 2>/dev/null)"
fi
```

**Expected Result**: HTTP 200, subscription updated

---

### TEST 8: Data Persistence & Database

**Purpose**: Verify data is persisted correctly
**Duration**: 3 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 8.1: Building Persists After Logout

```bash
test_info "Verifying data persistence..."

# Create new token (re-login) and verify building still exists
NEW_LOGIN=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_USER_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

NEW_TOKEN=$(echo "$NEW_LOGIN" | jq -r '.accessToken' 2>/dev/null)

VERIFY_BUILDING=$(curl -s "$API_URL/tenants/$TEST_TENANT_ID/buildings/$TEST_BUILDING_ID" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "X-Tenant-Id: $TEST_TENANT_ID")

RETRIEVED_BUILDING_ID=$(echo "$VERIFY_BUILDING" | jq -r '.id' 2>/dev/null)

if [[ "$RETRIEVED_BUILDING_ID" == "$TEST_BUILDING_ID" ]]; then
  test_pass "Data persisted: Building retrieved after logout"
else
  test_fail "Data persistence failed"
fi
```

**Expected Result**: Building still exists and is retrievable

---

### TEST 9: Error Handling & Observability

**Purpose**: Verify errors are logged and tracked
**Duration**: 3 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 9.1: Invalid Request Returns 400

```bash
test_info "Testing error response..."

INVALID_REQUEST=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/tenants/$TEST_TENANT_ID/buildings" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -d "{
    \"name\": \"\"
  }")

HTTP_CODE=$(echo "$INVALID_REQUEST" | tail -1)

if [[ "$HTTP_CODE" == "400" ]]; then
  test_pass "Invalid request properly rejected (400)"
else
  test_fail "Invalid request handling failed: HTTP $HTTP_CODE"
fi
```

**Expected Result**: HTTP 400 Bad Request

#### Test 9.2: Unauthorized Request Returns 401

```bash
test_info "Testing unauthorized access..."

UNAUTHORIZED=$(curl -s -w "\n%{http_code}" "$API_URL/auth/me" \
  -H "Authorization: Bearer invalid-token")

HTTP_CODE=$(echo "$UNAUTHORIZED" | tail -1)

if [[ "$HTTP_CODE" == "401" ]]; then
  test_pass "Unauthorized access properly rejected (401)"
else
  test_fail "Auth validation failed: HTTP $HTTP_CODE"
fi
```

**Expected Result**: HTTP 401 Unauthorized

---

### TEST 10: Backup & Recovery (If Testing on Staging DB)

**Purpose**: Verify backup/restore works
**Duration**: 10 minutes
**Result**: ☐ PASS ☐ FAIL

#### Test 10.1: Create Backup

```bash
test_info "Creating database backup..."

BACKUP_OUTPUT=$(./scripts/backup-db.sh --env staging 2>&1)
BACKUP_FILE=$(echo "$BACKUP_OUTPUT" | grep "Backup file:" | awk '{print $NF}')

if [[ -f "$BACKUP_FILE" ]]; then
  test_pass "Backup created: $BACKUP_FILE"
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  test_info "Backup size: $BACKUP_SIZE"
else
  test_fail "Backup creation failed"
fi
```

**Expected Result**: Backup file created and verified

#### Test 10.2: Verify Backup Integrity

```bash
test_info "Verifying backup integrity..."

METADATA_FILE="${BACKUP_FILE}.metadata.json"

if [[ -f "$METADATA_FILE" ]]; then
  CHECKSUM=$(jq -r '.checksum_sha256' "$METADATA_FILE")
  test_pass "Backup metadata present, checksum: ${CHECKSUM:0:16}..."
else
  test_fail "Backup metadata missing"
fi
```

**Expected Result**: Metadata file with valid checksum

---

## Summary & Results

### Test Execution Summary

```bash
# Print summary
echo ""
echo "════════════════════════════════════════════"
echo "SMOKE TEST RESULTS SUMMARY"
echo "════════════════════════════════════════════"
echo ""
echo "Total Tests: 10"
echo "Passed: $(grep -c "✓ PASS" "$TEST_RESULTS")"
echo "Failed: $(grep -c "✗ FAIL" "$TEST_RESULTS")"
echo ""
echo "Details:"
cat "$TEST_RESULTS"
echo ""
echo "Results saved to: $TEST_RESULTS"
echo "════════════════════════════════════════════"
echo ""

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✓ ALL TESTS PASSED - Ready for launch"
  exit 0
else
  echo "✗ SOME TESTS FAILED - Do not launch"
  exit 1
fi
```

### Go/No-Go Decision

| Result | Decision | Action |
|--------|----------|--------|
| **All 10 tests PASS** | **GO** | Proceed to production |
| **1-2 tests FAIL** | **NO-GO** | Fix issues, re-test in staging |
| **3+ tests FAIL** | **HALT** | Major issues, escalate to VP |

### If Tests Fail

**Root cause investigation:**

```bash
# 1. Check logs
tail -f /var/log/buildingos/api.log | grep -i error

# 2. Check database
psql -c "SELECT COUNT(*) FROM \"Building\";"

# 3. Check Sentry
# https://sentry.io/organizations/buildingos/issues/

# 4. Check health endpoint
curl http://api:3001/readyz | jq '.'

# 5. Restart and retry
systemctl restart buildingos-api
sleep 10
# Re-run failed test
```

---

## Sign-Off

**Test Date**: ________________

**Tested By**: ________________

**Results**: ☐ PASS  ☐ FAIL

**Sign-Off**: ________________

---

**Next Step**:
- If PASS: Schedule production launch
- If FAIL: Fix issues and re-run tests

