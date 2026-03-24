#!/usr/bin/env bash
set -euo pipefail

# Publish all @hypercli packages in dependency order.
#
# Before publishing, rewrites workspace:* references to real semver ranges
# so the published package.json is valid for any npm client.
#
# Usage: ./scripts/release.sh [--dry-run] [--provenance]

# Find system npm — bun/proto add ./node_modules/.bin to PATH which may
# resolve a broken npm shim. Use `which -a` to find the real system binary.
NPM="$(which -a npm | grep -v node_modules | head -1)"
if [ -z "$NPM" ]; then
  echo "Error: npm not found on system PATH (outside node_modules)"
  exit 1
fi
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
#   ui              → (no workspace deps)
#   core            → ui
#   create-hyper-hq → (no workspace deps, synced version)
#   kit             → core, ui
#   hq              → create-hyper-hq, ui
#   gen             → core, kit, ui
#   cli             → core, ui, gen, hq, kit
PACKAGES=(ui core create-hyper-hq kit hq gen cli)

publish_package() {
  local pkg=$1
  local pkg_name
  pkg_name=$(node -e "console.log(require('$REPO_ROOT/packages/$pkg/package.json').name)")

  if "$NPM" view "$pkg_name@$VERSION" version &>/dev/null; then
    echo "$pkg_name@$VERSION already published, skipping"
    return 0
  fi

  local retries=3
  local delay=15
  for attempt in $(seq 1 $retries); do
    if (cd "$REPO_ROOT/packages/$pkg" && "$NPM" publish $PUBLISH_FLAGS); then
      return 0
    elif [ $attempt -lt $retries ]; then
      echo "Retrying in ${delay}s (attempt $((attempt+1))/$retries)..."
      sleep $delay
      delay=$((delay * 2))
    else
      echo "Failed to publish $pkg_name after $retries attempts"
      return 1
    fi
  done
}

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "Publishing @hypercli/$pkg..."
  publish_package "$pkg"
  echo "@hypercli/$pkg done"
done

echo ""
echo "All packages published."
