#!/bin/bash

# Validation: SUPER_ADMIN vs TENANT Routing Tests
# This script validates HTTP responses for critical routes

echo "═══════════════════════════════════════════════════════════════"
echo "ROUTING VALIDATION TEST - SUPER_ADMIN vs TENANT"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Function to test route availability
test_route() {
    local url=$1
    local name=$2
    local expected_code=$3

    echo -n "Testing: $name ... "

    response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>&1)

    if [ "$response" = "$expected_code" ]; then
        echo -e "${GREEN}✅ PASS${NC} (HTTP $response)"
        ((PASS++))
    else
        echo -e "${RED}❌ FAIL${NC} (Expected $expected_code, got $response)"
        ((FAIL++))
    fi
}

# Test basic routes
echo "🔹 PUBLIC ROUTES:"
test_route "http://localhost:3000/" "Homepage" "200"
test_route "http://localhost:3000/login" "Login page" "200"
test_route "http://localhost:3000/signup" "Signup page" "200"
test_route "http://localhost:3000/health" "Health check" "200"

echo ""
echo "🔹 SUPER_ADMIN ROUTES:"
test_route "http://localhost:3000/super-admin" "Control plane" "200"
test_route "http://localhost:3000/super-admin/overview" "Overview" "200"
test_route "http://localhost:3000/super-admin/tenants" "Tenants management" "200"
test_route "http://localhost:3000/super-admin/tenants/create" "Create tenant" "200"

echo ""
echo "🔹 TENANT ROUTES (should exist but require auth):"
test_route "http://localhost:3000/tenant-123/dashboard" "Tenant dashboard" "200"
test_route "http://localhost:3000/tenant-123/buildings" "Buildings list" "200"
test_route "http://localhost:3000/tenant-123/units" "Units list" "200"

echo ""
echo "🔹 INVALID ROUTES (should 404):"
test_route "http://localhost:3000/nonexistent" "Invalid route" "404"
test_route "http://localhost:3000/super-admin/invalid" "Invalid super-admin route" "404"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "RESULTS: ${GREEN}$PASS PASS${NC} | ${RED}$FAIL FAIL${NC}"
echo "═══════════════════════════════════════════════════════════════"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ ALL ROUTING TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi
