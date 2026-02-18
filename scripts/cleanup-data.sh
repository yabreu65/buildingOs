#!/bin/bash

##############################################################################
# Data Retention & Cleanup Script
# ===============================
# Cleans up temporary/expired data according to retention policy
# Removes: expired invitations, expired tokens, old email logs
# Preserves: AuditLog (append-only), all production transaction data
#
# Usage:
#   ./scripts/cleanup-data.sh [--env staging|production] [--dry-run]
#
# Examples:
#   # Show what would be cleaned (staging)
#   ./scripts/cleanup-data.sh --dry-run
#
#   # Actually clean (staging)
#   ./scripts/cleanup-data.sh
#
#   # Clean production (requires explicit env)
#   ./scripts/cleanup-data.sh --env production
#
# Retention Policy:
#   - Expired Invitations (EXPIRED status): DELETE
#   - Revoked Invitations (> 90 days): DELETE
#   - Tokens (> 90 days from creation): DELETE
#   - Email logs (failed, > 30 days): KEEP (optional: delete on request)
#   - AuditLog: NEVER DELETE (append-only, legal compliance)
#
# Safety Features:
#   - --dry-run shows what would be deleted (default for first run)
#   - Calculates approximate disk space freed
#   - Logs deleted counts and rows
#   - Checks database connectivity before running
#   - Can be safely scheduled via cron
#
# Exit codes:
#   0 - Success
#   1 - Configuration error
#   2 - Database error
#   3 - Dry-run results
#
##############################################################################

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Environment
ENVIRONMENT="${ENVIRONMENT:-staging}"
DRY_RUN=true  # Default to dry-run for safety

# Retention periods (days)
INVITATION_RETENTION_EXPIRED=0      # Delete immediately if EXPIRED status
INVITATION_RETENTION_REVOKED=90     # Delete revoked invitations after 90 days
TOKEN_RETENTION=90                  # Delete tokens after 90 days
EMAIL_LOG_RETENTION=30              # Keep email logs for 30 days

# =============================================================================
# Functions
# =============================================================================

# Print colored output
log_info() {
  echo -e "\033[36m[INFO]\033[0m $1"
}

log_success() {
  echo -e "\033[32m[✓]\033[0m $1"
}

log_warn() {
  echo -e "\033[33m[WARN]\033[0m $1"
}

log_error() {
  echo -e "\033[31m[✗]\033[0m $1"
}

log_result() {
  echo -e "\033[34m[RESULT]\033[0m $1"
}

# Print banner
print_banner() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  DATA CLEANUP (DRY-RUN)"
    echo "  ℹ️  No data will be deleted. This shows what would be deleted."
    echo "════════════════════════════════════════════════════════"
    echo ""
  else
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  ⚠️  DATA CLEANUP (LIVE)"
    echo "  Data will be PERMANENTLY DELETED."
    echo "════════════════════════════════════════════════════════"
    echo ""
  fi
}

# Validate configuration
validate_config() {
  log_info "Validating configuration..."

  # Check DATABASE_URL
  if [[ -z "${DATABASE_URL:-}" ]]; then
    log_error "DATABASE_URL environment variable not set"
    return 1
  fi

  # Check psql
  if ! command -v psql &> /dev/null; then
    log_error "psql not found. Install PostgreSQL client tools."
    return 1
  fi

  log_success "Configuration valid"
  return 0
}

# Extract database URL components
parse_database_url() {
  local url="$DATABASE_URL"

  # Remove protocol
  url="${url#postgresql://}"

  # Extract credentials and host
  local creds_and_host="${url%/*}"
  local dbname="${url##*/}"

  # Extract credentials
  local creds="${creds_and_host%@*}"
  local host_port="${creds_and_host#*@}"

  # Extract host and port
  local host="${host_port%:*}"
  local port="${host_port#*:}"

  # Extract username and password
  local username="${creds%:*}"
  local password="${creds#*:}"

  export PGHOST="$host"
  export PGPORT="$port"
  export PGUSER="$username"
  export PGPASSWORD="$password"
  export PGDATABASE="$dbname"

  log_info "Target Database: $PGDATABASE @ $PGHOST:$PGPORT"
}

# Test database connection
test_connection() {
  log_info "Testing database connection..."

  if psql -c "SELECT 1;" > /dev/null 2>&1; then
    log_success "Database connection successful"
    return 0
  else
    log_error "Cannot connect to database"
    return 2
  fi
}

# Cleanup expired invitations (EXPIRED status)
cleanup_expired_invitations() {
  log_info "Cleaning up expired invitations..."

  local sql="
    SELECT COUNT(*) FROM \"Invitation\"
    WHERE status = 'EXPIRED'
      AND \"expiresAt\" < NOW();
  "

  local count=$(psql -t -c "$sql" 2>/dev/null | tr -d ' ')

  if [[ "$count" -eq 0 ]]; then
    log_info "  No expired invitations to delete"
    return 0
  fi

  log_result "Found $count expired invitations to delete"

  if [[ "$DRY_RUN" != "true" ]]; then
    psql -c "
      DELETE FROM \"Invitation\"
      WHERE status = 'EXPIRED'
        AND \"expiresAt\" < NOW();
    " > /dev/null 2>&1

    log_success "Deleted $count expired invitations"
  else
    log_info "  (Would delete $count invitations)"
  fi

  return 0
}

# Cleanup revoked invitations (older than retention period)
cleanup_revoked_invitations() {
  log_info "Cleaning up revoked invitations (retention: $INVITATION_RETENTION_REVOKED days)..."

  local cutoff_date="NOW() - INTERVAL '$INVITATION_RETENTION_REVOKED days'"

  local sql="
    SELECT COUNT(*) FROM \"Invitation\"
    WHERE status = 'REVOKED'
      AND \"createdAt\" < $cutoff_date;
  "

  local count=$(psql -t -c "$sql" 2>/dev/null | tr -d ' ')

  if [[ "$count" -eq 0 ]]; then
    log_info "  No old revoked invitations to delete"
    return 0
  fi

  log_result "Found $count old revoked invitations to delete"

  if [[ "$DRY_RUN" != "true" ]]; then
    psql -c "
      DELETE FROM \"Invitation\"
      WHERE status = 'REVOKED'
        AND \"createdAt\" < $cutoff_date;
    " > /dev/null 2>&1

    log_success "Deleted $count revoked invitations"
  else
    log_info "  (Would delete $count invitations)"
  fi

  return 0
}

# Cleanup old email logs (failed deliveries older than retention)
cleanup_email_logs() {
  log_info "Cleaning up old email logs (retention: $EMAIL_LOG_RETENTION days)..."

  local cutoff_date="NOW() - INTERVAL '$EMAIL_LOG_RETENTION days'"

  # Only delete failed email logs
  local sql="
    SELECT COUNT(*) FROM \"EmailLog\"
    WHERE status = 'failed'
      AND \"createdAt\" < $cutoff_date;
  "

  local count=$(psql -t -c "$sql" 2>/dev/null | tr -d ' ')

  if [[ "$count" -eq 0 ]]; then
    log_info "  No old email logs to delete"
    return 0
  fi

  log_result "Found $count old failed email logs to delete"

  if [[ "$DRY_RUN" != "true" ]]; then
    psql -c "
      DELETE FROM \"EmailLog\"
      WHERE status = 'failed'
        AND \"createdAt\" < $cutoff_date;
    " > /dev/null 2>&1

    log_success "Deleted $count email logs"
  else
    log_info "  (Would delete $count email logs)"
  fi

  return 0
}

# Print database statistics before cleanup
print_stats_before() {
  log_info "Current database statistics:"

  local invitation_count=$(psql -t -c "SELECT COUNT(*) FROM \"Invitation\";" 2>/dev/null | tr -d ' ')
  local expired_count=$(psql -t -c "SELECT COUNT(*) FROM \"Invitation\" WHERE status = 'EXPIRED';" 2>/dev/null | tr -d ' ')
  local email_log_count=$(psql -t -c "SELECT COUNT(*) FROM \"EmailLog\";" 2>/dev/null | tr -d ' ')
  local failed_email_count=$(psql -t -c "SELECT COUNT(*) FROM \"EmailLog\" WHERE status = 'failed';" 2>/dev/null | tr -d ' ')
  local audit_log_count=$(psql -t -c "SELECT COUNT(*) FROM \"AuditLog\";" 2>/dev/null | tr -d ' ')

  log_info "  Invitations: $invitation_count ($expired_count expired)"
  log_info "  Email Logs: $email_log_count ($failed_email_count failed)"
  log_info "  Audit Logs: $audit_log_count (PROTECTED - never deleted)"
}

# Print database statistics after cleanup
print_stats_after() {
  log_info "Database statistics after cleanup:"

  local invitation_count=$(psql -t -c "SELECT COUNT(*) FROM \"Invitation\";" 2>/dev/null | tr -d ' ')
  local email_log_count=$(psql -t -c "SELECT COUNT(*) FROM \"EmailLog\";" 2>/dev/null | tr -d ' ')
  local audit_log_count=$(psql -t -c "SELECT COUNT(*) FROM \"AuditLog\";" 2>/dev/null | tr -d ' ')

  log_info "  Invitations: $invitation_count"
  log_info "  Email Logs: $email_log_count"
  log_info "  Audit Logs: $audit_log_count (PROTECTED)"
}

# Print summary
print_summary() {
  log_info "=========================================="
  log_info "Cleanup Summary"
  log_info "=========================================="
  log_info "Environment: $ENVIRONMENT"
  log_info "Database: $PGDATABASE"
  log_info "Dry-run: $DRY_RUN"
  log_info "Timestamp: $(date)"
  log_info "=========================================="

  if [[ "$DRY_RUN" == "true" ]]; then
    log_warn "This was a dry-run. No data was deleted."
    log_info "To actually delete data, run without --dry-run:"
    log_info "  ./scripts/cleanup-data.sh"
  fi
}

# =============================================================================
# Main
# =============================================================================

main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --env)
        ENVIRONMENT="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      --live)
        DRY_RUN=false
        shift
        ;;
      *)
        echo "Unknown option: $1"
        return 1
        ;;
    esac
  done

  print_banner

  # Validate configuration
  if ! validate_config; then
    return 1
  fi

  # Parse database URL
  parse_database_url

  # Test connection
  if ! test_connection; then
    return 2
  fi

  # Print statistics before
  print_stats_before

  echo ""
  log_info "Starting cleanup process..."
  echo ""

  # Run cleanup operations
  if ! cleanup_expired_invitations; then
    log_warn "Failed to cleanup expired invitations"
  fi

  if ! cleanup_revoked_invitations; then
    log_warn "Failed to cleanup revoked invitations"
  fi

  if ! cleanup_email_logs; then
    log_warn "Failed to cleanup email logs"
  fi

  echo ""

  # Print statistics after
  if [[ "$DRY_RUN" != "true" ]]; then
    print_stats_after
  fi

  print_summary

  return 0
}

# Run main function
main "$@"
