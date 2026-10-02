#!/usr/bin/env bash
# Single source of truth for CI: GitHub Actions runs exactly this, and so can you.
#
#   bash scripts/ci.sh              # every step, in pipeline order
#   bash scripts/ci.sh lint test    # only the named steps, in the order given
#
# Each step's command mirrors a gate in .claude/gates.local.json; change both
# together or the local gates and CI drift apart.
set -euo pipefail

readonly STEPS=(install fixtures shell lint typecheck build test mutants size e2e)

step_install() { pnpm install --frozen-lockfile; }

step_fixtures() {
  local dir=packages/protocol/fixtures
  local files=()
  if [[ -d $dir ]]; then
    shopt -s nullglob
    files=("$dir"/*.json)
    shopt -u nullglob
  fi
  if ((${#files[@]} == 0)); then
    notice "fixtures: no $dir/*.json yet, skipping"
    return 0
  fi
  jq empty "${files[@]}"
}

# Prefer the runner's native binary: the npm wrapper downloads shellcheck from
# GitHub on every cold install, which turns a GitHub outage into a red CI.
step_shell() {
  if command -v shellcheck >/dev/null; then
    shellcheck scripts/*.sh
  else
    pnpm exec shellcheck scripts/*.sh
  fi
}
step_lint() { pnpm exec biome ci .; }
step_typecheck() { pnpm -r --if-present typecheck; }
step_build() { pnpm -r --if-present build; }
step_test() { pnpm -r --if-present test; }
step_mutants() { bash scripts/mutants.sh; }
step_size() { pnpm run size; }

# Chromium only; --with-deps installs its system libraries, which a CI runner
# lacks and a dev machine usually has (and would need sudo for).
step_e2e() {
  local deps=()
  [[ -n ${CI:-} ]] && deps=(--with-deps)
  pnpm --filter @lob26/auco-e2e exec playwright install "${deps[@]}" chromium
  # Not "test": pnpm -r test runs the unit suites and must not start browsers.
  pnpm --filter @lob26/auco-e2e e2e
}

in_actions() { [[ -n ${GITHUB_ACTIONS:-} ]]; }

notice() {
  if in_actions; then
    printf '::notice::%s\n' "$1"
  else
    printf 'notice: %s\n' "$1"
  fi
}

usage() {
  printf 'usage: bash scripts/ci.sh [step...]\nsteps: %s\n' "${STEPS[*]}"
}

current_step=''
step_started=0

# An EXIT trap rather than `if ! step_x` around each call: an `if` condition
# disables errexit inside the function it calls, so a failing command in the
# middle of a step would be ignored and only the last one would count.
on_exit() {
  local status=$?
  [[ -z $current_step ]] && return
  local elapsed=$(($(date +%s) - step_started))
  in_actions && printf '::endgroup::\n'
  if in_actions; then
    printf '::error title=ci.sh::step "%s" failed (exit %d, %ds)\n' \
      "$current_step" "$status" "$elapsed"
  fi
  printf '\nci: step "%s" FAILED after %ds (exit %d)\n' \
    "$current_step" "$elapsed" "$status" >&2
}
trap on_exit EXIT

run_step() {
  current_step=$1
  step_started=$(date +%s)
  if in_actions; then
    printf '::group::%s\n' "$1"
  else
    printf '\n==> %s\n' "$1"
  fi
  "step_$1"
  local elapsed=$(($(date +%s) - step_started))
  in_actions && printf '::endgroup::\n'
  printf 'ci: %s ok (%ds)\n' "$1" "$elapsed"
  current_step=''
}

main() {
  local step
  for step in "$@"; do
    if [[ $step == -h || $step == --help ]]; then
      usage
      exit 0
    fi
    if ! declare -F "step_$step" >/dev/null; then
      printf 'ci: unknown step "%s"\n' "$step" >&2
      usage >&2
      exit 2
    fi
  done

  cd "$(dirname "${BASH_SOURCE[0]}")/.."

  local selected=("$@")
  ((${#selected[@]} == 0)) && selected=("${STEPS[@]}")
  for step in "${selected[@]}"; do
    run_step "$step"
  done
}

main "$@"
