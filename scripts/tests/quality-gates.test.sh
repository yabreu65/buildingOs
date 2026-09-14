#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
PRE_PUSH_GATE="$REPO_ROOT/scripts/quality/pre-push-gate.sh"
GGA_GATE="$REPO_ROOT/scripts/quality/gga-pr-gate.sh"
MIGRATION_GATE="$REPO_ROOT/scripts/quality/migration-upgrade-gate.sh"

for script in "$PRE_PUSH_GATE" "$GGA_GATE" "$MIGRATION_GATE"; do
  bash -n "$script"
done

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/buildingos-quality-gates.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

setup_repository() {
  local name="$1"
  local bare_repository="$TEMP_ROOT/${name}-origin.git"
  local repository="$TEMP_ROOT/$name"

  git init --bare --template= -q "$bare_repository"
  git init --template= -q "$repository"
  git -C "$repository" config user.email quality-gates@example.invalid
  git -C "$repository" config user.name quality-gates
  git -C "$repository" config core.hooksPath /dev/null
  git -C "$repository" checkout -q -b main
  mkdir -p "$repository/scripts/quality"
  cp "$GGA_GATE" "$repository/scripts/quality/gga-pr-gate.sh"
  chmod +x "$repository/scripts/quality/gga-pr-gate.sh"
  printf 'quality gate fixture\n' > "$repository/README.md"
  git -C "$repository" add README.md scripts/quality/gga-pr-gate.sh
  git -C "$repository" commit -qm 'test fixture'
  git -C "$repository" remote add origin "$bare_repository"
  git -C "$repository" push -q -u origin main
  git -C "$repository" checkout -q -b feature/quality-gate
  git -C "$repository" push -q -u origin feature/quality-gate
  printf '%s\n' "$repository"
}

make_fake_gga() {
  local directory="$1"
  mkdir -p "$directory"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    ': "${GGA_MARKER:?}"' \
    'printf "invoked\\n" > "$GGA_MARKER"' > "$directory/gga"
  chmod +x "$directory/gga"
}

run_rejection_case() {
  local repository="$1"
  local marker="$2"
  local output="$3"

  if GGA_PROVIDER=fake GGA_MARKER="$marker" PATH="$TEMP_ROOT/fake-bin:$PATH" \
    bash "$repository/scripts/quality/gga-pr-gate.sh" >"$output" 2>&1; then
    fail "GGA gate unexpectedly passed for $repository"
  fi
  [[ ! -e "$marker" ]] || fail "fake gga was invoked for $repository"
}

make_fake_gga "$TEMP_ROOT/fake-bin"

dirty_repository="$(setup_repository dirty)"
printf 'tracked change\n' >> "$dirty_repository/README.md"
run_rejection_case "$dirty_repository" "$TEMP_ROOT/dirty-invoked" "$TEMP_ROOT/dirty-output"
grep -F 'tracked changes are present' "$TEMP_ROOT/dirty-output" >/dev/null ||
  fail 'dirty-worktree rejection was not reported'

mismatch_repository="$(setup_repository mismatch)"
printf 'local-only commit\n' >> "$mismatch_repository/README.md"
git -C "$mismatch_repository" add README.md
git -C "$mismatch_repository" commit -qm 'ahead of origin'
run_rejection_case "$mismatch_repository" "$TEMP_ROOT/mismatch-invoked" "$TEMP_ROOT/mismatch-output"
grep -F 'HEAD does not equal origin/feature/quality-gate' "$TEMP_ROOT/mismatch-output" >/dev/null ||
  fail 'remote-head mismatch rejection was not reported'

printf 'PASS: quality gate shell checks passed.\n'
