#!/bin/bash

# ============================================================================
# BuildingOS Branch Protection Setup Script
#
# This script configures GitHub branch protection rules for the `main` branch
# using GitHub CLI (gh). This ensures:
# - CI must pass before merging
# - PR reviews are required
# - Branches must be up-to-date
#
# Prerequisites:
#   1. Install GitHub CLI: https://cli.github.com
#   2. Login: gh auth login
#   3. Have admin access to the repository
#
# Usage:
#   chmod +x scripts/setup-branch-protection.sh
#   ./scripts/setup-branch-protection.sh
#
# ============================================================================

set -e

echo "🔒 BuildingOS - Branch Protection Setup"
echo "======================================="
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI not found. Install it: https://cli.github.com"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Run: gh auth login"
    exit 1
fi

# Get repository info
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
echo "📍 Repository: $REPO"
echo ""

# Confirm before proceeding
echo "⚠️  This will configure branch protection for the 'main' branch:"
echo "   - Require CI to pass (ci job)"
echo "   - Require 1 approved review"
echo "   - Require branches to be up-to-date"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔧 Configuring branch protection..."
echo ""

# Update branch protection settings
# Reference: https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28

gh api \
  --method PUT \
  /repos/$REPO/branches/main/protection \
  -f "required_status_checks={checks:[{context:'ci'}],strict:true}" \
  -f "required_pull_request_reviews={required_approving_review_count:1,dismiss_stale_reviews:true,require_code_owner_reviews:false}" \
  -f "enforce_admins=true" \
  -f "dismiss_stale_reviews=true" \
  -f "required_linear_history=false" \
  -f "allow_force_pushes=false" \
  -f "allow_deletions=false" \
  -f "required_conversation_resolution=false" \
  --input /dev/null

echo "✅ Branch protection configured!"
echo ""
echo "📋 Settings applied:"
echo "   ✓ Require status checks to pass (ci workflow)"
echo "   ✓ Require branches to be up-to-date before merging"
echo "   ✓ Require 1 pull request review before merging"
echo "   ✓ Dismiss stale pull request approvals when commits are pushed"
echo "   ✓ Enforce branch protection for administrators"
echo "   ✓ Block force pushes"
echo "   ✓ Block deletions"
echo ""

# Verify settings
echo "🔍 Verifying configuration..."
gh api /repos/$REPO/branches/main/protection \
  --jq '{
    required_status_checks: .required_status_checks,
    required_pull_request_reviews: .required_pull_request_reviews,
    enforce_admins: .enforce_admins,
    allow_force_pushes: .allow_force_pushes,
    allow_deletions: .allow_deletions
  }' | jq '.'

echo ""
echo "✨ Done! The main branch is now protected."
echo ""
echo "📚 For details, see: .github/BRANCH_PROTECTION.md"
