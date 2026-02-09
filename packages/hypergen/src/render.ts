import path from 'node:path'
import fs from 'fs-extra'
import fm from 'front-matter'
import walk from 'ignore-walk'
import createDebug from 'debug'
import type { RenderedAction, RunnerConfig } from './types.js'
import context from './context.js'
import { initializeJig, renderTemplate } from './template-engines/index.js'
const debug = createDebug('hypergen:render')

// Initialize Jig on first use
let jigInitialized = false

const ensureJigInitialized = (config?: any) => {
  if (!jigInitialized) {
    initializeJig(config?.engine)
    jigInitialized = true
  }
}

// for some reason lodash/fp takes 90ms to load.
// inline what we use here with the regular lodash.
const map = (f) => (arr) => arr.map(f)
const filter = (f) => (arr) => arr.filter(f)

const ignores = [
  'prompt.js',
  'index.js',
  'prompt.ts',
  'index.ts',
  '.hypergenignore',
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  'ehthumbs.db',
  'Thumbs.db',
]
const renderTmpl = async (tmpl, locals, config) => {
  if (typeof tmpl !== 'string') {
    return tmpl
  }

  const ctx = context(locals, config)

  // Inject 2-pass AI generation state into render context
  if (config?._answers) {
    ctx.answers = config._answers
  }
  if (config?._collectMode) {
    ctx.__hypergenCollectMode = true
  }

  return await renderTemplate(tmpl, ctx)
}

async function getFiles(dir) {
  const files = walk
    .sync({ path: dir, ignoreFiles: ['.hypergenignore'] })
    .map((f) => path.join(dir, f))
  return files
}

const render = async (
  args: any,
  config: RunnerConfig,
): Promise<RenderedAction[]> => {
  // Ensure Jig is initialized
  ensureJigInitialized(config)

  if (!args.actionFolder) {
    return []
  }
  return getFiles(args.actionFolder)
    .then((things) => things.sort((a, b) => a.localeCompare(b))) // TODO: add a test to verify this sort
    .then(filter((f) => !ignores.find((ig) => f.endsWith(ig)))) // TODO: add a
    // test for ignoring prompt.js and index.js
    .then(
      filter((file) =>
        args.subAction
          ? file.replace(args.actionFolder, '').match(args.subAction)
          : true,
      ),
    )
    .then(
      map((file) =>
        fs.readFile(file).then((text) => ({ file, text: text.toString() })),
      ),
    )
    .then((_) => Promise.all(_))
    .then(
      map(({ file, text }) => {
        debug('Pre-formatting file: %o', file)
        return { file, ...(fm as any)(text, { allowUnsafe: true }) }
      }),
    )
    .then(
      map(async ({ file, attributes, body }) => {
        const renderedAttrs = {}
        for (const [key, value] of Object.entries(attributes)) {
          renderedAttrs[key] = await renderTmpl(value, args, config)
        }
        debug('Rendering file: %o', file)
        return {
          file,
          attributes: renderedAttrs,
          body: await renderTmpl(
            body,
            { ...args, attributes: renderedAttrs },
            config,
          ),
        }
      }),
    )
    .then((_) => Promise.all(_))
}

export default render
