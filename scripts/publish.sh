#!/usr/bin/env bash
set -euo pipefail

# Publish all @hypercli packages in dependency order using bun publish.
# bun publish resolves workspace:* to real version numbers before publishing.
#
# Called by semantic-release's publishCmd, or manually:
#   ./scripts/publish.sh [--dry-run]

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "Dry run mode — no packages will be published"
fi

# Publishing order respects the dependency graph:
#   ui     → (no workspace deps)
#   core   → ui
#   kit    → core, ui
#   hq     → (no workspace deps, synced version)
#   gen    → core, kit, ui
#   cli    → core, ui, gen, hq, kit
PACKAGES=(ui core kit hq gen cli)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "Publishing @hypercli/$pkg..."
  (cd "$REPO_ROOT/packages/$pkg" && bun publish --access public $DRY_RUN)
  echo "@hypercli/$pkg done"
done

echo ""
echo "All packages published."
