#!/bin/bash

# Multi-Epic Simulation
# Runs multiple epics simultaneously to show dashboard with multiple workflows

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

echo -e "${GREEN}🚀 Starting Multi-Epic Simulation${NC}"
echo "This will create multiple epics running in parallel"
echo "📊 Open the dashboard in another terminal: cd apps/dash && ./dash"
echo ""

# Clean up any existing simulated epics
echo "🧹 Cleaning up previous simulations..."
rm -rf agent/epics/demo-*

# Create base epics directory
mkdir -p agent/epics

# Function to run an epic simulation in the background
run_epic_simulation() {
    local epic_name="$1"
    local delay_multiplier="$2"
    
    echo -e "${BLUE}🏗️  Starting epic: $epic_name${NC}"
    
    # Modify the simulation script to accept delay multiplier
    export DELAY_MULTIPLIER="$delay_multiplier"
    (
        cd /work/hyper-dash/apps/dash
        # Run simulation with modified timing
        sed "s/simulate_step_delay 3 5/simulate_step_delay $((3 * delay_multiplier)) $((5 * delay_multiplier))/g; 
             s/simulate_step_delay 2 3/simulate_step_delay $((2 * delay_multiplier)) $((3 * delay_multiplier))/g;
             s/simulate_step_delay 4 6/simulate_step_delay $((4 * delay_multiplier)) $((6 * delay_multiplier))/g;
             s/simulate_step_delay 5 8/simulate_step_delay $((5 * delay_multiplier)) $((8 * delay_multiplier))/g;
             s/simulate_step_delay 6 10/simulate_step_delay $((6 * delay_multiplier)) $((10 * delay_multiplier))/g" \
             scripts/simulate-epic.sh | bash -s "$epic_name"
    ) &
}

# Start multiple epic simulations with different timings
run_epic_simulation "demo-user-auth" 1
sleep 3

run_epic_simulation "demo-payment-system" 2  
sleep 5

run_epic_simulation "demo-notification-service" 1
sleep 2

run_epic_simulation "demo-admin-dashboard" 3

echo ""
echo -e "${GREEN}✨ All epic simulations started!${NC}"
echo -e "${BLUE}📊 Four epics are now running in parallel${NC}"
echo -e "${YELLOW}⏱️  Total simulation time: ~3-5 minutes${NC}"
echo ""
echo -e "${PURPLE}🎬 To record the dashboard, use:${NC}"
echo "   asciinema rec dashboard-demo.cast -c './dash'"
echo "   or"
echo "   terminalizer record dashboard-demo -c './dash'"
echo ""

# Wait for all background jobs to complete
wait

echo ""
echo -e "${GREEN}🎉 All epic simulations completed!${NC}"
echo -e "${BLUE}📊 Check the dashboard to see all completed workflows${NC}"