#!/bin/bash

# Terminal Recording Script for HyperDash Demo
# Automatically sets up and records a complete dashboard demonstration

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check for recording tools
check_recording_tools() {
    echo -e "${BLUE}🔍 Checking for terminal recording tools...${NC}"
    
    if command -v asciinema &> /dev/null; then
        echo -e "${GREEN}✅ asciinema found${NC}"
        RECORDER="asciinema"
        return 0
    fi
    
    if command -v terminalizer &> /dev/null; then
        echo -e "${GREEN}✅ terminalizer found${NC}"
        RECORDER="terminalizer"
        return 0
    fi
    
    if command -v ttyrec &> /dev/null; then
        echo -e "${GREEN}✅ ttyrec found${NC}"
        RECORDER="ttyrec"
        return 0
    fi
    
    echo -e "${RED}❌ No terminal recording tools found${NC}"
    echo ""
    echo "Please install one of the following:"
    echo ""
    echo -e "${YELLOW}🎬 asciinema (recommended):${NC}"
    echo "   macOS: brew install asciinema"
    echo "   Ubuntu: apt install asciinema"
    echo "   Others: pip install asciinema"
    echo ""
    echo -e "${YELLOW}🎬 terminalizer:${NC}"
    echo "   npm install -g terminalizer"
    echo ""
    echo -e "${YELLOW}🎬 ttyrec:${NC}"
    echo "   macOS: brew install ttyrec"
    echo "   Ubuntu: apt install ttyrec"
    echo ""
    return 1
}

# Record with asciinema
record_asciinema() {
    local output_file="$1"
    echo -e "${GREEN}🎬 Recording with asciinema...${NC}"
    echo "Recording will start in 3 seconds. Press Ctrl+C to stop recording."
    sleep 3
    
    asciinema rec "$output_file" \
        --title "HyperDash - Epic Workflow Monitor" \
        --command "./dash" \
        --idle-time-limit 2 \
        --yes
}

# Record with terminalizer
record_terminalizer() {
    local output_file="$1"
    echo -e "${GREEN}🎬 Recording with terminalizer...${NC}"
    echo "Recording will start in 3 seconds. Type 'exit' to stop recording."
    sleep 3
    
    terminalizer record "$output_file" \
        --config '{"command":"./dash","cwd":".","env":{},"cols":"auto","rows":"auto"}' \
        --skip-sharing
}

# Record with ttyrec
record_ttyrec() {
    local output_file="$1"
    echo -e "${GREEN}🎬 Recording with ttyrec...${NC}"
    echo "Recording will start in 3 seconds. Press Ctrl+C to stop recording."
    sleep 3
    
    ttyrec -e "./dash" "$output_file"
}

# Main demo sequence
run_demo() {
    echo -e "${GREEN}🚀 HyperDash Demo Recording Setup${NC}"
    echo ""
    
    # Build the dashboard
    echo -e "${BLUE}🔨 Building dashboard...${NC}"
    if ! make build; then
        echo -e "${RED}❌ Build failed${NC}"
        exit 1
    fi
    
    # Clean previous demos
    echo -e "${BLUE}🧹 Cleaning previous demo data...${NC}"
    rm -rf agent/epics/demo-*
    
    # Create output directory
    mkdir -p recordings
    
    # Set up recording filename
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local recording_file=""
    
    case $RECORDER in
        "asciinema")
            recording_file="recordings/hyperdash_demo_$timestamp.cast"
            ;;
        "terminalizer")
            recording_file="recordings/hyperdash_demo_$timestamp"
            ;;
        "ttyrec")
            recording_file="recordings/hyperdash_demo_$timestamp.tty"
            ;;
    esac
    
    echo -e "${YELLOW}📁 Recording will be saved to: $recording_file${NC}"
    echo ""
    
    # Start simulation in background
    echo -e "${BLUE}🎭 Starting epic simulation in background...${NC}"
    (
        sleep 8  # Give time for dashboard to start
        echo "Starting simulation after dashboard startup..."
        ./scripts/simulate-epic.sh demo-live-recording
    ) &
    
    # Start recording
    case $RECORDER in
        "asciinema")
            record_asciinema "$recording_file"
            ;;
        "terminalizer")
            record_terminalizer "$recording_file"
            ;;
        "ttyrec")
            record_ttyrec "$recording_file"
            ;;
    esac
    
    echo ""
    echo -e "${GREEN}🎉 Recording completed!${NC}"
    echo -e "${BLUE}📁 File saved: $recording_file${NC}"
    
    # Provide playback instructions
    echo ""
    echo -e "${YELLOW}🎬 To playback the recording:${NC}"
    case $RECORDER in
        "asciinema")
            echo "   asciinema play $recording_file"
            echo ""
            echo -e "${YELLOW}🌐 To share online:${NC}"
            echo "   asciinema upload $recording_file"
            ;;
        "terminalizer")
            echo "   terminalizer play $recording_file"
            echo ""
            echo -e "${YELLOW}🎬 To generate GIF:${NC}"
            echo "   terminalizer render $recording_file"
            ;;
        "ttyrec")
            echo "   ttyplay $recording_file"
            ;;
    esac
}

# Print usage instructions
print_usage() {
    echo -e "${BLUE}📚 HyperDash Demo Recording${NC}"
    echo ""
    echo "This script will:"
    echo "1. Build the dashboard application"
    echo "2. Start a realistic epic simulation"
    echo "3. Record the dashboard in action"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --check-tools  Only check for recording tools"
    echo ""
    echo "The recording will demonstrate:"
    echo "• Real-time epic progress monitoring"
    echo "• Live agent deployment and task execution"
    echo "• Log streaming with different severity levels"
    echo "• Error handling and retry mechanisms"
    echo "• Beautiful TUI with responsive design"
}

# Handle command line arguments
case "${1:-}" in
    -h|--help)
        print_usage
        exit 0
        ;;
    --check-tools)
        check_recording_tools
        exit $?
        ;;
esac

# Main execution
echo -e "${GREEN}🎬 HyperDash Terminal Recording Script${NC}"
echo ""

# Check for recording tools
if ! check_recording_tools; then
    exit 1
fi

echo ""
read -p "Ready to start demo recording? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    run_demo
else
    echo -e "${YELLOW}Demo cancelled${NC}"
    exit 0
fi