#!/bin/bash

##############################################################################
# GitHub Labels Setup Script
#
# Purpose: Create all standardized labels for bug triage workflow
#
# Usage:
#   1. Set GITHUB_TOKEN environment variable:
#      export GITHUB_TOKEN=your_github_token_here
#
#   2. Set GITHUB_REPO environment variable:
#      export GITHUB_REPO=owner/repo (e.g., yoryiabreu/buildingos)
#
#   3. Run this script:
#      ./scripts/setup-labels.sh
#
# Requires: curl, jq
##############################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GITHUB_API="https://api.github.com"

# Validate requirements
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}❌ Error: GITHUB_TOKEN environment variable not set${NC}"
    echo "   export GITHUB_TOKEN=your_github_token_here"
    exit 1
fi

if [ -z "$GITHUB_REPO" ]; then
    echo -e "${RED}❌ Error: GITHUB_REPO environment variable not set${NC}"
    echo "   export GITHUB_REPO=owner/repo"
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo -e "${RED}❌ Error: curl is required${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ Error: jq is required (install with: brew install jq)${NC}"
    exit 1
fi

echo -e "${BLUE}🏷️  Setting up GitHub Labels for ${GITHUB_REPO}${NC}"
echo ""

# Function to create a label
create_label() {
    local name=$1
    local color=$2
    local description=$3

    echo -n "Creating label: ${YELLOW}${name}${NC}... "

    response=$(curl -s -X POST \
        -H "Authorization: token ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        "${GITHUB_API}/repos/${GITHUB_REPO}/labels" \
        -d "{\"name\":\"${name}\",\"color\":\"${color}\",\"description\":\"${description}\"}" \
        2>&1)

    # Check if label already exists
    if echo "$response" | grep -q "already_exists"; then
        echo -e "${YELLOW}(already exists)${NC}"
    elif echo "$response" | grep -q "\"name\":\"${name}\""; then
        echo -e "${GREEN}✅${NC}"
    else
        echo -e "${RED}❌${NC}"
        echo "Response: $response"
    fi
}

# Priority Labels
echo -e "${BLUE}📊 Priority Labels${NC}"
create_label "P0-critical" "d32f2f" "Fix immediately (data loss, crashes, security)"
create_label "P1-high" "f57c00" "Fix this sprint (major feature broken)"
create_label "P2-medium" "fbc02d" "Fix next sprint (workaround exists)"

echo ""
echo -e "${BLUE}🔧 Component Labels${NC}"
create_label "backend" "1976d2" "API, database, server-side logic"
create_label "frontend" "7b1fa2" "React, Next.js, UI/UX"
create_label "auth" "c2185b" "Authentication, authorization, JWT"
create_label "database" "0097a7" "Schema, migrations, data integrity"
create_label "performance" "388e3c" "Speed, optimization, efficiency"
create_label "ui" "d81b60" "User interface, styling, layout"
create_label "mobile" "6a1b9a" "Mobile responsiveness, mobile app"
create_label "documentation" "455a64" "Docs, guides, comments"

echo ""
echo -e "${BLUE}🔄 Status Labels${NC}"
create_label "needs-triage" "e0e0e0" "Awaiting priority & assignment"
create_label "needs-info" "bdbdbd" "Awaiting reporter clarification"
create_label "in-progress" "42a5f5" "Developer is working on it"
create_label "in-review" "ab47bc" "PR awaiting code review"
create_label "verified" "26a69a" "QA confirmed fix works"
create_label "released" "7cb342" "Fixed & deployed to production"

echo ""
echo -e "${BLUE}📝 Type Labels${NC}"
create_label "bug" "e53935" "Something is broken"
create_label "regression" "d81b60" "Used to work, now broken"
create_label "feature-request" "5e35b1" "Requested feature (mislabeled)"
create_label "chore" "616161" "Internal improvement, cleanup"

echo ""
echo -e "${BLUE}⚠️  Impact Labels${NC}"
create_label "multi-tenant" "c62828" "Affects multiple tenants/users"
create_label "security" "bf360c" "Security vulnerability"
create_label "data-loss" "e53935" "Risk of data loss/corruption"
create_label "blocker" "d32f2f" "Blocks other work/features"
create_label "regression-critical" "c62828" "Critical regression (worked before)"

echo ""
echo -e "${GREEN}✅ Label setup complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Go to: https://github.com/${GITHUB_REPO}/labels"
echo "  2. Verify all labels are created"
echo "  3. Create first issue using the bug report template"
echo "  4. Share BUG_TRIAGE.md with your team"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  - BUG_TRIAGE.md → Complete bug triage process"
echo "  - GITHUB_LABELS.md → Label configuration reference"
echo "  - .github/ISSUE_TEMPLATE/bug_report.md → Bug report template"
