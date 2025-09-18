import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'

const execAsync = promisify(exec)

export interface CLIDiagnosticResult {
  available: boolean
  version?: string
  path?: string
  permissions?: string
  lastChecked: number
  diagnostics: {
    pathExists: boolean
    executable: boolean
    permissions: {
      read: boolean
      execute: boolean
    }
    environmentPath: string[]
    commonInstallLocations: Array<{
      path: string
      exists: boolean
      executable?: boolean
    }>
    systemInfo: {
      platform: string
      arch: string
      nodeVersion: string
      workingDirectory: string
    }
    networkConnectivity?: boolean
    diskSpace?: {
      available: number
      total: number
    }
  }
  issues: Array<{
    type: 'error' | 'warning' | 'info'
    code: string
    message: string
    suggestion?: string
    autoFixable?: boolean
  }>
  installSuggestions: string[]
}

export interface CLIHealthStatus {
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  score: number // 0-100
  lastHealthCheck: number
  healthHistory: Array<{
    timestamp: number
    status: 'healthy' | 'degraded' | 'unavailable'
    responseTime: number
    issues: string[]
  }>
}

/**
 * Comprehensive CLI diagnostics and health monitoring service
 * 
 * Features:
 * - Deep CLI availability detection
 * - System environment analysis
 * - Permission and path diagnostics
 * - Installation suggestions
 * - Health monitoring and scoring
 * - Auto-fix capabilities for common issues
 */
export class CLIDiagnosticsService extends EventEmitter {
  private healthStatus: CLIHealthStatus = {
    status: 'unknown',
    score: 0,
    lastHealthCheck: 0,
    healthHistory: []
  }

  private readonly commonInstallPaths = [
    '/usr/local/bin/task-master',
    '/usr/bin/task-master',
    '/opt/taskmaster/bin/task-master',
    '~/.local/bin/task-master',
    '~/bin/task-master',
    // Windows paths
    'C:\\Program Files\\TaskMaster\\task-master.exe',
    'C:\\Program Files (x86)\\TaskMaster\\task-master.exe',
    '%USERPROFILE%\\AppData\\Local\\TaskMaster\\task-master.exe',
    // macOS paths
    '/Applications/TaskMaster.app/Contents/MacOS/task-master',
    '/usr/local/Cellar/taskmaster/*/bin/task-master'
  ]

  /**
   * Perform comprehensive CLI diagnostics
   */
  async performDiagnostics(cliCommand = 'task-master'): Promise<CLIDiagnosticResult> {
    const startTime = Date.now()
    
    const result: CLIDiagnosticResult = {
      available: false,
      lastChecked: startTime,
      diagnostics: {
        pathExists: false,
        executable: false,
        permissions: {
          read: false,
          execute: false
        },
        environmentPath: (process.env.PATH || '').split(path.delimiter),
        commonInstallLocations: [],
        systemInfo: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          workingDirectory: process.cwd()
        }
      },
      issues: [],
      installSuggestions: []
    }

    try {
      // Check if CLI is in PATH
      const pathResult = await this.checkCLIInPath(cliCommand)
      result.diagnostics.pathExists = pathResult.exists
      result.path = pathResult.path
      
      if (pathResult.exists && pathResult.path) {
        // Check permissions and executability
        const permResult = await this.checkFilePermissions(pathResult.path)
        result.permissions = permResult.permissions
        result.diagnostics.executable = permResult.executable
        result.diagnostics.permissions = permResult.detailed
        
        // Try to get version if executable
        if (permResult.executable) {
          try {
            const versionResult = await this.getCLIVersion(cliCommand)
            result.version = versionResult.version
            result.available = versionResult.success
          } catch (error) {
            result.issues.push({
              type: 'error',
              code: 'VERSION_CHECK_FAILED',
              message: `CLI found but version check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              suggestion: 'The CLI may be corrupted or incompatible'
            })
          }
        } else {
          result.issues.push({
            type: 'error',
            code: 'NOT_EXECUTABLE',
            message: 'CLI found but not executable',
            suggestion: `Run: chmod +x ${pathResult.path}`,
            autoFixable: true
          })
        }
      } else {
        // CLI not in PATH, check common install locations
        result.diagnostics.commonInstallLocations = await this.checkCommonInstallLocations()
        
        const foundInstallations = result.diagnostics.commonInstallLocations.filter(loc => loc.exists)
        
        if (foundInstallations.length > 0) {
          result.issues.push({
            type: 'warning',
            code: 'CLI_NOT_IN_PATH',
            message: `CLI found at ${foundInstallations[0].path} but not in PATH`,
            suggestion: `Add to PATH or create symlink: ln -s ${foundInstallations[0].path} /usr/local/bin/task-master`,
            autoFixable: true
          })
        } else {
          result.issues.push({
            type: 'error',
            code: 'CLI_NOT_FOUND',
            message: 'TaskMaster CLI not found anywhere on the system',
            suggestion: 'Install TaskMaster CLI'
          })
          
          result.installSuggestions = this.generateInstallSuggestions()
        }
      }

      // Additional diagnostics
      await this.performAdditionalDiagnostics(result)
      
      // Calculate health score
      this.updateHealthStatus(result, Date.now() - startTime)
      
      this.emit('diagnosticsCompleted', result)
      
    } catch (error) {
      result.issues.push({
        type: 'error',
        code: 'DIAGNOSTICS_FAILED',
        message: `Diagnostics failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
      
      this.emit('diagnosticsError', error)
    }

    return result
  }

  /**
   * Perform a quick health check
   */
  async performHealthCheck(cliCommand = 'task-master'): Promise<CLIHealthStatus> {
    const startTime = Date.now()
    
    try {
      // Quick availability check
      const versionResult = await this.getCLIVersion(cliCommand, 5000) // 5 second timeout
      const responseTime = Date.now() - startTime
      
      const healthEntry = {
        timestamp: Date.now(),
        status: versionResult.success ? 'healthy' as const : 'degraded' as const,
        responseTime,
        issues: versionResult.success ? [] : ['Version check failed']
      }
      
      this.healthStatus.healthHistory.push(healthEntry)
      
      // Keep only last 20 entries
      if (this.healthStatus.healthHistory.length > 20) {
        this.healthStatus.healthHistory = this.healthStatus.healthHistory.slice(-20)
      }
      
      // Calculate health score based on recent history
      this.calculateHealthScore()
      
      this.healthStatus.lastHealthCheck = Date.now()
      this.emit('healthCheckCompleted', this.healthStatus)
      
    } catch (error) {
      const healthEntry = {
        timestamp: Date.now(),
        status: 'unavailable' as const,
        responseTime: Date.now() - startTime,
        issues: [error instanceof Error ? error.message : 'Unknown error']
      }
      
      this.healthStatus.healthHistory.push(healthEntry)
      this.healthStatus.status = 'unavailable'
      this.healthStatus.score = 0
      this.healthStatus.lastHealthCheck = Date.now()
      
      this.emit('healthCheckError', error)
    }

    return this.healthStatus
  }

  /**
   * Attempt to auto-fix common CLI issues
   */
  async attemptAutoFix(issue: { code: string; autoFixable?: boolean }): Promise<boolean> {
    if (!issue.autoFixable) {
      return false
    }

    try {
      switch (issue.code) {
        case 'NOT_EXECUTABLE':
          return await this.fixExecutablePermissions()
          
        case 'CLI_NOT_IN_PATH':
          return await this.addToPath()
          
        default:
          return false
      }
    } catch (error) {
      this.emit('autoFixError', issue, error)
      return false
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus(): CLIHealthStatus {
    return { ...this.healthStatus }
  }

  /**
   * Get installation recommendations based on platform
   */
  getInstallationRecommendations(): Array<{
    method: string
    description: string
    commands: string[]
    platform: string[]
  }> {
    const recommendations = []

    switch (process.platform) {
      case 'darwin':
        recommendations.push(
          {
            method: 'Homebrew',
            description: 'Install via Homebrew package manager',
            commands: ['brew install taskmaster'],
            platform: ['darwin']
          },
          {
            method: 'Manual Download',
            description: 'Download binary from GitHub releases',
            commands: [
              'curl -L https://github.com/taskmaster/releases/latest/download/taskmaster-darwin-amd64 -o /usr/local/bin/task-master',
              'chmod +x /usr/local/bin/task-master'
            ],
            platform: ['darwin']
          }
        )
        break

      case 'linux':
        recommendations.push(
          {
            method: 'Package Manager',
            description: 'Install via system package manager',
            commands: [
              'sudo apt-get install taskmaster',  // Debian/Ubuntu
              'sudo yum install taskmaster',      // RHEL/CentOS
              'sudo dnf install taskmaster'       // Fedora
            ],
            platform: ['linux']
          },
          {
            method: 'Manual Download',
            description: 'Download binary from GitHub releases',
            commands: [
              'curl -L https://github.com/taskmaster/releases/latest/download/taskmaster-linux-amd64 -o /usr/local/bin/task-master',
              'chmod +x /usr/local/bin/task-master'
            ],
            platform: ['linux']
          }
        )
        break

      case 'win32':
        recommendations.push(
          {
            method: 'Chocolatey',
            description: 'Install via Chocolatey package manager',
            commands: ['choco install taskmaster'],
            platform: ['win32']
          },
          {
            method: 'Manual Download',
            description: 'Download installer from GitHub releases',
            commands: [
              'Download: https://github.com/taskmaster/releases/latest/download/taskmaster-windows-amd64.exe',
              'Add to PATH environment variable'
            ],
            platform: ['win32']
          }
        )
        break
    }

    return recommendations
  }

  // Private implementation methods

  private async checkCLIInPath(command: string): Promise<{ exists: boolean; path?: string }> {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which'
      const { stdout } = await execAsync(`${which} ${command}`)
      const path = stdout.trim().split('\n')[0]
      
      return {
        exists: true,
        path: path
      }
    } catch {
      return { exists: false }
    }
  }

  private async checkFilePermissions(filePath: string): Promise<{
    permissions: string
    executable: boolean
    detailed: { read: boolean; execute: boolean }
  }> {
    try {
      const stats = fs.statSync(filePath)
      const mode = stats.mode
      const permissions = (mode & parseInt('777', 8)).toString(8)
      
      // Check if file is executable
      const executable = !!(mode & parseInt('111', 8))
      
      // Detailed permissions check
      const detailed = {
        read: !!(mode & parseInt('444', 8)),
        execute: executable
      }

      return {
        permissions,
        executable,
        detailed
      }
    } catch {
      return {
        permissions: 'unknown',
        executable: false,
        detailed: { read: false, execute: false }
      }
    }
  }

  private async getCLIVersion(
    command: string, 
    timeout = 10000
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let isTimedOut = false

      const timeoutId = setTimeout(() => {
        isTimedOut = true
        child.kill('SIGTERM')
        resolve({
          success: false,
          error: `Command timed out after ${timeout}ms`
        })
      }, timeout)

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (isTimedOut) return

        clearTimeout(timeoutId)

        if (code === 0) {
          const version = stdout.trim().match(/\d+\.\d+\.\d+/)?.[0]
          resolve({
            success: true,
            version: version || stdout.trim()
          })
        } else {
          resolve({
            success: false,
            error: stderr || stdout || `Command failed with exit code ${code}`
          })
        }
      })

      child.on('error', (error) => {
        if (isTimedOut) return

        clearTimeout(timeoutId)
        resolve({
          success: false,
          error: error.message
        })
      })
    })
  }

  private async checkCommonInstallLocations(): Promise<Array<{
    path: string
    exists: boolean
    executable?: boolean
  }>> {
    const results = []
    
    for (const installPath of this.commonInstallPaths) {
      try {
        // Expand environment variables
        const expandedPath = installPath
          .replace(/~/g, process.env.HOME || process.env.USERPROFILE || '')
          .replace(/%(\w+)%/g, (_, varName) => process.env[varName] || '')
        
        const exists = fs.existsSync(expandedPath)
        let executable = false
        
        if (exists) {
          const permResult = await this.checkFilePermissions(expandedPath)
          executable = permResult.executable
        }
        
        results.push({
          path: expandedPath,
          exists,
          executable
        })
      } catch {
        results.push({
          path: installPath,
          exists: false
        })
      }
    }
    
    return results
  }

  private async performAdditionalDiagnostics(result: CLIDiagnosticResult): Promise<void> {
    // Check network connectivity
    try {
      await execAsync('ping -c 1 google.com', { timeout: 5000 })
      result.diagnostics.networkConnectivity = true
    } catch {
      result.diagnostics.networkConnectivity = false
      result.issues.push({
        type: 'warning',
        code: 'NETWORK_UNAVAILABLE',
        message: 'Network connectivity appears to be limited',
        suggestion: 'Check internet connection for CLI updates and remote features'
      })
    }

    // Check disk space
    try {
      const { stdout } = await execAsync(`df ${process.cwd()}`)
      const lines = stdout.trim().split('\n')
      if (lines.length > 1) {
        const diskInfo = lines[1].split(/\s+/)
        const total = parseInt(diskInfo[1]) * 1024 // Convert from KB
        const available = parseInt(diskInfo[3]) * 1024 // Convert from KB
        
        result.diagnostics.diskSpace = { total, available }
        
        // Warn if less than 100MB available
        if (available < 100 * 1024 * 1024) {
          result.issues.push({
            type: 'warning',
            code: 'LOW_DISK_SPACE',
            message: `Low disk space: ${Math.round(available / 1024 / 1024)}MB available`,
            suggestion: 'Free up disk space for optimal CLI performance'
          })
        }
      }
    } catch {
      // Disk space check failed, not critical
    }
  }

  private updateHealthStatus(diagnostics: CLIDiagnosticResult, responseTime: number): void {
    const healthEntry = {
      timestamp: Date.now(),
      status: diagnostics.available ? 'healthy' as const : 'unavailable' as const,
      responseTime,
      issues: diagnostics.issues.map(issue => issue.message)
    }
    
    this.healthStatus.healthHistory.push(healthEntry)
    this.healthStatus.status = healthEntry.status
    this.healthStatus.lastHealthCheck = Date.now()
    
    this.calculateHealthScore()
  }

  private calculateHealthScore(): void {
    if (this.healthStatus.healthHistory.length === 0) {
      this.healthStatus.score = 0
      return
    }

    const recentHistory = this.healthStatus.healthHistory.slice(-10) // Last 10 checks
    let totalScore = 0

    for (const entry of recentHistory) {
      let entryScore = 0
      
      switch (entry.status) {
        case 'healthy':
          entryScore = 100
          break
        case 'degraded':
          entryScore = 60
          break
        case 'unavailable':
          entryScore = 0
          break
      }
      
      // Adjust for response time (penalty for slow responses)
      if (entry.responseTime > 5000) {
        entryScore = Math.max(0, entryScore - 20)
      } else if (entry.responseTime > 2000) {
        entryScore = Math.max(0, entryScore - 10)
      }
      
      totalScore += entryScore
    }

    this.healthStatus.score = Math.round(totalScore / recentHistory.length)
  }

  private generateInstallSuggestions(): string[] {
    const suggestions = []
    
    switch (process.platform) {
      case 'darwin':
        suggestions.push(
          'Install via Homebrew: brew install taskmaster',
          'Download from: https://github.com/taskmaster/releases/latest',
          'Build from source: git clone https://github.com/taskmaster/taskmaster.git'
        )
        break
        
      case 'linux':
        suggestions.push(
          'Install via package manager: sudo apt-get install taskmaster',
          'Download from: https://github.com/taskmaster/releases/latest',
          'Build from source: git clone https://github.com/taskmaster/taskmaster.git'
        )
        break
        
      case 'win32':
        suggestions.push(
          'Install via Chocolatey: choco install taskmaster',
          'Download installer: https://github.com/taskmaster/releases/latest',
          'Use Windows Subsystem for Linux (WSL)'
        )
        break
        
      default:
        suggestions.push(
          'Download from: https://github.com/taskmaster/releases/latest',
          'Build from source: git clone https://github.com/taskmaster/taskmaster.git'
        )
    }
    
    return suggestions
  }

  private async fixExecutablePermissions(): Promise<boolean> {
    // This would implement automatic permission fixing
    // For security reasons, this should be limited and require user confirmation
    return false
  }

  private async addToPath(): Promise<boolean> {
    // This would implement automatic PATH modification
    // For security reasons, this should be limited and require user confirmation
    return false
  }
}

// Export default instance
export const cliDiagnostics = new CLIDiagnosticsService()