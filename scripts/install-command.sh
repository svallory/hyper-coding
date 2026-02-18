#!/usr/bin/env bash
set -e

HYPER_BIN="$MOON_WORKSPACE_ROOT/packages/cli/bin/dev.js"

if [ ! -f "$HYPER_BIN" ]; then
  echo "Error: $HYPER_BIN not found. Run 'moon run cli:build' first."
  exit 1
fi

SHELL_NAME="$(basename "$SHELL")"
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  fish)
    FISH_DIR="$HOME/.config/fish"
    mkdir -p "$FISH_DIR/functions"
    printf 'function hyper\n  bun %s $argv\nend\n' "$HYPER_BIN" > "$FISH_DIR/functions/hyper.fish"
    echo "✓ Created fish function at $FISH_DIR/functions/hyper.fish"
    echo "  Restart your shell or run: source $FISH_DIR/functions/hyper.fish"
    exit 0
    ;;
  *)
    echo "Unsupported shell: $SHELL_NAME"
    echo "Add this function manually to your shell rc file:"
    echo "  hyper() { bun $HYPER_BIN \"\$@\"; }"
    exit 1
    ;;
esac

FUNC_LINE="hyper() { bun $HYPER_BIN \"\$@\"; }"
MARKER="# hyper-dev function"

# Remove existing marker block if present (marker line + function line)
if grep -q "$MARKER" "$RC_FILE" 2>/dev/null; then
  sed -i.bak "/$MARKER/{N;d;}" "$RC_FILE" && rm -f "$RC_FILE.bak"
fi

# Add new function
echo "" >> "$RC_FILE"
echo "$MARKER" >> "$RC_FILE"
echo "$FUNC_LINE" >> "$RC_FILE"

echo "✓ Added hyper function to $RC_FILE"
echo "  Restart your shell or run: source $RC_FILE"
