#!/usr/bin/env bash
set -euo pipefail

# Blocks obviously destructive commands from being committed accidentally.
# This script is intentionally conservative: it scans staged text diffs only and
# ignores generated/binary artifacts. If a legitimate change is blocked, rewrite
# it to be explicit/safe or bypass with a deliberate `git commit --no-verify`.

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

failures=0

# Patterns that should almost never be introduced accidentally in app code/docs.
# Keep this list focused; noisy hooks get bypassed and then teach nobody anything.
DANGEROUS_PATTERNS=(
  'rm[[:space:]]+-rf[[:space:]]+/'
  'rm[[:space:]]+-rf[[:space:]]+\*'
  'sudo[[:space:]]+rm[[:space:]]+-rf'
  'chmod[[:space:]]+-R[[:space:]]+777'
  'chown[[:space:]]+-R[[:space:]]+[^[:space:]]+[[:space:]]+/'
  'docker[[:space:]]+system[[:space:]]+prune[[:space:]].*(-a|--all)'
  'docker[[:space:]]+volume[[:space:]]+rm'
  'docker[[:space:]]+compose[[:space:]].*down[[:space:]].*(-v|--volumes)'
  'DROP[[:space:]]+DATABASE'
  'DROP[[:space:]]+SCHEMA'
  'TRUNCATE[[:space:]]+TABLE'
  'DELETE[[:space:]]+FROM[[:space:]]+[^;]+;'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-fd'
)

is_text_file() {
  local file="$1"
  [ -f "$file" ] || return 1
  file --mime "$file" | grep -q 'charset='
}

should_skip_file() {
  local file="$1"
  case "$file" in
    node_modules/*|dist/*|coverage/*|apps/web/playwright-report/*|apps/web/test-results/*|test-results/*)
      return 0
      ;;
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.webm|*.mp4|*.mov|*.pdf|*.zip|*.gz|*.dump)
      return 0
      ;;
  esac
  return 1
}

for file in $STAGED_FILES; do
  if should_skip_file "$file" || ! is_text_file "$file"; then
    continue
  fi

  # Only scan added lines. Strip the leading '+' so regexes read naturally.
  added_lines=$(git diff --cached --unified=0 -- "$file" | sed -n '/^+[^+]/s/^+//p')
  [ -n "$added_lines" ] || continue

  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if printf '%s\n' "$added_lines" | grep -Eiq "$pattern"; then
      echo "❌ Dangerous pattern detected in staged changes: $file"
      echo "   Pattern: $pattern"
      failures=$((failures + 1))
    fi
  done
done

if [ "$failures" -gt 0 ]; then
  echo
  echo "Commit blocked by scripts/pre-commit-deny-dangerous.sh"
  echo "Review the staged changes. If this is intentional, make the operation safer/explicit or bypass manually."
  exit 1
fi

exit 0
