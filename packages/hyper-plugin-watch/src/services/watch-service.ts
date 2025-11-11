import { watch, FSWatcher } from 'chokidar'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import chalk from 'chalk'
import type { WatchConfig, WatchServiceStatus, FileChangeEvent } from '../types.js'
import { KnowledgeStore } from './knowledge-store.js'

export class WatchService {
  private watcher: FSWatcher | null = null
  private knowledgeStore: KnowledgeStore
  private status: WatchServiceStatus
  private startTime: number = 0
  private statusUpdateInterval: NodeJS.Timeout | null = null

  constructor(private config: WatchConfig) {
    this.knowledgeStore = new KnowledgeStore({
      dbPath: config.dbPath,
    })

    this.status = {
      running: false,
      uptime: 0,
      filesWatched: 0,
      changesDetected: 0,
      knowledgeEntries: 0,
      lastUpdate: new Date().toISOString(),
      errors: [],
    }
  }

  async start(): Promise<void> {
    try {
      // Ensure database directory exists
      if (!existsSync(this.config.dbPath)) {
        mkdirSync(this.config.dbPath, { recursive: true })
      }

      // Initialize knowledge store
      await this.knowledgeStore.initialize()

      // Start file watcher
      this.watcher = watch(this.config.patterns, {
        cwd: this.config.path,
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.hyper/**',
        ],
      })

      this.setupWatcherEvents()

      this.status.running = true
      this.startTime = Date.now()

      // Update status file periodically
      this.statusUpdateInterval = setInterval(() => {
        this.updateStatusFile()
      }, this.config.interval * 1000)

      this.log(chalk.green('✓ Watch service started successfully'))
      this.log(chalk.gray('Press Ctrl+C to stop\n'))

      // Keep process running
      await new Promise(() => {}) // Never resolves
    } catch (error) {
      const errorMsg = `Failed to start watch service: ${error}`
      this.status.errors.push(errorMsg)
      throw error
    }
  }

  async stop(): Promise<void> {
    this.log(chalk.yellow('Stopping watch service...'))

    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval)
    }

    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    await this.knowledgeStore.close()

    this.status.running = false
    this.updateStatusFile()

    this.log(chalk.green('✓ Watch service stopped'))
  }

  private setupWatcherEvents(): void {
    if (!this.watcher) return

    this.watcher.on('add', (path) => this.handleFileEvent('add', path))
    this.watcher.on('change', (path) => this.handleFileEvent('change', path))
    this.watcher.on('unlink', (path) => this.handleFileEvent('unlink', path))

    this.watcher.on('ready', () => {
      const watchedPaths = Object.keys(this.watcher?.getWatched() || {})
      this.status.filesWatched = watchedPaths.length
      this.log(chalk.green(`Watching ${this.status.filesWatched} files`))
    })

    this.watcher.on('error', (error) => {
      const errorMsg = `Watcher error: ${error}`
      this.status.errors.push(errorMsg)
      this.log(chalk.red(errorMsg))
    })
  }

  private async handleFileEvent(
    type: 'add' | 'change' | 'unlink',
    filePath: string
  ): Promise<void> {
    const event: FileChangeEvent = {
      type,
      path: filePath,
      timestamp: new Date().toISOString(),
    }

    this.status.changesDetected++
    this.status.lastUpdate = event.timestamp

    if (this.config.verbose) {
      const icon = type === 'add' ? '➕' : type === 'change' ? '📝' : '🗑️'
      this.log(chalk.gray(`${icon} ${type}: ${filePath}`))
    }

    // Capture knowledge from file changes
    if (type !== 'unlink') {
      try {
        await this.knowledgeStore.captureFromFile(filePath, {
          changeType: type,
          timestamp: event.timestamp,
        })
        this.status.knowledgeEntries = await this.knowledgeStore.getEntryCount()
      } catch (error) {
        if (this.config.verbose) {
          this.log(chalk.red(`Failed to capture knowledge from ${filePath}: ${error}`))
        }
      }
    }
  }

  private updateStatusFile(): void {
    try {
      this.status.uptime = Math.floor((Date.now() - this.startTime) / 1000)

      const statusPath = join(this.config.dbPath, 'status.json')
      const statusDir = dirname(statusPath)

      if (!existsSync(statusDir)) {
        mkdirSync(statusDir, { recursive: true })
      }

      writeFileSync(statusPath, JSON.stringify(this.status, null, 2))
    } catch (error) {
      if (this.config.verbose) {
        this.log(chalk.red(`Failed to update status file: ${error}`))
      }
    }
  }

  private log(message: string): void {
    console.log(message)
  }
}
