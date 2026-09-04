#!/usr/bin/env bash

validate_ipv6_section() {
  local section="$1"
  local part
  local -a parts=()
  IPV6_GROUP_COUNT=0

  [[ -z "$section" ]] && return 0
  [[ "$section" != :* && "$section" != *: ]] || return 1
  IFS=':' read -r -a parts <<< "$section"
  for part in "${parts[@]}"; do
    [[ "$part" =~ ^[0-9A-Fa-f]{1,4}$ ]] || return 1
    IPV6_GROUP_COUNT=$((IPV6_GROUP_COUNT + 1))
  done
}

validate_ipv6_literal() {
  local value="$1"
  local left right group_count=0

  [[ "$value" =~ ^[0-9A-Fa-f:]+$ && "$value" == *:* ]] || return 1
  if [[ "$value" == *::* ]]; then
    left="${value%%::*}"
    right="${value#*::}"
    [[ "$right" != *::* && "$left" != *: && "$right" != :* ]] || return 1
    validate_ipv6_section "$left" || return 1
    group_count=$((group_count + IPV6_GROUP_COUNT))
    validate_ipv6_section "$right" || return 1
    group_count=$((group_count + IPV6_GROUP_COUNT))
    (( group_count < 8 )) || return 1
  else
    validate_ipv6_section "$value" || return 1
    (( IPV6_GROUP_COUNT == 8 )) || return 1
  fi
}

endpoint_identity() {
  local value="$1" scheme authority path default_port host port prefix
  if [[ "$value" =~ ^([A-Za-z][A-Za-z0-9+.-]*)://([^/]+) ]]; then
    scheme="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    authority="${BASH_REMATCH[2]}"
    prefix="${BASH_REMATCH[1]}://${BASH_REMATCH[2]}"
    path="${value#"$prefix"}"
  else
    scheme='https'
    authority="${value%%/*}"
    path="${value#"$authority"}"
  fi
  [[ -z "$path" || "$path" == '/' ]] || return 1
  case "$scheme" in
    https) default_port=443 ;;
    http) default_port=80 ;;
    *) return 1 ;;
  esac

  if [[ "$authority" =~ ^\[([0-9A-Fa-f:]+)\](:([0-9]+))?$ ]]; then
    host="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    port="${BASH_REMATCH[3]:-$default_port}"
    validate_ipv6_literal "$host" || return 1
    (( port >= 1 && port <= 65535 )) || return 1
    printf '[%s]:%s\n' "$host" "$port"
    return 0
  fi

  [[ "$authority" =~ ^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:([0-9]+))?$ ]] || return 1
  host="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
  port="${BASH_REMATCH[4]:-$default_port}"
  (( port >= 1 && port <= 65535 )) || return 1
  printf '%s:%s\n' "$host" "$port"
}

endpoint_hostname() {
  local authority
  authority="$(endpoint_identity "$1")" || return 1
  if [[ "$authority" == \[*\]:* ]]; then
    authority="${authority#\[}"
    authority="${authority%%\]*}"
  else
    authority="${authority%%:*}"
  fi
  printf '%s\n' "$authority"
}
