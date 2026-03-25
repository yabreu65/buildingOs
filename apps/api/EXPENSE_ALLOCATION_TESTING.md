# Expense Allocation System — Testing Guide (Phase 2)

## Quick Start

### Prerequisites
1. **API running**: `npm run dev` (or `npm run start:dev`)
2. **Valid JWT token**: Login as TENANT_ADMIN or higher
3. **jq installed**: `brew install jq` (for JSON parsing)
4. **curl available**: Usually pre-installed

### Run All Tests
```bash
cd apps/api

export TOKEN="your_jwt_token_here"
export API_URL="http://localhost:3000"  # or your API URL
export TENANT_ID="your_tenant_id"       # optional, defaults to test_tenant_001

./run-expense-allocation-tests.sh
```

### Expected Output
```
✓ Building created: cuid_123
✓ Allocation mode enabled
✓ Units created: U1=cuid_1 (50m²), U2=cuid_2 (120m²), U3=cuid_3 (250m²), U4=cuid_4 (no m2)
✓ Category A created (201)
✓ Category B created (201)
✓ Category C created (201)
✓ Overlapping range rejected (409)
✓ Preview correct: assigned=3, noM2=1
✓ Auto-assign executed: Unit 1 → Category A
✓ Period created with DRAFT status (id=cuid_period)
✓ Charges generated: count=3, total=300000 (exact)
✓ Snapshots preserved (coeff=1.0, sumCoef=6.5)
✓ Period published (status=PUBLISHED)
✓ Re-generation blocked (409)
✓ Snapshots preserved after coefficient change (snapshot=1.0)
✓ Category soft-deleted (204)
✓ Generation blocked with inactive category (422)

========== SUMMARY ==========
Passed: 12
Failed: 0
Total:  12

✅ ALL TESTS PASSED!
```

---

## Manual Testing (Interactive)

If you prefer to run tests manually or step-by-step:

### Step 1: Get a Valid Token
```bash
export TOKEN=$(curl -s -X POST "http://localhost:3000/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password"}' | jq -r '.accessToken')

echo "Token: $TOKEN"
```

### Step 2: Create Building and Enable Allocation
```bash
export BUILDING_ID=$(curl -s -X POST "http://localhost:3000/buildings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Building", "address": "Test St"}' | jq -r '.id')

echo "Building: $BUILDING_ID"

# Enable allocation mode
curl -s -X PATCH "http://localhost:3000/buildings/$BUILDING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allocationMode": "BY_CATEGORY_RANGE_M2_COEFFICIENT"}' | jq '.allocationMode'
```

### Step 3: Create Units
```bash
# 50 m² unit
export UNIT_1=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "U001", "label": "Unit 50m²", "m2": 50, "isBillable": true}' | jq -r '.id')

# 120 m² unit
export UNIT_2=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "U002", "label": "Unit 120m²", "m2": 120, "isBillable": true}' | jq -r '.id')

# 250 m² unit
export UNIT_3=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "U003", "label": "Unit 250m²", "m2": 250, "isBillable": true}' | jq -r '.id')

echo "Units created: U1=$UNIT_1, U2=$UNIT_2, U3=$UNIT_3"
```

### Step 4: Create Categories
```bash
# Category A: 40-60 m², coefficient 1.0
export CAT_A=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Cat A (40-60)", "minM2": 40, "maxM2": 60, "coefficient": 1.0}' | jq -r '.id')

# Category B: 100-200 m², coefficient 2.5
export CAT_B=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Cat B (100-200)", "minM2": 100, "maxM2": 200, "coefficient": 2.5}' | jq -r '.id')

# Category C: 200+ m², coefficient 3.0 (catch-all)
export CAT_C=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-categories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Cat C (200+)", "minM2": 200, "maxM2": null, "coefficient": 3.0}' | jq -r '.id')

echo "Categories: A=$CAT_A, B=$CAT_B, C=$CAT_C"
```

### Step 5: Auto-Assign Units
```bash
# Preview (no save)
curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-categories/auto-assign/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": false}' | jq '.'

# Execute (save)
curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-categories/auto-assign" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": false}' | jq '.'

# Verify unit assignment
curl -s "http://localhost:3000/buildings/$BUILDING_ID/units/$UNIT_1" \
  -H "Authorization: Bearer $TOKEN" | jq '{unitCategoryId, m2}'
```

### Step 6: Create and Generate Expense Period
```bash
# Create period (DRAFT)
export PERIOD=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-periods" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "year": 2026,
    "month": 1,
    "totalToAllocate": 300000,
    "currency": "ARS",
    "dueDate": "2026-02-01T23:59:59Z",
    "concept": "Expensas Comunes - Enero 2026"
  }' | jq -r '.id')

echo "Period: $PERIOD"

# Generate charges (DRAFT → GENERATED)
curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-periods/$PERIOD/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.'

# View charges with snapshots
curl -s "http://localhost:3000/buildings/$BUILDING_ID/expense-periods/$PERIOD" \
  -H "Authorization: Bearer $TOKEN" | jq '.charges[] | {unitCode, amount, coefficientSnapshot}'
```

### Step 7: Publish Period
```bash
curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-periods/$PERIOD/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.status'
```

### Step 8: Test Edge Cases

**Change coefficient and verify snapshot**
```bash
# Change Category A coefficient
curl -s -X PATCH "http://localhost:3000/buildings/$BUILDING_ID/expense-categories/$CAT_A" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"coefficient": 2.0}' | jq '.coefficient'

# Check that published charges still have old snapshot
curl -s "http://localhost:3000/buildings/$BUILDING_ID/expense-periods/$PERIOD" \
  -H "Authorization: Bearer $TOKEN" | jq '.charges[0].coefficientSnapshot'
# Should still be 1.0
```

**Soft-delete category**
```bash
curl -s -X DELETE "http://localhost:3000/buildings/$BUILDING_ID/expense-categories/$CAT_A" \
  -H "Authorization: Bearer $TOKEN"

# Verify it's still there but inactive
curl -s "http://localhost:3000/buildings/$BUILDING_ID/expense-categories/$CAT_A" \
  -H "Authorization: Bearer $TOKEN" | jq '.active'
# Should be false
```

**Create new period and try to generate (should fail)**
```bash
# Create Feb period
export PERIOD_2=$(curl -s -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-periods" \
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

# Try to generate → should fail because Unit 1 has inactive category
curl -s -w "\nHTTP %{http_code}\n" -X POST "http://localhost:3000/buildings/$BUILDING_ID/expense-periods/$PERIOD_2/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.'
# Should return 422 with unitsWithoutCategory list
```

---

## Verification Checklist

After running tests, verify:

- [ ] **12 test cases all passed** (or manual verification complete)
- [ ] **Exact cent distribution**: `Σ(charges) === 300,000` (no rounding errors)
- [ ] **Snapshots preserved**: Published charges have `coefficientSnapshot`, `sumCoefSnapshot`, etc.
- [ ] **Soft-delete works**: Category has `active: false` after DELETE
- [ ] **Inactive blocks generation**: 422 error when trying to generate with inactive category
- [ ] **Overlap validation**: Cannot create overlapping ranges
- [ ] **Auto-assign works**: Units correctly matched to categories by m² range
- [ ] **State machine works**: Period goes DRAFT → GENERATED → PUBLISHED → (can't re-generate)

---

## Troubleshooting

### "Cannot find module..." errors
Make sure all imports are correct:
```bash
cd apps/api && npx tsc --noEmit
```

### "Permission denied" on tests.sh
```bash
chmod +x /Users/yoryiabreu/proyectos/buildingos/apps/api/run-expense-allocation-tests.sh
```

### API returns 404 on endpoints
- Verify building and period IDs are correct
- Check that routes are registered in finanzas.module.ts
- Verify JWT token is valid

### "No active category" error on auto-assign
- Make sure categories are created with `active: true` (default)
- Check that units have `isBillable: true`
- Verify m² value exists and falls within category range

### Charges don't sum to exactly totalToAllocate
This indicates a bug in cent distribution. Check:
- Loop bounds in generateCharges (line 448)
- Delta calculation (line 444)
- Fraction sorting (line 447)

---

## Next Steps After Phase 2

If all 12 tests pass:
1. ✅ Phase 2 complete
2. Integration tests with Playwright (optional)
3. Performance tests (allocating to 1000+ units)
4. Frontend implementation for managing categories/periods
5. Resident-facing charge display

---

## Support

For issues or questions:
- Check EXPENSE_ALLOCATION_E2E_TESTS.md for detailed test documentation
- Review expense-categories.service.ts and expense-periods.service.ts for implementation details
- Check finanzas.validators.ts for permission checks
