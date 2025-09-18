import { TaskMasterComplexityReport, TaskMasterAnalyticsData, TaskMasterHistoricalData, TaskMasterTask, TaskMasterStats } from './taskmaster.service'

export interface ExportOptions {
  format: 'json' | 'csv' | 'markdown' | 'txt'
  includeTimestamp?: boolean
  includeMetadata?: boolean
  compactOutput?: boolean
  timeRange?: {
    start: Date
    end: Date
  }
}

export interface ExportResult {
  data: string
  filename: string
  size: number
  format: string
  generatedAt: Date
}

export interface ReportTemplate {
  name: string
  description: string
  sections: string[]
  format: 'json' | 'csv' | 'markdown' | 'txt'
}

const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    name: 'executive-summary',
    description: 'High-level executive summary with key metrics',
    sections: ['overview', 'progress', 'risks', 'recommendations'],
    format: 'markdown'
  },
  {
    name: 'technical-detail',
    description: 'Detailed technical analysis for team leads',
    sections: ['complexity', 'bottlenecks', 'trends', 'tasks'],
    format: 'json'
  },
  {
    name: 'weekly-report',
    description: 'Weekly progress report for stakeholders',
    sections: ['progress', 'productivity', 'upcoming'],
    format: 'markdown'
  },
  {
    name: 'data-export',
    description: 'Complete data export for external analysis',
    sections: ['all'],
    format: 'csv'
  }
]

/**
 * Analytics Export Service
 * Handles data export, report generation, and file formatting
 */
export class AnalyticsExportService {
  /**
   * Export analytics data in specified format
   */
  static exportAnalytics(
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions = { format: 'json' }
  ): ExportResult {
    const timestamp = new Date()
    const baseFilename = `taskmaster-analytics-${timestamp.toISOString().split('T')[0]}`
    
    let data: string
    let filename: string

    switch (options.format) {
      case 'json':
        data = this.exportToJSON(complexityReport, analyticsData, historicalData, options)
        filename = `${baseFilename}.json`
        break
      
      case 'csv':
        data = this.exportToCSV(complexityReport, analyticsData, historicalData, options)
        filename = `${baseFilename}.csv`
        break
      
      case 'markdown':
        data = this.exportToMarkdown(complexityReport, analyticsData, historicalData, options)
        filename = `${baseFilename}.md`
        break
      
      case 'txt':
        data = this.exportToText(complexityReport, analyticsData, historicalData, options)
        filename = `${baseFilename}.txt`
        break
      
      default:
        throw new Error(`Unsupported export format: ${options.format}`)
    }

    return {
      data,
      filename,
      size: new Blob([data]).size,
      format: options.format,
      generatedAt: timestamp
    }
  }

  /**
   * Generate report using template
   */
  static generateReport(
    templateName: string,
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    customOptions?: Partial<ExportOptions>
  ): ExportResult {
    const template = REPORT_TEMPLATES.find(t => t.name === templateName)
    if (!template) {
      throw new Error(`Unknown report template: ${templateName}`)
    }

    const options: ExportOptions = {
      format: template.format,
      includeTimestamp: true,
      includeMetadata: true,
      compactOutput: false,
      ...customOptions
    }

    const timestamp = new Date()
    const filename = `${templateName}-report-${timestamp.toISOString().split('T')[0]}.${template.format}`

    let data: string

    switch (template.format) {
      case 'markdown':
        data = this.generateMarkdownReport(template, complexityReport, analyticsData, historicalData, options)
        break
      
      case 'json':
        data = this.generateJSONReport(template, complexityReport, analyticsData, historicalData, options)
        break
      
      case 'csv':
        data = this.exportToCSV(complexityReport, analyticsData, historicalData, options)
        break
      
      default:
        data = this.exportToText(complexityReport, analyticsData, historicalData, options)
    }

    return {
      data,
      filename,
      size: new Blob([data]).size,
      format: template.format,
      generatedAt: timestamp
    }
  }

  /**
   * Get available report templates
   */
  static getReportTemplates(): ReportTemplate[] {
    return [...REPORT_TEMPLATES]
  }

  /**
   * Export to JSON format
   */
  private static exportToJSON(
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions
  ): string {
    const exportObject: any = {}

    if (options.includeMetadata) {
      exportObject.metadata = {
        exportedAt: new Date().toISOString(),
        format: 'json',
        version: '1.0',
        dataPoints: {
          complexityTasks: complexityReport?.tasks.length || 0,
          historicalPoints: historicalData.length,
          bottlenecks: analyticsData?.bottlenecks.length || 0
        }
      }
    }

    if (complexityReport) {
      exportObject.complexityReport = complexityReport
    }

    if (analyticsData) {
      exportObject.analyticsData = analyticsData
    }

    if (historicalData.length > 0) {
      let filteredHistorical = historicalData
      
      if (options.timeRange) {
        filteredHistorical = historicalData.filter(point => {
          const pointDate = new Date(point.timestamp)
          return pointDate >= options.timeRange!.start && pointDate <= options.timeRange!.end
        })
      }
      
      exportObject.historicalData = filteredHistorical
    }

    return JSON.stringify(exportObject, null, options.compactOutput ? 0 : 2)
  }

  /**
   * Export to CSV format
   */
  private static exportToCSV(
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions
  ): string {
    const sections: string[] = []

    // Complexity Report CSV
    if (complexityReport && complexityReport.tasks.length > 0) {
      sections.push('# Complexity Report')
      sections.push('Task ID,Title,Complexity,Risk Level,Estimated Hours,Recommendations')
      
      complexityReport.tasks.forEach(task => {
        const recommendations = (task.recommendations || []).join('; ')
        sections.push([
          task.id,
          `"${task.title.replace(/"/g, '""')}"`,
          task.complexity,
          task.riskLevel || 'unknown',
          task.estimatedHours || 0,
          `"${recommendations.replace(/"/g, '""')}"`
        ].join(','))
      })
      sections.push('')
    }

    // Analytics Summary CSV
    if (analyticsData) {
      sections.push('# Analytics Summary')
      sections.push('Metric,Value')
      sections.push(`Tasks Per Day,${analyticsData.productivityMetrics.tasksPerDay}`)
      sections.push(`Average Completion Time,${analyticsData.productivityMetrics.averageCompletionTime}`)
      sections.push(`Burndown Rate,${analyticsData.productivityMetrics.burndownRate}`)
      sections.push(`High Priority Tasks,${analyticsData.productivityMetrics.workloadDistribution.high}`)
      sections.push(`Medium Priority Tasks,${analyticsData.productivityMetrics.workloadDistribution.medium}`)
      sections.push(`Low Priority Tasks,${analyticsData.productivityMetrics.workloadDistribution.low}`)
      sections.push(`Total Bottlenecks,${analyticsData.bottlenecks.length}`)
      sections.push('')

      // Bottlenecks CSV
      if (analyticsData.bottlenecks.length > 0) {
        sections.push('# Bottlenecks')
        sections.push('Task ID,Title,Blocked Tasks Count,Days Blocked,Impact')
        
        analyticsData.bottlenecks.forEach(bottleneck => {
          sections.push([
            bottleneck.taskId,
            `"${bottleneck.title.replace(/"/g, '""')}"`,
            bottleneck.blockedTasks.length,
            bottleneck.daysBlocked,
            bottleneck.impact
          ].join(','))
        })
        sections.push('')
      }
    }

    // Historical Trends CSV
    if (historicalData.length > 0) {
      sections.push('# Historical Trends')
      sections.push('Timestamp,Total Tasks,Completed Tasks,Progress Percentage,Average Complexity')
      
      historicalData.forEach(point => {
        const avgComplexity = point.complexityReport?.averageComplexity || 0
        sections.push([
          point.timestamp,
          point.stats.totalTasks,
          point.stats.completedTasks,
          point.stats.progressPercentage,
          avgComplexity.toFixed(2)
        ].join(','))
      })
    }

    return sections.join('\n')
  }

  /**
   * Export to Markdown format
   */
  private static exportToMarkdown(
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions
  ): string {
    const sections: string[] = []

    // Header
    sections.push('# TaskMaster Analytics Report')
    
    if (options.includeTimestamp) {
      sections.push(`*Generated on: ${new Date().toLocaleString()}*`)
    }
    
    sections.push('')

    // Executive Summary
    sections.push('## Executive Summary')
    
    if (complexityReport) {
      sections.push(`- **Average Complexity:** ${complexityReport.averageComplexity.toFixed(1)}/10`)
      sections.push(`- **High-Risk Tasks:** ${complexityReport.highComplexityTasks.length}`)
      sections.push(`- **Total Estimated Hours:** ${complexityReport.totalEstimatedHours}`)
    }
    
    if (analyticsData) {
      sections.push(`- **Daily Productivity:** ${analyticsData.productivityMetrics.tasksPerDay.toFixed(1)} tasks/day`)
      sections.push(`- **Burndown Rate:** ${analyticsData.productivityMetrics.burndownRate.toFixed(1)}%`)
      sections.push(`- **Active Bottlenecks:** ${analyticsData.bottlenecks.length}`)
    }
    
    sections.push('')

    // Complexity Analysis
    if (complexityReport) {
      sections.push('## Complexity Analysis')
      sections.push('')
      
      sections.push('### Distribution')
      sections.push(`- **Low (1-3):** ${complexityReport.complexityDistribution.low} tasks`)
      sections.push(`- **Medium (4-7):** ${complexityReport.complexityDistribution.medium} tasks`)
      sections.push(`- **High (8-10):** ${complexityReport.complexityDistribution.high} tasks`)
      sections.push('')

      // High complexity tasks
      if (complexityReport.tasks.length > 0) {
        sections.push('### Most Complex Tasks')
        sections.push('')
        sections.push('| Task | Complexity | Risk | Hours |')
        sections.push('|------|------------|------|-------|')
        
        complexityReport.tasks
          .sort((a, b) => b.complexity - a.complexity)
          .slice(0, 10)
          .forEach(task => {
            sections.push(`| ${task.title.slice(0, 30)} | ${task.complexity} | ${task.riskLevel || 'N/A'} | ${task.estimatedHours || 'N/A'} |`)
          })
        
        sections.push('')
      }
    }

    // Bottlenecks
    if (analyticsData && analyticsData.bottlenecks.length > 0) {
      sections.push('## Workflow Bottlenecks')
      sections.push('')
      
      analyticsData.bottlenecks.slice(0, 5).forEach((bottleneck, index) => {
        sections.push(`### ${index + 1}. ${bottleneck.title}`)
        sections.push(`- **Impact:** ${bottleneck.impact.toUpperCase()}`)
        sections.push(`- **Blocked Tasks:** ${bottleneck.blockedTasks.length}`)
        sections.push(`- **Days Blocked:** ${bottleneck.daysBlocked}`)
        sections.push('')
      })
    }

    // Productivity Metrics
    if (analyticsData) {
      sections.push('## Productivity Metrics')
      sections.push('')
      
      sections.push('### Workload Distribution')
      const workload = analyticsData.productivityMetrics.workloadDistribution
      sections.push(`- **High Priority:** ${workload.high} tasks`)
      sections.push(`- **Medium Priority:** ${workload.medium} tasks`)
      sections.push(`- **Low Priority:** ${workload.low} tasks`)
      sections.push('')
      
      sections.push('### Performance Indicators')
      sections.push(`- **Tasks per Day:** ${analyticsData.productivityMetrics.tasksPerDay.toFixed(1)}`)
      sections.push(`- **Average Completion Time:** ${analyticsData.productivityMetrics.averageCompletionTime.toFixed(1)} hours`)
      sections.push(`- **Burndown Rate:** ${analyticsData.productivityMetrics.burndownRate.toFixed(1)}%`)
      sections.push('')
    }

    // Recommendations
    sections.push('## Recommendations')
    sections.push('')
    
    if (complexityReport && complexityReport.highComplexityTasks.length > 0) {
      sections.push('- **High Complexity Tasks:** Consider breaking down complex tasks into smaller, manageable subtasks')
    }
    
    if (analyticsData && analyticsData.bottlenecks.length > 0) {
      sections.push('- **Bottlenecks:** Address blocking tasks to improve overall workflow velocity')
    }
    
    if (analyticsData && analyticsData.productivityMetrics.tasksPerDay < 1) {
      sections.push('- **Low Productivity:** Review processes and identify improvement opportunities')
    }
    
    sections.push('')

    return sections.join('\n')
  }

  /**
   * Export to plain text format
   */
  private static exportToText(
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions
  ): string {
    const sections: string[] = []

    sections.push('TASKMASTER ANALYTICS REPORT')
    sections.push('=' .repeat(50))
    
    if (options.includeTimestamp) {
      sections.push(`Generated: ${new Date().toLocaleString()}`)
    }
    
    sections.push('')

    if (complexityReport) {
      sections.push('COMPLEXITY ANALYSIS')
      sections.push('-'.repeat(30))
      sections.push(`Average Complexity: ${complexityReport.averageComplexity.toFixed(1)}/10`)
      sections.push(`High-Risk Tasks: ${complexityReport.highComplexityTasks.length}`)
      sections.push(`Total Estimated Hours: ${complexityReport.totalEstimatedHours}`)
      sections.push('')
      
      sections.push('Distribution:')
      sections.push(`  Low (1-3):    ${complexityReport.complexityDistribution.low} tasks`)
      sections.push(`  Medium (4-7): ${complexityReport.complexityDistribution.medium} tasks`)
      sections.push(`  High (8-10):  ${complexityReport.complexityDistribution.high} tasks`)
      sections.push('')
    }

    if (analyticsData) {
      sections.push('PRODUCTIVITY METRICS')
      sections.push('-'.repeat(30))
      sections.push(`Tasks per Day: ${analyticsData.productivityMetrics.tasksPerDay.toFixed(1)}`)
      sections.push(`Burndown Rate: ${analyticsData.productivityMetrics.burndownRate.toFixed(1)}%`)
      sections.push(`Active Bottlenecks: ${analyticsData.bottlenecks.length}`)
      sections.push('')
      
      if (analyticsData.bottlenecks.length > 0) {
        sections.push('TOP BOTTLENECKS:')
        analyticsData.bottlenecks.slice(0, 5).forEach((bottleneck, index) => {
          sections.push(`  ${index + 1}. ${bottleneck.title} (${bottleneck.impact} impact, ${bottleneck.blockedTasks.length} blocked)`)
        })
        sections.push('')
      }
    }

    return sections.join('\n')
  }

  /**
   * Generate Markdown report using template
   */
  private static generateMarkdownReport(
    template: ReportTemplate,
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions
  ): string {
    // For now, use the standard markdown export
    // In a full implementation, this would customize based on template sections
    return this.exportToMarkdown(complexityReport, analyticsData, historicalData, options)
  }

  /**
   * Generate JSON report using template
   */
  private static generateJSONReport(
    template: ReportTemplate,
    complexityReport: TaskMasterComplexityReport | null,
    analyticsData: TaskMasterAnalyticsData | null,
    historicalData: TaskMasterHistoricalData[],
    options: ExportOptions
  ): string {
    // For now, use the standard JSON export
    // In a full implementation, this would filter based on template sections
    return this.exportToJSON(complexityReport, analyticsData, historicalData, options)
  }
}

export default AnalyticsExportService