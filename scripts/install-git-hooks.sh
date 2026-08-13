#!/usr/bin/env bash
#
# Install the versioned BuildingOS git hooks into the CURRENT clone only.
#
# Sets repo-local core.hooksPath to scripts/git-hooks so every developer and
# every fresh clone gets the same pre-commit gate:
#   1. SAFETY  (pre-commit-deny-dangerous.sh)  -> BLOCKING
#   2. GENTLE  (gentle-advisory.sh)            -> ADVISORY / NON-BLOCKING
#
# Repo-local only: never touches global git config, never affects other
# repositories (CocinaCore, JurisManager, etc.).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$REPO_ROOT/scripts/git-hooks/pre-commit" ]; then
  echo "ERROR: $REPO_ROOT/scripts/git-hooks/pre-commit not found" >&2
  exit 1
fi

git config core.hooksPath scripts/git-hooks

echo "Installed BuildingOS git hooks (repo-local core.hooksPath=scripts/git-hooks)"
echo "Safety gate (pre-commit-deny-dangerous.sh) is BLOCKING."
echo "Gentle review (gentle-advisory.sh) is ADVISORY / NON-BLOCKING."
