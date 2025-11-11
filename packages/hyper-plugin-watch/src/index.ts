export { default as Watch } from './commands/watch/index.js'
export { default as WatchStatus } from './commands/watch/status.js'
export { default as WatchQuery } from './commands/watch/query.js'

// Export types for external use
export type {
  WatchConfig,
  WatchServiceStatus,
  KnowledgeEntry,
  QueryResult,
  QueryOptions,
  FileChangeEvent,
  MonitoringMetrics,
} from './types.js'

// Export services for advanced usage
export { WatchService } from './services/watch-service.js'
export { KnowledgeStore } from './services/knowledge-store.js'
