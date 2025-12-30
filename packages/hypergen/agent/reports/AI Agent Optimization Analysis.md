# AI Agent Optimization Analysis for Hypergen

**Date**: 2025-12-27
**Objective**: Transform Hypergen into an AI-agent-optimized code generation tool that combines deterministic generation with LLM-powered intelligent completion.

## Executive Summary

Hypergen has excellent foundational architecture for becoming an AI-agent-first code generation tool. The existing systems (Recipe Engine, Template Engine, Actions) can be extended with LLM integration to create a hybrid approach where:

1. **Deterministic parts** (boilerplate, structure, imports) are generated via templates
2. **Non-deterministic parts** (business logic, complex implementations) are completed by LLMs
3. **Context optimization** reduces token usage through smart code references and project standards

## Current Architecture Analysis

### Strengths for AI Integration

1. **Modular Tool System** (`src/recipe-engine/tools/`)
   - Already has base tool framework with lifecycle management
   - Easy to add new tool types (e.g., `LLMTool`, `CodeCompletionTool`)
   - Tools support validation, execution, retry logic, and cleanup

2. **Rich Context System** (`src/context.ts`)
   - Template variables available to all generators
   - Helper functions (inflection, case conversion) already integrated
   - Can be extended with project metadata, standards, conventions

3. **Multi-Engine Template Support**
   - EJS and LiquidJS engines already supported
   - Engine factory pattern makes adding AI-powered engines straightforward
   - Templates have YAML frontmatter for metadata

4. **Recipe Step System**
   - Multi-step workflows with dependency resolution
   - Conditional execution based on variables
   - Variable interpolation and inheritance
   - Perfect for orchestrating AI + deterministic generation

5. **Comprehensive Error Handling**
   - Error codes, validation, detailed context
   - Retry mechanisms built into tools
   - Good foundation for handling LLM failures/retries

### Current Limitations for AI Agents

1. **No LLM Integration**
   - No support for calling LLMs within templates
   - No way to defer implementation to AI agents
   - No token optimization strategies

2. **Static Templates Only**
   - Templates are fully deterministic
   - No placeholders for "AI fill this in"
   - No way to generate partial code and have AI complete it

3. **Limited Project Context**
   - No automatic extraction of project standards
   - No codebase analysis for conventions
   - No reference to existing patterns

4. **No Token Management**
   - No concept of context budgets
   - No intelligent code summarization
   - No reference system for existing code

## Proposed Enhancement: AI-Hybrid Generation System

### Core Concept: The "Scaffold + Complete" Pattern

```yaml
# Example template.yml with AI integration
name: create-api-endpoint
description: Create a REST API endpoint with business logic
version: 2.0.0

variables:
  name:
    type: string
    required: true
    description: Endpoint name (e.g., 'users', 'posts')

  method:
    type: enum
    values: [GET, POST, PUT, DELETE]
    default: GET

  hasAuth:
    type: boolean
    default: true

steps:
  # Step 1: Generate deterministic boilerplate
  - type: template
    template: api-endpoint-scaffold.ts.liquid
    to: "src/api/{{ name }}.ts"

  # Step 2: AI completes business logic
  - type: llm-completion
    file: "src/api/{{ name }}.ts"
    markers:
      - "// AI_IMPLEMENT: Input validation"
      - "// AI_IMPLEMENT: Business logic"
      - "// AI_IMPLEMENT: Error handling"
    context:
      projectStandards:
        - ref: "CODING_STANDARDS.md"
        - ref: "API_PATTERNS.md"
      similarCode:
        - pattern: "src/api/*.ts"
          limit: 3
          strategy: "most-similar"
    prompt: |
      Complete the implementation following project standards.
      This is a {{ method }} endpoint for {{ name }}.
      {% if hasAuth %}Include authentication checks.{% endif %}

  # Step 3: Generate tests scaffold
  - type: template
    template: api-endpoint-test.ts.liquid
    to: "src/api/__tests__/{{ name }}.test.ts"

  # Step 4: AI completes test cases
  - type: llm-completion
    file: "src/api/__tests__/{{ name }}.test.ts"
    markers:
      - "// AI_IMPLEMENT: Test cases"
    context:
      testingPatterns:
        - ref: "src/api/__tests__/*.test.ts"
        - limit: 2
```

### Architecture Enhancements

#### 1. New Tool: `LLMCompletionTool`

**Location**: `src/recipe-engine/tools/llm-completion-tool.ts`

**Features**:
- Finds AI markers in generated code (e.g., `// AI_IMPLEMENT: description`)
- Builds optimized context from project files
- Calls LLM API with smart prompting
- Replaces markers with AI-generated code
- Validates generated code (syntax, types, tests)

**Token Optimization Strategies**:
```typescript
interface LLMContextStrategy {
  // Reference existing code without including full source
  references: {
    type: 'file-path' | 'symbol-signature' | 'code-snippet'
    path: string
    description: string
    // Only include minimal context
  }[]

  // Project standards as compressed references
  standards: {
    file: string
    sections: string[] // Only relevant sections
    summary: string // AI-generated summary of standards
  }[]

  // Similar code patterns (most relevant examples)
  patterns: {
    file: string
    relevance: number
    snippet: string // Only the relevant part, not full file
  }[]
}
```

#### 2. Enhanced Template Engine: `AITemplateEngine`

**Location**: `src/template-engines/ai-engine.ts`

**Concept**: Templates can have AI markers that are filled in during rendering

```typescript
// Example template with AI markers
export class AITemplateEngine extends TemplateEngine {
  name = 'ai-template'

  async render(template: string, context: any): Promise<string> {
    // First pass: render deterministic parts with Liquid/EJS
    let rendered = await this.baseEngine.render(template, context)

    // Second pass: find and process AI markers
    const markers = this.extractAIMarkers(rendered)

    for (const marker of markers) {
      const completion = await this.completeWithAI(marker, context)
      rendered = rendered.replace(marker.placeholder, completion)
    }

    return rendered
  }

  private extractAIMarkers(content: string): AIMarker[] {
    // Find patterns like:
    // {{ ai.implement "validation logic" context="validators/*.ts" }}
    // {{ ai.complete type="function" description="..." }}
  }
}
```

**Template Example**:
```liquid
---
to: src/services/{{ name }}.ts
---
import { Service } from '@/types'

export class {{ name | pascalCase }}Service implements Service {
  constructor(
    {{ ai.generate_params
       description="constructor parameters based on service dependencies"
       context="src/services/*.ts"
       strategy="analyze-similar-services" }}
  ) {}

  async execute(input: {{ name | pascalCase }}Input): Promise<{{ name | pascalCase }}Output> {
    {{ ai.implement
       description="implement service logic following project patterns"
       context_files=["ARCHITECTURE.md", "src/services/example-*.ts"]
       constraints=["use dependency injection", "handle errors with Result type"] }}
  }

  {{ ai.generate_methods
     description="generate additional helper methods if needed"
     optional=true }}
}
```

#### 3. Project Context Analyzer

**Location**: `src/ai/context-analyzer.ts`

**Purpose**: Extract and maintain project conventions to reduce LLM context

```typescript
interface ProjectContext {
  // Coding standards (extracted once, cached)
  standards: {
    naming: { files: string, classes: string, functions: string }
    patterns: { errorHandling: string, async: string }
    imports: { preferred: string[], deprecated: string[] }
  }

  // File patterns and conventions
  conventions: {
    fileStructure: Map<string, string> // "services/*.ts" -> "export class XService"
    commonImports: Map<string, string[]> // "services" -> ["@/types", "@/errors"]
    testPatterns: string[] // ["describe", "it.each", "expect"]
  }

  // Code index for smart references
  index: {
    symbols: Map<string, SymbolInfo> // All classes, functions, types
    dependencies: Map<string, string[]> // What imports what
    patterns: Map<string, CodePattern[]> // Recurring patterns
  }
}

class ContextAnalyzer {
  // Analyze project and build context (run once, cache result)
  async analyze(projectRoot: string): Promise<ProjectContext>

  // Find relevant context for a generation task
  async findRelevantContext(
    task: string,
    currentFile: string,
    options: ContextOptions
  ): Promise<OptimizedContext>

  // Generate compact prompt from context
  generatePrompt(context: OptimizedContext): string
}
```

#### 4. Smart Code Reference System

**Location**: `src/ai/code-references.ts`

**Concept**: Instead of including full files in LLM context, use references

```typescript
// Instead of this (high token cost):
const context = `
Here's the entire User service file (500 lines):
${fs.readFileSync('src/services/UserService.ts')}
`

// Do this (low token cost):
const context = `
Reference similar pattern:
- File: src/services/UserService.ts
- Pattern: Service with authentication and validation
- Key methods: execute(), validate(), authenticate()
- Dependencies: @/auth, @/validators, @/db

Follow this structure in your implementation.
`
```

### Implementation Roadmap

#### Phase 1: Foundation (Week 1-2)

1. **Create `LLMCompletionTool`**
   - Basic marker detection and replacement
   - Simple LLM API integration (OpenAI, Anthropic)
   - Token counting and budget management

2. **Add AI markers to template syntax**
   - Extend Liquid engine with custom tags
   - Add `{{ ai.implement }}`, `{{ ai.generate }}` tags
   - Validation and error handling

3. **Create `ProjectContext` system**
   - File indexing and pattern detection
   - Convention extraction
   - Caching layer

#### Phase 2: Smart Context (Week 3-4)

1. **Implement `ContextAnalyzer`**
   - AST-based code analysis (using TypeScript compiler API)
   - Pattern recognition
   - Similarity matching

2. **Build reference system**
   - Code snippet extraction
   - Symbol signature generation
   - Smart file summarization

3. **Token optimization**
   - Context pruning strategies
   - Intelligent code summarization
   - Reference-based prompting

#### Phase 3: Advanced Features (Week 5-6)

1. **Multi-step AI workflows**
   - Generate scaffold → AI complete → Validate → Refine
   - Iterative improvement loops
   - Test-driven generation

2. **Project standards learning**
   - Auto-extract conventions from existing code
   - Build project-specific prompts
   - Maintain standards database

3. **Quality validation**
   - Type checking generated code
   - Running tests
   - ESLint/prettier validation
   - Auto-fix common issues

### Template Examples

#### Example 1: React Component with AI Logic

```liquid
---
to: src/components/{{ name }}/{{ name }}.tsx
---
import React from 'react'
{{ ai.generate_imports
   description="determine needed imports based on component requirements"
   context="src/components/**/*.tsx" }}

interface {{ name }}Props {
  {{ ai.generate_props
     description="generate props based on component purpose: {{ description }}"
     context="src/components/**/*Props.ts" }}
}

export const {{ name }}: React.FC<{{ name }}Props> = ({{ ai.destruct_props }}) => {
  {{ ai.generate_hooks
     description="add necessary hooks (useState, useEffect, etc.)"
     optional=true }}

  {{ ai.implement
     description="implement component logic: {{ description }}"
     constraints=["use TypeScript strictly", "follow React best practices"]
     context_files=["REACT_PATTERNS.md"] }}

  return (
    {{ ai.generate_jsx
       description="generate JSX structure based on purpose and props" }}
  )
}
```

#### Example 2: API Route with Validation

```liquid
---
to: src/api/routes/{{ name }}.ts
---
import { Router } from 'express'
import { z } from 'zod'
{{ ai.generate_imports context="src/api/routes/*.ts" }}

// Input validation schema
const {{ name }}Schema = z.object({
  {{ ai.generate_schema
     description="create Zod schema for {{ method }} {{ name }} endpoint"
     context_files=["API_SPEC.md"]
     similar_patterns="src/api/routes/*.ts" }}
})

export const {{ name }}Router = Router()

{{ name }}Router.{{ method | lowercase }}('/', async (req, res, next) => {
  try {
    // Validate input
    const validated = {{ name }}Schema.parse(req.body)

    {{ ai.implement
       description="implement {{ method }} logic for {{ name }}"
       context={
         "patterns": "src/api/routes/*.ts",
         "standards": "API_PATTERNS.md",
         "database": "src/db/schema.ts"
       }
       constraints=[
         "use transaction if modifying data",
         "return proper HTTP status codes",
         "handle errors with error middleware"
       ] }}
  } catch (error) {
    next(error)
  }
})
```

#### Example 3: Full Feature Recipe

```yaml
name: create-feature
description: Create a complete feature with frontend, backend, and tests

variables:
  featureName:
    type: string
    required: true
  needsAuth:
    type: boolean
    default: true
  hasDatabase:
    type: boolean
    default: true

steps:
  # 1. Generate database schema
  - type: template
    condition: "{{ hasDatabase }}"
    template: db-schema.prisma.liquid
    to: "prisma/schema/{{ featureName }}.prisma"

  - type: llm-completion
    condition: "{{ hasDatabase }}"
    file: "prisma/schema/{{ featureName }}.prisma"
    markers: ["// AI_DESIGN: Schema design"]
    context:
      files: ["prisma/schema/*.prisma"]
      standards: ["DATABASE_DESIGN.md"]

  # 2. Generate backend service
  - type: template
    template: service.ts.liquid
    to: "src/services/{{ featureName }}Service.ts"

  - type: llm-completion
    file: "src/services/{{ featureName }}Service.ts"
    markers:
      - "// AI_IMPLEMENT: Service methods"
      - "// AI_IMPLEMENT: Validation"
    context:
      similar:
        pattern: "src/services/*.ts"
        limit: 3
      standards: ["SERVICE_PATTERNS.md"]

  # 3. Generate API routes
  - type: template
    template: api-routes.ts.liquid
    to: "src/api/{{ featureName }}.ts"

  - type: llm-completion
    file: "src/api/{{ featureName }}.ts"
    prompt: |
      Implement RESTful API routes for {{ featureName }}.
      Follow OpenAPI spec in API_SPEC.md.
      {% if needsAuth %}Include JWT authentication.{% endif %}

  # 4. Generate frontend component
  - type: template
    template: feature-component.tsx.liquid
    to: "src/features/{{ featureName }}/{{ featureName }}.tsx"

  - type: llm-completion
    file: "src/features/{{ featureName }}/{{ featureName }}.tsx"
    context:
      standards: ["REACT_PATTERNS.md", "UI_UX_GUIDELINES.md"]
      similar: "src/features/**/*.tsx"

  # 5. Generate tests (AI-first approach)
  - type: llm-generation
    prompt: |
      Generate comprehensive tests for {{ featureName }}:
      - Unit tests for service
      - Integration tests for API
      - Component tests for UI

      Follow testing patterns in existing test files.
      Use the testing stack: Vitest, React Testing Library, MSW.
    output: "src/features/{{ featureName }}/__tests__/"
    context:
      patterns: "src/**/__tests__/**/*.test.ts"
      standards: "TESTING_GUIDE.md"
    validate:
      - type: "run-tests"
      - type: "coverage-threshold"
        threshold: 80
```

## Token Optimization Strategies

### 1. Reference-Based Context

Instead of full file inclusion:

```typescript
// BAD: High token cost
const prompt = `
Here are 5 similar files (total 3000 lines):
${file1Content}
${file2Content}
${file3Content}
${file4Content}
${file5Content}

Now create a similar file...
`

// GOOD: Low token cost
const prompt = `
Reference similar patterns:

1. src/services/UserService.ts
   - Constructor: (db: Database, auth: AuthService)
   - Methods: execute(), validate(), authenticate()
   - Error handling: Result<T, E> pattern
   - ~120 lines

2. src/services/ProductService.ts
   - Constructor: (db: Database, cache: CacheService)
   - Methods: execute(), validate(), checkCache()
   - Error handling: Result<T, E> pattern
   - ~95 lines

Follow this structure for the new service.
`
```

### 2. Standards Summarization

Pre-process and cache project standards:

```typescript
// Extract once, cache forever
const standards = await extractStandards({
  files: ['CODING_STANDARDS.md', 'ARCHITECTURE.md'],
  output: '.hypergen/standards-summary.json'
})

// Use compressed version in prompts
const prompt = `
Project standards:
- Naming: PascalCase classes, camelCase variables
- Imports: Always use @ aliases, prefer named imports
- Errors: Use Result<T, E> type, never throw
- Async: Always use async/await, no .then()
- Tests: describe/it, expect, 80% coverage

${standards.summary} // Pre-generated AI summary
`
```

### 3. Smart Pattern Matching

Find most relevant examples:

```typescript
interface PatternMatcher {
  // Find files most similar to current task
  findSimilar(
    task: string,
    filePattern: string,
    options: {
      limit: number
      strategy: 'embeddings' | 'keywords' | 'structure'
      threshold: number
    }
  ): Promise<SimilarFile[]>
}

// Usage in template
{{ ai.implement
   context_similar={
     pattern: "src/services/*.ts",
     limit: 2,  // Only 2 most relevant examples
     strategy: "embeddings",  // Use semantic similarity
     threshold: 0.7  // Minimum similarity score
   } }}
```

### 4. Incremental Context

Build context incrementally as AI generates code:

```typescript
// Instead of providing all context upfront
// Provide minimal context and expand only if needed

Step 1: Generate with minimal context
  → If AI asks questions, provide more context
  → If AI makes mistakes, provide corrections
  → Learn what context is actually needed

Step 2: Cache optimal context for similar tasks
  → Next time, use learned context
  → Continuously improve context selection
```

## Benefits for AI Agents

### For Claude Code / AI Assistants

1. **Reduced Context Load**
   - Reference system means less code in context
   - Project standards pre-summarized
   - Only relevant examples included

2. **Standardized Integration**
   - AI agents can call hypergen to generate scaffolding
   - Hypergen calls back to AI for complex logic
   - Clear separation of concerns

3. **Iterative Refinement**
   - Generate → Validate → Refine loop
   - AI can focus on one piece at a time
   - Incremental context building

4. **Project Awareness**
   - Hypergen maintains project context
   - AI doesn't need to re-analyze project each time
   - Conventions automatically applied

### For Human Developers

1. **Faster Development**
   - Boilerplate instantly generated
   - AI completes complex logic
   - Tests auto-generated

2. **Consistency**
   - Project standards automatically enforced
   - Patterns from existing code reused
   - No deviation from conventions

3. **Quality**
   - Generated code follows best practices
   - Tests included by default
   - Validation runs automatically

## Implementation Considerations

### LLM Provider Abstraction

```typescript
interface LLMProvider {
  name: string

  complete(
    prompt: string,
    options: {
      maxTokens?: number
      temperature?: number
      model?: string
    }
  ): Promise<string>

  countTokens(text: string): number

  estimateCost(tokens: number): number
}

// Support multiple providers
class OpenAIProvider implements LLMProvider { }
class AnthropicProvider implements LLMProvider { }
class LocalLLMProvider implements LLMProvider { } // Ollama, etc.
```

### Configuration

```javascript
// hypergen.config.js
export default {
  ai: {
    provider: 'anthropic', // or 'openai', 'local'
    model: 'claude-sonnet-4',
    apiKey: process.env.ANTHROPIC_API_KEY,

    // Token budget per generation
    maxTokens: 4000,

    // Context optimization
    contextStrategy: {
      maxReferenceFiles: 5,
      maxSimilarPatterns: 3,
      includeStandards: true,
      cacheContext: true
    },

    // Validation
    validate: {
      syntax: true,
      types: true,
      tests: true,
      lint: true
    },

    // Retry configuration
    retry: {
      maxAttempts: 3,
      onFailure: 'prompt-refinement' // or 'ask-user', 'skip'
    }
  },

  // Project context configuration
  projectContext: {
    standards: [
      'CODING_STANDARDS.md',
      'ARCHITECTURE.md',
      'API_PATTERNS.md'
    ],

    // Auto-extract conventions
    learnFrom: [
      'src/**/*.ts',
      'src/**/*.tsx'
    ],

    // Cache location
    cache: '.hypergen/context-cache'
  }
}
```

## Conclusion

Hypergen is well-positioned to become an AI-agent-optimized code generation tool. The existing architecture provides:

- ✅ Modular tool system for adding AI capabilities
- ✅ Recipe step system for orchestrating AI + deterministic generation
- ✅ Template engine extensibility for AI markers
- ✅ Context system for variable management
- ✅ Error handling and validation framework

**Key Innovation**: The "scaffold + complete" pattern where:
1. Hypergen generates deterministic boilerplate
2. AI completes non-deterministic logic
3. Context is optimized through references and standards
4. Validation ensures quality

**Primary Benefit**: Dramatically reduces AI agent token usage while maintaining code quality and project consistency.

**Next Steps**:
1. Implement `LLMCompletionTool` as proof of concept
2. Add AI markers to Liquid template engine
3. Build basic `ProjectContext` analyzer
4. Create example templates demonstrating the pattern
5. Benchmark token usage vs traditional approaches
