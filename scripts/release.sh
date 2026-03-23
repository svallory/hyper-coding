#!/usr/bin/env bash
set -euo pipefail

# Publish all @hypercli packages in dependency order.
#
# Before publishing, rewrites workspace:* references to real semver ranges
# so the published package.json is valid for any npm client.
#
# Called by the publish workflow after release-please creates a release.
# Can also be run manually: ./scripts/release.sh [--dry-run] [--provenance]

PUBLISH_FLAGS="--access public"

for arg in "$@"; do
  case "$arg" in
    --dry-run)    PUBLISH_FLAGS="$PUBLISH_FLAGS --dry-run" ;;
    --provenance) PUBLISH_FLAGS="$PUBLISH_FLAGS --provenance" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read the version from any package (all are synchronized)
VERSION=$(node -e "console.log(require('$REPO_ROOT/packages/cli/package.json').version)")
echo "Publishing @hypercli/* v${VERSION}"

# Rewrite workspace:* → ^version in all package.json files
echo ""
echo "Resolving workspace:* references..."
node "$REPO_ROOT/scripts/bump-versions.mjs" "$VERSION"

# Publishing order respects the dependency graph:
#   ui     → (no workspace deps)
#   core   → ui
#   kit    → core, ui
#   hq     → (no workspace deps, synced version)
#   gen    → core, kit, ui
#   cli    → core, ui, gen, hq, kit
PACKAGES=(ui core kit hq gen cli)

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "Publishing @hypercli/$pkg..."
  (cd "$REPO_ROOT/packages/$pkg" && npm publish $PUBLISH_FLAGS)
  echo "@hypercli/$pkg done"
done

echo ""
echo "All packages published."
