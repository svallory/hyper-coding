import React from 'react'
import { Box, Text } from 'ink'
import { BarChart, Sparkline, HeatMap, ProgressBar, Gauge, ChartDataPoint, SparklineDataPoint } from './ChartRenderer'
import { TaskMasterComplexityReport, TaskMasterAnalyticsData, TaskMasterStats } from '../../services/taskmaster.service'

export interface ComplexityChartProps {
  complexityReport: TaskMasterComplexityReport
  compact?: boolean
}

export interface TrendChartProps {
  analyticsData: TaskMasterAnalyticsData
  compact?: boolean
}

export interface BottleneckChartProps {
  analyticsData: TaskMasterAnalyticsData
  compact?: boolean
}

export interface ProductivityChartProps {
  analyticsData: TaskMasterAnalyticsData
  stats: TaskMasterStats
  compact?: boolean
}

/**
 * Task Complexity Analysis Chart
 */
export const ComplexityChart: React.FC<ComplexityChartProps> = ({
  complexityReport,
  compact = false
}) => {
  if (!complexityReport || complexityReport.tasks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Complexity Analysis</Text>
        <Text dimColor>No complexity data available</Text>
      </Box>
    )
  }

  // Prepare data for complexity distribution
  const distributionData: ChartDataPoint[] = [
    {
      label: 'Low (1-3)',
      value: complexityReport.complexityDistribution.low,
      color: 'green'
    },
    {
      label: 'Medium (4-7)',
      value: complexityReport.complexityDistribution.medium,
      color: 'yellow'
    },
    {
      label: 'High (8-10)',
      value: complexityReport.complexityDistribution.high,
      color: 'red'
    }
  ]

  // Top 5 most complex tasks
  const topComplexTasks = complexityReport.tasks
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, compact ? 3 : 5)
    .map(task => ({
      label: task.title.slice(0, 20),
      value: task.complexity,
      color: task.complexity > 7 ? 'red' : task.complexity > 4 ? 'yellow' : 'green'
    }))

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold underline>Complexity Analysis</Text>
      </Box>

      <Box flexDirection={compact ? "column" : "row"}>
        {/* Complexity Distribution */}
        <Box width={compact ? "100%" : "50%"} marginRight={compact ? 0 : 2}>
          <BarChart
            data={distributionData}
            title="Complexity Distribution"
            maxWidth={compact ? 25 : 30}
            compact={compact}
            showValues={true}
          />
        </Box>

        {/* Top Complex Tasks */}
        <Box width={compact ? "100%" : "50%"} marginTop={compact ? 1 : 0}>
          <BarChart
            data={topComplexTasks}
            title="Most Complex Tasks"
            maxWidth={compact ? 25 : 30}
            compact={compact}
            showValues={true}
          />
        </Box>
      </Box>

      {/* Summary Statistics */}
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text>
          Avg Complexity: <Text color="cyan">{complexityReport.averageComplexity.toFixed(1)}</Text>
        </Text>
        <Text>
          Total Hours: <Text color="cyan">{complexityReport.totalEstimatedHours}h</Text>
        </Text>
        <Text>
          High Risk: <Text color="red">{complexityReport.highComplexityTasks.length}</Text>
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Trend Analysis Charts
 */
export const TrendChart: React.FC<TrendChartProps> = ({
  analyticsData,
  compact = false
}) => {
  if (!analyticsData) {
    return (
      <Box flexDirection="column">
        <Text bold>Trend Analysis</Text>
        <Text dimColor>No trend data available</Text>
      </Box>
    )
  }

  // Prepare sparkline data for complexity trends
  const complexitySparklineData: SparklineDataPoint[] = analyticsData.complexityTrends.map(trend => ({
    value: trend.averageComplexity,
    timestamp: trend.date
  }))

  // Prepare sparkline data for completion trends
  const completionSparklineData: SparklineDataPoint[] = analyticsData.completionTrends.map(trend => ({
    value: trend.completionRate,
    timestamp: trend.date
  }))

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold underline>Trend Analysis</Text>
      </Box>

      <Box flexDirection={compact ? "column" : "row"}>
        {/* Complexity Trend */}
        <Box width={compact ? "100%" : "50%"} marginRight={compact ? 0 : 2}>
          <Sparkline
            data={complexitySparklineData}
            title="Complexity Trend"
            width={compact ? 30 : 40}
            showMinMax={!compact}
          />
          
          {!compact && (
            <Box marginTop={1}>
              <Text dimColor>
                Recent: {analyticsData.complexityTrends[analyticsData.complexityTrends.length - 1]?.averageComplexity.toFixed(1) || 'N/A'}
              </Text>
            </Box>
          )}
        </Box>

        {/* Completion Trend */}
        <Box width={compact ? "100%" : "50%"} marginTop={compact ? 1 : 0}>
          <Sparkline
            data={completionSparklineData}
            title="Completion Rate Trend"
            width={compact ? 30 : 40}
            showMinMax={!compact}
          />
          
          {!compact && (
            <Box marginTop={1}>
              <Text dimColor>
                Recent: {analyticsData.completionTrends[analyticsData.completionTrends.length - 1]?.completionRate.toFixed(1) || 'N/A'}%
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Task Count Trend */}
      {!compact && (
        <Box marginTop={2}>
          <BarChart
            data={analyticsData.complexityTrends.slice(-7).map((trend, index) => ({
              label: `Day ${index + 1}`,
              value: trend.taskCount,
              color: 'blue'
            }))}
            title="Task Count (Last 7 Days)"
            maxWidth={35}
            horizontal={true}
            compact={false}
          />
        </Box>
      )}
    </Box>
  )
}

/**
 * Bottleneck Analysis Chart
 */
export const BottleneckChart: React.FC<BottleneckChartProps> = ({
  analyticsData,
  compact = false
}) => {
  if (!analyticsData || analyticsData.bottlenecks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Bottleneck Analysis</Text>
        <Text color="green">✓ No bottlenecks detected</Text>
      </Box>
    )
  }

  const bottleneckData: ChartDataPoint[] = analyticsData.bottlenecks
    .slice(0, compact ? 3 : 5)
    .map(bottleneck => ({
      label: bottleneck.title.slice(0, 20),
      value: bottleneck.blockedTasks.length,
      color: bottleneck.impact === 'high' ? 'red' : 
             bottleneck.impact === 'medium' ? 'yellow' : 'green'
    }))

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold underline>Workflow Bottlenecks</Text>
      </Box>

      <BarChart
        data={bottleneckData}
        title="Tasks Blocking Others"
        maxWidth={compact ? 25 : 35}
        compact={compact}
        showValues={true}
      />

      {!compact && (
        <Box marginTop={1}>
          <Text dimColor>
            Total Bottlenecks: {analyticsData.bottlenecks.length} | 
            High Impact: {analyticsData.bottlenecks.filter(b => b.impact === 'high').length}
          </Text>
        </Box>
      )}

      {/* Bottleneck Details */}
      {!compact && analyticsData.bottlenecks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Critical Bottlenecks:</Text>
          {analyticsData.bottlenecks.slice(0, 3).map((bottleneck, index) => (
            <Box key={index} marginLeft={2}>
              <Text>
                <Text color={bottleneck.impact === 'high' ? 'red' : 'yellow'}>●</Text>
                {' '}{bottleneck.title.slice(0, 30)} 
                <Text dimColor> (blocking {bottleneck.blockedTasks.length} tasks)</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

/**
 * Productivity Metrics Chart
 */
export const ProductivityChart: React.FC<ProductivityChartProps> = ({
  analyticsData,
  stats,
  compact = false
}) => {
  if (!analyticsData || !stats) {
    return (
      <Box flexDirection="column">
        <Text bold>Productivity Metrics</Text>
        <Text dimColor>No productivity data available</Text>
      </Box>
    )
  }

  const workloadData: ChartDataPoint[] = [
    {
      label: 'High Priority',
      value: analyticsData.productivityMetrics.workloadDistribution.high,
      color: 'red'
    },
    {
      label: 'Medium Priority',
      value: analyticsData.productivityMetrics.workloadDistribution.medium,
      color: 'yellow'
    },
    {
      label: 'Low Priority',
      value: analyticsData.productivityMetrics.workloadDistribution.low,
      color: 'green'
    }
  ]

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold underline>Productivity Metrics</Text>
      </Box>

      <Box flexDirection={compact ? "column" : "row"}>
        {/* Progress Gauge */}
        <Box width={compact ? "100%" : "50%"} marginRight={compact ? 0 : 2}>
          <Gauge
            value={stats.completedTasks}
            max={stats.totalTasks}
            label="Overall Progress"
            color="green"
            size={compact ? "small" : "medium"}
          />
          
          <Box marginTop={1}>
            <ProgressBar
              value={stats.progressPercentage}
              max={100}
              width={compact ? 20 : 30}
              label="Completion Rate"
              color="green"
            />
          </Box>
        </Box>

        {/* Workload Distribution */}
        <Box width={compact ? "100%" : "50%"} marginTop={compact ? 1 : 0}>
          <BarChart
            data={workloadData}
            title="Workload by Priority"
            maxWidth={compact ? 20 : 25}
            compact={compact}
            showValues={true}
          />
        </Box>
      </Box>

      {/* Key Metrics */}
      <Box marginTop={1} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            Tasks/Day: <Text color="cyan">{analyticsData.productivityMetrics.tasksPerDay.toFixed(1)}</Text>
          </Text>
          <Text>
            Avg Time: <Text color="cyan">{analyticsData.productivityMetrics.averageCompletionTime.toFixed(1)}h</Text>
          </Text>
          <Text>
            Burndown: <Text color="cyan">{analyticsData.productivityMetrics.burndownRate.toFixed(1)}%</Text>
          </Text>
        </Box>
        
        {!compact && (
          <Box marginTop={1}>
            <Text dimColor>
              Velocity: {(analyticsData.productivityMetrics.tasksPerDay * 7).toFixed(1)} tasks/week |
              Remaining: {stats.totalTasks - stats.completedTasks} tasks |
              ETA: {Math.ceil((stats.totalTasks - stats.completedTasks) / Math.max(analyticsData.productivityMetrics.tasksPerDay, 0.1)).toFixed(0)} days
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * Combined Analytics Summary
 */
export interface AnalyticsSummaryProps {
  complexityReport?: TaskMasterComplexityReport | null
  analyticsData?: TaskMasterAnalyticsData | null
  stats?: TaskMasterStats | null
  compact?: boolean
}

export const AnalyticsSummary: React.FC<AnalyticsSummaryProps> = ({
  complexityReport,
  analyticsData,
  stats,
  compact = false
}) => {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold underline color="cyan">Analytics Summary</Text>
      </Box>

      {/* Quick Stats */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text>
          Avg Complexity: <Text color="yellow">{complexityReport?.averageComplexity.toFixed(1) || 'N/A'}</Text>
        </Text>
        <Text>
          Completion: <Text color="green">{stats?.progressPercentage.toFixed(1) || 'N/A'}%</Text>
        </Text>
        <Text>
          Bottlenecks: <Text color="red">{analyticsData?.bottlenecks.length || 0}</Text>
        </Text>
      </Box>

      {/* Key Insights */}
      <Box flexDirection="column">
        <Text bold>Key Insights:</Text>
        
        {complexityReport && complexityReport.highComplexityTasks.length > 0 && (
          <Box marginLeft={2}>
            <Text color="red">⚠ {complexityReport.highComplexityTasks.length} high complexity tasks need attention</Text>
          </Box>
        )}
        
        {analyticsData && analyticsData.bottlenecks.length > 0 && (
          <Box marginLeft={2}>
            <Text color="yellow">🔗 {analyticsData.bottlenecks.length} bottlenecks blocking progress</Text>
          </Box>
        )}
        
        {stats && stats.progressPercentage > 80 && (
          <Box marginLeft={2}>
            <Text color="green">🎯 Project nearing completion ({stats.progressPercentage.toFixed(1)}%)</Text>
          </Box>
        )}
        
        {analyticsData && analyticsData.productivityMetrics.tasksPerDay < 1 && (
          <Box marginLeft={2}>
            <Text color="red">⏰ Low productivity: {analyticsData.productivityMetrics.tasksPerDay.toFixed(1)} tasks/day</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}