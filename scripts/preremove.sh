#!/bin/bash
# Pre-removal script for HyperDash package

set -e

echo "Removing HyperDash..."

# Remove symlink if it exists
if [ -L "/usr/bin/hyper-dash" ]; then
    rm -f /usr/bin/hyper-dash
fi

# Clean up any temporary files (but preserve user data)
rm -f /tmp/hyper-dash-*

echo "HyperDash removal completed"

exit 0