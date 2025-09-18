import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { useAnalytics } from '../hooks/useAnalytics'
import { ComplexityChart, TrendChart, BottleneckChart, ProductivityChart, AnalyticsSummary } from './charts/AnalyticsCharts'
import { HistoricalAnalysis } from './HistoricalAnalysis'
import { ErrorDisplay } from './ErrorDisplay'
import { ErrorBoundary } from './ErrorBoundary'
import AnalyticsExportService from '../services/analytics-export.service'

export type AnalyticsView = 'summary' | 'complexity' | 'trends' | 'bottlenecks' | 'productivity' | 'historical' | 'export'

export interface AnalyticsDashboardProps {
  compact?: boolean
  initialView?: AnalyticsView
  enableKeyboardNav?: boolean
  onViewChange?: (view: AnalyticsView) => void
  onClose?: () => void
}

const ANALYTICS_VIEWS: Array<{ key: AnalyticsView; label: string; description: string }> = [
  { key: 'summary', label: 'Summary', description: 'Overview of key metrics and insights' },
  { key: 'complexity', label: 'Complexity', description: 'Task complexity analysis and distribution' },
  { key: 'trends', label: 'Trends', description: 'Current trends and patterns' },
  { key: 'bottlenecks', label: 'Bottlenecks', description: 'Workflow bottlenecks and blockers' },
  { key: 'productivity', label: 'Productivity', description: 'Team productivity and velocity metrics' },
  { key: 'historical', label: 'Historical', description: 'Historical analysis and trend detection' },
  { key: 'export', label: 'Export', description: 'Data export and reporting options' }
]

/**
 * Main Analytics Dashboard Component
 * Provides comprehensive analytics views with interactive navigation
 */
export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  compact = false,
  initialView = 'summary',
  enableKeyboardNav = true,
  onViewChange,
  onClose
}) => {
  const [currentView, setCurrentView] = useState<AnalyticsView>(initialView)
  const [showHelp, setShowHelp] = useState(false)
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json')
  const [exportData, setExportData] = useState<string>('')
  
  const [analyticsState, analyticsActions] = useAnalytics({
    autoRefresh: true,
    autoRefreshInterval: 120000, // 2 minutes
    enableBackgroundRefresh: true
  })

  const {
    complexityReport,
    analyticsData,
    historicalData,
    isLoading,
    isRefreshing,
    error,
    lastUpdate,
    cacheStats
  } = analyticsState

  // Handle view changes
  const handleViewChange = (view: AnalyticsView) => {
    setCurrentView(view)
    setExportData('') // Clear export data when changing views
    if (onViewChange) {
      onViewChange(view)
    }
  }

  // Keyboard navigation
  useInput((input, key) => {
    if (!enableKeyboardNav) return

    if (key.escape) {
      if (showHelp) {
        setShowHelp(false)
      } else if (onClose) {
        onClose()
      }
      return
    }

    if (input === '?' || input === 'h') {
      setShowHelp(!showHelp)
      return
    }

    if (input === 'r') {
      analyticsActions.refreshAll()
      return
    }

    if (input === 'c') {
      analyticsActions.clearCache()
      return
    }

    // View navigation
    const viewKeys: Record<string, AnalyticsView> = {
      '1': 'summary',
      '2': 'complexity',
      '3': 'trends',
      '4': 'bottlenecks',
      '5': 'productivity',
      '6': 'historical',
      '7': 'export'
    }

    if (viewKeys[input]) {
      handleViewChange(viewKeys[input])
      return
    }

    // Export format toggle (only in export view)
    if (currentView === 'export' && input === 't') {
      setExportFormat(prev => prev === 'json' ? 'csv' : 'json')
      return
    }

    // Generate export (only in export view)
    if (currentView === 'export' && input === 'e') {
      try {
        const result = AnalyticsExportService.exportAnalytics(
          complexityReport,
          analyticsData,
          historicalData,
          { format: exportFormat, includeTimestamp: true, includeMetadata: true }
        )
        setExportData(result.data)
      } catch (error) {
        setExportData(`Export failed: ${error}`)
      }
      return
    }

    // Arrow key navigation between views
    if (key.leftArrow || key.rightArrow) {
      const currentIndex = ANALYTICS_VIEWS.findIndex(v => v.key === currentView)
      let newIndex: number

      if (key.leftArrow) {
        newIndex = currentIndex > 0 ? currentIndex - 1 : ANALYTICS_VIEWS.length - 1
      } else {
        newIndex = currentIndex < ANALYTICS_VIEWS.length - 1 ? currentIndex + 1 : 0
      }

      handleViewChange(ANALYTICS_VIEWS[newIndex].key)
      return
    }
  })

  // Auto-refresh effect
  useEffect(() => {
    if (currentView !== 'export') {
      setExportData('')
    }
  }, [currentView])

  // Loading state
  if (isLoading) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">⏳ Loading analytics data...</Text>
        </Box>
      </Box>
    )
  }

  // Error state
  if (error && !complexityReport && !analyticsData) {
    return (
      <ErrorBoundary>
        <Box flexDirection="column">
          <Box borderStyle="round" borderColor="red" paddingX={1}>
            <ErrorDisplay error={error} />
          </Box>
          
          {enableKeyboardNav && (
            <Box marginTop={1}>
              <Text dimColor>Press 'r' to retry, '?' for help, ESC to close</Text>
            </Box>
          )}
        </Box>
      </ErrorBoundary>
    )
  }

  // Help overlay
  if (showHelp) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1}>
          <Text bold underline>Analytics Dashboard Help</Text>
          
          <Box marginTop={1} flexDirection="column">
            <Text bold>Navigation:</Text>
            <Text>1-7: Switch between views</Text>
            <Text>← →: Navigate views with arrows</Text>
            <Text>r: Refresh all data</Text>
            <Text>c: Clear cache</Text>
            <Text>?: Toggle this help</Text>
            <Text>ESC: Close help/dashboard</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold>Export View (7):</Text>
            <Text>t: Toggle format (JSON/CSV)</Text>
            <Text>e: Generate export data</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold>Views:</Text>
            {ANALYTICS_VIEWS.map((view, index) => (
              <Text key={view.key}>
                {index + 1}: {view.label} - {view.description}
              </Text>
            ))}
          </Box>
        </Box>
        
        <Box marginTop={1}>
          <Text dimColor>Press '?' or ESC to close help</Text>
        </Box>
      </Box>
    )
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'summary':
        return (
          <AnalyticsSummary
            complexityReport={complexityReport}
            analyticsData={analyticsData}
            stats={analyticsData ? {
              totalTasks: analyticsData.productivityMetrics.workloadDistribution.high + 
                         analyticsData.productivityMetrics.workloadDistribution.medium + 
                         analyticsData.productivityMetrics.workloadDistribution.low,
              completedTasks: Math.round(analyticsData.productivityMetrics.burndownRate / 100 * 
                            (analyticsData.productivityMetrics.workloadDistribution.high + 
                             analyticsData.productivityMetrics.workloadDistribution.medium + 
                             analyticsData.productivityMetrics.workloadDistribution.low)),
              inProgressTasks: 0,
              pendingTasks: 0,
              blockedTasks: analyticsData.bottlenecks.length,
              deferredTasks: 0,
              cancelledTasks: 0,
              progressPercentage: analyticsData.productivityMetrics.burndownRate,
              subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
              priorityBreakdown: analyticsData.productivityMetrics.workloadDistribution
            } : null}
            compact={compact}
          />
        )

      case 'complexity':
        return complexityReport ? (
          <ComplexityChart complexityReport={complexityReport} compact={compact} />
        ) : (
          <Box>
            <Text dimColor>No complexity data available</Text>
          </Box>
        )

      case 'trends':
        return analyticsData ? (
          <TrendChart analyticsData={analyticsData} compact={compact} />
        ) : (
          <Box>
            <Text dimColor>No trend data available</Text>
          </Box>
        )

      case 'bottlenecks':
        return analyticsData ? (
          <BottleneckChart analyticsData={analyticsData} compact={compact} />
        ) : (
          <Box>
            <Text dimColor>No bottleneck data available</Text>
          </Box>
        )

      case 'productivity':
        return analyticsData ? (
          <ProductivityChart
            analyticsData={analyticsData}
            stats={{
              totalTasks: analyticsData.productivityMetrics.workloadDistribution.high + 
                         analyticsData.productivityMetrics.workloadDistribution.medium + 
                         analyticsData.productivityMetrics.workloadDistribution.low,
              completedTasks: Math.round(analyticsData.productivityMetrics.burndownRate / 100 * 
                            (analyticsData.productivityMetrics.workloadDistribution.high + 
                             analyticsData.productivityMetrics.workloadDistribution.medium + 
                             analyticsData.productivityMetrics.workloadDistribution.low)),
              inProgressTasks: 0,
              pendingTasks: 0,
              blockedTasks: analyticsData.bottlenecks.length,
              deferredTasks: 0,
              cancelledTasks: 0,
              progressPercentage: analyticsData.productivityMetrics.burndownRate,
              subtaskStats: { total: 0, completed: 0, inProgress: 0, pending: 0 },
              priorityBreakdown: analyticsData.productivityMetrics.workloadDistribution
            }}
            compact={compact}
          />
        ) : (
          <Box>
            <Text dimColor>No productivity data available</Text>
          </Box>
        )

      case 'historical':
        return historicalData.length > 0 ? (
          <HistoricalAnalysis 
            historicalData={historicalData} 
            compact={compact}
          />
        ) : (
          <Box>
            <Text dimColor>No historical data available</Text>
          </Box>
        )

      case 'export':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold underline>Data Export & Reporting</Text>
            </Box>

            <Box flexDirection="row" marginBottom={1}>
              <Text>Format: </Text>
              <Text color={exportFormat === 'json' ? 'green' : 'gray'}>JSON</Text>
              <Text> | </Text>
              <Text color={exportFormat === 'csv' ? 'green' : 'gray'}>CSV</Text>
              <Text dimColor> (press 't' to toggle)</Text>
            </Box>

            <Box marginBottom={1}>
              <Text>Available Data:</Text>
              <Box marginLeft={2} flexDirection="column">
                <Text color={complexityReport ? 'green' : 'gray'}>
                  ✓ Complexity Report ({complexityReport?.tasks.length || 0} tasks)
                </Text>
                <Text color={analyticsData ? 'green' : 'gray'}>
                  ✓ Analytics Data ({analyticsData?.bottlenecks.length || 0} bottlenecks)
                </Text>
                <Text color={historicalData.length > 0 ? 'green' : 'gray'}>
                  ✓ Historical Data ({historicalData.length} data points)
                </Text>
              </Box>
            </Box>

            {!exportData ? (
              <Box>
                <Text dimColor>Press 'e' to generate export data</Text>
              </Box>
            ) : (
              <Box flexDirection="column">
                <Box marginBottom={1}>
                  <Text bold>Generated Export ({exportFormat.toUpperCase()}):</Text>
                </Box>
                
                <Box 
                  borderStyle="single" 
                  paddingX={1} 
                  paddingY={1}
                  height={compact ? 10 : 15}
                  flexDirection="column"
                >
                  <Text>{exportData.slice(0, compact ? 500 : 1500)}...</Text>
                  {exportData.length > (compact ? 500 : 1500) && (
                    <Text dimColor>...truncated (full data would be exported)</Text>
                  )}
                </Box>
                
                <Box marginTop={1}>
                  <Text dimColor>
                    Export size: {(exportData.length / 1024).toFixed(1)}KB
                  </Text>
                </Box>
              </Box>
            )}
          </Box>
        )

      default:
        return <Text>Unknown view</Text>
    }
  }

  return (
    <ErrorBoundary>
      <Box flexDirection="column">
        {/* Header */}
        <Box 
          borderStyle="double" 
          borderColor="cyan" 
          paddingX={1} 
          marginBottom={1}
          justifyContent="space-between"
        >
          <Text bold color="cyan">TaskMaster Analytics Dashboard</Text>
          <Text dimColor>
            {lastUpdate ? `Updated: ${lastUpdate.toLocaleTimeString()}` : 'No data'}
            {isRefreshing && ' 🔄'}
          </Text>
        </Box>

        {/* Navigation Tabs */}
        <Box marginBottom={1}>
          <Box flexDirection="row">
            {ANALYTICS_VIEWS.map((view, index) => (
              <Box key={view.key} marginRight={1}>
                <Text 
                  color={currentView === view.key ? 'yellow' : 'gray'}
                  bold={currentView === view.key}
                >
                  {index + 1}:{view.label}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Current View Content */}
        <Box marginBottom={1}>
          {renderCurrentView()}
        </Box>

        {/* Status Bar */}
        <Box 
          borderStyle="single" 
          borderColor="gray" 
          paddingX={1}
          justifyContent="space-between"
        >
          <Text dimColor>
            Cache: {cacheStats.size} entries | 
            Historical: {historicalData.length} points
            {error && ` | Warning: ${error.slice(0, 50)}`}
          </Text>
          
          {enableKeyboardNav && (
            <Text dimColor>
              Press '?' for help | 'r' to refresh | ESC to close
            </Text>
          )}
        </Box>

        {/* Key Insights */}
        {!compact && currentView === 'summary' && (
          <Box marginTop={1}>
            <Text bold>AI Insights:</Text>
            {analyticsActions.getInsights().slice(0, 3).map((insight, index) => (
              <Box key={index} marginLeft={2}>
                <Text dimColor>• {insight}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </ErrorBoundary>
  )
}

export default AnalyticsDashboard