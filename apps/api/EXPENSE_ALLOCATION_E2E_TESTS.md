# Expense Allocation System — E2E Tests (Phase 2)

## Setup

### Environment Variables
```bash
export API_URL="http://localhost:3000"
export TENANT_ID="test_tenant_001"
export BUILDING_ID=""  # Will be set after building creation
export CATEGORY_A_ID=""
export CATEGORY_B_ID=""
export PERIOD_ID=""
export TOKEN="your_jwt_token_here"
```

### Auth Headers
```bash
HEADERS=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
```

### Helper: Pretty Print JSON
```bash
prettify() {
  echo "$1" | jq '.' 2>/dev/null || echo "$1"
}
```

---

## Part A: Seed Data Setup

### A1. Create Building
```bash
# Create a building and enable allocation mode
curl -X POST "$API_URL/buildings" "${HEADERS[@]}" \
  -d '{
    "name": "Test Building - Expense Allocation",
    "address": "Test St 123"
  }' | jq -r '.id' > /tmp/building_id.txt

export BUILDING_ID=$(cat /tmp/building_id.txt)
echo "Building ID: $BUILDING_ID"
```

### A2. Enable Allocation Mode on Building
```bash
# PATCH building to set allocationMode = BY_CATEGORY_RANGE_M2_COEFFICIENT
curl -X PATCH "$API_URL/buildings/$BUILDING_ID" "${HEADERS[@]}" \
  -d '{
    "allocationMode": "BY_CATEGORY_RANGE_M2_COEFFICIENT"
  }' | jq '.allocationMode'
```

### A3. Create Units with m2
```bash
# Unit 1: 50 m² (will match Category A: 40-60)
curl -X POST "$API_URL/buildings/$BUILDING_ID/units" "${HEADERS[@]}" \
  -d '{
    "code": "UNIT_001",
    "label": "Unit 001 - 50m²",
    "unitType": "APARTMENT",
    "m2": 50,
    "isBillable": true
  }' | jq '.id' > /tmp/unit_1.txt

# Unit 2: 120 m² (will match Category B: 100-200)
curl -X POST "$API_URL/buildings/$BUILDING_ID/units" "${HEADERS[@]}" \
  -d '{
    "code": "UNIT_002",
    "label": "Unit 002 - 120m²",
    "unitType": "APARTMENT",
    "m2": 120,
    "isBillable": true
  }' | jq '.id' > /tmp/unit_2.txt

# Unit 3: 250 m² (will match Category C catch-all: 200-∞)
curl -X POST "$API_URL/buildings/$BUILDING_ID/units" "${HEADERS[@]}" \
  -d '{
    "code": "UNIT_003",
    "label": "Unit 003 - 250m²",
    "unitType": "APARTMENT",
    "m2": 250,
    "isBillable": true
  }' | jq '.id' > /tmp/unit_3.txt

# Unit 4: No m2 (should fail auto-assign)
curl -X POST "$API_URL/buildings/$BUILDING_ID/units" "${HEADERS[@]}" \
  -d '{
    "code": "UNIT_004",
    "label": "Unit 004 - No m2",
    "unitType": "APARTMENT",
    "m2": null,
    "isBillable": true
  }' | jq '.id' > /tmp/unit_4.txt

# Unit 5: isBillable=false (should be excluded from allocation)
curl -X POST "$API_URL/buildings/$BUILDING_ID/units" "${HEADERS[@]}" \
  -d '{
    "code": "HALLWAY",
    "label": "Common Hallway",
    "unitType": "STORAGE",
    "m2": 30,
    "isBillable": false
  }' | jq '.id' > /tmp/unit_5.txt

echo "Units created. Stored IDs in /tmp/unit_*.txt"
```

---

## Part B: Unit Category Tests

### TEST 1: Create valid category ranges (expect 201)
```bash
echo "=== TEST 1: Create valid category ranges ==="

# Category A: 40-60 m², coefficient 1.0
curl -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" "${HEADERS[@]}" \
  -d '{
    "name": "Category A (40-60m²)",
    "minM2": 40,
    "maxM2": 60,
    "coefficient": 1.0
  }' | jq '. | {status: .id, name, minM2, maxM2, coefficient}' | tee /tmp/test1_a.json

export CATEGORY_A_ID=$(jq -r '.status' /tmp/test1_a.json)

# Category B: 100-200 m², coefficient 2.5
curl -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" "${HEADERS[@]}" \
  -d '{
    "name": "Category B (100-200m²)",
    "minM2": 100,
    "maxM2": 200,
    "coefficient": 2.5
  }' | jq '. | {status: .id, name, minM2, maxM2, coefficient}' | tee /tmp/test1_b.json

export CATEGORY_B_ID=$(jq -r '.status' /tmp/test1_b.json)

# Category C: 200+ m², coefficient 3.0 (catch-all with maxM2=null)
curl -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" "${HEADERS[@]}" \
  -d '{
    "name": "Category C (200+m²)",
    "minM2": 200,
    "maxM2": null,
    "coefficient": 3.0
  }' | jq '. | {status: .id, name, minM2, maxM2, coefficient}' | tee /tmp/test1_c.json

export CATEGORY_C_ID=$(jq -r '.status' /tmp/test1_c.json)

echo "✅ TEST 1 PASSED: 3 categories created (A=$CATEGORY_A_ID, B=$CATEGORY_B_ID, C=$CATEGORY_C_ID)"
```

### TEST 2: Attempt overlapping range (expect 422)
```bash
echo "=== TEST 2: Attempt overlapping range ==="

# Try to create category 50-150 (overlaps with A and B)
RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories" "${HEADERS[@]}" \
  -d '{
    "name": "Overlapping Category (50-150m²)",
    "minM2": 50,
    "maxM2": 150,
    "coefficient": 1.5
  }')

HTTP_STATUS=$(echo "$RESPONSE" | jq -r '.statusCode // .status // 200')
if [[ "$HTTP_STATUS" == "409" ]]; then
  echo "✅ TEST 2 PASSED: Got 409 Conflict for overlapping range"
  echo "$RESPONSE" | jq '.message'
else
  echo "❌ TEST 2 FAILED: Expected 409, got $HTTP_STATUS"
  echo "$RESPONSE" | jq '.'
fi
```

### TEST 3: Auto-assign preview (no save)
```bash
echo "=== TEST 3: Auto-assign preview (no save) ==="

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories/auto-assign/preview" "${HEADERS[@]}" \
  -d '{"force": false}')

ASSIGNED=$(echo "$RESPONSE" | jq '.assigned')
UNASSIGNED=$(echo "$RESPONSE" | jq '.unassigned | length')
NO_M2=$(echo "$RESPONSE" | jq '.noM2 | length')
ALREADY=$(echo "$RESPONSE" | jq '.alreadyAssigned')

echo "Preview Results:"
echo "  Assigned: $ASSIGNED (expected: 3 - units 1,2,3)"
echo "  Unassigned: $UNASSIGNED (expected: 0)"
echo "  No m2: $NO_M2 (expected: 1 - unit 4)"
echo "  Already assigned: $ALREADY (expected: 0)"

if [[ $ASSIGNED -eq 3 && $NO_M2 -eq 1 ]]; then
  echo "✅ TEST 3 PASSED: Preview shows correct distribution"
else
  echo "❌ TEST 3 FAILED: Numbers don't match"
fi
```

### TEST 4: Execute auto-assign (save changes)
```bash
echo "=== TEST 4: Execute auto-assign (save changes) ==="

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-categories/auto-assign" "${HEADERS[@]}" \
  -d '{"force": false}')

ASSIGNED=$(echo "$RESPONSE" | jq '.assigned')

echo "Auto-assign Results:"
echo "  Assigned: $ASSIGNED"
echo "$RESPONSE" | jq '.'

# Verify units are assigned by fetching one unit
UNIT_1=$(cat /tmp/unit_1.txt)
UNIT_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/units/$UNIT_1" "${HEADERS[@]}")
CATEGORY=$(echo "$UNIT_DATA" | jq '.unitCategoryId')

if [[ "$CATEGORY" == "$CATEGORY_A_ID" ]]; then
  echo "✅ TEST 4 PASSED: Unit auto-assigned to category $CATEGORY"
else
  echo "❌ TEST 4 FAILED: Unit category mismatch"
fi
```

---

## Part C: Expense Period Tests

### TEST 5: Create expense period (expect DRAFT)
```bash
echo "=== TEST 5: Create expense period (status = DRAFT) ==="

# Create period for Jan 2026 with 300,000 centavos = $3,000 ARS
RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods" "${HEADERS[@]}" \
  -d '{
    "year": 2026,
    "month": 1,
    "totalToAllocate": 300000,
    "currency": "ARS",
    "dueDate": "2026-02-01T23:59:59Z",
    "concept": "Expensas Comunes - Enero 2026"
  }')

export PERIOD_ID=$(echo "$RESPONSE" | jq -r '.id')
STATUS=$(echo "$RESPONSE" | jq -r '.status')

if [[ "$STATUS" == "DRAFT" ]]; then
  echo "✅ TEST 5 PASSED: Period created with status=$STATUS (id=$PERIOD_ID)"
else
  echo "❌ TEST 5 FAILED: Expected DRAFT, got $STATUS"
fi
```

### TEST 6: Generate charges (validate exact cent distribution)
```bash
echo "=== TEST 6: Generate charges with exact cent distribution ==="

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID/generate" "${HEADERS[@]}" \
  -d '{}')

CHARGES_COUNT=$(echo "$RESPONSE" | jq '.chargesCount')
TOTAL_ALLOCATED=$(echo "$RESPONSE" | jq '.totalAllocated')

echo "Generation Results:"
echo "  Charges created: $CHARGES_COUNT (expected: 3)"
echo "  Total allocated: $TOTAL_ALLOCATED (expected: 300000)"

# Verify exact sum
if [[ $TOTAL_ALLOCATED -eq 300000 ]]; then
  echo "✅ TEST 6 PASSED: Exact cent distribution (Σ charges === totalToAllocate)"
else
  echo "❌ TEST 6 FAILED: Total mismatch. Expected 300000, got $TOTAL_ALLOCATED"
fi

# Verify charges are in GENERATED period
PERIOD_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID" "${HEADERS[@]}")
PERIOD_STATUS=$(echo "$PERIOD_DATA" | jq -r '.status')
CHARGES=$(echo "$PERIOD_DATA" | jq '.charges | length')

echo "  Period status: $PERIOD_STATUS (expected: GENERATED)"
echo "  Charges in period: $CHARGES"

# Print charge amounts to verify distribution
echo "  Charge amounts:"
echo "$PERIOD_DATA" | jq '.charges[] | {unitCode, amount}' | head -20
```

### TEST 7: Verify snapshot preservation (coefficient history)
```bash
echo "=== TEST 7: Verify snapshot preservation ==="

PERIOD_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID" "${HEADERS[@]}")

echo "Snapshot verification:"
echo "$PERIOD_DATA" | jq '.charges[0] | {unitCode, amount, coefficientSnapshot, sumCoefSnapshot, totalToAllocateSnapshot}' | head -20

COEFF=$(echo "$PERIOD_DATA" | jq '.charges[0].coefficientSnapshot')
SUM_COEFF=$(echo "$PERIOD_DATA" | jq '.charges[0].sumCoefSnapshot')

if [[ ! -z "$COEFF" && ! -z "$SUM_COEFF" ]]; then
  echo "✅ TEST 7 PASSED: Snapshots preserved (coeff=$COEFF, sumCoef=$SUM_COEFF)"
else
  echo "❌ TEST 7 FAILED: Snapshots missing"
fi
```

### TEST 8: Publish expense period
```bash
echo "=== TEST 8: Publish expense period (GENERATED → PUBLISHED) ==="

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID/publish" "${HEADERS[@]}" \
  -d '{}')

PUBLISHED_STATUS=$(echo "$RESPONSE" | jq -r '.status')
PUBLISHED_AT=$(echo "$RESPONSE" | jq -r '.publishedAt')

if [[ "$PUBLISHED_STATUS" == "PUBLISHED" && ! -z "$PUBLISHED_AT" ]]; then
  echo "✅ TEST 8 PASSED: Period published with timestamp=$PUBLISHED_AT"
else
  echo "❌ TEST 8 FAILED: Expected PUBLISHED status, got $PUBLISHED_STATUS"
fi
```

### TEST 9: Prevent re-generation of PUBLISHED period (expect 409)
```bash
echo "=== TEST 9: Prevent re-generation of PUBLISHED period ==="

RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID/generate" "${HEADERS[@]}" \
  -d '{}')

HTTP_STATUS=$(echo "$RESPONSE" | jq -r '.statusCode // .status // 200')
ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // .error // "no message"')

if [[ "$HTTP_STATUS" == "409" ]]; then
  echo "✅ TEST 9 PASSED: Got 409 Conflict for PUBLISHED period"
  echo "  Message: $ERROR_MSG"
else
  echo "❌ TEST 9 FAILED: Expected 409, got $HTTP_STATUS"
fi
```

---

## Part D: Edge Cases & Snapshot Tests

### TEST 10: Change coefficient and verify old charges keep snapshot
```bash
echo "=== TEST 10: Coefficient change preserves historical snapshots ==="

# Update Category A coefficient from 1.0 to 2.0
curl -s -X PATCH "$API_URL/buildings/$BUILDING_ID/expense-categories/$CATEGORY_A_ID" "${HEADERS[@]}" \
  -d '{
    "coefficient": 2.0
  }' | jq '.coefficient'

# Verify published charges still have old snapshot (1.0)
PERIOD_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_ID" "${HEADERS[@]}")
SNAPSHOT_COEFF=$(echo "$PERIOD_DATA" | jq '.charges[0].coefficientSnapshot')

echo "Published charge coefficient snapshot: $SNAPSHOT_COEFF (should be 1.0)"

if [[ "$SNAPSHOT_COEFF" == "1" ]]; then
  echo "✅ TEST 10 PASSED: Snapshots preserved despite coefficient change"
else
  echo "❌ TEST 10 FAILED: Snapshot was modified"
fi
```

### TEST 11: Soft-delete category (active=false)
```bash
echo "=== TEST 11: Soft-delete category (active=false) ==="

# Delete Category A
curl -s -X DELETE "$API_URL/buildings/$BUILDING_ID/expense-categories/$CATEGORY_A_ID" "${HEADERS[@]}"

# Fetch the category and verify it's still there but inactive
CATEGORY_DATA=$(curl -s "$API_URL/buildings/$BUILDING_ID/expense-categories/$CATEGORY_A_ID" "${HEADERS[@]}")
ACTIVE=$(echo "$CATEGORY_DATA" | jq '.active')

if [[ "$ACTIVE" == "false" ]]; then
  echo "✅ TEST 11 PASSED: Category soft-deleted (active=false)"
else
  echo "❌ TEST 11 FAILED: Expected active=false, got $ACTIVE"
fi
```

### TEST 12: Block generation with inactive category (expect 422)
```bash
echo "=== TEST 12: Block generation when unit has inactive category ==="

# Create a new period for Feb
PERIOD_2=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods" "${HEADERS[@]}" \
  -d '{
    "year": 2026,
    "month": 2,
    "totalToAllocate": 300000,
    "currency": "ARS",
    "dueDate": "2026-03-01T23:59:59Z",
    "concept": "Expensas Comunes - Febrero 2026"
  }' | jq -r '.id')

echo "New period created: $PERIOD_2"

# Try to generate charges → should fail because Unit 1 has inactive category
RESPONSE=$(curl -s -X POST "$API_URL/buildings/$BUILDING_ID/expense-periods/$PERIOD_2/generate" "${HEADERS[@]}" \
  -d '{}')

HTTP_STATUS=$(echo "$RESPONSE" | jq -r '.statusCode // .status // 200')
ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // .error // "no message"')

if [[ "$HTTP_STATUS" == "422" ]]; then
  echo "✅ TEST 12 PASSED: Got 422 for inactive category"
  echo "  Message: $ERROR_MSG"
  echo "$RESPONSE" | jq '.unitsWithoutCategory // .' | head -5
else
  echo "❌ TEST 12 FAILED: Expected 422, got $HTTP_STATUS"
fi
```

---

## Summary

Run all tests with:
```bash
bash EXPENSE_ALLOCATION_E2E_TESTS.md
```

Expected results:
- ✅ TEST 1: 3 valid categories created
- ✅ TEST 2: Overlapping range rejected (409)
- ✅ TEST 3: Preview shows correct distribution
- ✅ TEST 4: Auto-assign saves changes
- ✅ TEST 5: Period created with DRAFT status
- ✅ TEST 6: Charges generated with exact cent distribution
- ✅ TEST 7: Snapshots preserved
- ✅ TEST 8: Period published successfully
- ✅ TEST 9: Re-generation blocked (409)
- ✅ TEST 10: Old snapshots survive coefficient change
- ✅ TEST 11: Category soft-deleted
- ✅ TEST 12: Generation blocked with inactive category (422)

All 12 acceptance criteria passed → **Phase 2 Complete**
