package main

import (
	"fmt"

	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui"
)

// runTestMode runs the dashboard in test mode without requiring a TTY
func runTestMode(epicDir string) {
	fmt.Printf("🧪 Testing HyperDash in headless mode\n")
	fmt.Printf("📁 Epic Directory: %s\n", epicDir)

	// Test data loading
	epics, logs := ui.LoadExistingDataForTest(epicDir)

	fmt.Printf("\n📊 Dashboard Status:\n")
	fmt.Printf("  • Found %d epics\n", len(epics))
	fmt.Printf("  • Found %d log entries\n", len(logs))

	if len(epics) == 0 {
		fmt.Printf("\n⚠️  No epics found. Try running:\n")
		fmt.Printf("    make create-sample-epic\n")
		fmt.Printf("    make simulate-epic\n")
		return
	}

	fmt.Printf("\n🎯 Epic Summary:\n")
	for _, epic := range epics {
		status := "⏸️ Pending"
		switch epic.Status {
		case "completed":
			status = "✅ Completed"
		case "running", "in_progress":
			status = "🔄 Running"
		case "failed", "error":
			status = "❌ Failed"
		}

		fmt.Printf("  • %s: %s (%.0f%% complete, %d agents active)\n",
			epic.Name, status, epic.Progress, epic.Execution.ParallelAgentsActive)
	}

	if len(logs) > 0 {
		fmt.Printf("\n📝 Recent Logs:\n")
		// Show last 5 log entries
		start := 0
		if len(logs) > 5 {
			start = len(logs) - 5
		}
		for i := start; i < len(logs); i++ {
			log := logs[i]
			icon := log.Level.GetLevelIcon()
			fmt.Printf("  %s [%s] %s\n", icon, log.EpicName, log.Message)
		}
	}

	fmt.Printf("\n✅ Dashboard test completed successfully!\n")
	fmt.Printf("🚀 Run './dash' in an interactive terminal to see the full TUI\n")
}