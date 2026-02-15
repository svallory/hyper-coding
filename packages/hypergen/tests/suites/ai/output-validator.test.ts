import { describe, it, expect } from 'vitest'
import { validateOutput, buildValidationFeedback } from '#/ai/output-validator'
import path from 'path'

const projectRoot = path.resolve(__dirname, '../../..')

describe('validateOutput', () => {
  describe('without guardrails', () => {
    it('passes any non-empty output', async () => {
      const result = await validateOutput('some output', undefined, projectRoot)
      expect(result.passed).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('empty output detection', () => {
    it('fails on empty output', async () => {
      const result = await validateOutput('', { validateSyntax: false }, projectRoot)
      expect(result.passed).toBe(false)
      expect(result.errors).toContain('AI returned empty output')
    })

    it('warns on very short output', async () => {
      const result = await validateOutput('hi', {}, projectRoot)
      expect(result.warnings).toContain('AI output is suspiciously short')
    })
  })

  describe('JSON syntax validation', () => {
    it('passes valid JSON', async () => {
      const result = await validateOutput('{"key": "value"}', { validateSyntax: 'json' }, projectRoot)
      expect(result.passed).toBe(true)
    })

    it('fails invalid JSON', async () => {
      const result = await validateOutput('{invalid}', { validateSyntax: 'json' }, projectRoot)
      expect(result.passed).toBe(false)
      expect(result.errors[0]).toContain('JSON syntax error')
    })
  })

  describe('maxOutputLength', () => {
    it('passes when under limit', async () => {
      const result = await validateOutput('short', { maxOutputLength: 100 }, projectRoot)
      expect(result.passed).toBe(true)
    })

    it('fails when over limit', async () => {
      const result = await validateOutput('a'.repeat(200), { maxOutputLength: 100 }, projectRoot)
      expect(result.passed).toBe(false)
      expect(result.errors[0]).toContain('exceeds maximum')
    })
  })

  describe('import validation', () => {
    it('detects unknown imports when requireKnownImports is true', async () => {
      const code = `import { foo } from 'nonexistent-package'`
      const result = await validateOutput(code, { requireKnownImports: true }, projectRoot)
      expect(result.passed).toBe(false)
      expect(result.errors.some(e => e.includes('nonexistent-package'))).toBe(true)
    })

    it('ignores relative imports', async () => {
      const code = `import { foo } from '#/local-file'`
      const result = await validateOutput(code, { requireKnownImports: true }, projectRoot)
      expect(result.passed).toBe(true)
    })

    it('ignores node built-in imports', async () => {
      const code = `import fs from 'fs'\nimport path from 'node:path'`
      const result = await validateOutput(code, { requireKnownImports: true }, projectRoot)
      expect(result.passed).toBe(true)
    })

    it('respects allowedImports', async () => {
      const code = `import { z } from 'zod'`
      const result = await validateOutput(code, { allowedImports: ['zod'] }, projectRoot)
      expect(result.passed).toBe(true)
    })

    it('rejects imports not in allowedImports', async () => {
      const code = `import { z } from 'zod'`
      const result = await validateOutput(code, { allowedImports: ['lodash'] }, projectRoot)
      expect(result.passed).toBe(false)
    })

    it('blocks blocked imports', async () => {
      const code = `import { exec } from 'child_process'\nimport evil from 'evil-package'`
      const result = await validateOutput(code, { blockedImports: ['evil-package'] }, projectRoot)
      expect(result.passed).toBe(false)
      expect(result.errors.some(e => e.includes('evil-package'))).toBe(true)
    })
  })
})

describe('buildValidationFeedback', () => {
  it('formats errors into feedback message', () => {
    const result = { passed: false, errors: ['Import "foo" not found', 'Syntax error at line 5'], warnings: [] }
    const feedback = buildValidationFeedback(result)
    expect(feedback).toContain('Import "foo" not found')
    expect(feedback).toContain('Syntax error at line 5')
    expect(feedback).toContain('Fix these errors')
  })
})
