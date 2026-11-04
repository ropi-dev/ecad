set -euo pipefail

if [[ "${1}" == perf* ]]; then
  shopt -s dotglob nullglob
  source_entries=(/source/*)
  tar -C /source --exclude=.git --exclude=node_modules --exclude=dist --exclude=dist-ssr --exclude=.output --exclude=.tanstack --exclude=.nitro --exclude=perf-artifacts -cf - "${source_entries[@]#/source/}" | tar -C /workspace --no-overwrite-dir -xf -
fi
cd "${ECAD_WORKSPACE:-/workspace}"
(
  if [[ "${ECAD_PERF_LOCK_HELD:-0}" != "1" ]]; then
    exec 8>"${ECAD_LOCK_DIR}/perf.lock"
    flock --shared 8
  fi
  flock --exclusive 9
  fingerprint="$( { printf '%s\n' "$PWD"; sha256sum pnpm-lock.yaml package.json pnpm-workspace.yaml packages/*/package.json; } | sha256sum | cut -d ' ' -f 1)"
  if [[ "${1}" == perf* ]] || [[ ! -f node_modules/.ecad-install ]] || [[ "$(cat node_modules/.ecad-install)" != "$fingerprint" ]]; then
    pnpm install --frozen-lockfile --store-dir /pnpm/store
    printf '%s' "$fingerprint" > node_modules/.ecad-install
  fi
) 9>"${ECAD_LOCK_DIR}/install-${ECAD_WORKTREE_ID}-${ECAD_SANDBOX_ROLE}.lock"
if [[ "${1}" == "dev" ]]; then
  shift
  pnpm dev --host 0.0.0.0 --port 3000 --strictPort "$@"
elif [[ "${1}" == "shell" ]]; then
  shift
  bash "$@"
else
  pnpm run "$@"
fi
