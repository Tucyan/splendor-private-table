#!/usr/bin/env bash
set -Eeuo pipefail

SPLENDOR_UPDATE_TESTING=1 source "$(dirname "$0")/update.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

clone_calls=0
git() {
  clone_calls=$((clone_calls + 1))
  if (( clone_calls < 3 )); then return 128; fi
  mkdir -p "${@: -1}"
}
sleep() { :; }
CLONE_ATTEMPTS=3
CLONE_RETRY_DELAY=0
TEMP_DIR=""
clone_with_retry "https://example.invalid/repo.git" main "/tmp"
[[ $clone_calls -eq 3 ]] || fail "clone should retry twice before success"
[[ -d $TEMP_DIR ]] || fail "successful clone directory was not retained"
rmdir "$TEMP_DIR"

health_count_file="$(mktemp)"
printf '0' > "$health_count_file"
systemctl() { [[ $1 == is-active ]]; }
curl() {
  local count
  count=$(( $(<"$health_count_file") + 1 ))
  printf '%s' "$count" > "$health_count_file"
  (( count >= 3 )) && printf '{"ok":true}'
}
HEALTH_ATTEMPTS=5
HEALTH_RETRY_DELAY=0
wait_for_health splendor http://127.0.0.1:3030/api/health
[[ $(<"$health_count_file") -eq 3 ]] || fail "health check should wait until the endpoint is ready"

printf '0' > "$health_count_file"
HEALTH_ATTEMPTS=2
if wait_for_health splendor http://127.0.0.1:3030/api/health; then
  fail "health check should fail after its attempt limit"
fi
[[ $(<"$health_count_file") -eq 2 ]] || fail "health check did not honor its attempt limit"
rm -f "$health_count_file"

printf 'PASS: clone retries and health readiness waiting\n'
