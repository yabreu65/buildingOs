#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly AUDITOR="$ROOT_DIR/scripts/production-readonly-audit.sh"

classify_fixture() {
  local payment_amount="$1"
  local tenant_match="$2"
  local charge_currency="$3"
  local payment_currency="$4"
  local allocation_amount="$5"
  local original_amount="$6"

  [[ "$tenant_match" == 'yes' ]] || { printf 'TENANT_MISMATCH_DETECTED\n'; return; }
  if [[ "$original_amount" == 'NULL' && "$charge_currency" != "$payment_currency" ]]; then
    printf 'OVER_ALLOCATIONS_UNVERIFIABLE\n'
    return
  fi
  local consumed="$allocation_amount"
  [[ "$original_amount" == 'NULL' ]] || consumed="$original_amount"
  if (( consumed > payment_amount )); then
    printf 'OVER_ALLOCATIONS_DEFINITE\n'
  else
    printf 'PASS\n'
  fi
}

[[ "$(classify_fixture 10000 yes USD USD 10000 10000)" == 'PASS' ]]
[[ "$(classify_fixture 10000 yes VES USD 365000 10000)" == 'PASS' ]]
[[ "$(classify_fixture 10000 yes VES USD 365001 10001)" == 'OVER_ALLOCATIONS_DEFINITE' ]]
[[ "$(classify_fixture 10000 no VES USD 365000 10000)" == 'TENANT_MISMATCH_DETECTED' ]]
[[ "$(classify_fixture 10000 yes VES USD 365000 NULL)" == 'OVER_ALLOCATIONS_UNVERIFIABLE' ]]

captured="$(mktemp "${TMPDIR:-/tmp}/buildingos-readonly-audit-cross.XXXXXX")"
trap 'rm -f "$captured"' EXIT
docker() {
  local payload
  [[ "$1" == 'exec' && "$*" == *'psql'* ]] || return 1
  payload="$(< /dev/stdin)"
  printf '%s\n' "$payload" >> "$captured"
  printf '0|0\n'
}

source "$AUDITOR"
report_finance_integrity >/dev/null
query="$(< "$captured")"
[[ "$query" == *'paymentOriginalAmountMinor'* ]]
[[ "$query" == *'"paymentOriginalAmountMinor" < 0'* ]]
[[ "$query" == *'amount <= 0'* ]]
[[ "$query" == *'legacy_cross_unverifiable'* ]]
[[ "$query" == *'has_same_currency'* ]]
[[ "$query" == *'inconsistent_same_currency_share'* ]]
[[ "$query" == *'paymentOriginalAmountMinor" <> a.amount'* ]]
[[ "$query" == *'charge_overallocations'* ]]
[[ "$query" == *'OVER_ALLOCATIONS'* || "$query" == *'original_consumed'* ]]
printf 'PASS: cross-currency audit fixture classifications and SQL contract\n'
