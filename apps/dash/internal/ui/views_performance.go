// Package ui provides performance monitoring views
package ui

import (
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/hyperdev-io/hyper-dash/apps/dash/internal/performance"
)

// renderPerformanceContent renders the performance monitoring dashboard
func (m Model) renderPerformanceContent() string {
	var sections []string
	
	// Collect current metrics
	var metrics performance.Metrics
	if m.perfMonitor != nil {
		metrics = m.perfMonitor.GetCurrent()
	} else {
		// Fallback to runtime metrics
		metrics = collectRuntimeMetrics()
	}
	
	// System Overview
	systemOverview := m.renderSystemOverview(metrics)
	sections = append(sections, systemOverview)
	
	// Memory Metrics
	memoryMetrics := m.renderMemoryMetrics(metrics)
	sections = append(sections, memoryMetrics)
	
	// Cache Performance
	cacheMetrics := m.renderCacheMetrics(metrics)
	sections = append(sections, cacheMetrics)
	
	// TaskMaster Performance
	tmMetrics := m.renderTaskMasterMetrics(metrics)
	sections = append(sections, tmMetrics)
	
	// File Operations
	fileOpsMetrics := m.renderFileOpsMetrics(metrics)
	sections = append(sections, fileOpsMetrics)
	
	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// renderSystemOverview renders system overview metrics
func (m Model) renderSystemOverview(metrics performance.Metrics) string {
	overviewStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#00FF00")).
		Padding(1, 2).
		Width(m.width - 4)
	
	uptimeStr := formatDuration(metrics.Uptime)
	
	content := fmt.Sprintf(
		"🖥️  System Overview\n\n" +
		"Uptime: %s | CPU: %.1f%% (%d cores) | Goroutines: %d\n" +
		"Requests: %d (%.1f/sec) | Errors: %d",
		uptimeStr,
		metrics.CPUPercent,
		metrics.CPUCores,
		metrics.NumGoroutines,
		metrics.RequestsTotal,
		metrics.RequestsPerSec,
		metrics.ErrorsTotal,
	)
	
	return overviewStyle.Render(content)
}

// renderMemoryMetrics renders memory usage metrics
func (m Model) renderMemoryMetrics(metrics performance.Metrics) string {
	memStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#FFA500")).
		Padding(1, 2).
		Width(m.width/2 - 3).
		Height(8)
	
	heapMB := float64(metrics.HeapAlloc) / 1024 / 1024
	sysMB := float64(metrics.HeapSys) / 1024 / 1024
	inuseMB := float64(metrics.HeapInuse) / 1024 / 1024
	releasedMB := float64(metrics.HeapReleased) / 1024 / 1024
	
	// Create memory bar
	memPercent := metrics.MemoryPercent
	memBar := m.renderProgressBar(int(memPercent), 100, 20)
	
	content := fmt.Sprintf(
		"💾 Memory Usage\n\n" +
		"Total: %.2f%%  %s\n" +
		"Heap: %.1f MB / %.1f MB\n" +
		"In Use: %.1f MB | Released: %.1f MB\n" +
		"GCs: %d | Last: %s | Pause: %s",
		memPercent, memBar,
		heapMB, sysMB,
		inuseMB, releasedMB,
		metrics.NumGC,
		formatTimeSince(metrics.LastGC),
		formatDuration(time.Duration(metrics.PauseNs)),
	)
	
	return memStyle.Render(content)
}

// renderCacheMetrics renders cache performance metrics
func (m Model) renderCacheMetrics(metrics performance.Metrics) string {
	cacheStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#00BFFF")).
		Padding(1, 2).
		Width(m.width/2 - 3).
		Height(8)
	
	hitRatio := metrics.CacheHitRatio * 100
	hitBar := m.renderProgressBar(int(hitRatio), 100, 20)
	
	// Get cache stats if available
	var cacheSize int
	var cacheMemory string
	if m.cacheSystem != nil {
		stats := m.cacheSystem.Stats()
		cacheSize = stats.Size
		cacheMemory = formatBytes(stats.MemoryUsed)
	}
	
	content := fmt.Sprintf(
		"🗄️  Cache Performance\n\n" +
		"Hit Ratio: %.1f%%  %s\n" +
		"Hits: %d | Misses: %d\n" +
		"Size: %d items | Memory: %s\n" +
		"Evictions: %d",
		hitRatio, hitBar,
		metrics.CacheHits, metrics.CacheMisses,
		cacheSize, cacheMemory,
		metrics.CacheEvictions,
	)
	
	return cacheStyle.Render(content)
}

// renderTaskMasterMetrics renders TaskMaster performance metrics
func (m Model) renderTaskMasterMetrics(metrics performance.Metrics) string {
	tmStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#FF69B4")).
		Padding(1, 2).
		Width(m.width/2 - 3).
		Height(6)
	
	successRate := float64(100)
	if metrics.TaskMasterCalls > 0 {
		successRate = float64(metrics.TaskMasterCalls-metrics.TaskMasterErrors) / float64(metrics.TaskMasterCalls) * 100
	}
	
	content := fmt.Sprintf(
		"🤖 TaskMaster Performance\n\n" +
		"API Calls: %d | Errors: %d (%.1f%% success)\n" +
		"Avg Latency: %s\n" +
		"Status: %s",
		metrics.TaskMasterCalls,
		metrics.TaskMasterErrors,
		successRate,
		metrics.TaskMasterLatency,
		m.getTaskMasterStatus(),
	)
	
	return tmStyle.Render(content)
}

// renderFileOpsMetrics renders file operations metrics
func (m Model) renderFileOpsMetrics(metrics performance.Metrics) string {
	fileStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#32CD32")).
		Padding(1, 2).
		Width(m.width/2 - 3).
		Height(6)
	
	// Get background worker stats if available
	var bgStats string
	if m.bgWorker != nil {
		stats := m.bgWorker.GetStats()
		bgStats = fmt.Sprintf("Active: %d | Queue: %d | Avg: %s",
			stats.Active, stats.QueueSize, stats.AvgLatency)
	} else {
		bgStats = "Background workers not initialized"
	}
	
	content := fmt.Sprintf(
		"📁 File Operations\n\n" +
		"Total: %d ops (%.1f/sec)\n" +
		"Background: %s",
		metrics.FileOpsTotal,
		metrics.FileOpsPerSec,
		bgStats,
	)
	
	return fileStyle.Render(content)
}

// renderProgressBar creates a visual progress bar
func (m Model) renderProgressBar(current, total, width int) string {
	if total == 0 {
		total = 1
	}
	
	filled := (current * width) / total
	if filled > width {
		filled = width
	}
	
	bar := strings.Repeat("█", filled)
	empty := strings.Repeat("░", width-filled)
	
	return fmt.Sprintf("[%s%s]", bar, empty)
}

// Helper functions
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%.1fs", d.Seconds())
	}
	if d < time.Hour {
		return fmt.Sprintf("%.1fm", d.Minutes())
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%.1fh", d.Hours())
	}
	return fmt.Sprintf("%.1fd", d.Hours()/24)
}

func formatTimeSince(t time.Time) string {
	if t.IsZero() {
		return "never"
	}
	return formatDuration(time.Since(t)) + " ago"
}

func formatBytes(bytes uint64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// formatFileSizePerf formats file size for performance view
func formatFileSizePerf(size int64) string {
	return formatBytes(uint64(size))
}

// getTaskMasterStatus returns TaskMaster connection status
func (m Model) getTaskMasterStatus() string {
	if m.taskmaster == nil {
		return "❌ Not initialized"
	}
	if !m.taskmaster.IsAvailable() {
		return "⚠️ Unavailable"
	}
	return "✅ Connected"
}

// collectRuntimeMetrics collects basic runtime metrics as fallback
func collectRuntimeMetrics() performance.Metrics {
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	
	return performance.Metrics{
		Timestamp:     time.Now(),
		HeapAlloc:     memStats.HeapAlloc,
		HeapSys:       memStats.HeapSys,
		HeapInuse:     memStats.HeapInuse,
		HeapReleased:  memStats.HeapReleased,
		NumGC:         memStats.NumGC,
		NumGoroutines: runtime.NumGoroutine(),
		CPUCores:      runtime.NumCPU(),
		LastGC:        time.Unix(0, int64(memStats.LastGC)),
		PauseNs:       memStats.PauseNs[(memStats.NumGC+255)%256],
		PauseTotalNs:  memStats.PauseTotalNs,
		GCCPUPercent:  memStats.GCCPUFraction * 100,
	}
}