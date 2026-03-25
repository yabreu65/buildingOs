#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
TOKEN="${TOKEN:-}"
TENANT_ID="${TENANT_ID:-test_tenant_001}"

# Global variables
BUILDING_ID=""
CATEGORY_A_ID=""
CATEGORY_B_ID=""
CATEGORY_C_ID=""
PERIOD_ID=""
UNIT_1=""
UNIT_2=""
UNIT_3=""
UNIT_4=""

# Counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
  ((TESTS_PASSED++))
}

log_error() {
  echo -e "${RED}[✗]${NC} $1"
  ((TESTS_FAILED++))
}

log_test() {
  echo -e "\n${YELLOW}=== $1 ===${NC}"
}

# Check prerequisites
if [[ -z "$TOKEN" ]]; then
  log_error "TOKEN environment variable not set. Set it with: export TOKEN=your_jwt_token"
  exit 1
fi

log_info "Using API_URL: $API_URL"
log_info "Using TENANT_ID: $TENANT_ID"

# ============================================================================
# PART A: SEED DATA
# ============================================================================

log_test "PART A: SEED DATA SETUP"

# A1. Create Building
log_info "Creating test building..."
BUILDING_RESPONSE=$(curl -s -X POST "$API_URL/buildings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Building - Expense Allocation",
    "address": "Test St 123"
  }')

BUILDING_ID=$(echo "$BUILDING_RESPONSE" | jq -r '.id // empty')
if [[ -z "$BUILDING_ID" ]]; then
  log_error "Failed to create building"
  echo "$BUILDING_RESPONSE" | jq '.'
  exit 1
fi
log_success "Building created: $BUILDING_ID"

# A2. Enable allocation mode
log_info "Enabling BY_CATEGORY_RANGE_M2_COEFFICIENT mode..."
curl -s -X PATCH "$API_URL/buildings/$BUILDING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allocationMode": "BY_CATEGORY_RANGE_M2_COEFFICIENT"}' > /dev/null
log_success "Allocation mode enabled"

# A3. Create units
log_info "Creating units with m2..."

UNIT_1=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "UNIT_001", "label": "Unit 001 - 50m²", "unitType": "APARTMENT", "m2": 50, "isBillable": true}' | jq -r '.id')

UNIT_2=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "UNIT_002", "label": "Unit 002 - 120m²", "unitType": "APARTMENT", "m2": 120, "isBillable": true}' | jq -r '.id')

UNIT_3=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "UNIT_003", "label": "Unit 003 - 250m²", "unitType": "APARTMENT", "m2": 250, "isBillable": true}' | jq -r '.id')

UNIT_4=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "UNIT_004", "label": "Unit 004 - No m2", "unitType": "APARTMENT", "m2": null, "isBillable": true}' | jq -r '.id')

log_success "Units created: U1=$UNIT_1 (50m²), U2=$UNIT_2 (120m²), U3=$UNIT_3 (250m²), U4=$UNIT_4 (no m2)"

# ============================================================================
# PART B: UNIT CATEGORY TESTS
# ============================================================================

log_test "PART B: UNIT CATEGORY TESTS"

# TEST 1: Create valid categories
log_test "TEST 1: Create valid category ranges (expect 201)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Category A (40-60m²)", "minM2": 40, "maxM2": 60, "coefficient": 1.0}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
CATEGORY_A_ID=$(echo "$BODY" | jq -r '.id // empty')

if [[ "$HTTP_CODE" == "201" && ! -z "$CATEGORY_A_ID" ]]; then
  log_success "Category A created (201)"
else
  log_error "Category A failed (HTTP $HTTP_CODE)"
  echo "$BODY" | jq '.'
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Category B (100-200m²)", "minM2": 100, "maxM2": 200, "coefficient": 2.5}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
CATEGORY_B_ID=$(echo "$BODY" | jq -r '.id // empty')

if [[ "$HTTP_CODE" == "201" ]]; then
  log_success "Category B created (201)"
else
  log_error "Category B failed (HTTP $HTTP_CODE)"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Category C (200+m²)", "minM2": 200, "maxM2": null, "coefficient": 3.0}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
CATEGORY_C_ID=$(echo "$BODY" | jq -r '.id // empty')

if [[ "$HTTP_CODE" == "201" ]]; then
  log_success "Category C created (201)"
else
  log_error "Category C failed (HTTP $HTTP_CODE)"
fi

# TEST 2: Overlapping range
log_test "TEST 2: Attempt overlapping range (expect 409)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Overlapping", "minM2": 50, "maxM2": 150, "coefficient": 1.5}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" == "409" ]]; then
  log_success "Overlapping range rejected (409)"
else
  log_error "Expected 409 for overlap, got $HTTP_CODE"
fi

# TEST 3: Auto-assign preview
log_test "TEST 3: Auto-assign preview (no save)"

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories/auto-assign/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": false}')

ASSIGNED=$(echo "$RESPONSE" | jq '.assigned')
NO_M2=$(echo "$RESPONSE" | jq '.noM2 | length')

if [[ $ASSIGNED -eq 3 && $NO_M2 -eq 1 ]]; then
  log_success "Preview correct: assigned=3, noM2=1"
else
  log_error "Preview incorrect: assigned=$ASSIGNED (expected 3), noM2=$NO_M2 (expected 1)"
fi

# TEST 4: Execute auto-assign
log_test "TEST 4: Execute auto-assign (save changes)"

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories/auto-assign" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": false}')

ASSIGNED=$(echo "$RESPONSE" | jq '.assigned')

# Verify unit assignment
UNIT_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/units/$UNIT_1" \
  -H "Authorization: Bearer $TOKEN")
UNIT_CATEGORY=$(echo "$UNIT_DATA" | jq -r '.unitCategoryId // empty')

if [[ "$UNIT_CATEGORY" == "$CATEGORY_A_ID" ]]; then
  log_success "Auto-assign executed: Unit 1 → Category A"
else
  log_error "Auto-assign failed: Unit 1 not assigned"
fi

# ============================================================================
# PART C: EXPENSE PERIOD TESTS
# ============================================================================

log_test "PART C: EXPENSE PERIOD TESTS"

# TEST 5: Create period
log_test "TEST 5: Create expense period (expect DRAFT)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2026,
    "month": 1,
    "totalToAllocate": 300000,
    "currency": "ARS",
    "dueDate": "2026-02-01T23:59:59Z",
    "concept": "Expensas Comunes - Enero 2026"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
PERIOD_ID=$(echo "$BODY" | jq -r '.id // empty')
STATUS=$(echo "$BODY" | jq -r '.status // empty')

if [[ "$HTTP_CODE" == "201" && "$STATUS" == "DRAFT" ]]; then
  log_success "Period created with DRAFT status (id=$PERIOD_ID)"
else
  log_error "Period creation failed (HTTP $HTTP_CODE, status=$STATUS)"
fi

# TEST 6: Generate charges
log_test "TEST 6: Generate charges with exact cent distribution"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
CHARGES_COUNT=$(echo "$BODY" | jq '.chargesCount')
TOTAL_ALLOCATED=$(echo "$BODY" | jq '.totalAllocated')

if [[ "$HTTP_CODE" == "200" && $TOTAL_ALLOCATED -eq 300000 ]]; then
  log_success "Charges generated: count=$CHARGES_COUNT, total=$TOTAL_ALLOCATED (exact)"
else
  log_error "Generation failed (HTTP $HTTP_CODE) or total mismatch"
fi

# TEST 7: Verify snapshots
log_test "TEST 7: Verify snapshot preservation"

PERIOD_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID" \
  -H "Authorization: Bearer $TOKEN")

COEFF=$(echo "$PERIOD_DATA" | jq '.charges[0].coefficientSnapshot')
SUM_COEFF=$(echo "$PERIOD_DATA" | jq '.charges[0].sumCoefSnapshot')

if [[ ! -z "$COEFF" && ! -z "$SUM_COEFF" ]]; then
  log_success "Snapshots preserved (coeff=$COEFF, sumCoef=$SUM_COEFF)"
else
  log_error "Snapshots missing"
fi

# TEST 8: Publish period
log_test "TEST 8: Publish expense period"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
PUB_STATUS=$(echo "$BODY" | jq -r '.status // empty')

if [[ "$HTTP_CODE" == "200" && "$PUB_STATUS" == "PUBLISHED" ]]; then
  log_success "Period published (status=PUBLISHED)"
else
  log_error "Publish failed (HTTP $HTTP_CODE, status=$PUB_STATUS)"
fi

# TEST 9: Prevent re-generation
log_test "TEST 9: Prevent re-generation of PUBLISHED period (expect 409)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_CODE" == "409" ]]; then
  log_success "Re-generation blocked (409)"
else
  log_error "Expected 409, got $HTTP_CODE"
fi

# ============================================================================
# PART D: EDGE CASES
# ============================================================================

log_test "PART D: EDGE CASES & SNAPSHOTS"

# TEST 10: Coefficient change preserves snapshot
log_test "TEST 10: Change coefficient, verify old charges keep snapshot"

curl -s -X PATCH "$API_URL/buildings/$BUILDING_ID/expense-categories/$CATEGORY_A_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"coefficient": 2.0}' > /dev/null

PERIOD_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID" \
  -H "Authorization: Bearer $TOKEN")
SNAPSHOT_COEFF=$(echo "$PERIOD_DATA" | jq '.charges[0].coefficientSnapshot')

if [[ "$SNAPSHOT_COEFF" == "1" ]]; then
  log_success "Snapshots preserved after coefficient change (snapshot=1.0)"
else
  log_error "Snapshot mismatch: expected 1, got $SNAPSHOT_COEFF"
fi

# TEST 11: Soft-delete category
log_test "TEST 11: Soft-delete category (active=false)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/buildings/$BUILDING_ID/expense-categories/$CATEGORY_A_ID" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_CODE" == "204" ]]; then
  log_success "Category soft-deleted (204)"
else
  log_error "Delete failed (HTTP $HTTP_CODE)"
fi

# TEST 12: Block generation with inactive category
log_test "TEST 12: Block generation with inactive category (expect 422)"

PERIOD_2=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2026,
    "month": 2,
    "totalToAllocate": 300000,
    "currency": "ARS",
    "dueDate": "2026-03-01T23:59:59Z",
    "concept": "Expensas Comunes - Febrero 2026"
  }' | jq -r '.id')

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_2/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_CODE" == "422" ]]; then
  log_success "Generation blocked with inactive category (422)"
else
  log_error "Expected 422, got $HTTP_CODE"
fi

# ============================================================================
# SUMMARY
# ============================================================================

TOTAL=$((TESTS_PASSED + TESTS_FAILED))
echo -e "\n${BLUE}========== SUMMARY ==========${NC}"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo -e "Total:  $TOTAL"

if [[ $TESTS_FAILED -eq 0 ]]; then
  echo -e "\n${GREEN}✅ ALL TESTS PASSED!${NC}"
  exit 0
else
  echo -e "\n${RED}❌ SOME TESTS FAILED${NC}"
  exit 1
fi
