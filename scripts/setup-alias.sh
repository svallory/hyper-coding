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
    echo "function hyper; node $HYPER_BIN \$argv; end" > "$FISH_DIR/functions/hyper.fish"
    echo "✓ Created fish function at $FISH_DIR/functions/hyper.fish"
    echo "  Restart your shell or run: source $FISH_DIR/functions/hyper.fish"
    exit 0
    ;;
  *)
    echo "Unsupported shell: $SHELL_NAME"
    echo "Add this alias manually to your shell rc file:"
    echo "  alias hyper='node $HYPER_BIN'"
    exit 1
    ;;
esac

ALIAS_LINE="alias hyper='node $HYPER_BIN'"
MARKER="# hyper-dev alias"

# Remove existing alias block if present
if grep -q "$MARKER" "$RC_FILE" 2>/dev/null; then
  # Use temp file for cross-platform sed compatibility
  sed "/$MARKER/d" "$RC_FILE" > "$RC_FILE.tmp" && mv "$RC_FILE.tmp" "$RC_FILE"
fi

# Add new alias block
echo "" >> "$RC_FILE"
echo "$MARKER" >> "$RC_FILE"
echo "$ALIAS_LINE" >> "$RC_FILE"

echo "✓ Added hyper alias to $RC_FILE"
echo "  Restart your shell or run: source $RC_FILE"
