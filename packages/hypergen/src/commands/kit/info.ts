/**
 * Show detailed information about a kit
 */

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '#/lib/base-command'
import { discoverCookbooksInKit, discoverRecipesInCookbook } from '#/config/cookbook-parser'
import { c } from '#/lib/colors'
import { s } from '#/lib/styles'

export default class KitInfo extends BaseCommand<typeof KitInfo> {
  static override description = 'Show detailed information about a kit'

  static override examples = [
    '<%= config.bin %> kit info @kit/starlight',
    '<%= config.bin %> kit info starlight --json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  }

  static override args = {
    kit: Args.string({
      description: 'Kit name or path',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KitInfo)

    try {
      // Discover all kits and find the requested one
      const kits = await this.discovery.discoverAll()
      const kit = kits.find(k =>
        k.name === args.kit ||
        k.name.endsWith(`/${args.kit}`) ||
        k.name === `@kit/${args.kit}`
      )

      if (!kit) {
        this.log(s.error(`Kit not found: ${args.kit}`))
        this.suggestAvailableKits(kits)
        this.exit(1)
      }

      // Gather detailed cookbook and recipe information
      const cookbooks: Array<{
        name: string
        description?: string
        version?: string
        recipes: string[]
      }> = []

      if (kit.cookbooks && kit.cookbooks.length > 0) {
        const cookbookGlobs = ['./cookbooks/*/cookbook.yml']
        try {
          const discoveredCookbooks = await discoverCookbooksInKit(kit.path, cookbookGlobs)

          for (const [cookbookName, cookbook] of discoveredCookbooks) {
            const recipeGlobs = cookbook.config.recipes || ['./*/recipe.yml']
            const recipes = await discoverRecipesInCookbook(cookbook.dirPath, recipeGlobs)

            cookbooks.push({
              name: cookbookName,
              description: cookbook.config.description,
              version: cookbook.config.version,
              recipes: Array.from(recipes.keys()),
            })
          }
        } catch (error) {
          this.warn(`Failed to discover cookbooks: ${error}`)
        }
      }

      // Prepare output
      const kitInfo = {
        name: kit.name,
        source: kit.source,
        path: kit.path,
        metadata: kit.metadata,
        cookbooks,
        recipes: kit.recipes || [],
        helpers: kit.helpers || [],
      }

      if (flags.json) {
        this.log(JSON.stringify(kitInfo, null, 2))
        return
      }

      this.displayKitInfo(kitInfo)
    } catch (error) {
      this.error(`Failed to get kit info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private displayKitInfo(kitInfo: {
    name: string
    source: string
    path: string
    metadata?: {
      description?: string
      version?: string
      author?: string
      license?: string
      keywords?: string[]
      tags?: string[]
    }
    cookbooks: Array<{ name: string; description?: string; version?: string; recipes: string[] }>
    recipes: string[]
    helpers: string[]
  }): void {
    // Title with version
    const versionStr = kitInfo.metadata?.version ? s.version(kitInfo.metadata.version) : ''
    this.log(`\n${s.title('Kit', kitInfo.name)}${versionStr}`)
    this.log(s.hr())

    // Description
    if (kitInfo.metadata?.description) {
      this.log(`\n${kitInfo.metadata.description}`)
    }

    // Metadata
    this.log('')
    this.log(s.keyValue('Source', kitInfo.source, 10))
    this.log(s.keyValue('Path', s.path(kitInfo.path), 10))

    if (kitInfo.metadata?.author) {
      this.log(s.keyValue('Author', kitInfo.metadata.author, 10))
    }

    if (kitInfo.metadata?.license) {
      this.log(s.keyValue('License', kitInfo.metadata.license, 10))
    }

    if (kitInfo.metadata?.keywords && kitInfo.metadata.keywords.length > 0) {
      this.log(s.keyValue('Keywords', kitInfo.metadata.keywords.join(', '), 10))
    }

    if (kitInfo.metadata?.tags && kitInfo.metadata.tags.length > 0) {
      this.log(s.keyValue('Tags', kitInfo.metadata.tags.join(', '), 10))
    }

    // Cookbooks
    this.log('')
    this.log(s.header('Cookbooks', kitInfo.cookbooks.length))
    if (kitInfo.cookbooks.length === 0) {
      this.log(s.description('No cookbooks found', 2))
    } else {
      for (const cookbook of kitInfo.cookbooks) {
        const cbVersion = cookbook.version ? s.version(cookbook.version) : ''
        this.log('')
        this.log(s.listItem(c.cookbook(cookbook.name) + cbVersion))

        if (cookbook.description) {
          this.log(s.description(cookbook.description))
        }

        if (cookbook.recipes.length > 0) {
          this.log(s.description(`Recipes: ${cookbook.recipes.join(', ')}`))
        }
      }
    }

    // Direct recipes
    this.log('')
    this.log(s.header('Direct Recipes', kitInfo.recipes.length))
    if (kitInfo.recipes.length === 0) {
      this.log(s.description('No direct recipes', 2))
    } else {
      for (const recipe of kitInfo.recipes) {
        this.log(s.listItem(recipe))
      }
    }

    // Helpers
    if (kitInfo.helpers.length > 0) {
      this.log('')
      this.log(s.header('Helpers', kitInfo.helpers.length))
      for (const helper of kitInfo.helpers) {
        this.log(s.listItem(helper))
      }
    }

    this.log('')
  }

  /**
   * Display available kits when a kit is not found
   */
  private suggestAvailableKits(kits: any[]): void {
    if (kits.length === 0) {
      this.log(c.warning('No kits installed.'))
      this.log(s.hint('\nInstall a kit with: hypergen kit install <kit>'))
      return
    }

    this.log(c.title('Available kits:'))
    this.log(s.hr())
    this.log('')

    // Group by source
    const bySource = new Map<string, any[]>()
    for (const kit of kits) {
      const sourceKits = bySource.get(kit.source) || []
      sourceKits.push(kit)
      bySource.set(kit.source, sourceKits)
    }

    const sourceLabels: Record<string, string> = {
      local: 'Local',
      workspace: 'Workspace',
      npm: 'NPM',
      github: 'GitHub',
      git: 'Git',
      global: 'Global',
    }

    for (const [source, sourceKits] of bySource) {
      const label = sourceLabels[source] || source
      this.log(c.heading(`${label}:`))

      for (const kit of sourceKits) {
        const version = kit.metadata?.version ? s.version(kit.metadata.version) : ''
        const name = c.kit(`  ${kit.name}`) + version

        if (kit.metadata?.description) {
          this.log(`${name} ${c.subtle('— ' + kit.metadata.description)}`)
        } else {
          this.log(name)
        }
      }
      this.log('')
    }

    this.log(s.hint('Run `hypergen kit info <kit>` for more details.'))
  }
}
