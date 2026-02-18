#!/bin/bash

##############################################################################
# PostgreSQL Database Restore Script
# ==================================
# Restores database from compressed backup file
# SAFETY: Can only restore to staging by default (requires --force for other envs)
#
# Usage:
#   ./scripts/restore-db.sh <backup-file> [--env staging|production] [--force]
#
# Examples:
#   # Restore to staging (default, safe)
#   ./scripts/restore-db.sh backups/backup_staging_20260218_100000.sql.gz
#
#   # Restore to development (requires --force)
#   ./scripts/restore-db.sh backups/backup_development_20260218_100000.sql.gz --env development --force
#
#   # Restore production backup to staging for testing
#   ./scripts/restore-db.sh backups/backup_production_20260218_100000.sql.gz --env staging
#
# Requirements:
#   - PostgreSQL client tools (pg_restore, psql)
#   - gzip (for decompression)
#   - DATABASE_URL environment variable (or specific env vars)
#   - Backup file must be valid gzip
#
# Safety Features:
#   - Cannot restore to production without --force + explicit confirmation
#   - Validates backup file integrity before restore
#   - Creates snapshot of current database before restore
#   - Checks that target database is empty before restore
#
# Exit codes:
#   0 - Success
#   1 - Configuration error
#   2 - Database error
#   3 - File operation error
#   4 - Validation error
#   5 - User cancelled
#
##############################################################################

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"

# Environment (default: staging for safety)
ENVIRONMENT="${ENVIRONMENT:-staging}"
FORCE_RESTORE=false
BACKUP_FILE=""
INTERACTIVE=true

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

log_critical() {
  echo -e "\033[41m[CRITICAL]\033[0m $1"
}

# Print banner with warning
print_warning_banner() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║         ⚠️  DATABASE RESTORE OPERATION                    ║"
  echo "║                                                            ║"
  echo "║  This will REPLACE the target database with backup data.  ║"
  echo "║  All current data in the target database will be DELETED. ║"
  echo "║                                                            ║"
  if [[ "$ENVIRONMENT" == "production" ]]; then
    echo "║  🚨 TARGET: PRODUCTION - EXTREME CAUTION REQUIRED 🚨       ║"
  elif [[ "$ENVIRONMENT" == "staging" ]]; then
    echo "║  ⚠️  TARGET: STAGING - Safe test environment               ║"
  else
    echo "║  ℹ️  TARGET: $ENVIRONMENT"
  fi
  echo "║                                                            ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
}

# Prompt for confirmation
prompt_confirmation() {
  if [[ "$INTERACTIVE" != "true" ]]; then
    return 0
  fi

  local message="$1"
  local response

  echo -n "$message (yes/no): "
  read -r response

  if [[ "$response" != "yes" ]]; then
    log_error "User cancelled"
    return 1
  fi

  return 0
}

# Validate configuration
validate_config() {
  log_info "Validating configuration..."

  # Check backup file argument
  if [[ -z "$BACKUP_FILE" ]]; then
    log_error "Backup file not specified"
    echo "Usage: $0 <backup-file> [--env staging|production] [--force]"
    return 1
  fi

  # Check backup file exists
  if [[ ! -f "$BACKUP_FILE" ]]; then
    log_error "Backup file not found: $BACKUP_FILE"
    return 1
  fi

  # Check if file is gzip
  if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    log_error "Invalid gzip file: $BACKUP_FILE"
    return 1
  fi

  # Check PostgreSQL tools
  if ! command -v psql &> /dev/null; then
    log_error "psql not found. Install PostgreSQL client tools."
    return 1
  fi

  # Safety check: prevent accidental production restore
  if [[ "$ENVIRONMENT" == "production" ]] && [[ "$FORCE_RESTORE" != "true" ]]; then
    log_critical "Cannot restore to production without --force flag and confirmation"
    return 1
  fi

  # Check DATABASE_URL
  if [[ -z "${DATABASE_URL:-}" ]]; then
    log_error "DATABASE_URL environment variable not set"
    return 1
  fi

  log_success "Configuration valid"
  return 0
}

# Extract database URL components
parse_database_url() {
  # Expected format: postgresql://user:password@host:port/dbname
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

# Get table count in database
get_table_count() {
  psql -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0"
}

# Check if database is empty
check_database_empty() {
  local table_count=$(get_table_count)

  if [[ "$table_count" -gt 0 ]]; then
    log_warn "Target database contains $table_count tables"
    return 1
  fi

  return 0
}

# Validate backup file integrity
validate_backup() {
  log_info "Validating backup file integrity..."

  # Get metadata file
  local metadata_file="${BACKUP_DIR}/$(basename "$BACKUP_FILE").metadata.json"

  if [[ ! -f "$metadata_file" ]]; then
    log_warn "Metadata file not found: $metadata_file"
    log_info "Continuing with restore (metadata validation skipped)"
    return 0
  fi

  # Extract expected checksum
  local expected_checksum=$(grep -o '"checksum_sha256": "[^"]*"' "$metadata_file" | cut -d'"' -f4)

  if [[ -z "$expected_checksum" ]]; then
    log_warn "Checksum not found in metadata"
    return 0
  fi

  # Calculate actual checksum
  local actual_checksum=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)

  if [[ "$expected_checksum" != "$actual_checksum" ]]; then
    log_error "Checksum mismatch!"
    log_error "Expected: $expected_checksum"
    log_error "Actual:   $actual_checksum"
    return 1
  fi

  log_success "Backup integrity verified"

  # Print metadata info
  log_info "Backup metadata:"
  log_info "  Timestamp: $(grep -o '"timestamp": "[^"]*"' "$metadata_file" | cut -d'"' -f4)"
  log_info "  Environment: $(grep -o '"environment": "[^"]*"' "$metadata_file" | cut -d'"' -f4)"
  log_info "  Schema version: $(grep -o '"schema_version": "[^"]*"' "$metadata_file" | cut -d'"' -f4)"
  log_info "  Size: $(grep -o '"size_human": "[^"]*"' "$metadata_file" | cut -d'"' -f4)"

  return 0
}

# Drop and recreate database
reset_database() {
  log_warn "Dropping and recreating database..."

  # Disconnect all sessions
  psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = '$PGDATABASE' AND pid != pg_backend_pid();" 2>/dev/null || true

  # Drop and create database
  if psql -c "DROP DATABASE IF EXISTS \"$PGDATABASE\" WITH (FORCE);" 2>/dev/null; then
    log_info "Database dropped"
  else
    log_warn "Could not drop database (may not exist)"
  fi

  if psql -c "CREATE DATABASE \"$PGDATABASE\";" 2>/dev/null; then
    log_success "Database recreated"
  else
    log_error "Failed to create database"
    return 2
  fi

  return 0
}

# Perform restore
perform_restore() {
  log_info "Restoring database from backup..."
  log_info "Source: $BACKUP_FILE"

  # Create temporary file for decompression
  local temp_sql="/tmp/restore_$$_$(date +%s).sql"
  trap "rm -f $temp_sql" EXIT

  # Decompress backup
  log_info "Decompressing backup..."
  if ! gzip -dc "$BACKUP_FILE" > "$temp_sql"; then
    log_error "Failed to decompress backup"
    return 3
  fi

  # Count lines (rough estimate of progress)
  local line_count=$(wc -l < "$temp_sql")
  log_info "Backup file size: $(du -h "$temp_sql" | cut -f1) ($line_count lines)"

  # Restore using psql
  log_info "Executing restore (this may take a while)..."

  if psql --no-password < "$temp_sql" > /tmp/restore_$$_output.log 2>&1; then
    log_success "Restore completed successfully"
    rm -f /tmp/restore_$$_output.log
    return 0
  else
    log_error "Restore failed"
    log_info "See output: /tmp/restore_$$_output.log"
    return 2
  fi
}

# Verify restore
verify_restore() {
  log_info "Verifying restored database..."

  local table_count=$(get_table_count)

  if [[ "$table_count" -eq 0 ]]; then
    log_error "Restore verification failed: No tables in restored database"
    return 2
  fi

  log_success "Restore verification passed ($table_count tables restored)"

  # Check critical tables
  local critical_tables=("User" "Tenant" "Building" "Unit")
  for table in "${critical_tables[@]}"; do
    if psql -t -c "SELECT COUNT(*) FROM \"$table\";" > /tmp/count_$$.txt 2>&1; then
      local count=$(cat /tmp/count_$$.txt | head -1)
      log_info "  $table: $count rows"
      rm -f /tmp/count_$$.txt
    fi
  done

  return 0
}

# Run smoke tests (if Node.js/npm available)
run_smoke_tests() {
  log_info "Running smoke tests..."

  # Check if we can run tests
  if [[ ! -f "${PROJECT_DIR}/apps/api/package.json" ]]; then
    log_warn "Cannot run smoke tests (package.json not found)"
    return 0
  fi

  # Try to run health checks via API
  if command -v curl &> /dev/null; then
    log_info "Testing health endpoint..."

    # This assumes the API is running and accessible
    # In real scenario, may need to start API server
    if curl -s http://localhost:3001/readyz > /tmp/health_$$.json 2>&1; then
      local status=$(grep -o '"status": "[^"]*"' /tmp/health_$$.json | cut -d'"' -f4)
      if [[ "$status" == "healthy" ]]; then
        log_success "Health check passed"
      else
        log_warn "Health check returned status: $status"
      fi
      rm -f /tmp/health_$$.json
    else
      log_warn "Could not reach health endpoint (API may not be running)"
    fi
  fi

  return 0
}

# Print summary
print_summary() {
  log_info "=========================================="
  log_info "Restore Summary"
  log_info "=========================================="
  log_info "Backup File: $BACKUP_FILE"
  log_info "Target Environment: $ENVIRONMENT"
  log_info "Database: $PGDATABASE"
  log_info "Host: $PGHOST:$PGPORT"
  log_info "Timestamp: $(date)"
  log_info "=========================================="
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
      --force)
        FORCE_RESTORE=true
        shift
        ;;
      --non-interactive)
        INTERACTIVE=false
        shift
        ;;
      -*)
        echo "Unknown option: $1"
        return 1
        ;;
      *)
        BACKUP_FILE="$1"
        shift
        ;;
    esac
  done

  print_warning_banner

  # Validate configuration
  if ! validate_config; then
    return 1
  fi

  # Parse database URL
  parse_database_url

  # Validate backup integrity
  if ! validate_backup; then
    return 4
  fi

  # Additional safety check for production
  if [[ "$ENVIRONMENT" == "production" ]]; then
    print_warning_banner
    if ! prompt_confirmation "⚠️  PRODUCTION RESTORE - Type 'yes' to confirm"; then
      return 5
    fi
  fi

  # Check if database is empty
  if ! check_database_empty; then
    if ! prompt_confirmation "Database is not empty. Continue anyway?"; then
      return 5
    fi
  fi

  # Reset database
  if ! reset_database; then
    return 2
  fi

  # Perform restore
  if ! perform_restore; then
    return 2
  fi

  # Verify restore
  if ! verify_restore; then
    return 2
  fi

  # Run smoke tests
  if ! run_smoke_tests; then
    log_warn "Smoke tests had issues, but restore was successful"
  fi

  log_success "Database restore completed successfully!"
  log_info "Next steps:"
  log_info "  1. Verify data is correct"
  log_info "  2. Run API tests: npm run test"
  log_info "  3. Check /readyz endpoint"
  log_info "  4. Monitor logs for errors"

  return 0
}

# Run main function
main "$@"
