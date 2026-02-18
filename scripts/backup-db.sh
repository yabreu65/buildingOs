#!/bin/bash

##############################################################################
# PostgreSQL Database Backup Script
# =============================
# Backs up PostgreSQL database to compressed file with checksum and metadata
# Supports uploading to S3/MinIO for offsite storage
#
# Usage:
#   ./scripts/backup-db.sh [--upload] [--env production|staging|development]
#
# Examples:
#   # Local backup only
#   ./scripts/backup-db.sh
#
#   # Backup and upload to S3
#   ./scripts/backup-db.sh --upload --env production
#
#   # Staging backup
#   ./scripts/backup-db.sh --env staging
#
# Requirements:
#   - PostgreSQL client tools (pg_dump, pg_restore)
#   - gzip (for compression)
#   - aws-cli (if using S3 upload)
#   - DATABASE_URL environment variable
#
# Exit codes:
#   0 - Success
#   1 - Configuration error
#   2 - Database error
#   3 - File operation error
#   4 - Upload error
#
##############################################################################

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
METADATA_DIR="${BACKUP_DIR}/metadata"

# Environment
ENVIRONMENT="${ENVIRONMENT:-development}"
SHOULD_UPLOAD=false

# Backup retention (days)
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=28

# S3/MinIO settings (optional)
S3_BUCKET="${S3_BUCKET:-buildingos-backups}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_REGION="${S3_REGION:-us-east-1}"

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

# Validate configuration
validate_config() {
  log_info "Validating configuration..."

  # Check PostgreSQL connection
  if [[ -z "${DATABASE_URL:-}" ]]; then
    log_error "DATABASE_URL environment variable not set"
    return 1
  fi

  # Check required tools
  if ! command -v pg_dump &> /dev/null; then
    log_error "pg_dump not found. Install PostgreSQL client tools."
    return 1
  fi

  if ! command -v gzip &> /dev/null; then
    log_error "gzip not found. Install gzip."
    return 1
  fi

  # If uploading, check AWS CLI
  if [[ "$SHOULD_UPLOAD" == "true" ]]; then
    if ! command -v aws &> /dev/null; then
      log_warn "aws-cli not found. Backup will be saved locally only."
      SHOULD_UPLOAD=false
    fi
  fi

  # Create backup directories
  mkdir -p "$BACKUP_DIR" "$METADATA_DIR"

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

  log_info "Database: $PGDATABASE @ $PGHOST:$PGPORT"
}

# Create backup file
create_backup() {
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="${BACKUP_DIR}/backup_${ENVIRONMENT}_${timestamp}.sql.gz"

  log_info "Creating database backup..."
  log_info "Output: $backup_file"

  # Perform dump with progress
  if pg_dump --verbose --no-acl --no-owner 2>&1 | gzip > "$backup_file"; then
    log_success "Backup created: $backup_file"

    # Get file size
    local file_size=$(du -h "$backup_file" | cut -f1)
    log_info "Backup size: $file_size"

    # Calculate checksum
    local checksum=$(sha256sum "$backup_file" | cut -d' ' -f1)

    # Create metadata
    create_metadata "$backup_file" "$checksum" "$file_size" "$timestamp"

    echo "$backup_file"
    return 0
  else
    log_error "Failed to create backup"
    rm -f "$backup_file"
    return 2
  fi
}

# Create metadata file
create_metadata() {
  local backup_file="$1"
  local checksum="$2"
  local file_size="$3"
  local timestamp="$4"

  local metadata_file="${METADATA_DIR}/$(basename "$backup_file").metadata.json"

  cat > "$metadata_file" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_date": "$timestamp",
  "environment": "$ENVIRONMENT",
  "database": "$PGDATABASE",
  "host": "$PGHOST",
  "file": "$(basename "$backup_file")",
  "path": "$backup_file",
  "size_bytes": $(stat -f%z "$backup_file" 2>/dev/null || stat -c%s "$backup_file"),
  "size_human": "$file_size",
  "checksum_sha256": "$checksum",
  "schema_version": "$(get_schema_version)",
  "app_version": "$(get_app_version)",
  "backup_type": "$(get_backup_type)",
  "compressed": true,
  "compression": "gzip"
}
EOF

  log_success "Metadata saved: $metadata_file"
  echo "$metadata_file"
}

# Get current schema version (latest migration)
get_schema_version() {
  cd "$PROJECT_DIR/apps/api" 2>/dev/null || echo "unknown"

  # Try to get latest migration name
  if [[ -d "prisma/migrations" ]]; then
    ls -1 prisma/migrations | tail -1 | sed 's/_.*$//' || echo "unknown"
  else
    echo "unknown"
  fi

  cd - > /dev/null 2>&1
}

# Get app version
get_app_version() {
  cd "$PROJECT_DIR" 2>/dev/null || echo "unknown"

  if [[ -f "package.json" ]]; then
    grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/' || echo "unknown"
  else
    echo "unknown"
  fi

  cd - > /dev/null 2>&1
}

# Get backup type (daily or weekly)
get_backup_type() {
  local day_of_week=$(date +%u)

  # Sunday = 0 or 7, run weekly
  if [[ "$day_of_week" == "7" ]] || [[ "$day_of_week" == "0" ]]; then
    echo "weekly"
  else
    echo "daily"
  fi
}

# Upload backup to S3/MinIO
upload_backup() {
  local backup_file="$1"
  local metadata_file="$2"

  if [[ "$SHOULD_UPLOAD" != "true" ]]; then
    log_info "Skipping upload (use --upload flag to enable)"
    return 0
  fi

  log_info "Uploading backup to S3..."

  local backup_filename=$(basename "$backup_file")
  local s3_path="s3://${S3_BUCKET}/${ENVIRONMENT}/$(date +%Y/%m)/${backup_filename}"

  # Prepare AWS CLI options
  local aws_opts="--region $S3_REGION"

  if [[ -n "$S3_ENDPOINT" ]]; then
    aws_opts="$aws_opts --endpoint-url $S3_ENDPOINT"
  fi

  # Upload backup file
  if aws s3 cp "$backup_file" "$s3_path" $aws_opts; then
    log_success "Backup uploaded to: $s3_path"
  else
    log_error "Failed to upload backup to S3"
    return 4
  fi

  # Upload metadata
  local metadata_filename=$(basename "$metadata_file")
  local metadata_s3_path="s3://${S3_BUCKET}/${ENVIRONMENT}/metadata/${metadata_filename}"

  if aws s3 cp "$metadata_file" "$metadata_s3_path" $aws_opts; then
    log_success "Metadata uploaded to: $metadata_s3_path"
  else
    log_warn "Failed to upload metadata to S3 (backup still successful)"
  fi

  return 0
}

# Cleanup old backups
cleanup_old_backups() {
  log_info "Cleaning up old backups..."

  local current_date=$(date +%s)
  local daily_cutoff=$((current_date - BACKUP_RETENTION_DAILY * 86400))
  local weekly_cutoff=$((current_date - BACKUP_RETENTION_WEEKLY * 86400))

  local deleted_count=0

  for metadata_file in "$METADATA_DIR"/*.metadata.json; do
    [[ -f "$metadata_file" ]] || continue

    # Extract backup type and date
    local backup_type=$(grep -o '"backup_type": "[^"]*"' "$metadata_file" | cut -d'"' -f4)
    local backup_timestamp=$(grep -o '"timestamp": "[^"]*"' "$metadata_file" | cut -d'"' -f4)
    local backup_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$backup_timestamp" +%s 2>/dev/null || date -d "$backup_timestamp" +%s)

    # Determine cutoff based on type
    local cutoff=$daily_cutoff
    if [[ "$backup_type" == "weekly" ]]; then
      cutoff=$weekly_cutoff
    fi

    # Delete if older than cutoff
    if [[ $backup_epoch -lt $cutoff ]]; then
      local backup_file=$(grep -o '"path": "[^"]*"' "$metadata_file" | cut -d'"' -f4)

      if [[ -f "$backup_file" ]]; then
        rm -f "$backup_file"
        rm -f "$metadata_file"
        log_info "Deleted: $(basename "$backup_file")"
        ((deleted_count++))
      fi
    fi
  done

  log_success "Cleanup complete ($deleted_count files deleted)"
}

# Print summary
print_summary() {
  log_info "=========================================="
  log_info "Backup Summary"
  log_info "=========================================="
  log_info "Environment: $ENVIRONMENT"
  log_info "Database: $PGDATABASE"
  log_info "Timestamp: $(date)"
  log_info "Backup Directory: $BACKUP_DIR"
  log_info "Retention (daily): $BACKUP_RETENTION_DAILY days"
  log_info "Retention (weekly): $BACKUP_RETENTION_WEEKLY days"
  log_info "=========================================="
}

# =============================================================================
# Main
# =============================================================================

main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --upload)
        SHOULD_UPLOAD=true
        shift
        ;;
      --env)
        ENVIRONMENT="$2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1"
        exit 1
        ;;
    esac
  done

  print_summary

  # Validate configuration
  if ! validate_config; then
    exit 1
  fi

  # Parse database URL
  parse_database_url

  # Create backup
  local backup_file
  if ! backup_file=$(create_backup); then
    exit 2
  fi

  # Get metadata file path
  local metadata_file="${METADATA_DIR}/$(basename "$backup_file").metadata.json"

  # Upload if requested
  if ! upload_backup "$backup_file" "$metadata_file"; then
    exit 4
  fi

  # Cleanup old backups
  if ! cleanup_old_backups; then
    log_warn "Cleanup had issues, but backup was successful"
  fi

  log_success "Backup process completed successfully!"
  log_info "Backup file: $backup_file"
  log_info "Metadata: $metadata_file"

  return 0
}

# Run main function
main "$@"
