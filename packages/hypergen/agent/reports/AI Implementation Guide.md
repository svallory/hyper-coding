# AI Integration Implementation Guide

## Quick Start: Building Your First AI-Powered Template

### Step 1: Create the Template File

**File**: `_templates/api-endpoint/create/endpoint.ts.liquid`

```liquid
---
to: src/api/{{ name }}.ts
---
import { Router } from 'express'
import { z } from 'zod'

// Validation schema
const {{ name | pascalCase }}Schema = z.object({
  // AI_IMPLEMENT: Define schema fields
  // Description: Create validation schema for {{ method }} {{ name }}
  // Context: src/api/*.ts
  // Constraints: Use Zod for validation, include all required fields
})

export const {{ name | camelCase }}Router = Router()

{{ name | camelCase }}Router.{{ method | lowercase }}('/', async (req, res, next) => {
  try {
    const validated = {{ name | pascalCase }}Schema.parse(req.body)

    // AI_IMPLEMENT: Business logic
    // Description: Implement {{ method }} {{ name }} endpoint logic
    // Context: src/api/users.ts, src/api/posts.ts
    // Constraints: Use Prisma for database, return JSON response, handle errors properly

  } catch (error) {
    next(error)
  }
})
```

### Step 2: Create the Recipe

**File**: `_templates/api-endpoint/create/recipe.yml`

```yaml
name: create-api-endpoint
description: Create REST API endpoint with AI-completed logic
version: 1.0.0

variables:
  name:
    type: string
    required: true
    description: Endpoint name (e.g., 'users', 'posts')

  method:
    type: enum
    values: [GET, POST, PUT, DELETE]
    default: GET
    description: HTTP method

steps:
  # Step 1: Generate template scaffold
  - type: template
    template: endpoint.ts.liquid
    to: "src/api/{{ name }}.ts"

  # Step 2: Complete with AI
  - type: llm-completion
    file: "src/api/{{ name }}.ts"
    provider: anthropic
    model: claude-sonnet-4
    context:
      standards:
        - file: docs/API_STANDARDS.md
          sections: [error-handling, validation, response-format]
      similar:
        pattern: "src/api/*.ts"
        limit: 2
        strategy: most-similar
    validation:
      - syntax-check
      - type-check
      - lint

  # Step 3: Generate tests
  - type: template
    template: endpoint.test.ts.liquid
    to: "src/api/__tests__/{{ name }}.test.ts"

  # Step 4: Complete test cases with AI
  - type: llm-completion
    file: "src/api/__tests__/{{ name }}.test.ts"
    context:
      standards:
        - file: docs/TESTING_GUIDE.md
      patterns:
        - "src/api/__tests__/*.test.ts"
    validation:
      - run-tests
```

### Step 3: Run the Generator

```bash
hypergen recipe create-api-endpoint \
  --name=posts \
  --method=POST
```

## Core Components Implementation

### Component 1: LLM Completion Tool

**File**: `src/recipe-engine/tools/llm-completion-tool.ts`

```typescript
import { Tool, type ToolValidationResult } from './base.js'
import type { LLMCompletionStep, StepContext, StepResult } from '../types.js'
import fs from 'fs-extra'
import path from 'path'

interface AIMarker {
  type: 'implement' | 'generate' | 'complete'
  description: string
  context?: string[]
  constraints?: string[]
  lineNumber: number
  placeholder: string
}

export class LLMCompletionTool extends Tool<LLMCompletionStep> {
  private llmProvider: LLMProvider

  async onInitialize(): Promise<void> {
    // Initialize LLM provider based on config
    const provider = this.options.provider || 'anthropic'
    this.llmProvider = await createLLMProvider(provider, {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: this.options.model || 'claude-sonnet-4'
    })
  }

  protected async onValidate(
    step: LLMCompletionStep,
    context: StepContext
  ): Promise<ToolValidationResult> {
    const errors: string[] = []

    // Check if file exists
    const filePath = path.resolve(context.workingDir, step.file)
    if (!await fs.pathExists(filePath)) {
      errors.push(`File not found: ${step.file}`)
    }

    // Check if LLM provider is configured
    if (!this.llmProvider) {
      errors.push('LLM provider not configured')
    }

    // Estimate token usage
    const content = await fs.readFile(filePath, 'utf-8')
    const markers = this.extractMarkers(content)
    const estimatedTokens = this.estimateTokens(markers, step.context)

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      suggestions: [],
      estimatedExecutionTime: estimatedTokens * 0.01, // Rough estimate
      resourceRequirements: {
        network: true
      }
    }
  }

  protected async onExecute(
    step: LLMCompletionStep,
    context: StepContext
  ): Promise<StepResult> {
    const filePath = path.resolve(context.workingDir, step.file)
    let content = await fs.readFile(filePath, 'utf-8')

    // Extract AI markers
    const markers = this.extractMarkers(content)
    this.debug('Found %d AI markers in %s', markers.length, step.file)

    // Build optimized context
    const optimizedContext = await this.buildOptimizedContext(
      step.context,
      context.workingDir
    )

    // Process each marker
    for (const marker of markers) {
      this.debug('Processing marker: %s', marker.description)

      // Build prompt for this marker
      const prompt = this.buildPrompt(marker, optimizedContext, context.variables)

      // Call LLM
      const completion = await this.llmProvider.complete(prompt, {
        maxTokens: step.maxTokens || 2000,
        temperature: step.temperature || 0.7
      })

      // Replace marker with completion
      content = this.replaceMarker(content, marker, completion)
    }

    // Write updated content
    await fs.writeFile(filePath, content, 'utf-8')

    // Validate if requested
    if (step.validation) {
      await this.validateGenerated(filePath, step.validation)
    }

    return {
      status: 'completed',
      message: `Completed AI generation for ${step.file}`,
      filesModified: [step.file],
      metadata: {
        markersProcessed: markers.length,
        tokensUsed: await this.llmProvider.getLastUsage()
      }
    }
  }

  private extractMarkers(content: string): AIMarker[] {
    const markers: AIMarker[] = []
    const lines = content.split('\n')

    let currentMarker: Partial<AIMarker> | null = null
    let markerStartLine = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Detect marker start: // AI_IMPLEMENT: description
      const implementMatch = line.match(/\/\/\s*AI_IMPLEMENT:\s*(.+)/)
      if (implementMatch) {
        currentMarker = {
          type: 'implement',
          description: implementMatch[1].trim(),
          lineNumber: i
        }
        markerStartLine = i
        continue
      }

      // Detect context line: // Context: file patterns
      const contextMatch = line.match(/\/\/\s*Context:\s*(.+)/)
      if (contextMatch && currentMarker) {
        currentMarker.context = contextMatch[1].split(',').map(s => s.trim())
        continue
      }

      // Detect constraints: // Constraints: rules
      const constraintsMatch = line.match(/\/\/\s*Constraints:\s*(.+)/)
      if (constraintsMatch && currentMarker) {
        currentMarker.constraints = constraintsMatch[1].split(',').map(s => s.trim())
        continue
      }

      // End of marker block (non-comment line or empty line)
      if (currentMarker && (!line.trim().startsWith('//') || !line.trim())) {
        // Build placeholder text
        const placeholderLines = lines.slice(markerStartLine, i)
        currentMarker.placeholder = placeholderLines.join('\n')

        markers.push(currentMarker as AIMarker)
        currentMarker = null
        markerStartLine = -1
      }
    }

    return markers
  }

  private async buildOptimizedContext(
    contextConfig: any,
    workingDir: string
  ): Promise<OptimizedContext> {
    const context: OptimizedContext = {
      standards: [],
      similar: [],
      patterns: []
    }

    // Load standards with only relevant sections
    if (contextConfig.standards) {
      for (const standard of contextConfig.standards) {
        const fullPath = path.resolve(workingDir, standard.file)
        const content = await fs.readFile(fullPath, 'utf-8')

        // Extract only relevant sections if specified
        let relevantContent = content
        if (standard.sections) {
          relevantContent = this.extractSections(content, standard.sections)
        }

        context.standards.push({
          file: standard.file,
          content: this.summarize(relevantContent, 500) // Max 500 chars
        })
      }
    }

    // Find similar files
    if (contextConfig.similar) {
      const pattern = contextConfig.similar.pattern
      const limit = contextConfig.similar.limit || 3

      const similarFiles = await this.findSimilarFiles(
        workingDir,
        pattern,
        limit
      )

      context.similar = similarFiles.map(file => ({
        file: file.path,
        relevance: file.score,
        summary: this.extractSignature(file.content) // Only signatures, not full code
      }))
    }

    return context
  }

  private buildPrompt(
    marker: AIMarker,
    context: OptimizedContext,
    variables: Record<string, any>
  ): string {
    let prompt = `You are implementing code for a project.

TASK: ${marker.description}

PROJECT STANDARDS:
${context.standards.map(s => `- ${s.file}:\n  ${s.content}`).join('\n')}

SIMILAR CODE PATTERNS:
${context.similar.map(s => `- ${s.file} (relevance: ${s.relevance}):\n  ${s.summary}`).join('\n')}

CONSTRAINTS:
${marker.constraints?.map(c => `- ${c}`).join('\n') || 'None'}

VARIABLES:
${Object.entries(variables).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Generate ONLY the code implementation. Do not include comments explaining what you did.
Match the indentation of the surrounding code.
`

    return prompt
  }

  private replaceMarker(
    content: string,
    marker: AIMarker,
    completion: string
  ): string {
    // Replace the marker placeholder with generated code
    return content.replace(marker.placeholder, completion.trim())
  }

  private extractSignature(content: string): string {
    // Extract function/class signatures without implementations
    // This gives AI the pattern without full code
    const signatures: string[] = []

    // Match function signatures
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g
    let match
    while ((match = funcRegex.exec(content)) !== null) {
      signatures.push(match[0])
    }

    // Match class signatures
    const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g
    while ((match = classRegex.exec(content)) !== null) {
      signatures.push(match[0])
    }

    return signatures.slice(0, 5).join('\n') // Max 5 signatures
  }

  private summarize(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text

    // Simple truncation with ellipsis
    return text.slice(0, maxLength - 3) + '...'
  }

  private async validateGenerated(
    filePath: string,
    validations: string[]
  ): Promise<void> {
    for (const validation of validations) {
      switch (validation) {
        case 'syntax-check':
          await this.checkSyntax(filePath)
          break
        case 'type-check':
          await this.checkTypes(filePath)
          break
        case 'lint':
          await this.runLint(filePath)
          break
        case 'run-tests':
          await this.runTests(filePath)
          break
      }
    }
  }

  private estimateTokens(markers: AIMarker[], context: any): number {
    // Rough estimation
    const markerTokens = markers.length * 500
    const contextTokens = 1000 // Fixed context overhead
    return markerTokens + contextTokens
  }
}

interface OptimizedContext {
  standards: Array<{ file: string; content: string }>
  similar: Array<{ file: string; relevance: number; summary: string }>
  patterns: Array<{ pattern: string; description: string }>
}

interface LLMProvider {
  complete(prompt: string, options: any): Promise<string>
  getLastUsage(): Promise<number>
}
```

### Component 2: AI Template Tags for Liquid

**File**: `src/template-engines/liquid-ai-tags.ts`

```typescript
import { Liquid } from 'liquidjs'

export function registerAITags(liquid: Liquid) {
  // {{ ai.implement description="..." context="..." constraints="..." }}
  liquid.registerTag('ai.implement', {
    parse(tagToken, remainTokens) {
      this.args = tagToken.args
    },

    render(scope, emitter) {
      const description = scope.evaluate(this.args.description)
      const context = scope.evaluate(this.args.context)
      const constraints = scope.evaluate(this.args.constraints)

      // Generate marker that LLMCompletionTool will process
      emitter.write('// AI_IMPLEMENT: ' + description + '\n')

      if (context) {
        emitter.write('// Context: ' + context + '\n')
      }

      if (constraints) {
        const constraintList = Array.isArray(constraints)
          ? constraints.join(', ')
          : constraints
        emitter.write('// Constraints: ' + constraintList + '\n')
      }
    }
  })

  // {{ ai.generate_imports context="..." }}
  liquid.registerTag('ai.generate_imports', {
    parse(tagToken, remainTokens) {
      this.args = tagToken.args
    },

    render(scope, emitter) {
      const context = scope.evaluate(this.args.context)

      emitter.write('// AI_IMPLEMENT: Generate necessary imports\n')
      emitter.write('// Context: ' + context + '\n')
      emitter.write('// Constraints: Use named imports, prefer @ path aliases\n')
    }
  })

  // More tags...
}
```

### Component 3: Recipe Step Type Definition

**File**: `src/recipe-engine/types.ts` (additions)

```typescript
export interface LLMCompletionStep {
  type: 'llm-completion'
  id?: string
  name?: string
  description?: string

  // File to process (must already exist)
  file: string

  // LLM provider configuration
  provider?: 'openai' | 'anthropic' | 'local'
  model?: string
  maxTokens?: number
  temperature?: number

  // Context configuration
  context?: {
    // Standards to include
    standards?: Array<{
      file: string
      sections?: string[]
    }>

    // Similar code to reference
    similar?: {
      pattern: string
      limit?: number
      strategy?: 'most-similar' | 'random'
    }

    // Additional patterns
    patterns?: string[]
  }

  // Validation to run after generation
  validation?: Array<'syntax-check' | 'type-check' | 'lint' | 'run-tests'>

  // Retry configuration
  retries?: number
  retryDelay?: number

  // Conditional execution
  condition?: string
}

// Update RecipeStepUnion
export type RecipeStepUnion =
  | TemplateStep
  | ActionStep
  | CodeModStep
  | RecipeStep
  | ShellStep
  | ConditionalStep
  | LLMCompletionStep  // New!
```

## Testing Your AI Integration

### Test 1: Simple AI Completion

```typescript
// tests/llm-completion.test.ts
import { describe, it, expect } from 'vitest'
import { LLMCompletionTool } from '../src/recipe-engine/tools/llm-completion-tool'
import fs from 'fs-extra'

describe('LLMCompletionTool', () => {
  it('should extract AI markers from file', async () => {
    const content = `
import { Router } from 'express'

// AI_IMPLEMENT: Create user endpoint
// Context: src/api/posts.ts
// Constraints: Use Prisma, validate input

export const userRouter = Router()
    `.trim()

    await fs.writeFile('/tmp/test.ts', content)

    const tool = new LLMCompletionTool()
    await tool.initialize()

    const markers = (tool as any).extractMarkers(content)

    expect(markers).toHaveLength(1)
    expect(markers[0].description).toBe('Create user endpoint')
    expect(markers[0].context).toContain('src/api/posts.ts')
  })

  it('should complete code with AI', async () => {
    // Mock LLM provider
    const mockProvider = {
      complete: vi.fn().mockResolvedValue(`
        userRouter.get('/', async (req, res) => {
          const users = await prisma.user.findMany()
          res.json(users)
        })
      `)
    }

    const tool = new LLMCompletionTool('test', { provider: mockProvider })

    // ... test AI completion
  })
})
```

### Test 2: Full Recipe with AI

```bash
# Create test recipe
mkdir -p _templates/test-ai/create
cat > _templates/test-ai/create/recipe.yml << 'EOF'
name: test-ai-generation
steps:
  - type: template
    template: scaffold.ts.liquid
    to: test-output.ts

  - type: llm-completion
    file: test-output.ts
EOF

# Run recipe
hypergen recipe test-ai-generation --name=TestService
```

## Best Practices

### 1. Marker Placement

✅ **Good**: Clear, specific markers
```typescript
// AI_IMPLEMENT: Validate user input
// Context: src/validators/*.ts
// Constraints: Use Zod, check email format, min password length 8
```

❌ **Bad**: Vague markers
```typescript
// AI_IMPLEMENT: Do stuff here
```

### 2. Context Optimization

✅ **Good**: Minimal, relevant context
```yaml
context:
  similar:
    pattern: "src/services/User*.ts"  # Specific pattern
    limit: 2                          # Only most relevant
  standards:
    - file: CODING_STANDARDS.md
      sections: [error-handling]      # Only relevant section
```

❌ **Bad**: Everything included
```yaml
context:
  similar:
    pattern: "src/**/*.ts"  # Too broad
    limit: 20               # Too many
  standards:
    - file: CODING_STANDARDS.md  # Entire file
```

### 3. Progressive Refinement

Start simple, add complexity:

```yaml
# Version 1: Basic scaffold
steps:
  - type: template
    template: basic.ts.liquid

# Version 2: Add AI completion
steps:
  - type: template
    template: basic.ts.liquid
  - type: llm-completion
    file: output.ts

# Version 3: Add validation
steps:
  - type: template
    template: basic.ts.liquid
  - type: llm-completion
    file: output.ts
    validation: [syntax-check, type-check]

# Version 4: Add tests
steps:
  - type: template
    template: basic.ts.liquid
  - type: llm-completion
    file: output.ts
    validation: [syntax-check, type-check]
  - type: template
    template: tests.ts.liquid
  - type: llm-completion
    file: tests.ts
    validation: [run-tests]
```

## Troubleshooting

### Issue: AI generates incorrect code

**Solution**: Add more specific constraints
```yaml
constraints:
  - "Use TypeScript strict mode"
  - "Return Result<T, E> type, never throw"
  - "Include JSDoc comments"
  - "Follow existing pattern in src/services/UserService.ts"
```

### Issue: Token usage too high

**Solution**: Use reference strategy
```yaml
context:
  similar:
    strategy: signatures-only  # Only function/class signatures
    limit: 3                   # Reduce number of examples
```

### Issue: Generated code doesn't match style

**Solution**: Include style guide in standards
```yaml
context:
  standards:
    - file: .eslintrc.json
    - file: STYLE_GUIDE.md
      sections: [naming, formatting]
```

## Next Steps

1. ✅ Implement `LLMCompletionTool` basic version
2. ✅ Add AI tags to Liquid engine
3. ✅ Create 3-5 example templates
4. ✅ Write integration tests
5. ✅ Document usage patterns
6. ✅ Gather feedback from real usage
