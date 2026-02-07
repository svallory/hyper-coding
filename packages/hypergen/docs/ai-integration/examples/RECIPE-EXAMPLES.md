# AI Recipe Examples

Examples using the `AIStep` interface defined in `src/recipe-engine/types.ts`.

---

## Example 1: Scaffold + Complete (API Endpoint)

This is the core pattern: a template step generates the file skeleton, then an AI step fills in the business logic.

```yaml
name: create-api-endpoint
description: Create a REST API endpoint with AI-completed business logic

variables:
  name:
    type: string
    required: true
    description: Endpoint name (e.g., 'users', 'posts')

steps:
  # Step 1: Deterministic scaffold via template
  - name: scaffold
    tool: template
    template: api-endpoint.ts.liquid
    to: "src/api/{{ name }}.ts"

  # Step 2: AI completes the handler logic
  - name: complete-handler
    tool: ai
    prompt: |
      Complete the {{ name }} API endpoint handler.
      Implement the request processing logic using Prisma for database access.
      Return proper HTTP status codes. Handle errors via next(error).
    output:
      mode: inject
      to: "src/api/{{ name }}.ts"
      marker: "// AI:HANDLER"
    context:
      files:
        - "src/api/users.ts"
        - "docs/API_STANDARDS.md"
    guardrails:
      mustInclude: ["async", "try", "catch"]
      maxRetries: 2
    temperature: 0.7
    maxTokens: 2048
```

---

## Example 2: AI-Only Generation

No template step -- the AI generates the entire file.

```yaml
name: generate-tests
description: Generate test file for an existing module

variables:
  module:
    type: string
    required: true

steps:
  - name: generate
    tool: ai
    prompt: |
      Generate comprehensive Vitest tests for the module at src/{{ module }}.ts.
      Cover: happy path, error cases, edge cases.
      Use describe/it blocks. Mock external dependencies.
    output:
      mode: create
      to: "src/__tests__/{{ module }}.test.ts"
    context:
      files:
        - "src/{{ module }}.ts"
        - "src/__tests__/users.test.ts"
    examples:
      - input: "Generate tests for a simple add function"
        output: |
          import { describe, it, expect } from 'vitest'
          import { add } from '../math'

          describe('add', () => {
            it('adds two positive numbers', () => {
              expect(add(1, 2)).toBe(3)
            })
          })
    guardrails:
      mustInclude: ["describe", "it", "expect"]
      mustNotInclude: ["console.log"]
    maxTokens: 4096
```

---

## Example 3: Multi-Step with Budget

```yaml
name: create-feature
description: Create a complete feature with service, route, and tests

variables:
  feature:
    type: string
    required: true

steps:
  - name: scaffold-service
    tool: template
    template: service.ts.liquid
    to: "src/services/{{ feature }}Service.ts"

  - name: complete-service
    tool: ai
    prompt: |
      Implement the service methods for {{ feature }}Service.
      Use Prisma for data access. Return Result types for error handling.
    output:
      mode: inject
      to: "src/services/{{ feature }}Service.ts"
      marker: "// AI:METHODS"
    context:
      files:
        - "src/services/UserService.ts"
        - "prisma/schema.prisma"
    budget:
      maxTokensPerStep: 4000
      maxCostPerStep: 0.25

  - name: scaffold-route
    tool: template
    template: route.ts.liquid
    to: "src/api/{{ feature }}.ts"

  - name: complete-route
    tool: ai
    prompt: |
      Implement the API route handlers for {{ feature }}.
      Call {{ feature }}Service methods. Validate input with Zod.
    output:
      mode: inject
      to: "src/api/{{ feature }}.ts"
      marker: "// AI:HANDLERS"
    context:
      files:
        - "src/api/users.ts"
        - "src/services/{{ feature }}Service.ts"
    budget:
      maxTokensPerStep: 3000
      maxCostPerStep: 0.20

  - name: generate-tests
    tool: ai
    prompt: |
      Generate tests for {{ feature }}Service and the {{ feature }} API route.
    output:
      mode: create
      to: "src/__tests__/{{ feature }}.test.ts"
    context:
      files:
        - "src/services/{{ feature }}Service.ts"
        - "src/api/{{ feature }}.ts"
        - "src/__tests__/users.test.ts"
    budget:
      maxTokensPerStep: 4000
```

---

## Using `{% ai %}` in Templates

The `{% ai %}` tag can also be used directly in LiquidJS templates:

```liquid
---
to: src/services/{{ name }}Service.ts
---
import { prisma } from '../db'

export class {{ name | pascalCase }}Service {
  {% ai model="claude-sonnet-4-5" %}
  Implement CRUD methods for {{ name }}.
  Follow the pattern in UserService.
  Use Prisma for database access.
  Return Result<T, Error> types.
  {% endai %}
}
```

If AI is unavailable (no API key, network error), the tag emits a warning comment in the output instead of crashing the template.
