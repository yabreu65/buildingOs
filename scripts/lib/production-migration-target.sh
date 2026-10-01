#!/usr/bin/env bash
set -euo pipefail

awk -F '\t' '
  {
    for (i = 1; i <= NF; i++) {
      if ($i == "target") {
        invalid = 1
      } else if ($i ~ /^target=/) {
        count++
        value = $i
        sub(/^target=/, "", value)
        if (value !~ /^[0-9]+$/) {
          invalid = 1
        } else {
          target = value
        }
      }
    }
  }
  END {
    if (count != 1 || invalid) {
      exit 1
    }
    print target
  }
'
