import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

export interface EpicMetadata {
  name: string
  displayName: string
  path: string
  status: string
  description?: string
  createdAt?: string
  finalizedAt?: string
  lastActivity?: string
  isValid: boolean
  errors: string[]
  hasWorkflowState: boolean
  hasManifest: boolean
  hasLogs: boolean
  taskCount?: number
  progress?: {
    currentStep: number
    totalSteps: number
    completedSteps: number[]
    percentage: number
  }
}

export interface EpicManifest {
  epic: {
    name: string
    originalWorkingName?: string
    status: string
    createdAt?: string
    finalizedAt?: string
    planningSummary?: {
      problemStatement: string
      solutionApproach: string
      keyDecisions: string[]
      risksMitigated: string[]
    }
  }
  artifacts?: Array<{
    id: string
    path: string
    type: string
    description: string
    essential?: boolean
  }>
  validation?: {
    criticalConcerns?: string
    alternativesConsidered?: string[]
    userConfirmation?: string
    risksAccepted?: string[]
  }
}

export interface WorkflowState {
  epic_name: string
  current_step: number
  completed_steps: number[]
  workflow_config?: {
    no_stop: boolean
    max_subagents: number
    use_research: boolean
  }
  agents?: {
    required: string[]
    created: string[]
    available: string[]
  }
  artifacts?: {
    original_doc: string
    prd: string
    tasks_file: string
    complexity_report: string
  }
  tag_name?: string
  timestamp: string
}

export class EpicDiscoveryService {
  private static readonly WORKFLOW_STEPS = [
    'Document Validation',
    'Epic Analysis & Setup',
    'Tag Creation & Switching',
    'PRD Generation',
    'Agent Analysis & Creation',
    'Research Decision',
    'Parse PRD to Tasks',
    'Complexity Analysis',
    'Multi-Agent Review',
    'Final Verification',
  ]

  private cache: Map<string, EpicMetadata> = new Map()
  private lastScanTime: number = 0
  private readonly CACHE_TTL = 30000 // 30 seconds

  constructor(private epicRootPaths: string[] = []) {
    // Default epic discovery paths
    if (this.epicRootPaths.length === 0) {
      this.epicRootPaths = [
        './agent/epics',
        '../agent/epics',
        '../../agent/epics',
        './sandbox/agent/epics'
      ]
    }
  }

  /**
   * Discover all available epics across configured paths
   */
  async discoverEpics(forceRefresh: boolean = false): Promise<EpicMetadata[]> {
    const now = Date.now()
    
    if (!forceRefresh && (now - this.lastScanTime) < this.CACHE_TTL && this.cache.size > 0) {
      return Array.from(this.cache.values())
    }

    this.cache.clear()
    const allEpics: EpicMetadata[] = []

    for (const rootPath of this.epicRootPaths) {
      try {
        const resolvedPath = resolve(rootPath)
        if (!existsSync(resolvedPath)) continue

        const epics = await this.scanEpicDirectory(resolvedPath)
        allEpics.push(...epics)
      } catch (error) {
        console.warn(`Failed to scan epic directory ${rootPath}:`, error)
      }
    }

    // Update cache
    for (const epic of allEpics) {
      this.cache.set(epic.path, epic)
    }
    
    this.lastScanTime = now
    return allEpics
  }

  /**
   * Get specific epic metadata by path or name
   */
  async getEpic(pathOrName: string): Promise<EpicMetadata | null> {
    const epics = await this.discoverEpics()
    
    // Try exact path match first
    let epic = epics.find(e => e.path === pathOrName || e.path === resolve(pathOrName))
    
    if (!epic) {
      // Try name match
      epic = epics.find(e => e.name === pathOrName)
    }

    if (!epic) {
      // Check if pathOrName is a direct path to an epic directory (outside our search paths)
      try {
        const resolvedPath = resolve(pathOrName)
        if (existsSync(resolvedPath)) {
          const stat = statSync(resolvedPath)
          if (stat.isDirectory()) {
            // Validate this as an epic directory
            epic = await this.validateEpic(resolvedPath)
            if (epic.isValid) {
              // Add to cache for future lookups
              this.cache.set(epic.path, epic)
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to validate direct epic path ${pathOrName}:`, error)
      }
    }

    return epic || null
  }

  /**
   * Validate an epic directory and extract metadata
   */
  async validateEpic(epicPath: string): Promise<EpicMetadata> {
    const resolvedPath = resolve(epicPath)
    const epicName = epicPath.split('/').pop() || 'unknown'
    
    const metadata: EpicMetadata = {
      name: epicName,
      displayName: epicName,
      path: resolvedPath,
      status: 'unknown',
      isValid: false,
      errors: [],
      hasWorkflowState: false,
      hasManifest: false,
      hasLogs: false
    }

    try {
      // Check if directory exists
      if (!existsSync(resolvedPath)) {
        metadata.errors.push('Directory does not exist')
        return metadata
      }

      const stat = statSync(resolvedPath)
      if (!stat.isDirectory()) {
        metadata.errors.push('Path is not a directory')
        return metadata
      }

      // Check for required files
      const workflowStatePath = join(resolvedPath, 'workflow-state.json')
      const manifestPath = join(resolvedPath, 'manifest.json')
      const logsPath = join(resolvedPath, 'workflow.log')

      metadata.hasWorkflowState = existsSync(workflowStatePath)
      metadata.hasManifest = existsSync(manifestPath)
      metadata.hasLogs = existsSync(logsPath)

      // Load and validate manifest if present
      if (metadata.hasManifest) {
        try {
          const manifestContent = readFileSync(manifestPath, 'utf-8')
          const manifest: EpicManifest = JSON.parse(manifestContent)
          
          metadata.displayName = manifest.epic.name || metadata.name
          metadata.status = manifest.epic.status || 'unknown'
          metadata.description = manifest.epic.planningSummary?.problemStatement
          metadata.createdAt = manifest.epic.createdAt
          metadata.finalizedAt = manifest.epic.finalizedAt
        } catch (error) {
          metadata.errors.push(`Invalid manifest.json: ${error}`)
        }
      }

      // Load and validate workflow state if present
      if (metadata.hasWorkflowState) {
        try {
          const stateContent = readFileSync(workflowStatePath, 'utf-8')
          const workflowState: WorkflowState = JSON.parse(stateContent)
          
          // Extract progress information
          metadata.progress = {
            currentStep: workflowState.current_step || 0,
            totalSteps: EpicDiscoveryService.WORKFLOW_STEPS.length,
            completedSteps: workflowState.completed_steps || [],
            percentage: Math.round(((workflowState.completed_steps?.length || 0) / EpicDiscoveryService.WORKFLOW_STEPS.length) * 100)
          }

          metadata.lastActivity = workflowState.timestamp
        } catch (error) {
          metadata.errors.push(`Invalid workflow-state.json: ${error}`)
        }
      }

      // Get last activity from logs if available and workflow state doesn't have it
      if (metadata.hasLogs && !metadata.lastActivity) {
        try {
          const logsContent = readFileSync(logsPath, 'utf-8')
          const lines = logsContent.split('\n').filter(l => l.trim())
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1]
            const timestampMatch = lastLine.match(/^\[(.*?)\]/)
            if (timestampMatch) {
              metadata.lastActivity = timestampMatch[1]
            }
          }
        } catch (error) {
          // Silent fail for logs
        }
      }

      // Determine if epic is valid
      metadata.isValid = metadata.hasWorkflowState || metadata.hasManifest
      
      if (!metadata.isValid) {
        metadata.errors.push('Epic must have either workflow-state.json or manifest.json')
      }

    } catch (error) {
      metadata.errors.push(`Failed to validate epic: ${error}`)
    }

    return metadata
  }

  /**
   * Scan a directory for epic subdirectories
   */
  private async scanEpicDirectory(directoryPath: string): Promise<EpicMetadata[]> {
    const epics: EpicMetadata[] = []
    
    try {
      const entries = readdirSync(directoryPath)
      
      for (const entry of entries) {
        const entryPath = join(directoryPath, entry)
        
        try {
          const stat = statSync(entryPath)
          if (stat.isDirectory()) {
            // Check if this looks like an epic directory
            const hasEpicFiles = existsSync(join(entryPath, 'workflow-state.json')) ||
                                existsSync(join(entryPath, 'manifest.json'))
            
            if (hasEpicFiles) {
              const epicMetadata = await this.validateEpic(entryPath)
              epics.push(epicMetadata)
            }
          }
        } catch (error) {
          // Skip invalid entries
          continue
        }
      }
    } catch (error) {
      throw new Error(`Failed to read directory ${directoryPath}: ${error}`)
    }

    return epics
  }

  /**
   * Clear the discovery cache
   */
  clearCache(): void {
    this.cache.clear()
    this.lastScanTime = 0
  }

  /**
   * Add additional epic root paths for discovery
   */
  addEpicRootPath(path: string): void {
    if (!this.epicRootPaths.includes(path)) {
      this.epicRootPaths.push(path)
      this.clearCache() // Force refresh on next discovery
    }
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      lastScanTime: this.lastScanTime,
      rootPaths: this.epicRootPaths,
      cacheAge: Date.now() - this.lastScanTime
    }
  }
}

export default EpicDiscoveryService