#!/usr/bin/env bash
set -euo pipefail

# Ensure dist/index.js has a shebang and is executable.
# tsc doesn't emit shebangs or set executable permissions.

FILE="dist/index.js"

if [ ! -f "$FILE" ]; then
  echo "postbuild: $FILE not found" >&2
  exit 1
fi

# Add shebang only if not already present
if ! head -1 "$FILE" | grep -q '^#!/usr/bin/env node'; then
  echo '#!/usr/bin/env node' | cat - "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
fi

# Make executable
chmod +x "$FILE"
