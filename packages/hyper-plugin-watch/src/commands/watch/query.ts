import { Command, Flags, Args } from '@oclif/core'
import chalk from 'chalk'
import { KnowledgeStore } from '../../services/knowledge-store.js'

export default class WatchQuery extends Command {
  static override description = 'Query the local knowledge base'

  static override examples = [
    '<%= config.bin %> <%= command.id %> "How does authentication work?"',
    '<%= config.bin %> <%= command.id %> "database schema" --limit 10',
    '<%= config.bin %> <%= command.id %> "API endpoints" --json',
  ]

  static override args = {
    query: Args.string({
      description: 'Search query for the knowledge base',
      required: true,
    }),
  }

  static override flags = {
    'db-path': Flags.string({
      char: 'd',
      description: 'Path to local vector database',
      default: './.hyper/knowledge',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of results to return',
      default: 5,
    }),
    json: Flags.boolean({
      description: 'Output results as JSON',
      default: false,
    }),
    threshold: Flags.float({
      char: 't',
      description: 'Similarity threshold (0-1)',
      default: 0.7,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WatchQuery)

    const store = new KnowledgeStore({
      dbPath: flags['db-path'],
    })

    try {
      await store.initialize()

      this.log(chalk.blue('🔍 Searching knowledge base...'))
      this.log(chalk.gray(`Query: "${args.query}"\n`))

      const results = await store.query(args.query, {
        limit: flags.limit,
        threshold: flags.threshold,
      })

      if (results.length === 0) {
        this.log(chalk.yellow('No results found matching your query.'))
        return
      }

      if (flags.json) {
        this.log(JSON.stringify(results, null, 2))
        return
      }

      this.log(chalk.green(`Found ${results.length} results:\n`))

      results.forEach((result, index) => {
        this.log(chalk.bold(`${index + 1}. ${result.title || 'Untitled'}`))
        this.log(chalk.gray(`   Similarity: ${(result.similarity * 100).toFixed(1)}%`))
        this.log(chalk.gray(`   Source: ${result.source}`))
        this.log(chalk.gray(`   Timestamp: ${new Date(result.timestamp).toLocaleString()}`))
        this.log(`   ${result.content.substring(0, 200)}...`)
        this.log('')
      })
    } catch (error) {
      this.error(chalk.red(`Failed to query knowledge base: ${error}`))
    } finally {
      await store.close()
    }
  }
}
