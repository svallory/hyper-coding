package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui"
)

var (
	epicDir  string
	testMode bool
)

var rootCmd = &cobra.Command{
	Use:   "dash",
	Short: "🚀 HyperDash - Epic Workflow Monitor",
	Long: `🚀 HyperDash - A beautiful TUI dashboard for monitoring HyperDev epic workflows in real-time.

Monitor agent deployments, task execution, and workflow progression with live updates
and beautiful terminal interface powered by Charmbracelet.

Examples:
  dash                                    Monitor epics in ./agent/epics/
  dash --epic /path/to/epics             Monitor specific epic directory  
  dash --test                            Run in headless test mode
  dash --epic agent/epics --test         Test specific epic directory

For best results, run epic simulations in another terminal:
  ./scripts/quick-test.sh                Quick test data
  ./scripts/simulate-epic.sh demo        Realistic epic simulation`,
	Version: "1.0.0",
	Run:     runDashboard,
}

func init() {
	rootCmd.Flags().StringVarP(&epicDir, "epic", "e", "", "path to epic directory to monitor (default: ./agent/epics/)")
	rootCmd.Flags().BoolVarP(&testMode, "test", "t", false, "run in headless test mode without TUI")
	
	// Set custom help template with better formatting
	rootCmd.SetHelpTemplate(`{{with (or .Long .Short)}}{{. | trimTrailingWhitespaces}}

{{end}}{{if or .Runnable .HasSubCommands}}{{.UsageString}}{{end}}`)
}

func runDashboard(cmd *cobra.Command, args []string) {
	// Default to monitoring epics in agent/epics/ relative to current directory
	if epicDir == "" {
		wd, err := os.Getwd()
		if err != nil {
			log.Fatalf("Failed to get working directory: %v", err)
		}
		epicDir = filepath.Join(wd, "agent", "epics")
	}

	// Convert relative path to absolute for clarity
	if !filepath.IsAbs(epicDir) {
		wd, err := os.Getwd()
		if err != nil {
			log.Fatalf("Failed to get working directory: %v", err)
		}
		epicDir = filepath.Join(wd, epicDir)
	}

	// Run in test mode if requested
	if testMode {
		fmt.Printf("Test mode: Monitoring %s\n", epicDir)
		// Test mode implementation would go here
		return
	}

	// Ensure the epic directory exists for TUI mode
	if _, err := os.Stat(epicDir); os.IsNotExist(err) {
		fmt.Printf("Epic directory does not exist: %s\n", epicDir)
		fmt.Println("\nTo create test data:")
		fmt.Println("  ./scripts/quick-test.sh")
		fmt.Println("  ./scripts/simulate-epic.sh demo")
		fmt.Println("\nOr specify a different directory:")
		fmt.Println("  dash --epic /path/to/epics")
		os.Exit(1)
	}

	// Initialize the TUI model
	model := ui.InitialModel(epicDir)

	// Create the Bubble Tea program
	p := tea.NewProgram(
		model,
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	// Run the program
	if _, err := p.Run(); err != nil {
		log.Fatalf("Error running program: %v", err)
	}
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}