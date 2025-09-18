#!/bin/bash

# Test script for verifying 6-tab UI structure

echo "Building dash application..."
go build -o dash cmd/dash/main.go

if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

echo "Build successful!"
echo ""
echo "Running tests..."
go test ./internal/ui -v

if [ $? -ne 0 ]; then
    echo "Tests failed!"
    exit 1
fi

echo ""
echo "All tests passed!"
echo ""
echo "To manually test the UI, run: ./dash"
echo ""
echo "Keyboard shortcuts to test:"
echo "  1 - Switch to Overview tab"
echo "  2 - Switch to Tasks tab"
echo "  3 - Switch to Agents tab"
echo "  4 - Switch to Docs tab"
echo "  5 - Switch to Logs tab"
echo "  6 - Switch to Help tab"
echo "  Tab - Cycle through tabs"
echo "  q - Quit"
echo ""
echo "The UI should show a tab bar at the top with all 6 tabs."
echo "The active tab should be highlighted differently."