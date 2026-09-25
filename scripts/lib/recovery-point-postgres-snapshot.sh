#!/usr/bin/env bash
# Captures a PostgreSQL custom dump and File rows from one exported MVCC snapshot.
# Docker database commands are limited to six hours, matching the paired service bound.
# Usage: recovery_point_postgres_snapshot_capture POSTGRES_CONTAINER DATABASE_NAME POSTGRES_USER PRIVATE_DIRECTORY

recovery_point_postgres_snapshot_error() {
  printf 'ERROR: recovery-point PostgreSQL snapshot capture failed\n' >&2
  return 1
}

recovery_point_postgres_snapshot_mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null; }
recovery_point_postgres_snapshot_inode() { stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1" 2>/dev/null; }

recovery_point_postgres_snapshot_private_directory() {
  local directory="$1" mode
  [[ -n "$directory" && -d "$directory" && ! -L "$directory" ]] || return 1
  mode="$(recovery_point_postgres_snapshot_mode "$directory")" || return 1
  [[ "$mode" == 700 ]]
}

# Preflight local and container command support without opening a database connection.
recovery_point_postgres_snapshot_require_runtime() {
  local container="${1:-}"
  [[ "$#" -eq 1 && "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || return 1
  command -v timeout >/dev/null 2>&1 && command -v docker >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 || return 1
  timeout 6h docker exec "$container" sh -c 'command -v pg_dump >/dev/null && command -v psql >/dev/null && command -v pg_restore >/dev/null' >/dev/null 2>&1
}

recovery_point_postgres_snapshot_close_fd() {
  local fd="${1:-}"
  [[ "$fd" =~ ^[0-9]+$ ]] && eval "exec ${fd}>&-"
}

recovery_point_postgres_snapshot_stop_exporter() {
  local input_fd="${1:-}" pid="${2:-}" attempts=0
  if [[ "$input_fd" =~ ^[0-9]+$ ]]; then
    printf 'ROLLBACK;\n\\q\n' >&"$input_fd" 2>/dev/null || true
    recovery_point_postgres_snapshot_close_fd "$input_fd"
  fi
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  while kill -0 "$pid" 2>/dev/null && (( attempts < 20 )); do sleep 0.1; attempts=$((attempts + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -TERM "$pid" 2>/dev/null || true
  attempts=0
  while kill -0 "$pid" 2>/dev/null && (( attempts < 20 )); do sleep 0.1; attempts=$((attempts + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

recovery_point_postgres_snapshot_cleanup_active() {
  local tmp_inode out_inode tmp_path out_path
  [[ "${recovery_point_postgres_snapshot_cleaned:-false}" == true ]] && return 0
  recovery_point_postgres_snapshot_cleaned=true
  recovery_point_postgres_snapshot_stop_exporter "${recovery_point_postgres_snapshot_input_fd:-}" "${recovery_point_postgres_snapshot_exporter_pid:-}"
  recovery_point_postgres_snapshot_close_fd "${recovery_point_postgres_snapshot_output_fd:-}"
  if [[ "${recovery_point_postgres_snapshot_remove_outputs:-false}" == true ]]; then
    for tmp_path in "${recovery_point_postgres_snapshot_dump_tmp:-}" "${recovery_point_postgres_snapshot_rows_tmp:-}"; do
      [[ "$tmp_path" == "${recovery_point_postgres_snapshot_dump_tmp:-}" ]] && out_path="${recovery_point_postgres_snapshot_dump_out:-}" || out_path="${recovery_point_postgres_snapshot_rows_out:-}"
      [[ -f "$tmp_path" && ! -L "$tmp_path" && -f "$out_path" && ! -L "$out_path" ]] || continue
      tmp_inode="$(recovery_point_postgres_snapshot_inode "$tmp_path")" || continue
      out_inode="$(recovery_point_postgres_snapshot_inode "$out_path")" || continue
      [[ "$tmp_inode" == "$out_inode" ]] && rm -f -- "$out_path"
    done
  fi
  for tmp_path in "${recovery_point_postgres_snapshot_dump_tmp:-}" "${recovery_point_postgres_snapshot_rows_tmp:-}"; do
    [[ -n "$tmp_path" && -f "$tmp_path" && ! -L "$tmp_path" ]] && rm -f -- "$tmp_path"
  done
  if [[ -n "${recovery_point_postgres_snapshot_pipe_root:-}" && -d "$recovery_point_postgres_snapshot_pipe_root" && ! -L "$recovery_point_postgres_snapshot_pipe_root" ]]; then
    [[ -p "$recovery_point_postgres_snapshot_pipe_root/input" && ! -L "$recovery_point_postgres_snapshot_pipe_root/input" ]] && rm -f -- "$recovery_point_postgres_snapshot_pipe_root/input"
    [[ -p "$recovery_point_postgres_snapshot_pipe_root/output" && ! -L "$recovery_point_postgres_snapshot_pipe_root/output" ]] && rm -f -- "$recovery_point_postgres_snapshot_pipe_root/output"
    rmdir -- "$recovery_point_postgres_snapshot_pipe_root" 2>/dev/null || true
  fi
}

recovery_point_postgres_snapshot_restore_traps() {
  eval "${recovery_point_postgres_snapshot_previous_exit:-trap - EXIT}"
  eval "${recovery_point_postgres_snapshot_previous_hup:-trap - HUP}"
  eval "${recovery_point_postgres_snapshot_previous_int:-trap - INT}"
  eval "${recovery_point_postgres_snapshot_previous_term:-trap - TERM}"
}

recovery_point_postgres_snapshot_trap() {
  local signal="$1" status="$2"
  recovery_point_postgres_snapshot_cleanup_active
  recovery_point_postgres_snapshot_restore_traps
  [[ "$signal" == EXIT ]] && return "$status"
  kill -s "$signal" "$$"
  return 128
}

recovery_point_postgres_snapshot_capture_body() {
  local container="$1" database="$2" user="$3" directory="$4" snapshot='' query=''
  [[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ && "$database" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ && "$user" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || return 1
  recovery_point_postgres_snapshot_private_directory "$directory" && recovery_point_postgres_snapshot_require_runtime "$container" || return 1
  [[ "${RECOVERY_POINT_POSTGRES_SNAPSHOT_RESPONSE_TIMEOUT_SECONDS:-30}" =~ ^[1-9][0-9]*$ ]] || return 1
  recovery_point_postgres_snapshot_dump_out="$directory/postgres.dump"
  recovery_point_postgres_snapshot_rows_out="$directory/file-rows.json"
  [[ ! -e "$recovery_point_postgres_snapshot_dump_out" && ! -L "$recovery_point_postgres_snapshot_dump_out" && ! -e "$recovery_point_postgres_snapshot_rows_out" && ! -L "$recovery_point_postgres_snapshot_rows_out" ]] || return 1
  recovery_point_postgres_snapshot_dump_tmp="$(umask 077; mktemp "$directory/.recovery-point-postgres-dump.XXXXXX")" || return 1
  recovery_point_postgres_snapshot_rows_tmp="$(umask 077; mktemp "$directory/.recovery-point-postgres-rows.XXXXXX")" || return 1
  chmod 0600 "$recovery_point_postgres_snapshot_dump_tmp" "$recovery_point_postgres_snapshot_rows_tmp" || return 1
  [[ ! -e /dev/fd/8 && ! -e /dev/fd/9 ]] || return 1
  recovery_point_postgres_snapshot_pipe_root="$(umask 077; mktemp -d "$directory/.recovery-point-postgres-exporter.XXXXXX")" || return 1
  mkfifo -m 0600 "$recovery_point_postgres_snapshot_pipe_root/input" "$recovery_point_postgres_snapshot_pipe_root/output" || return 1
  exec 9<>"$recovery_point_postgres_snapshot_pipe_root/input"
  exec 8<>"$recovery_point_postgres_snapshot_pipe_root/output"
  recovery_point_postgres_snapshot_input_fd=9; recovery_point_postgres_snapshot_output_fd=8
  timeout 6h docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U "$user" -d "$database" <&9 >&8 2>/dev/null &
  recovery_point_postgres_snapshot_exporter_pid="$!"
  printf '%s\n%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' 'SELECT pg_export_snapshot();' >&9 || return 1
  IFS= read -r -t "${RECOVERY_POINT_POSTGRES_SNAPSHOT_RESPONSE_TIMEOUT_SECONDS:-30}" snapshot <&8 || return 1
  [[ "$snapshot" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9A-Fa-f]+$ ]] || return 1
  timeout 6h docker exec -i "$container" pg_dump --format=custom --no-owner --no-privileges "--snapshot=$snapshot" -U "$user" -d "$database" >"$recovery_point_postgres_snapshot_dump_tmp" 2>/dev/null || return 1
  query="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT '$snapshot';
SELECT COALESCE(json_agg(json_build_object(
  'id', file_row.\"id\",
  'tenantId', file_row.\"tenantId\",
  'bucket', file_row.\"bucket\",
  'objectKey', file_row.\"objectKey\",
  'objectVersionId', CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'File'
      AND column_name = 'objectVersionId'
  ) THEN to_jsonb(file_row) -> 'objectVersionId' ELSE NULL END,
  'size', file_row.\"size\",
  'checksum', file_row.\"checksum\"
)), '[]'::json) FROM \"File\" AS file_row;
COMMIT;"
  timeout 6h docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U "$user" -d "$database" -c "$query" >"$recovery_point_postgres_snapshot_rows_tmp" 2>/dev/null || return 1
  timeout 6h docker exec -i "$container" pg_restore --list <"$recovery_point_postgres_snapshot_dump_tmp" >/dev/null 2>&1 || return 1
  jq -e . "$recovery_point_postgres_snapshot_rows_tmp" >/dev/null 2>&1 || return 1
  [[ ! -e "$recovery_point_postgres_snapshot_dump_out" && ! -L "$recovery_point_postgres_snapshot_dump_out" && ! -e "$recovery_point_postgres_snapshot_rows_out" && ! -L "$recovery_point_postgres_snapshot_rows_out" ]] || return 1
  ln "$recovery_point_postgres_snapshot_dump_tmp" "$recovery_point_postgres_snapshot_dump_out" && ln "$recovery_point_postgres_snapshot_rows_tmp" "$recovery_point_postgres_snapshot_rows_out" || return 1
  recovery_point_postgres_snapshot_remove_outputs=false
}

recovery_point_postgres_snapshot_capture() {
  [[ "$#" -eq 4 ]] || { recovery_point_postgres_snapshot_error; return 1; }
  recovery_point_postgres_snapshot_dump_tmp=''; recovery_point_postgres_snapshot_rows_tmp=''; recovery_point_postgres_snapshot_pipe_root=''
  recovery_point_postgres_snapshot_input_fd=''; recovery_point_postgres_snapshot_output_fd=''; recovery_point_postgres_snapshot_exporter_pid=''
  recovery_point_postgres_snapshot_remove_outputs=true; recovery_point_postgres_snapshot_cleaned=false
  recovery_point_postgres_snapshot_previous_exit="$(trap -p EXIT || true)"; recovery_point_postgres_snapshot_previous_hup="$(trap -p HUP || true)"
  recovery_point_postgres_snapshot_previous_int="$(trap -p INT || true)"; recovery_point_postgres_snapshot_previous_term="$(trap -p TERM || true)"
  trap 'recovery_point_postgres_snapshot_trap EXIT "$?"' EXIT
  trap 'recovery_point_postgres_snapshot_trap HUP "$?"' HUP
  trap 'recovery_point_postgres_snapshot_trap INT "$?"' INT
  trap 'recovery_point_postgres_snapshot_trap TERM "$?"' TERM
  if recovery_point_postgres_snapshot_capture_body "$@"; then
    recovery_point_postgres_snapshot_cleanup_active
    recovery_point_postgres_snapshot_restore_traps
    return 0
  fi
  recovery_point_postgres_snapshot_cleanup_active
  recovery_point_postgres_snapshot_restore_traps
  recovery_point_postgres_snapshot_error
}
