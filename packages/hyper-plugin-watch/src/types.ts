export interface WatchConfig {
  path: string
  dbPath: string
  verbose: boolean
  interval: number
  patterns: string[]
}

export interface WatchServiceStatus {
  running: boolean
  uptime: number
  filesWatched: number
  changesDetected: number
  knowledgeEntries: number
  lastUpdate: string
  errors: string[]
}

export interface KnowledgeEntry {
  id: string
  title?: string
  content: string
  source: string
  timestamp: string
  metadata: Record<string, any>
  embedding?: number[]
}

export interface QueryResult {
  id: string
  title?: string
  content: string
  source: string
  timestamp: string
  similarity: number
  metadata: Record<string, any>
}

export interface QueryOptions {
  limit: number
  threshold: number
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink'
  path: string
  timestamp: string
}

export interface MonitoringMetrics {
  cpu: number
  memory: number
  diskIO: number
  networkIO: number
}
