#!/usr/bin/env bash
# Ultimate 2.0 unified — EXPERIMENTAL Linux→Windows NSIS cross-build (Wine + prebuilds).
# NOT Windows-qualified: no M8, no install smoke, no Alpha.3 upgrade tests on Windows.
# See scripts/windows-qualification/ULTIMATE2-RELEASE-RUNBOOK.md for qualified path.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "integration/ultimate2-unified-pr" ]]; then
  echo "Refusing cross-build: checkout integration/ultimate2-unified-pr (current: $BRANCH)" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing cross-build: working tree must be clean" >&2
  exit 1
fi
SHA="$(git rev-parse HEAD)"
SHA8="${SHA:0:8}"
if ! command -v wine >/dev/null; then
  echo "wine is required for NSIS (see electron-builder.offline.cjs)" >&2
  exit 1
fi
export USE_SYSTEM_WINE="${USE_SYSTEM_WINE:-true}"
export WINEARCH="${WINEARCH:-win64}"
npm run build
node scripts/fetch-bundled-chromium.mjs win64
npx electron-builder --config electron-builder.offline.cjs --win nsis --x64 --publish never
SRC="$ROOT/release/Profile.Manager-offline-Setup-"*"-x64.exe"
EVID="$ROOT/build-evidence/ultimate2-crossbuild-$SHA8"
mkdir -p "$EVID"
DEST="$EVID/Profile-Manager-Ultimate2-unified-${SHA8}-offline-Setup-x64.exe"
cp "$SRC" "$DEST"
HASH="$(sha256sum "$DEST" | awk '{print $1}')"
printf '%s  %s\n' "$HASH" "$(basename "$DEST")" > "$EVID/SHA256SUMS.txt"
cat > "$EVID/BUILD-MANIFEST.txt" <<EOF
Repository: qadeer-cyber/profile-manager
Branch: integration/ultimate2-unified-pr
Commit: $SHA
Build host: Linux cross-build (Wine + electron-builder)
Artifact: $(basename "$DEST")
SHA256: $HASH
Bytes: $(stat -c%s "$DEST")
Windows M8: NOT RUN (experimental cross-build)
Windows install smoke: NOT RUN
Qualified release: NO — see Support #4931951 for windows-2022 gates
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
echo "EXPERIMENTAL cross-build OK: $DEST"
echo "Evidence: $EVID"
