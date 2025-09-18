import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import { errorHandler, ErrorType } from './error-handler.service'

// Promisify fs methods
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const access = promisify(fs.access)
const mkdir = promisify(fs.mkdir)
const stat = promisify(fs.stat)
const readdir = promisify(fs.readdir)

export interface FileSystemConfig {
  baseDirectory?: string
  createMissingDirectories?: boolean
  backupOnWrite?: boolean
  maxFileSize?: number
  allowedExtensions?: string[]
  retryAttempts?: number
  retryDelay?: number
}

export interface FileOperationResult<T = any> {
  success: boolean
  data?: T
  error?: Error
  path: string
  operation: string
  timestamp: number
  retryCount: number
  fallbackUsed?: boolean
}

export interface DirectoryInfo {
  path: string
  exists: boolean
  readable: boolean
  writable: boolean
  size: number
  fileCount: number
  lastModified: Date
}

export interface FileInfo {
  path: string
  exists: boolean
  readable: boolean
  writable: boolean
  size: number
  lastModified: Date
  extension: string
  isValid: boolean
}

/**
 * Comprehensive file system error handling service
 * 
 * Features:
 * - Safe file operations with error recovery
 * - Permission and access validation
 * - Automatic directory creation
 * - File backup and recovery
 * - Path traversal protection
 * - File size and type validation
 * - Atomic write operations
 * - Comprehensive error classification
 */
export class FileSystemHandlerService extends EventEmitter {
  private config: Required<FileSystemConfig>
  private readonly defaultConfig: Required<FileSystemConfig> = {
    baseDirectory: process.cwd(),
    createMissingDirectories: true,
    backupOnWrite: true,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedExtensions: ['.json', '.txt', '.md', '.yml', '.yaml'],
    retryAttempts: 3,
    retryDelay: 1000
  }

  constructor(config: Partial<FileSystemConfig> = {}) {
    super()
    this.config = { ...this.defaultConfig, ...config }
  }

  /**
   * Safely read a file with comprehensive error handling
   */
  async readFileSafe(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<FileOperationResult<string>> {
    const operation = 'read'
    const startTime = Date.now()
    let retryCount = 0

    // Validate and normalize path
    const normalizedPath = this.normalizePath(filePath)
    
    if (!this.isPathSafe(normalizedPath)) {
      const error = new Error(`Unsafe path detected: ${filePath}`)
      return this.createFailureResult(operation, normalizedPath, error, retryCount)
    }

    while (retryCount <= this.config.retryAttempts) {
      try {
        // Check file info first
        const fileInfo = await this.getFileInfo(normalizedPath)
        
        if (!fileInfo.exists) {
          const error = new Error(`File does not exist: ${normalizedPath}`)
          return this.createFailureResult(operation, normalizedPath, error, retryCount)
        }

        if (!fileInfo.readable) {
          const error = new Error(`File is not readable: ${normalizedPath}`)
          return this.createFailureResult(operation, normalizedPath, error, retryCount)
        }

        if (fileInfo.size > this.config.maxFileSize) {
          const error = new Error(`File too large: ${fileInfo.size} bytes (max: ${this.config.maxFileSize})`)
          return this.createFailureResult(operation, normalizedPath, error, retryCount)
        }

        if (!fileInfo.isValid) {
          const error = new Error(`File type not allowed: ${fileInfo.extension}`)
          return this.createFailureResult(operation, normalizedPath, error, retryCount)
        }

        // Read the file
        const data = await readFile(normalizedPath, encoding)
        
        const result: FileOperationResult<string> = {
          success: true,
          data,
          path: normalizedPath,
          operation,
          timestamp: Date.now(),
          retryCount
        }

        this.emit('fileOperationSuccess', result)
        return result

      } catch (error) {
        retryCount++
        
        if (retryCount > this.config.retryAttempts) {
          const taskMasterError = errorHandler.createError(error, {
            component: 'FileSystemHandler',
            operation: 'readFile',
            retryCount,
            workingDirectory: this.config.baseDirectory
          })

          const result = this.createFailureResult(operation, normalizedPath, taskMasterError.originalError || new Error('Unknown error'), retryCount)
          this.emit('fileOperationError', result)
          return result
        }

        // Wait before retry
        await this.delay(this.config.retryDelay * retryCount)
      }
    }

    return this.createFailureResult(operation, normalizedPath, new Error('Max retries exceeded'), retryCount)
  }

  /**
   * Safely write a file with backup and atomic operations
   */
  async writeFileSafe(filePath: string, data: string, encoding: BufferEncoding = 'utf8'): Promise<FileOperationResult<void>> {
    const operation = 'write'
    const startTime = Date.now()
    let retryCount = 0

    // Validate and normalize path
    const normalizedPath = this.normalizePath(filePath)
    
    if (!this.isPathSafe(normalizedPath)) {
      const error = new Error(`Unsafe path detected: ${filePath}`)
      return this.createFailureResult(operation, normalizedPath, error, retryCount)
    }

    // Validate file extension
    const extension = path.extname(normalizedPath).toLowerCase()
    if (!this.config.allowedExtensions.includes(extension)) {
      const error = new Error(`File extension not allowed: ${extension}`)
      return this.createFailureResult(operation, normalizedPath, error, retryCount)
    }

    // Validate data size
    const dataSize = Buffer.byteLength(data, encoding)
    if (dataSize > this.config.maxFileSize) {
      const error = new Error(`Data too large: ${dataSize} bytes (max: ${this.config.maxFileSize})`)
      return this.createFailureResult(operation, normalizedPath, error, retryCount)
    }

    while (retryCount <= this.config.retryAttempts) {
      let backupPath: string | null = null
      
      try {
        // Ensure directory exists
        const directory = path.dirname(normalizedPath)
        await this.ensureDirectoryExists(directory)

        // Create backup if file exists and backup is enabled
        if (this.config.backupOnWrite && await this.fileExists(normalizedPath)) {
          backupPath = await this.createBackup(normalizedPath)
        }

        // Perform atomic write (write to temp file, then rename)
        const tempPath = `${normalizedPath}.tmp.${Date.now()}`
        
        try {
          await writeFile(tempPath, data, encoding)
          
          // Verify written data
          const writtenData = await readFile(tempPath, encoding)
          if (writtenData !== data) {
            throw new Error('Data verification failed after write')
          }
          
          // Atomic move
          await this.moveFile(tempPath, normalizedPath)
          
        } catch (writeError) {
          // Clean up temp file
          try {
            await fs.promises.unlink(tempPath)
          } catch {
            // Ignore cleanup errors
          }
          throw writeError
        }

        const result: FileOperationResult<void> = {
          success: true,
          path: normalizedPath,
          operation,
          timestamp: Date.now(),
          retryCount
        }

        this.emit('fileOperationSuccess', result)
        return result

      } catch (error) {
        retryCount++
        
        // Restore backup if available
        if (backupPath && await this.fileExists(backupPath)) {
          try {
            await this.moveFile(backupPath, normalizedPath)
            this.emit('backupRestored', normalizedPath, backupPath)
          } catch (restoreError) {
            this.emit('backupRestoreFailed', normalizedPath, backupPath, restoreError)
          }
        }
        
        if (retryCount > this.config.retryAttempts) {
          const taskMasterError = errorHandler.createError(error, {
            component: 'FileSystemHandler',
            operation: 'writeFile',
            retryCount,
            workingDirectory: this.config.baseDirectory
          })

          const result = this.createFailureResult(operation, normalizedPath, taskMasterError.originalError || new Error('Unknown error'), retryCount)
          this.emit('fileOperationError', result)
          return result
        }

        // Wait before retry
        await this.delay(this.config.retryDelay * retryCount)
      }
    }

    return this.createFailureResult(operation, normalizedPath, new Error('Max retries exceeded'), retryCount)
  }

  /**
   * Safely ensure a directory exists
   */
  async ensureDirectoryExists(dirPath: string): Promise<FileOperationResult<void>> {
    const operation = 'ensureDirectory'
    const normalizedPath = this.normalizePath(dirPath)
    
    if (!this.isPathSafe(normalizedPath)) {
      const error = new Error(`Unsafe path detected: ${dirPath}`)
      return this.createFailureResult(operation, normalizedPath, error, 0)
    }

    try {
      const dirInfo = await this.getDirectoryInfo(normalizedPath)
      
      if (dirInfo.exists) {
        if (!dirInfo.writable) {
          const error = new Error(`Directory is not writable: ${normalizedPath}`)
          return this.createFailureResult(operation, normalizedPath, error, 0)
        }
        
        return {
          success: true,
          path: normalizedPath,
          operation,
          timestamp: Date.now(),
          retryCount: 0
        }
      }

      // Create directory recursively
      await mkdir(normalizedPath, { recursive: true })
      
      const result: FileOperationResult<void> = {
        success: true,
        path: normalizedPath,
        operation,
        timestamp: Date.now(),
        retryCount: 0
      }

      this.emit('directoryCreated', normalizedPath)
      return result

    } catch (error) {
      const taskMasterError = errorHandler.createError(error, {
        component: 'FileSystemHandler',
        operation: 'ensureDirectory'
      })

      return this.createFailureResult(operation, normalizedPath, taskMasterError.originalError || new Error('Unknown error'), 0)
    }
  }

  /**
   * Get comprehensive file information
   */
  async getFileInfo(filePath: string): Promise<FileInfo> {
    const normalizedPath = this.normalizePath(filePath)
    const extension = path.extname(normalizedPath).toLowerCase()
    
    const fileInfo: FileInfo = {
      path: normalizedPath,
      exists: false,
      readable: false,
      writable: false,
      size: 0,
      lastModified: new Date(0),
      extension,
      isValid: this.config.allowedExtensions.includes(extension)
    }

    try {
      await access(normalizedPath, fs.constants.F_OK)
      fileInfo.exists = true

      const stats = await stat(normalizedPath)
      fileInfo.size = stats.size
      fileInfo.lastModified = stats.mtime

      // Check read permissions
      try {
        await access(normalizedPath, fs.constants.R_OK)
        fileInfo.readable = true
      } catch {
        fileInfo.readable = false
      }

      // Check write permissions
      try {
        await access(normalizedPath, fs.constants.W_OK)
        fileInfo.writable = true
      } catch {
        fileInfo.writable = false
      }

    } catch {
      // File doesn't exist or other error
    }

    return fileInfo
  }

  /**
   * Get comprehensive directory information
   */
  async getDirectoryInfo(dirPath: string): Promise<DirectoryInfo> {
    const normalizedPath = this.normalizePath(dirPath)
    
    const dirInfo: DirectoryInfo = {
      path: normalizedPath,
      exists: false,
      readable: false,
      writable: false,
      size: 0,
      fileCount: 0,
      lastModified: new Date(0)
    }

    try {
      await access(normalizedPath, fs.constants.F_OK)
      dirInfo.exists = true

      const stats = await stat(normalizedPath)
      dirInfo.lastModified = stats.mtime

      // Check read permissions
      try {
        await access(normalizedPath, fs.constants.R_OK)
        dirInfo.readable = true
        
        // Get file count and total size
        const files = await readdir(normalizedPath)
        dirInfo.fileCount = files.length
        
        for (const file of files) {
          try {
            const filePath = path.join(normalizedPath, file)
            const fileStats = await stat(filePath)
            dirInfo.size += fileStats.size
          } catch {
            // Ignore errors for individual files
          }
        }
      } catch {
        dirInfo.readable = false
      }

      // Check write permissions
      try {
        await access(normalizedPath, fs.constants.W_OK)
        dirInfo.writable = true
      } catch {
        dirInfo.writable = false
      }

    } catch {
      // Directory doesn't exist or other error
    }

    return dirInfo
  }

  /**
   * Create a backup of an existing file
   */
  async createBackup(filePath: string): Promise<string> {
    const normalizedPath = this.normalizePath(filePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${normalizedPath}.backup.${timestamp}`
    
    try {
      const data = await readFile(normalizedPath)
      await writeFile(backupPath, data)
      
      this.emit('backupCreated', normalizedPath, backupPath)
      return backupPath
    } catch (error) {
      this.emit('backupFailed', normalizedPath, error)
      throw error
    }
  }

  /**
   * Clean up old backup files
   */
  async cleanupBackups(filePath: string, keepCount = 5): Promise<void> {
    const normalizedPath = this.normalizePath(filePath)
    const directory = path.dirname(normalizedPath)
    const basename = path.basename(normalizedPath)
    
    try {
      const files = await readdir(directory)
      const backupFiles = files
        .filter(file => file.startsWith(`${basename}.backup.`))
        .map(file => ({
          name: file,
          path: path.join(directory, file),
          stat: fs.statSync(path.join(directory, file))
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime())

      // Keep only the most recent backups
      const filesToDelete = backupFiles.slice(keepCount)
      
      for (const file of filesToDelete) {
        try {
          await fs.promises.unlink(file.path)
          this.emit('backupDeleted', file.path)
        } catch (error) {
          this.emit('backupDeletionFailed', file.path, error)
        }
      }
    } catch (error) {
      this.emit('backupCleanupFailed', normalizedPath, error)
    }
  }

  // Private utility methods

  private normalizePath(filePath: string): string {
    // Resolve path relative to base directory
    const resolved = path.resolve(this.config.baseDirectory, filePath)
    return path.normalize(resolved)
  }

  private isPathSafe(filePath: string): boolean {
    const normalized = path.normalize(filePath)
    const base = path.normalize(this.config.baseDirectory)
    
    // Ensure path is within base directory (prevent path traversal)
    return normalized.startsWith(base)
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, fs.constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  private async moveFile(source: string, destination: string): Promise<void> {
    try {
      await fs.promises.rename(source, destination)
    } catch (error) {
      // If rename fails (e.g., cross-device), try copy + delete
      const data = await readFile(source)
      await writeFile(destination, data)
      await fs.promises.unlink(source)
    }
  }

  private createFailureResult<T>(
    operation: string,
    path: string,
    error: Error,
    retryCount: number
  ): FileOperationResult<T> {
    return {
      success: false,
      error,
      path,
      operation,
      timestamp: Date.now(),
      retryCount
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Export default instance
export const fileSystemHandler = new FileSystemHandlerService()