#!/usr/bin/env bash
set -euo pipefail

# Publish all @hypercli packages in dependency order using bun publish.
# bun publish resolves workspace:* to real version numbers before publishing.
#
# Usage: ./scripts/publish.sh [--dry-run]

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "🔍 Dry run mode — no packages will be published"
fi

# Publishing order (respects dependency graph):
#   1. ui     (no workspace deps)
#   2. core   (depends on ui)
#   3. kit    (depends on core, ui)
#   4. hq     (no workspace deps, but synced version)
#   5. gen    (depends on core, kit, ui)
#   6. cli    (depends on all above)

PACKAGES=(ui core kit hq gen cli)

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "📦 Publishing @hypercli/$pkg..."
  (cd "packages/$pkg" && bun publish --access public $DRY_RUN)
  echo "✅ @hypercli/$pkg published"
done

echo ""
echo "🎉 All packages published successfully!"
