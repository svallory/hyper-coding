# AI Integration Summary - Quick Reference

## The Core Idea: Hybrid Generation

**Problem**: AI agents waste tokens regenerating boilerplate and need full project context.

**Solution**: Split generation into deterministic + AI-powered parts.

```
┌─────────────────────────────────────────────────┐
│  HYPERGEN (Deterministic)                       │
│  • File structure                               │
│  • Imports & exports                            │
│  • Type definitions                             │
│  • Boilerplate code                             │
│  • Test scaffolding                             │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  AI (Smart Completion)                          │
│  • Business logic                               │
│  • Complex algorithms                           │
│  • Edge case handling                           │
│  • Test cases                                   │
│  • Documentation                                │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  VALIDATION                                     │
│  • Type checking                                │
│  • Tests run                                    │
│  • Linting                                      │
│  • Project standards                            │
└─────────────────────────────────────────────────┘
```

## Token Optimization Techniques

### 1. References Instead of Full Code

**Before (❌ 2000+ tokens)**:
```
Here are 3 similar files to follow:
[Full content of UserService.ts - 800 lines]
[Full content of ProductService.ts - 700 lines]
[Full content of OrderService.ts - 600 lines]
```

**After (✅ ~150 tokens)**:
```
Reference these patterns:

src/services/UserService.ts
- Constructor: (db, auth, logger)
- Pattern: Result<T, E> error handling
- Key methods: execute(), validate()

src/services/ProductService.ts
- Constructor: (db, cache, logger)
- Pattern: Result<T, E> error handling
- Key methods: execute(), checkCache()

Follow this structure.
```

**Savings**: 93% token reduction

### 2. AI Markers in Templates

Instead of fully implementing in templates or asking AI to generate everything:

```liquid
---
to: src/api/{{ name }}.ts
---
import { Router } from 'express'

export const {{ name }}Router = Router()

{{ name }}Router.get('/', async (req, res) => {
  {{ ai.implement
     description="fetch {{ name }} from database with pagination"
     context="src/api/users.ts"  # Similar example
     constraints=["use Prisma", "max 100 items per page"] }}
})
```

AI only generates the 5-10 lines of business logic, not the entire file structure.

## Key Components to Build

### 1. LLMCompletionTool
```typescript
// src/recipe-engine/tools/llm-completion-tool.ts

class LLMCompletionTool extends Tool {
  async execute(step, context) {
    // 1. Find AI markers in file
    const markers = this.findMarkers(step.file)

    // 2. Build optimized context (standards + similar code)
    const optimizedContext = await this.buildContext(markers)

    // 3. Call LLM with prompt
    const completion = await this.llm.complete({
      prompt: this.buildPrompt(markers, optimizedContext),
      maxTokens: 2000
    })

    // 4. Replace markers with generated code
    const updated = this.replaceMarkers(fileContent, completion)

    // 5. Validate generated code
    await this.validate(updated)

    return { success: true, file: step.file }
  }
}
```

### 2. AI Template Tags
```typescript
// src/template-engines/ai-tags.ts

// Liquid custom tags for AI
Liquid.registerTag('ai.implement', class {
  async render(context, emitter) {
    const { description, context: ctx, constraints } = this.args

    // Queue for later AI completion
    emitter.write(`// AI_IMPLEMENT: ${description}`)
    emitter.write(`// Context: ${ctx}`)
    emitter.write(`// Constraints: ${constraints.join(', ')}`)
  }
})
```

### 3. Project Context Analyzer
```typescript
// src/ai/context-analyzer.ts

class ContextAnalyzer {
  async analyze(projectRoot: string) {
    return {
      // Extract patterns from existing code
      patterns: await this.extractPatterns('src/**/*.ts'),

      // Learn naming conventions
      conventions: await this.learnConventions(),

      // Build standards summary
      standards: await this.summarizeStandards([
        'CODING_STANDARDS.md',
        'ARCHITECTURE.md'
      ])
    }
  }

  async findSimilar(file: string, pattern: string) {
    // Use embeddings or AST similarity
    return this.index.findMostSimilar(file, pattern, limit: 3)
  }
}
```

## Example Usage

### Generate API Endpoint
```bash
hypergen recipe create-endpoint \
  --name=posts \
  --method=GET \
  --auth=true
```

**What happens**:
1. Template generates file structure (10 lines)
2. AI completes validation logic (5 lines)
3. AI completes database query (8 lines)
4. AI completes error handling (6 lines)
5. Template generates test scaffold (15 lines)
6. AI completes test cases (20 lines)

**Total**: 64 lines generated with ~800 tokens vs ~3000 tokens for full AI generation

### Generate Full Feature
```bash
hypergen recipe create-feature \
  --name=user-profile \
  --with-db \
  --with-auth
```

**Generates**:
- ✅ Database schema (template + AI)
- ✅ Backend service (template + AI)
- ✅ API routes (template + AI)
- ✅ Frontend component (template + AI)
- ✅ Tests for all layers (template + AI)

**Token usage**: ~2500 tokens vs ~15000 tokens for full AI generation

## Configuration

```javascript
// hypergen.config.js
export default {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4',

    contextStrategy: {
      maxReferenceFiles: 5,      // Limit similar files
      maxSimilarPatterns: 3,     // Limit patterns
      includeStandards: true,    // Include project standards
      useReferences: true        // Use refs instead of full code
    },

    validation: {
      syntax: true,              // Check TypeScript syntax
      types: true,               // Run type checker
      tests: true,               // Run generated tests
      lint: true                 // Run linter
    }
  },

  projectContext: {
    standards: [
      'docs/CODING_STANDARDS.md',
      'docs/ARCHITECTURE.md'
    ],
    learnFrom: 'src/**/*.ts'
  }
}
```

## Benefits

### For AI Agents (Claude Code, GitHub Copilot, etc.)

| Aspect | Traditional | With Hypergen |
|--------|-------------|---------------|
| **Token usage** | ~5000 per feature | ~1000 per feature |
| **Context window** | Full codebase | Standards + references |
| **Consistency** | Variable | Enforced by templates |
| **Boilerplate** | AI generates | Template generates |
| **Focus** | Everything | Business logic only |

### For Developers

| Aspect | Benefit |
|--------|---------|
| **Speed** | 5-10x faster than manual coding |
| **Quality** | Standards automatically applied |
| **Tests** | Generated with implementation |
| **Consistency** | All code follows patterns |
| **Learning** | Project conventions auto-extracted |

## Implementation Priority

### Phase 1 (MVP - 2 weeks)
1. ✅ `LLMCompletionTool` - Basic AI marker replacement
2. ✅ AI template tags - `{{ ai.implement }}`
3. ✅ OpenAI/Anthropic integration
4. ✅ Basic validation

### Phase 2 (Smart Context - 2 weeks)
1. ✅ Context analyzer
2. ✅ Reference system
3. ✅ Pattern matching
4. ✅ Standards summarization

### Phase 3 (Production - 2 weeks)
1. ✅ Multiple LLM providers
2. ✅ Advanced validation
3. ✅ Iterative refinement
4. ✅ Token usage analytics

## ROI Analysis

**Without AI Integration**:
- Developer writes everything manually: ~4 hours per feature
- AI agent regenerates boilerplate: ~1500 tokens per feature
- Inconsistencies across codebase

**With AI Integration**:
- Template generates boilerplate: instant
- AI completes logic: ~500 tokens per feature
- Consistent patterns enforced

**Savings**:
- ⏱️ Time: 75% reduction
- 💰 Tokens: 67% reduction
- ✅ Quality: Consistent standards
- 🎯 Focus: Only complex logic

## Next Steps

1. **Proof of Concept**: Implement `LLMCompletionTool` with basic markers
2. **Example Templates**: Create 3-5 templates showing the pattern
3. **Documentation**: Write guide for template authors
4. **Benchmark**: Compare token usage vs traditional AI generation
5. **Iterate**: Gather feedback and refine approach
