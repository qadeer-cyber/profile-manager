#!/usr/bin/env bash
# Ultimate 2.0 unified — Linux core regression (not a Windows substitute).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "Tip: $(git rev-parse HEAD)"
echo "Branch: $(git branch --show-current)"
if ! command -v node >/dev/null; then
  echo "node missing" >&2
  exit 1
fi
echo "Node: $(node -v)"
npx playwright install chromium
npm run build
npm run test:unit
npm run test:stabilization
npm run test:data-recovery
npm run test:browser-runtime
npm run test:integration:preflight
echo "Linux core regression finished OK"
