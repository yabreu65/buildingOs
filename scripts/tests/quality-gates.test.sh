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
  mkdir -p "$repository/scripts/quality" "$repository/scripts/tests"
  cp "$GGA_GATE" "$repository/scripts/quality/gga-pr-gate.sh"
  cp "$PRE_PUSH_GATE" "$repository/scripts/quality/pre-push-gate.sh"
  cp "$MIGRATION_GATE" "$repository/scripts/quality/migration-upgrade-gate.sh"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'exit 0' > "$repository/scripts/tests/quality-gates.test.sh"
  chmod +x "$repository/scripts/quality/"*.sh "$repository/scripts/tests/quality-gates.test.sh"
  printf 'quality gate fixture\n' > "$repository/README.md"
  git -C "$repository" add README.md scripts
  git -C "$repository" commit -qm 'test fixture'
  git -C "$repository" remote add origin "$bare_repository"
  git -C "$repository" push -q -u origin main
  git -C "$repository" checkout -q -b feature/quality-gate
  git -C "$repository" push -q -u origin feature/quality-gate
  printf '%s\n' "$repository"
}

commit_fixture_path() {
  local repository="$1"
  local path="$2"

  mkdir -p "$repository/$(dirname "$path")"
  printf 'fixture change\n' > "$repository/$path"
  git -C "$repository" add "$path"
  git -C "$repository" commit -qm "change $path"
}

make_fake_gga() {
  local directory="$1"
  mkdir -p "$directory"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    ': "${GGA_MARKER:?}"' \
    'printf "invoked\\n" > "$GGA_MARKER"' \
    'printf "%s\\n" "${GGA_OUTPUT:-}"' \
    'exit "${GGA_STATUS:-0}"' > "$directory/gga"
  chmod +x "$directory/gga"
}

make_fake_npm() {
  local directory="$1"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    ': "${NPM_MARKER:?}"' \
    'printf "%s|%s\\n" "${DATABASE_URL:-}" "$*" >> "$NPM_MARKER"' > "$directory/npm"
  chmod +x "$directory/npm"
}

make_fake_migration_gate() {
  local repository="$1"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    ': "${MIGRATION_MARKER:?}"' \
    'printf "invoked\\n" > "$MIGRATION_MARKER"' > "$repository/scripts/quality/migration-upgrade-gate.sh"
  chmod +x "$repository/scripts/quality/migration-upgrade-gate.sh"
  git -C "$repository" add scripts/quality/migration-upgrade-gate.sh
  git -C "$repository" commit -qm 'fake migration gate'
}

make_fake_git() {
  local directory="$1"
  mkdir -p "$directory"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'if [[ "$*" == "fetch origin"* ]]; then exit "${GIT_FETCH_STATUS:-0}"; fi' \
    'if [[ "$*" == "worktree add --detach "* ]]; then printf "worktree:%s\\n" "$*" >> "${GIT_MARKER:?}"; exit 1; fi' \
    'if [[ "$*" == *origin/main* ]]; then printf "%s\\n" "${GIT_ORIGIN_MAIN_COMMIT:-origin-main}"; exit 0; fi' \
    'if [[ "$*" == *main* ]]; then printf "%s\\n" "${GIT_LOCAL_MAIN_COMMIT:-local-main}"; exit 0; fi' \
    'if [[ "$*" == *HEAD* ]]; then printf "%s\\n" "${GIT_HEAD_COMMIT:-head}"; exit 0; fi' \
    'printf "unexpected fake git invocation: %s\\n" "$*" >&2' \
    'exit 99' > "$directory/git"
  chmod +x "$directory/git"
}

run_gga_rejection_case() {
  local repository="$1"
  local marker="$2"
  local output="$3"

  if GGA_PROVIDER=fake GGA_MARKER="$marker" PATH="$TEMP_ROOT/fake-bin:$PATH" \
    bash "$repository/scripts/quality/gga-pr-gate.sh" >"$output" 2>&1; then
    fail "GGA gate unexpectedly passed for $repository"
  fi
}

make_fake_gga "$TEMP_ROOT/fake-bin"
make_fake_npm "$TEMP_ROOT/fake-bin"

missing_gga_bin="$TEMP_ROOT/missing-gga-bin"
mkdir -p "$missing_gga_bin"
ln -s "$(command -v dirname)" "$missing_gga_bin/dirname"
missing_gga_repository="$(setup_repository missing-gga)"
if GGA_PROVIDER=fake PATH="$missing_gga_bin" /bin/bash "$missing_gga_repository/scripts/quality/gga-pr-gate.sh" \
  >"$TEMP_ROOT/missing-gga-output" 2>&1; then
  fail 'GGA gate unexpectedly passed without the gga CLI'
fi
grep -F 'EXTERNAL_BLOCKER: GGA CLI is unavailable' "$TEMP_ROOT/missing-gga-output" >/dev/null ||
  fail 'missing gga CLI was not classified as EXTERNAL_BLOCKER'
if grep -F '+ gga run --pr-mode --no-cache' "$TEMP_ROOT/missing-gga-output" >/dev/null; then
  fail 'GGA gate attempted review execution without the gga CLI'
fi

dirty_repository="$(setup_repository dirty)"
printf 'tracked change\n' >> "$dirty_repository/README.md"
run_gga_rejection_case "$dirty_repository" "$TEMP_ROOT/dirty-invoked" "$TEMP_ROOT/dirty-output"
[[ ! -e "$TEMP_ROOT/dirty-invoked" ]] || fail 'fake gga ran for a dirty worktree'
grep -F 'tracked changes are present' "$TEMP_ROOT/dirty-output" >/dev/null ||
  fail 'dirty-worktree rejection was not reported'

mismatch_repository="$(setup_repository mismatch)"
printf 'local-only commit\n' >> "$mismatch_repository/README.md"
git -C "$mismatch_repository" add README.md
git -C "$mismatch_repository" commit -qm 'ahead of origin'
run_gga_rejection_case "$mismatch_repository" "$TEMP_ROOT/mismatch-invoked" "$TEMP_ROOT/mismatch-output"
[[ ! -e "$TEMP_ROOT/mismatch-invoked" ]] || fail 'fake gga ran for an unpublished candidate'
grep -F 'HEAD does not equal origin/feature/quality-gate' "$TEMP_ROOT/mismatch-output" >/dev/null ||
  fail 'remote-head mismatch rejection was not reported'

stale_main_repository="$(setup_repository stale-main)"
stale_main_clone="$TEMP_ROOT/stale-main-clone"
git clone -q "$TEMP_ROOT/stale-main-origin.git" "$stale_main_clone"
git -C "$stale_main_clone" config user.email quality-gates@example.invalid
git -C "$stale_main_clone" config user.name quality-gates
git -C "$stale_main_clone" config core.hooksPath /dev/null
git -C "$stale_main_clone" checkout -q main
printf 'fresh remote main\n' >> "$stale_main_clone/README.md"
git -C "$stale_main_clone" add README.md
git -C "$stale_main_clone" commit -qm 'advance remote main'
git -C "$stale_main_clone" push -q origin main
run_gga_rejection_case "$stale_main_repository" "$TEMP_ROOT/stale-main-invoked" "$TEMP_ROOT/stale-main-output"
[[ ! -e "$TEMP_ROOT/stale-main-invoked" ]] || fail 'fake gga ran against a stale local main'
grep -F 'local main does not equal freshly fetched origin/main' "$TEMP_ROOT/stale-main-output" >/dev/null ||
  fail 'stale local main rejection was not reported'

review_failure_repository="$(setup_repository review-failure)"
if GGA_PROVIDER=fake GGA_MARKER="$TEMP_ROOT/review-failure-invoked" \
  GGA_OUTPUT='Codex provider reported a valid finding' GGA_STATUS=17 PATH="$TEMP_ROOT/fake-bin:$PATH" \
  bash "$review_failure_repository/scripts/quality/gga-pr-gate.sh" >"$TEMP_ROOT/review-failure-output" 2>&1; then
  fail 'GGA gate unexpectedly passed after a valid review finding'
fi
[[ -e "$TEMP_ROOT/review-failure-invoked" ]] || fail 'fake gga did not run for the review failure case'
grep -F 'REVIEW_FAILED: valid reported issues block READY states.' "$TEMP_ROOT/review-failure-output" >/dev/null ||
  fail 'valid GGA finding was not classified as REVIEW_FAILED'
if grep -F 'EXTERNAL_BLOCKER:' "$TEMP_ROOT/review-failure-output" >/dev/null; then
  fail 'valid GGA finding was misclassified as EXTERNAL_BLOCKER'
fi

domain_terms_finding_repository="$(setup_repository domain-terms-finding)"
if GGA_PROVIDER=fake GGA_MARKER="$TEMP_ROOT/domain-terms-finding-invoked" \
  GGA_OUTPUT='Codex provider review finding: tenant quota enforcement misses DNS, TLS, and socket validation.' GGA_STATUS=21 PATH="$TEMP_ROOT/fake-bin:$PATH" \
  bash "$domain_terms_finding_repository/scripts/quality/gga-pr-gate.sh" >"$TEMP_ROOT/domain-terms-finding-output" 2>&1; then
  fail 'GGA gate unexpectedly passed after a domain-terms review finding'
fi
grep -F 'REVIEW_FAILED: valid reported issues block READY states.' "$TEMP_ROOT/domain-terms-finding-output" >/dev/null ||
  fail 'domain-terms review finding was not classified as REVIEW_FAILED'
if grep -F 'EXTERNAL_BLOCKER:' "$TEMP_ROOT/domain-terms-finding-output" >/dev/null; then
  fail 'domain-terms review finding was misclassified as EXTERNAL_BLOCKER'
fi

authorization_finding_repository="$(setup_repository authorization-finding)"
if GGA_PROVIDER=fake GGA_MARKER="$TEMP_ROOT/authorization-finding-invoked" \
  GGA_OUTPUT='Codex provider finding: missing authorization check on tenant mutation' GGA_STATUS=18 PATH="$TEMP_ROOT/fake-bin:$PATH" \
  bash "$authorization_finding_repository/scripts/quality/gga-pr-gate.sh" >"$TEMP_ROOT/authorization-finding-output" 2>&1; then
  fail 'GGA gate unexpectedly passed after an authorization review finding'
fi
grep -F 'REVIEW_FAILED: valid reported issues block READY states.' "$TEMP_ROOT/authorization-finding-output" >/dev/null ||
  fail 'authorization review finding was not classified as REVIEW_FAILED'
if grep -F 'EXTERNAL_BLOCKER:' "$TEMP_ROOT/authorization-finding-output" >/dev/null; then
  fail 'authorization review finding was misclassified as EXTERNAL_BLOCKER'
fi

authoritative_review_failure_repository="$(setup_repository authoritative-review-failure)"
if GGA_PROVIDER=fake GGA_MARKER="$TEMP_ROOT/authoritative-review-failure-invoked" \
  GGA_OUTPUT=$'CODE REVIEW FAILED\nReviewed text mentions EXTERNAL_BLOCKER, provider, authentication, quota, and transport.' \
  GGA_STATUS=20 PATH="$TEMP_ROOT/fake-bin:$PATH" \
  bash "$authoritative_review_failure_repository/scripts/quality/gga-pr-gate.sh" >"$TEMP_ROOT/authoritative-review-failure-output" 2>&1; then
  fail 'GGA gate unexpectedly passed after an authoritative review failure'
fi
grep -F 'REVIEW_FAILED: valid reported issues block READY states.' "$TEMP_ROOT/authoritative-review-failure-output" >/dev/null ||
  fail 'authoritative review failure was not classified as REVIEW_FAILED'
if grep -F 'EXTERNAL_BLOCKER:' "$TEMP_ROOT/authoritative-review-failure-output" >/dev/null; then
  fail 'authoritative review failure was misclassified as EXTERNAL_BLOCKER'
fi

external_failure_repository="$(setup_repository external-failure)"
if GGA_PROVIDER=fake GGA_MARKER="$TEMP_ROOT/external-failure-invoked" \
  GGA_OUTPUT='authentication failed for the configured provider' GGA_STATUS=19 PATH="$TEMP_ROOT/fake-bin:$PATH" \
  bash "$external_failure_repository/scripts/quality/gga-pr-gate.sh" >"$TEMP_ROOT/external-failure-output" 2>&1; then
  fail 'GGA gate unexpectedly passed after an authentication failure'
fi
grep -F 'EXTERNAL_BLOCKER: GGA provider, authentication, quota, or transport failure' "$TEMP_ROOT/external-failure-output" >/dev/null ||
  fail 'authentication failure was not classified as EXTERNAL_BLOCKER'

fake_git_directory="$TEMP_ROOT/fake-git-bin"
make_fake_git "$fake_git_directory"
if PATH="$fake_git_directory:$PATH" GIT_FETCH_STATUS=1 \
  bash "$MIGRATION_GATE" >"$TEMP_ROOT/migration-fetch-output" 2>&1; then
  fail 'migration gate unexpectedly passed when origin/main fetch failed'
fi
grep -F 'unable to fetch origin/main for migration baseline' "$TEMP_ROOT/migration-fetch-output" >/dev/null ||
  fail 'migration fetch failure was not reported'

if PATH="$fake_git_directory:$PATH" GIT_ORIGIN_MAIN_COMMIT=origin-main GIT_LOCAL_MAIN_COMMIT=stale-main \
  BASE_REF=main bash "$MIGRATION_GATE" >"$TEMP_ROOT/migration-stale-base-output" 2>&1; then
  fail 'migration gate unexpectedly accepted stale local main as baseline'
fi
grep -F 'BASE_REF must resolve to freshly fetched origin/main' "$TEMP_ROOT/migration-stale-base-output" >/dev/null ||
  fail 'stale migration baseline was not rejected'

if PATH="$fake_git_directory:$PATH" GIT_MARKER="$TEMP_ROOT/migration-git-marker" \
  GIT_ORIGIN_MAIN_COMMIT=origin-main GIT_HEAD_COMMIT=head \
  bash "$MIGRATION_GATE" >"$TEMP_ROOT/migration-origin-base-output" 2>&1; then
  fail 'migration gate unexpectedly passed with an intentionally failing fake worktree'
fi
grep -F 'worktree add --detach' "$TEMP_ROOT/migration-git-marker" >/dev/null ||
  fail 'migration gate did not select origin/main for the base worktree'
if ! grep -F 'origin-main' "$TEMP_ROOT/migration-git-marker" >/dev/null; then
  fail 'migration gate did not use the fetched origin/main commit'
fi

if PATH="$fake_git_directory:$PATH" GIT_FETCH_STATUS=1 \
  bash "$PRE_PUSH_GATE" >"$TEMP_ROOT/pre-push-fetch-output" 2>&1; then
  fail 'pre-push gate unexpectedly passed when origin/main fetch failed'
fi
grep -F 'unable to fetch origin/main; refusing to determine changed paths' "$TEMP_ROOT/pre-push-fetch-output" >/dev/null ||
  fail 'pre-push fetch failure was not reported'

harness_failure_repository="$(setup_repository harness-failure)"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  ': "${QUALITY_HARNESS_MARKER:?}"' \
  'printf "invoked\\n" > "$QUALITY_HARNESS_MARKER"' \
  'exit 1' > "$harness_failure_repository/scripts/tests/quality-gates.test.sh"
chmod +x "$harness_failure_repository/scripts/tests/quality-gates.test.sh"
git -C "$harness_failure_repository" add scripts/tests/quality-gates.test.sh
git -C "$harness_failure_repository" commit -qm 'fail quality harness'
if QUALITY_HARNESS_MARKER="$TEMP_ROOT/harness-marker" NPM_MARKER="$TEMP_ROOT/harness-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$harness_failure_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/harness-output" 2>&1; then
  fail 'pre-push gate unexpectedly passed after a quality harness failure'
fi
[[ -e "$TEMP_ROOT/harness-marker" ]] || fail 'pre-push gate did not invoke the quality harness'
[[ ! -e "$TEMP_ROOT/harness-npm-marker" ]] || fail 'pre-push gate ran npm before the quality harness passed'
grep -F 'quality gate harness failed' "$TEMP_ROOT/harness-output" >/dev/null ||
  fail 'quality harness failure was not reported'

dirty_pre_push_repository="$(setup_repository dirty-pre-push)"
printf 'tracked change\n' >> "$dirty_pre_push_repository/README.md"
if QUALITY_GATES_INTERNAL_HARNESS=1 NPM_MARKER="$TEMP_ROOT/dirty-pre-push-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$dirty_pre_push_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/dirty-pre-push-output" 2>&1; then
  fail 'pre-push gate unexpectedly accepted tracked worktree changes'
fi
[[ ! -e "$TEMP_ROOT/dirty-pre-push-npm-marker" ]] || fail 'pre-push gate ran npm for tracked worktree changes'
grep -F 'tracked changes are present' "$TEMP_ROOT/dirty-pre-push-output" >/dev/null ||
  fail 'tracked worktree rejection was not reported'

whitespace_repository="$(setup_repository whitespace-range)"
printf 'trailing whitespace \n' > "$whitespace_repository/whitespace.txt"
git -C "$whitespace_repository" add whitespace.txt
git -C "$whitespace_repository" commit -qm 'introduce whitespace'
if QUALITY_GATES_INTERNAL_HARNESS=1 NPM_MARKER="$TEMP_ROOT/whitespace-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$whitespace_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/whitespace-output" 2>&1; then
  fail 'pre-push gate unexpectedly accepted committed PR-range whitespace errors'
fi
grep -F 'git diff --check origin/main...HEAD failed' "$TEMP_ROOT/whitespace-output" >/dev/null ||
  fail 'PR-range whitespace rejection was not reported'

schema_repository="$(setup_repository schema-routing)"
make_fake_migration_gate "$schema_repository"
commit_fixture_path "$schema_repository" 'apps/api/prisma/schema.prisma'
if ! DATABASE_URL='postgresql://quality@127.0.0.1:5432/buildingos_quality' \
  QUALITY_GATES_INTERNAL_HARNESS=1 QUALITY_SEED_TEST_DATABASE_CONFIRMED=1 NPM_MARKER="$TEMP_ROOT/schema-npm-marker" \
  MIGRATION_MARKER="$TEMP_ROOT/schema-migration-marker" PATH="$TEMP_ROOT/fake-bin:$PATH" \
  bash "$schema_repository/scripts/quality/pre-push-gate.sh" >"$TEMP_ROOT/schema-routing-output" 2>&1; then
  fail 'pre-push gate unexpectedly failed for safe schema routing'
fi
grep -F 'run seed:test -w apps/api' "$TEMP_ROOT/schema-npm-marker" >/dev/null ||
  fail 'schema change did not route through seed:test'
[[ -e "$TEMP_ROOT/schema-migration-marker" ]] || fail 'schema change did not route through migration gate'

backend_repository="$(setup_repository backend-routing)"
commit_fixture_path "$backend_repository" 'apps/api/src/seed-sensitive.service.ts'
if ! DATABASE_URL='postgresql://quality@127.0.0.1:5432/buildingos_quality' \
  QUALITY_GATES_INTERNAL_HARNESS=1 QUALITY_SEED_TEST_DATABASE_CONFIRMED=1 NPM_MARKER="$TEMP_ROOT/backend-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$backend_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/backend-routing-output" 2>&1; then
  fail 'pre-push gate unexpectedly failed for backend production routing'
fi
grep -F 'run seed:test -w apps/api' "$TEMP_ROOT/backend-npm-marker" >/dev/null ||
  fail 'backend production change did not route through seed:test'

unsafe_database_repository="$(setup_repository unsafe-database)"
commit_fixture_path "$unsafe_database_repository" 'apps/api/src/seed-sensitive.service.ts'
if DATABASE_URL='postgresql://quality@example.internal:5432/buildingos_quality' \
  QUALITY_GATES_INTERNAL_HARNESS=1 QUALITY_SEED_TEST_DATABASE_CONFIRMED=1 NPM_MARKER="$TEMP_ROOT/unsafe-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$unsafe_database_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/unsafe-database-output" 2>&1; then
  fail 'pre-push gate unexpectedly accepted a non-local seed database'
fi
[[ ! -e "$TEMP_ROOT/unsafe-npm-marker" ]] || fail 'pre-push gate ran npm before rejecting an unsafe database'
grep -F 'DATABASE_URL must use localhost/loopback' "$TEMP_ROOT/unsafe-database-output" >/dev/null ||
  fail 'unsafe database rejection was not reported'

malicious_loopback_repository="$(setup_repository malicious-loopback)"
commit_fixture_path "$malicious_loopback_repository" 'apps/api/src/seed-sensitive.service.ts'
if DATABASE_URL='postgresql://quality@127.attacker.example:5432/buildingos_quality' \
  QUALITY_GATES_INTERNAL_HARNESS=1 QUALITY_SEED_TEST_DATABASE_CONFIRMED=1 NPM_MARKER="$TEMP_ROOT/malicious-loopback-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$malicious_loopback_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/malicious-loopback-output" 2>&1; then
  fail 'pre-push gate unexpectedly accepted a non-numeric 127 hostname'
fi
[[ ! -e "$TEMP_ROOT/malicious-loopback-npm-marker" ]] || fail 'pre-push gate ran npm before rejecting a non-numeric 127 hostname'
grep -F 'DATABASE_URL must use localhost/loopback' "$TEMP_ROOT/malicious-loopback-output" >/dev/null ||
  fail 'non-numeric 127 hostname rejection was not reported'

numeric_loopback_repository="$(setup_repository numeric-loopback)"
commit_fixture_path "$numeric_loopback_repository" 'apps/api/src/seed-sensitive.service.ts'
if ! DATABASE_URL='postgresql://quality@127.255.255.255:5432/buildingos_quality' \
  QUALITY_GATES_INTERNAL_HARNESS=1 QUALITY_SEED_TEST_DATABASE_CONFIRMED=1 NPM_MARKER="$TEMP_ROOT/numeric-loopback-npm-marker" \
  PATH="$TEMP_ROOT/fake-bin:$PATH" bash "$numeric_loopback_repository/scripts/quality/pre-push-gate.sh" \
  >"$TEMP_ROOT/numeric-loopback-output" 2>&1; then
  fail 'pre-push gate unexpectedly rejected a numeric IPv4 loopback database'
fi
grep -F 'run seed:test -w apps/api' "$TEMP_ROOT/numeric-loopback-npm-marker" >/dev/null ||
  fail 'numeric IPv4 loopback database did not reach seed:test'

printf 'PASS: quality gate shell checks passed.\n'
