/**
 * Kit and Cookbook Configuration Types
 *
 * Type definitions for kit.yml and cookbook.yml configurations
 */

export interface VariableDefinition {
  type: VariableType
  required?: boolean
  default?: any
  /** Suggested value shown in prompts (interactive or AI). Never auto-applied. */
  suggestion?: any
  prompt?: string
  description?: string
  internal?: boolean
  validation?: VariableValidation
  // Type-specific properties
  values?: string[] // for enum
  min?: number // for number
  max?: number // for number
  pattern?: string // for string
}

export type VariableType = 'string' | 'boolean' | 'number' | 'enum' | 'array' | 'object'

export interface VariableValidation {
  required?: boolean
  custom?: string // path to custom validator
  message?: string // custom error message
}

/**
 * Kit configuration
 */
export interface KitConfig {
  /** Kit name (e.g., "@hyper-kits/nextjs") */
  name: string
  /** Kit description */
  description?: string
  /** Kit version */
  version?: string
  /** Kit author */
  author?: string
  /** License */
  license?: string
  /** Keywords for discovery */
  keywords?: string[]
  /** Default cookbook and recipe */
  defaults?: { cookbook?: string; recipe?: string }
  /** Glob patterns for discovering cookbooks */
  cookbooks?: string[]
  /** Glob patterns for discovering standalone recipes */
  recipes?: string[]
  /** Tags for categorization */
  tags?: string[]
  /** Categories */
  categories?: string[]
  /** Kit-level variables shared across all cookbooks/recipes */
  variables?: Record<string, VariableDefinition>
  /** Path to helpers file or directory (relative to kit.yml) */
  helpers?: string
}

/**
 * Cookbook configuration
 */
export interface CookbookConfig {
  /** Cookbook name (e.g., "crud", "component") */
  name: string
  /** Cookbook description */
  description?: string
  /** Cookbook version */
  version?: string
  /** Default recipe to run when cookbook is invoked without a recipe */
  defaults?: { recipe?: string }
  /** Glob patterns for discovering recipes within this cookbook */
  recipes?: string[]
  /** Path to helpers file or directory (relative to cookbook.yml) */
  helpers?: string
}

export interface ValidationError {
  field: string
  value: any
  message: string
  code: string
}

export class TemplateConfigError extends Error {
  constructor(
    message: string,
    public configPath: string,
    public field?: string,
    public validationErrors?: ValidationError[]
  ) {
    super(message)
  }
}
