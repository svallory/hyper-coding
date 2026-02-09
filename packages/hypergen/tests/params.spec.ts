import { describe, it, expect } from 'bun:test'
import params from '~/params.js'
import Logger from '~/logger.js'
import { paramsFixture } from './util/fixtures.js'
import type { ResolvedRunnerConfig } from '~/types.js'

describe('params', () => {
  it('should return the correct params', async () => {
    const templates = paramsFixture('templates-override/tmpls')

    const config: ResolvedRunnerConfig = {
      templates: [
        {
          path: templates,
          pathChecked: true,
          exists: true
        }
      ],
      cwd: paramsFixture('templates-override'),
      logger: new Logger(console.log),
      debug: false,
      exec: () => {},
      createPrompter: () => ({ prompt: async () => ({}) })
    }

    const result = await params(config, ['foo', 'bar', 'baz'])
    expect(result.generator).toBe('foo')
    expect(result.action).toBe('bar')
    expect(result.name).toBe('baz')
  })
})