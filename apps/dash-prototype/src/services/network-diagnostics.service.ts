import { promisify } from 'util'
import { exec } from 'child_process'
import * as dns from 'dns'
import { EventEmitter } from 'events'
import { errorHandler, ErrorType } from './error-handler.service'

const execAsync = promisify(exec)
const resolve4 = promisify(dns.resolve4)
const resolveTxt = promisify(dns.resolveTxt)

export interface NetworkDiagnosticConfig {
  enablePingTests?: boolean
  enableDNSTests?: boolean
  enablePortScanning?: boolean
  pingTimeout?: number
  dnsTimeout?: number
  testHosts?: string[]
  criticalServices?: ServiceEndpoint[]
}

export interface ServiceEndpoint {
  name: string
  host: string
  port: number
  protocol: 'tcp' | 'udp' | 'http' | 'https'
  timeout?: number
  critical?: boolean
}

export interface NetworkConnectivityResult {
  overall: 'connected' | 'limited' | 'disconnected'
  timestamp: number
  tests: {
    ping: PingTestResult[]
    dns: DNSTestResult[]
    services: ServiceTestResult[]
  }
  networkInfo: {
    publicIP?: string
    localIPs: string[]
    gateway?: string
    dnsServers: string[]
  }
  recommendations: string[]
  issues: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical'
    category: 'connectivity' | 'dns' | 'services' | 'configuration'
    message: string
    solution?: string
  }>
}

export interface PingTestResult {
  host: string
  success: boolean
  responseTime?: number
  packetLoss?: number
  error?: string
}

export interface DNSTestResult {
  query: string
  type: 'A' | 'TXT' | 'MX' | 'NS'
  success: boolean
  result?: string[]
  responseTime?: number
  error?: string
}

export interface ServiceTestResult {
  service: ServiceEndpoint
  success: boolean
  responseTime?: number
  statusCode?: number
  error?: string
}

export interface PermissionDiagnosticResult {
  process: {
    uid: number
    gid: number
    groups: number[]
    platform: string
  }
  filesystem: {
    workingDirectory: {
      path: string
      readable: boolean
      writable: boolean
      executable: boolean
    }
    homeDirectory: {
      path: string
      accessible: boolean
    }
    tempDirectory: {
      path: string
      writable: boolean
    }
  }
  system: {
    canExecuteCommands: boolean
    canAccessNetwork: boolean
    hasElevatedPrivileges: boolean
  }
  issues: Array<{
    type: 'permission' | 'access' | 'security'
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    recommendation: string
    autoFixable?: boolean
  }>
}

/**
 * Comprehensive network and permission diagnostics service
 * 
 * Features:
 * - Network connectivity testing (ping, DNS, port checks)
 * - Service endpoint availability testing
 * - Permission and access rights validation
 * - System privilege detection
 * - Automatic issue detection and recommendations
 * - Performance monitoring
 * - Offline detection and handling
 */
export class NetworkDiagnosticsService extends EventEmitter {
  private config: Required<NetworkDiagnosticConfig>
  private lastNetworkCheck: NetworkConnectivityResult | null = null
  private lastPermissionCheck: PermissionDiagnosticResult | null = null

  private readonly defaultConfig: Required<NetworkDiagnosticConfig> = {
    enablePingTests: true,
    enableDNSTests: true,
    enablePortScanning: false, // Disabled by default for security
    pingTimeout: 5000,
    dnsTimeout: 3000,
    testHosts: ['8.8.8.8', 'google.com', 'github.com'],
    criticalServices: [
      {
        name: 'GitHub API',
        host: 'api.github.com',
        port: 443,
        protocol: 'https',
        timeout: 5000,
        critical: true
      },
      {
        name: 'NPM Registry',
        host: 'registry.npmjs.org',
        port: 443,
        protocol: 'https',
        timeout: 5000,
        critical: false
      }
    ]
  }

  constructor(config: Partial<NetworkDiagnosticConfig> = {}) {
    super()
    this.config = { ...this.defaultConfig, ...config }
  }

  /**
   * Perform comprehensive network connectivity diagnostics
   */
  async performNetworkDiagnostics(): Promise<NetworkConnectivityResult> {
    const startTime = Date.now()
    
    const result: NetworkConnectivityResult = {
      overall: 'disconnected',
      timestamp: startTime,
      tests: {
        ping: [],
        dns: [],
        services: []
      },
      networkInfo: {
        localIPs: [],
        dnsServers: []
      },
      recommendations: [],
      issues: []
    }

    try {
      // Get network information
      result.networkInfo = await this.getNetworkInfo()

      // Perform ping tests
      if (this.config.enablePingTests) {
        result.tests.ping = await this.performPingTests()
      }

      // Perform DNS tests
      if (this.config.enableDNSTests) {
        result.tests.dns = await this.performDNSTests()
      }

      // Test critical services
      result.tests.services = await this.testServiceEndpoints()

      // Analyze results and determine overall connectivity
      result.overall = this.analyzeConnectivity(result)
      
      // Generate recommendations and identify issues
      this.analyzeIssuesAndRecommendations(result)

      this.lastNetworkCheck = result
      this.emit('networkDiagnosticsCompleted', result)

    } catch (error) {
      const taskMasterError = errorHandler.createError(error, {
        component: 'NetworkDiagnostics',
        operation: 'performDiagnostics'
      })

      result.issues.push({
        severity: 'critical',
        category: 'connectivity',
        message: `Network diagnostics failed: ${taskMasterError.userFriendlyMessage}`,
        solution: 'Check system network configuration and permissions'
      })

      this.emit('networkDiagnosticsError', taskMasterError)
    }

    return result
  }

  /**
   * Perform comprehensive permission diagnostics
   */
  async performPermissionDiagnostics(): Promise<PermissionDiagnosticResult> {
    const result: PermissionDiagnosticResult = {
      process: {
        uid: process.getuid ? process.getuid() : -1,
        gid: process.getgid ? process.getgid() : -1,
        groups: process.getgroups ? process.getgroups() : [],
        platform: process.platform
      },
      filesystem: {
        workingDirectory: {
          path: process.cwd(),
          readable: false,
          writable: false,
          executable: false
        },
        homeDirectory: {
          path: process.env.HOME || process.env.USERPROFILE || '',
          accessible: false
        },
        tempDirectory: {
          path: process.env.TMPDIR || process.env.TEMP || '/tmp',
          writable: false
        }
      },
      system: {
        canExecuteCommands: false,
        canAccessNetwork: false,
        hasElevatedPrivileges: false
      },
      issues: []
    }

    try {
      // Test filesystem permissions
      await this.testFilesystemPermissions(result)
      
      // Test system capabilities
      await this.testSystemCapabilities(result)
      
      // Analyze permission issues
      this.analyzePermissionIssues(result)

      this.lastPermissionCheck = result
      this.emit('permissionDiagnosticsCompleted', result)

    } catch (error) {
      const taskMasterError = errorHandler.createError(error, {
        component: 'NetworkDiagnostics',
        operation: 'performPermissionDiagnostics'
      })

      result.issues.push({
        type: 'permission',
        severity: 'critical',
        message: `Permission diagnostics failed: ${taskMasterError.userFriendlyMessage}`,
        recommendation: 'Check system permissions and access rights'
      })

      this.emit('permissionDiagnosticsError', taskMasterError)
    }

    return result
  }

  /**
   * Quick connectivity check
   */
  async quickConnectivityCheck(): Promise<boolean> {
    try {
      // Quick ping to a reliable host
      const { stdout } = await execAsync(`ping -c 1 -W ${this.config.pingTimeout} 8.8.8.8`)
      return stdout.includes('1 received') || stdout.includes('1 packets received')
    } catch {
      return false
    }
  }

  /**
   * Check if running in offline mode
   */
  isOfflineMode(): boolean {
    return this.lastNetworkCheck?.overall === 'disconnected' || false
  }

  /**
   * Get last network diagnostics result
   */
  getLastNetworkCheck(): NetworkConnectivityResult | null {
    return this.lastNetworkCheck
  }

  /**
   * Get last permission diagnostics result
   */
  getLastPermissionCheck(): PermissionDiagnosticResult | null {
    return this.lastPermissionCheck
  }

  // Private implementation methods

  private async getNetworkInfo(): Promise<NetworkConnectivityResult['networkInfo']> {
    const networkInfo: NetworkConnectivityResult['networkInfo'] = {
      localIPs: [],
      dnsServers: []
    }

    try {
      // Get local IP addresses
      const { stdout: ifconfigOutput } = await execAsync('ifconfig 2>/dev/null || ipconfig 2>/dev/null || ip addr 2>/dev/null')
      const ipMatches = ifconfigOutput.match(/inet (\d+\.\d+\.\d+\.\d+)/g)
      if (ipMatches) {
        networkInfo.localIPs = ipMatches
          .map(match => match.replace('inet ', ''))
          .filter(ip => ip !== '127.0.0.1')
      }

      // Get default gateway
      try {
        const { stdout: routeOutput } = await execAsync('route -n get default 2>/dev/null || route print 0.0.0.0 2>/dev/null || ip route show default 2>/dev/null')
        const gatewayMatch = routeOutput.match(/gateway: (\d+\.\d+\.\d+\.\d+)|via (\d+\.\d+\.\d+\.\d+)/)
        if (gatewayMatch) {
          networkInfo.gateway = gatewayMatch[1] || gatewayMatch[2]
        }
      } catch {
        // Gateway detection failed
      }

      // Get DNS servers
      try {
        const { stdout: dnsOutput } = await execAsync('cat /etc/resolv.conf 2>/dev/null || nslookup google.com 2>/dev/null')
        const dnsMatches = dnsOutput.match(/nameserver (\d+\.\d+\.\d+\.\d+)|Server: (\d+\.\d+\.\d+\.\d+)/g)
        if (dnsMatches) {
          networkInfo.dnsServers = dnsMatches
            .map(match => match.replace(/nameserver |Server: /, ''))
            .filter((dns, index, arr) => arr.indexOf(dns) === index) // Remove duplicates
        }
      } catch {
        // DNS detection failed
      }

      // Get public IP
      try {
        const { stdout: publicIPOutput } = await execAsync('curl -s ifconfig.me || curl -s ipinfo.io/ip || curl -s icanhazip.com')
        const publicIP = publicIPOutput.trim()
        if (/^\d+\.\d+\.\d+\.\d+$/.test(publicIP)) {
          networkInfo.publicIP = publicIP
        }
      } catch {
        // Public IP detection failed
      }

    } catch (error) {
      // Network info gathering failed
    }

    return networkInfo
  }

  private async performPingTests(): Promise<PingTestResult[]> {
    const results: PingTestResult[] = []

    for (const host of this.config.testHosts) {
      const startTime = Date.now()
      
      try {
        const { stdout } = await execAsync(`ping -c 3 -W ${this.config.pingTimeout} ${host}`)
        const responseTime = Date.now() - startTime
        
        // Parse packet loss
        const lossMatch = stdout.match(/(\d+)% packet loss/)
        const packetLoss = lossMatch ? parseInt(lossMatch[1]) : 0
        
        // Parse average response time
        const timeMatch = stdout.match(/avg = ([\d.]+)/)
        const avgTime = timeMatch ? parseFloat(timeMatch[1]) : responseTime

        results.push({
          host,
          success: packetLoss < 100,
          responseTime: avgTime,
          packetLoss
        })

      } catch (error) {
        results.push({
          host,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }

  private async performDNSTests(): Promise<DNSTestResult[]> {
    const results: DNSTestResult[] = []
    const testQueries = [
      { query: 'google.com', type: 'A' as const },
      { query: 'github.com', type: 'A' as const },
      { query: 'google.com', type: 'TXT' as const }
    ]

    for (const test of testQueries) {
      const startTime = Date.now()
      
      try {
        let result: string[] = []
        
        if (test.type === 'A') {
          const addresses = await resolve4(test.query)
          result = addresses
        } else if (test.type === 'TXT') {
          const txtRecords = await resolveTxt(test.query)
          result = txtRecords.flat()
        }

        const responseTime = Date.now() - startTime

        results.push({
          query: test.query,
          type: test.type,
          success: true,
          result,
          responseTime
        })

      } catch (error) {
        results.push({
          query: test.query,
          type: test.type,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }

  private async testServiceEndpoints(): Promise<ServiceTestResult[]> {
    const results: ServiceTestResult[] = []

    for (const service of this.config.criticalServices) {
      const startTime = Date.now()
      
      try {
        if (service.protocol === 'http' || service.protocol === 'https') {
          // Test HTTP/HTTPS service
          const { stdout } = await execAsync(`curl -s -o /dev/null -w "%{http_code}" --max-time ${(service.timeout || 5000) / 1000} ${service.protocol}://${service.host}:${service.port}`)
          const statusCode = parseInt(stdout.trim())
          const responseTime = Date.now() - startTime

          results.push({
            service,
            success: statusCode >= 200 && statusCode < 400,
            responseTime,
            statusCode
          })

        } else {
          // Test TCP/UDP service
          const timeout = (service.timeout || 5000) / 1000
          await execAsync(`timeout ${timeout} bash -c 'cat < /dev/null > /dev/tcp/${service.host}/${service.port}'`)
          const responseTime = Date.now() - startTime

          results.push({
            service,
            success: true,
            responseTime
          })
        }

      } catch (error) {
        results.push({
          service,
          success: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        })
      }
    }

    return results
  }

  private analyzeConnectivity(result: NetworkConnectivityResult): 'connected' | 'limited' | 'disconnected' {
    const successfulPings = result.tests.ping.filter(p => p.success).length
    const successfulDNS = result.tests.dns.filter(d => d.success).length
    const successfulServices = result.tests.services.filter(s => s.success).length
    
    const totalTests = result.tests.ping.length + result.tests.dns.length + result.tests.services.length
    const successfulTests = successfulPings + successfulDNS + successfulServices
    
    const successRate = totalTests > 0 ? successfulTests / totalTests : 0

    if (successRate >= 0.8) {
      return 'connected'
    } else if (successRate >= 0.3) {
      return 'limited'
    } else {
      return 'disconnected'
    }
  }

  private analyzeIssuesAndRecommendations(result: NetworkConnectivityResult): void {
    // Analyze ping results
    const failedPings = result.tests.ping.filter(p => !p.success)
    if (failedPings.length > 0) {
      result.issues.push({
        severity: 'medium',
        category: 'connectivity',
        message: `Failed to ping ${failedPings.length} host(s): ${failedPings.map(p => p.host).join(', ')}`,
        solution: 'Check internet connection and firewall settings'
      })
    }

    // Analyze DNS results
    const failedDNS = result.tests.dns.filter(d => !d.success)
    if (failedDNS.length > 0) {
      result.issues.push({
        severity: 'high',
        category: 'dns',
        message: `DNS resolution failed for ${failedDNS.length} query(ies)`,
        solution: 'Check DNS server configuration or try alternative DNS servers (8.8.8.8, 1.1.1.1)'
      })
      result.recommendations.push('Consider using alternative DNS servers')
    }

    // Analyze service results
    const failedCriticalServices = result.tests.services.filter(s => !s.success && s.service.critical)
    if (failedCriticalServices.length > 0) {
      result.issues.push({
        severity: 'critical',
        category: 'services',
        message: `Critical services unavailable: ${failedCriticalServices.map(s => s.service.name).join(', ')}`,
        solution: 'Check service status and network connectivity to critical endpoints'
      })
    }

    // Check for slow responses
    const slowPings = result.tests.ping.filter(p => p.success && (p.responseTime || 0) > 1000)
    if (slowPings.length > 0) {
      result.issues.push({
        severity: 'low',
        category: 'connectivity',
        message: 'Slow network response times detected',
        solution: 'Check network performance and consider switching to a faster connection'
      })
    }

    // Generate recommendations based on overall connectivity
    if (result.overall === 'disconnected') {
      result.recommendations.push('Check network cable/WiFi connection')
      result.recommendations.push('Restart network adapter')
      result.recommendations.push('Contact network administrator')
    } else if (result.overall === 'limited') {
      result.recommendations.push('Some services may be unavailable')
      result.recommendations.push('Enable offline mode for continued operation')
    }
  }

  private async testFilesystemPermissions(result: PermissionDiagnosticResult): Promise<void> {
    const fs = require('fs').promises

    // Test working directory permissions
    try {
      await fs.access(result.filesystem.workingDirectory.path, fs.constants.R_OK)
      result.filesystem.workingDirectory.readable = true
    } catch {}

    try {
      await fs.access(result.filesystem.workingDirectory.path, fs.constants.W_OK)
      result.filesystem.workingDirectory.writable = true
    } catch {}

    try {
      await fs.access(result.filesystem.workingDirectory.path, fs.constants.X_OK)
      result.filesystem.workingDirectory.executable = true
    } catch {}

    // Test home directory access
    if (result.filesystem.homeDirectory.path) {
      try {
        await fs.access(result.filesystem.homeDirectory.path, fs.constants.R_OK)
        result.filesystem.homeDirectory.accessible = true
      } catch {}
    }

    // Test temp directory write access
    try {
      const testFile = require('path').join(result.filesystem.tempDirectory.path, `test-${Date.now()}.tmp`)
      await fs.writeFile(testFile, 'test')
      await fs.unlink(testFile)
      result.filesystem.tempDirectory.writable = true
    } catch {}
  }

  private async testSystemCapabilities(result: PermissionDiagnosticResult): Promise<void> {
    // Test command execution
    try {
      await execAsync('echo test')
      result.system.canExecuteCommands = true
    } catch {}

    // Test network access (quick ping)
    try {
      await execAsync('ping -c 1 -W 1000 8.8.8.8')
      result.system.canAccessNetwork = true
    } catch {}

    // Check for elevated privileges
    result.system.hasElevatedPrivileges = result.process.uid === 0 || process.platform === 'win32'
  }

  private analyzePermissionIssues(result: PermissionDiagnosticResult): void {
    // Check filesystem permissions
    if (!result.filesystem.workingDirectory.readable) {
      result.issues.push({
        type: 'permission',
        severity: 'critical',
        message: 'Cannot read from working directory',
        recommendation: 'Check directory permissions and ownership'
      })
    }

    if (!result.filesystem.workingDirectory.writable) {
      result.issues.push({
        type: 'permission',
        severity: 'high',
        message: 'Cannot write to working directory',
        recommendation: 'Ensure write permissions for current user',
        autoFixable: false
      })
    }

    if (!result.filesystem.tempDirectory.writable) {
      result.issues.push({
        type: 'permission',
        severity: 'medium',
        message: 'Cannot write to temporary directory',
        recommendation: 'Check temp directory permissions or set TMPDIR environment variable'
      })
    }

    // Check system capabilities
    if (!result.system.canExecuteCommands) {
      result.issues.push({
        type: 'permission',
        severity: 'critical',
        message: 'Cannot execute system commands',
        recommendation: 'Check execution permissions and security policies'
      })
    }

    if (!result.system.canAccessNetwork) {
      result.issues.push({
        type: 'access',
        severity: 'high',
        message: 'Network access blocked or unavailable',
        recommendation: 'Check firewall settings and network permissions'
      })
    }
  }
}

// Export default instance
export const networkDiagnostics = new NetworkDiagnosticsService()