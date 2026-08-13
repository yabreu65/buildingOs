#!/usr/bin/env bash
#
# Gentle AI advisory wrapper (non-blocking review gate).
#
# Gentle AI is ADVISORY and NON-BLOCKING. This wrapper runs the AI review
# command (e.g. `gga run` for the repository pre-commit review) and converts
# every outcome into an advisory warning instead of a hard failure.
#
# Outcomes:
#   - GENTLE PASS        -> log PASS, continue (exit 0)
#   - GENTLE FINDING     -> keep findings on stdout, log advisory, continue (exit 0)
#   - GENTLE TOOL ERROR  -> log tool error, continue (exit 0)
#
# The normal quality gates (tests, typecheck, lint, build, E2E, CI) remain
# BLOCKING and are NOT routed through this wrapper.
#
# Configuration (environment):
#   GENTLE_COMMAND   AI review command to run (default: gga run)
#   GENTLE_PROVIDER  provider hint passed to the review tool, if supported
#   GENTLE_TIMEOUT   timeout hint passed to the review tool, if supported
#   GENTLE_DISABLED  set to "1" to skip the review entirely (still non-blocking)
#
# The wrapper always exits 0. Callers that need the real exit code for
# reporting must capture stdout/stderr themselves.

set -uo pipefail

GENTLE_COMMAND="${GENTLE_COMMAND:-gga run}"
GENTLE_PROVIDER="${GENTLE_PROVIDER:-codex}"
GENTLE_TIMEOUT="${GENTLE_TIMEOUT:-240}"

log() {
  echo "[gentle-advisory] $*"
}

if [ "${GENTLE_DISABLED:-0}" = "1" ]; then
  log "GENTLE NOT RUN (disabled by GENTLE_DISABLED=1) - advisory, continuing"
  exit 0
fi

log "Running advisory AI review: ${GENTLE_COMMAND} (provider=${GENTLE_PROVIDER}, timeout=${GENTLE_TIMEOUT}s)"

set +e
GGA_PROVIDER="$GENTLE_PROVIDER" GGA_TIMEOUT="$GENTLE_TIMEOUT" $GENTLE_COMMAND
REVIEW_EXIT=$?
set -e

if [ "$REVIEW_EXIT" -eq 0 ]; then
  log "GENTLE PASS - advisory, continuing"
  exit 0
fi

# GENTLE FINDING or GENTLE TOOL ERROR: both are advisory. Findings were already
# printed to stdout by the review tool and remain available for independent
# adjudication. A tool error (provider failure, context/history protection,
# receipt binding failure, reviewer execution failure, ...) must not block.
log "GENTLE review finished with exit ${REVIEW_EXIT} - ADVISORY WARNING, continuing"
log "Findings (if any) are available above; they require independent adjudication."
log "An internal Gentle tool error never blocks delivery."

exit 0
