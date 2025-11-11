import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { KnowledgeEntry, QueryResult, QueryOptions } from '../types.js'

export interface KnowledgeStoreConfig {
  dbPath: string
}

export class KnowledgeStore {
  private entries: Map<string, KnowledgeEntry> = new Map()
  private dbFile: string
  private initialized = false

  constructor(private config: KnowledgeStoreConfig) {
    this.dbFile = join(config.dbPath, 'knowledge.json')
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Ensure database directory exists
    if (!existsSync(this.config.dbPath)) {
      mkdirSync(this.config.dbPath, { recursive: true })
    }

    // Load existing entries if database exists
    if (existsSync(this.dbFile)) {
      try {
        const data = JSON.parse(readFileSync(this.dbFile, 'utf-8'))
        this.entries = new Map(Object.entries(data.entries || {}))
      } catch (error) {
        console.error(`Failed to load knowledge database: ${error}`)
        this.entries = new Map()
      }
    }

    this.initialized = true
  }

  async captureFromFile(filePath: string, metadata: Record<string, any>): Promise<void> {
    try {
      // Only capture content from text-based files
      const textExtensions = ['.ts', '.js', '.json', '.md', '.yml', '.yaml', '.txt', '.tsx', '.jsx']
      const ext = extname(filePath)

      if (!textExtensions.includes(ext)) {
        return
      }

      const fullPath = join(process.cwd(), filePath)
      if (!existsSync(fullPath)) {
        return
      }

      const content = readFileSync(fullPath, 'utf-8')

      // Skip very large files (>1MB)
      if (content.length > 1024 * 1024) {
        return
      }

      const entry: KnowledgeEntry = {
        id: randomUUID(),
        title: basename(filePath),
        content,
        source: filePath,
        timestamp: new Date().toISOString(),
        metadata: {
          ...metadata,
          fileType: ext,
          size: content.length,
        },
      }

      // Generate simple embedding (in production, use a real embedding model)
      entry.embedding = this.generateSimpleEmbedding(content)

      this.entries.set(entry.id, entry)
      await this.persist()
    } catch (error) {
      // Silently fail for individual file captures
      console.error(`Error capturing from ${filePath}:`, error)
    }
  }

  async query(queryText: string, options: QueryOptions): Promise<QueryResult[]> {
    const queryEmbedding = this.generateSimpleEmbedding(queryText)
    const results: QueryResult[] = []

    for (const entry of this.entries.values()) {
      if (!entry.embedding) continue

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding)

      if (similarity >= options.threshold) {
        results.push({
          id: entry.id,
          title: entry.title,
          content: entry.content,
          source: entry.source,
          timestamp: entry.timestamp,
          similarity,
          metadata: entry.metadata,
        })
      }
    }

    // Sort by similarity (descending) and limit results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.limit)
  }

  async getEntryCount(): Promise<number> {
    return this.entries.size
  }

  async close(): Promise<void> {
    await this.persist()
    this.entries.clear()
    this.initialized = false
  }

  private async persist(): Promise<void> {
    try {
      const data = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        entries: Object.fromEntries(this.entries),
      }

      writeFileSync(this.dbFile, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error(`Failed to persist knowledge database: ${error}`)
    }
  }

  /**
   * Generate a simple embedding using character frequency
   * In production, replace with a real embedding model (OpenAI, Cohere, etc.)
   */
  private generateSimpleEmbedding(text: string): number[] {
    const embedding = new Array(100).fill(0)
    const normalized = text.toLowerCase()

    // Simple character frequency-based embedding
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i)
      const index = charCode % 100
      embedding[index] += 1
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
    return embedding.map(val => (magnitude > 0 ? val / magnitude : 0))
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let magnitudeA = 0
    let magnitudeB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      magnitudeA += a[i] * a[i]
      magnitudeB += b[i] * b[i]
    }

    magnitudeA = Math.sqrt(magnitudeA)
    magnitudeB = Math.sqrt(magnitudeB)

    if (magnitudeA === 0 || magnitudeB === 0) return 0

    return dotProduct / (magnitudeA * magnitudeB)
  }
}
