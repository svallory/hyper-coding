#!/bin/bash
# Post-installation script for HyperDash package

set -e

echo "Setting up HyperDash..."

# Create symlink if needed
if [ ! -L "/usr/bin/hyper-dash" ] && [ -f "/usr/local/bin/hyper-dash" ]; then
    ln -sf /usr/local/bin/hyper-dash /usr/bin/hyper-dash
fi

# Set up shell completions
if [ -d "/usr/share/bash-completion/completions" ] && [ -f "/usr/share/bash-completion/completions/hyper-dash" ]; then
    echo "Bash completion installed"
fi

if [ -d "/usr/share/zsh/site-functions" ] && [ -f "/usr/share/zsh/site-functions/_hyper-dash" ]; then
    echo "Zsh completion installed"
fi

if [ -d "/usr/share/fish/vendor_completions.d" ] && [ -f "/usr/share/fish/vendor_completions.d/hyper-dash.fish" ]; then
    echo "Fish completion installed"
fi

# Test installation
if command -v hyper-dash >/dev/null 2>&1; then
    echo "HyperDash installed successfully!"
    hyper-dash -version
else
    echo "Warning: HyperDash binary not found in PATH"
fi

exit 0