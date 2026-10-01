#!/usr/bin/env bash
# Mutation check for the packages/legacy characterization suite.
# Each mutant is a sed program over packages/legacy/src/index.ts (frozen 1.0.9,
# so line addresses are stable). A mutant SURVIVES when the suite stays green
# against it. Exits 0 only when every mutant is killed.
#
#   bash scripts/mutants.sh            # all mutants
#   bash scripts/mutants.sh token-eq   # only the named ones
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
legacy=$repo/packages/legacy
src=$legacy/src/index.ts

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mut=$work/index.ts
config=$work/vitest.mutants.config.mjs
cp "$legacy/src/types.ts" "$work/types.ts"

# A plain object, not defineConfig: an import of vitest/config would resolve
# from this temp dir, where there is no node_modules. Paths come in through the
# environment so no quoting of $repo can break the generated JavaScript.
cat >"$config" <<'EOF'
export default {
  root: process.env.MUTANTS_LEGACY_DIR,
  resolve: {
    alias: [
      { find: /^\.\.\/src\/index$/, replacement: process.env.MUTANTS_SRC },
    ],
  },
  test: {
    environment: 'happy-dom',
    include: ['test/characterization.test.ts', 'test/known-defects.test.ts'],
    env: { AUCO_TARGET: 'legacy' },
  },
};
EOF
export MUTANTS_LEGACY_DIR=$legacy MUTANTS_SRC=$mut

declare -A MUTANTS=(
  # the 9 that survived round 1
  [token-eq]="91s/?\.includes('token')/ === 'token'/"
  [ready-no-return]="89s/return;//"
  [ready-optchain]="77s/event\.data\.ready/event.data?.ready/"
  [spread-order]="80s/language,/...sdkData,/;81s/\.\.\.sdkData,/language,/"
  [no-await-close]="114s/await //"
  [close-before]="113a\\      if (event.data?.status !== 'PENDING') window.removeEventListener('message', onMessage);
119,120d"
  [finish-remove-first]="125s/.*/        window.removeEventListener('message', onMessage);/;126s/.*/        await events.onSDKFinish();/"
  [custom-empty]="183s/customOrigin && customOrigin\.length > 0/customOrigin !== undefined/"
  [cw-null-ready]="78s/contentWindow?\.postMessage/contentWindow!.postMessage/"
  # documented `código` behavior the round-1 report left unpinned
  [nonstring-type]="91s/event\.data?\.type?\.includes('token')/typeof event.data?.type === 'string' \&\& event.data.type.includes('token')/"
  # written by the round-2 verifier, copied verbatim
  [close-or1]="115s/.*/        (event.data?.document || event.data?.similarity) ?? '',/"
  [close-or1b]="115s/.*/        event.data?.document ?? (event.data?.similarity || ''),/"
  [close-sp-or]="117s/.*/        event.data?.signProfile || [],/"
  [ready-strict]="77s/if (event.data.ready)/if (event.data.ready === true)/"
  [unknown-type-default]="191s/return getSDKURL\[sdkType\];/return getSDKURL[sdkType] ?? '';/"
  [prod-env-strict]="191s/return getSDKURL\[sdkType\];/if (env !== 'PROD') return ''; return getSDKURL[sdkType];/"
  [pending-inprogress]="119s/event.data?.status !== 'PENDING'/!['PENDING', 'INPROGRESS'].includes(event.data?.status)/"
  [pending-ci]="119s/event.data?.status !== 'PENDING'/event.data?.status?.toUpperCase?.() !== 'PENDING'/"
  # killed in round 1: regression guard
  [no-origin-filter]="76s/if (event\.origin !== origin) return;//"
  [pending-any]="119s/event\.data?\.status !== 'PENDING'/true/"
  [token-noawait]="97s/await //"
)

names=("$@")
if ((${#names[@]} == 0)); then
  mapfile -t names < <(printf '%s\n' "${!MUTANTS[@]}" | sort)
fi

survived=()
for name in "${names[@]}"; do
  prog=${MUTANTS[$name]:?unknown mutant $name}
  cp "$src" "$mut"
  sed -i -e "$prog" "$mut"
  if cmp -s "$src" "$mut"; then
    printf '%-20s BROKEN (sed changed nothing)\n' "$name"
    survived+=("$name")
    continue
  fi
  if (cd "$legacy" && pnpm exec vitest run --config "$config" >/dev/null 2>&1); then
    printf '%-20s SURVIVED\n' "$name"
    survived+=("$name")
  else
    printf '%-20s killed\n' "$name"
  fi
done

if ((${#survived[@]})); then
  printf '\n%d/%d survived: %s\n' "${#survived[@]}" "${#names[@]}" "${survived[*]}"
  exit 1
fi
printf '\nall %d mutants killed\n' "${#names[@]}"
