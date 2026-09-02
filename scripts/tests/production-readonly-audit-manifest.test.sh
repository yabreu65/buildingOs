#!/usr/bin/env bash
set -euo pipefail

extract_target_applied() {
  awk -F '=' '/^[[:space:]]*readonly[[:space:]]+TARGET_APPLIED[[:space:]]*=/ { value=$2; gsub(/[[:space:]]/, "", value); gsub(/\047/, "", value); if (value ~ /^[0-9]+$/) { print value; exit } }'
}

[[ "$(printf '%s\n' 'readonly TARGET_APPLIED=97' | extract_target_applied)" == '97' ]]
[[ "$(printf '%s\n' "readonly TARGET_APPLIED='98'" | extract_target_applied)" == '98' ]]
[[ "$(printf '%s\n' 'readonly TARGET_APPLIED = 123' | extract_target_applied)" == '123' ]]
[[ -z "$(printf '%s\n' 'readonly TARGET_APPLIED=not-a-number' | extract_target_applied)" ]]

printf 'PASS: unquoted, quoted, spaced, and invalid manifest target assignments are handled safely\n'
