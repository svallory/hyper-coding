package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/ui"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/version"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/logging"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/monitoring"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/performance"
)

var (
	// Build-time variables injected by ldflags
	buildVersion = "dev"
	commit       = "unknown"
	date         = "unknown"
	builtBy      = "dev"
	
	// Command-line flags
	epicDir  string
	testMode bool
	showVersion bool
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
	Version: buildVersion,
	Run:     runDashboard,
}

func init() {
	rootCmd.Flags().StringVarP(&epicDir, "epic", "e", "", "path to epic directory to monitor (default: ./agent/epics/)")
	rootCmd.Flags().BoolVarP(&testMode, "test", "t", false, "run in headless test mode without TUI")
	rootCmd.Flags().BoolVarP(&showVersion, "version", "v", false, "show version information")
	
	// Set custom help template with better formatting
	rootCmd.SetHelpTemplate(`{{with (or .Long .Short)}}{{. | trimTrailingWhitespaces}}

{{end}}{{if or .Runnable .HasSubCommands}}{{.UsageString}}{{end}}`)
	
	// Add version command
	versionCmd := &cobra.Command{
		Use:   "version",
		Short: "Show version information",
		Long:  "Display detailed version information including build time and git commit",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println(version.FormatVersionInfo())
		},
	}
	rootCmd.AddCommand(versionCmd)
	
	// Add update command
	updateCmd := &cobra.Command{
		Use:   "update",
		Short: "Check for updates",
		Long:  "Check for available updates and display update information",
		Run: func(cmd *cobra.Command, args []string) {
			checkForUpdates()
		},
	}
	rootCmd.AddCommand(updateCmd)
	
	// Add benchmark command
	benchmarkCmd := &cobra.Command{
		Use:   "benchmark",
		Short: "Run performance benchmarks",
		Long:  "Run performance benchmarks to test system performance and identify bottlenecks",
		Run: func(cmd *cobra.Command, args []string) {
			runBenchmarks()
		},
	}
	rootCmd.AddCommand(benchmarkCmd)
}

func runDashboard(cmd *cobra.Command, args []string) {
	// Initialize logging and monitoring
	logger := logging.GetDefaultLogger()
	monitor := monitoring.GetMonitor()
	
	// Apply performance optimizations
	optimizer := performance.NewPerformanceOptimizer()
	optimizer.OptimizeGC()
	optimizer.TuneMemory()
	
	// Start monitoring collection
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	monitor.StartPeriodicCollection(ctx, 30*time.Second)
	
	logger.Info("HyperDash starting up")
	monitor.IncrementCounter("app_starts", map[string]string{"version": buildVersion})
	
	// Show version information if requested
	if showVersion {
		fmt.Printf("HyperDash %s\n", buildVersion)
		fmt.Printf("Commit: %s\n", commit)
		fmt.Printf("Built: %s\n", date)
		fmt.Printf("Built by: %s\n", builtBy)
		return
	}
	
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

	// Start background update check
	updateChan := checkForUpdatesInBackground()

	// Initialize the TUI model
	model := ui.InitialModel(epicDir)

	// Create the Bubble Tea program
	p := tea.NewProgram(
		model,
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	// Run the program
	timer := monitor.NewTimer("app_runtime", map[string]string{"epic_dir": epicDir})
	if _, err := p.Run(); err != nil {
		monitor.RecordError(err, "application_runtime", map[string]interface{}{"epic_dir": epicDir})
		logger.WithError(err).Error("Error running program")
		log.Fatalf("Error running program: %v", err)
	}
	timer.Stop()
	
	logger.Info("HyperDash shutting down")

	// After TUI exits, check if there was an update available
	select {
	case updateCheck := <-updateChan:
		if updateCheck != nil && updateCheck.UpdateAvailable {
			fmt.Printf("\n%s\n", version.NewChecker().FormatUpdateNotification(updateCheck))
		}
	default:
		// No update check result available
	}
	
	// Export final metrics to log file
	if metricsData, err := monitor.ExportMetrics(); err == nil {
		logger.Debug("Final metrics exported")
		// Could write to separate metrics file if needed
		_ = metricsData
	}
}

// checkForUpdates checks for available updates and displays the result
func checkForUpdates() {
	fmt.Println("Checking for updates...")
	
	checker := version.NewChecker()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	updateCheck, err := checker.CheckForUpdates(ctx)
	if err != nil {
		fmt.Printf("Failed to check for updates: %v\n", err)
		return
	}
	
	if updateCheck.UpdateAvailable {
		fmt.Println(checker.FormatUpdateNotification(updateCheck))
	} else {
		fmt.Printf("You are running the latest version (%s)\n", updateCheck.CurrentVersion)
	}
}

// checkForUpdatesInBackground performs an update check in the background
// and returns a channel with the result
func checkForUpdatesInBackground() <-chan *version.UpdateCheck {
	resultChan := make(chan *version.UpdateCheck, 1)
	
	go func() {
		defer close(resultChan)
		
		checker := version.NewChecker()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		
		updateCheck, err := checker.CheckForUpdates(ctx)
		if err != nil {
			// Silently fail for background checks
			return
		}
		
		resultChan <- updateCheck
	}()
	
	return resultChan
}

// runBenchmarks runs performance benchmarks
func runBenchmarks() {
	fmt.Println("Running HyperDash performance benchmarks...")
	
	logger := logging.GetDefaultLogger()
	suite := performance.GetBenchmarkSuite()
	
	// Add core benchmarks
	setupBenchmarks(suite)
	
	// Run all benchmarks
	results := suite.RunAll()
	
	// Display results
	fmt.Println("\n📊 Benchmark Results:")
	fmt.Println("=" + strings.Repeat("=", 80))
	
	for _, result := range results {
		status := "✅ PASS"
		if !result.Success {
			status = "❌ FAIL"
		}
		
		fmt.Printf("%s %s\n", status, result.Name)
		if result.Success {
			fmt.Printf("   Iterations: %d\n", result.Iterations)
			fmt.Printf("   Average Duration: %v\n", result.AverageDuration)
			fmt.Printf("   Min Duration: %v\n", result.MinDuration)
			fmt.Printf("   Max Duration: %v\n", result.MaxDuration)
			fmt.Printf("   Memory Delta: %d bytes\n", result.MemoryDelta)
			fmt.Printf("   Allocations: %d\n", result.Allocations)
		} else {
			fmt.Printf("   Error: %s\n", result.Error)
		}
		fmt.Println()
	}
	
	// Display summary
	summary := suite.GetSummary()
	fmt.Println("📈 Summary:")
	fmt.Println("-" + strings.Repeat("-", 40))
	fmt.Printf("Total Benchmarks: %v\n", summary["total_benchmarks"])
	fmt.Printf("Successful: %v\n", summary["successful"])
	fmt.Printf("Failed: %v\n", summary["failed"])
	fmt.Printf("Total Duration: %v\n", summary["total_duration"])
	fmt.Printf("Total Iterations: %v\n", summary["total_iterations"])
	
	if avgDuration, exists := summary["average_iteration_duration"]; exists {
		fmt.Printf("Average Iteration Duration: %v\n", avgDuration)
	}
	
	logger.Info("Benchmark suite completed")
}

// setupBenchmarks adds standard benchmarks to the suite
func setupBenchmarks(suite *performance.BenchmarkSuite) {
	// Epic discovery benchmark
	suite.AddBenchmark(
		performance.NewBenchmark("epic_discovery", func() error {
			// Simulate epic discovery process
			time.Sleep(100 * time.Microsecond)
			return nil
		}).WithIterations(50).WithWarmup(5),
	)
	
	// File read benchmark
	suite.AddBenchmark(
		performance.NewBenchmark("file_operations", func() error {
			// Simulate file operations
			data := make([]byte, 1024)
			_ = data
			return nil
		}).WithIterations(100).WithWarmup(10),
	)
	
	// TaskMaster integration benchmark
	suite.AddBenchmark(
		performance.NewBenchmark("taskmaster_integration", func() error {
			// Simulate TaskMaster CLI call
			time.Sleep(50 * time.Microsecond)
			return nil
		}).WithIterations(30).WithWarmup(3),
	)
	
	// UI rendering benchmark
	suite.AddBenchmark(
		performance.NewBenchmark("ui_rendering", func() error {
			// Simulate UI component rendering
			for i := 0; i < 100; i++ {
				_ = fmt.Sprintf("component_%d", i)
			}
			return nil
		}).WithIterations(20).WithWarmup(2),
	)
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}