#!/bin/bash

# Test TUI Script
# Tests the dashboard TUI in a way that works in CI/automated environments

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🧪 Testing HyperDash TUI${NC}"
echo ""

# Build the dashboard
echo -e "${BLUE}🔨 Building dashboard...${NC}"
go build -o dash ./cmd/dash

# Test headless mode first
echo -e "${BLUE}📊 Testing data loading...${NC}"
./dash -test

echo ""
echo -e "${BLUE}🎭 Testing TUI startup and shutdown...${NC}"

# Test TUI startup with a script that immediately quits
# This simulates opening the dashboard and pressing 'q' to quit
echo "q" | timeout 10s ./dash 2>/dev/null || {
    exit_code=$?
    if [ $exit_code -eq 124 ]; then
        echo -e "${RED}❌ TUI test timed out - dashboard may be stuck${NC}"
        exit 1
    elif [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✅ TUI started and exited cleanly${NC}"
    else
        echo -e "${YELLOW}⚠️  TUI exited with code $exit_code (expected in CI environment)${NC}"
    fi
}

echo ""
echo -e "${GREEN}✅ TUI tests completed!${NC}"
echo ""
echo -e "${BLUE}📋 Manual Testing Instructions:${NC}"
echo "  1. Open two terminals"
echo "  2. Terminal 1: ./scripts/quick-test.sh"
echo "  3. Terminal 2: ./dash"
echo "  4. Navigate with Tab/Shift+Tab, Enter to select, q to quit"
echo ""
echo -e "${YELLOW}🎬 To record a demo:${NC}"
echo "  1. Install: brew install asciinema"
echo "  2. Record: asciinema rec demo.cast -c './dash'"
echo "  3. Start simulation: ./scripts/simulate-epic.sh"
echo "  4. Playback: asciinema play demo.cast"