/**
 * AI Tags for 2-Pass Generation
 *
 * Registers @ai, @context, @prompt, and @output tags with the Jig (Edge.js) engine.
 *
 * In the 2-pass system:
 *   Pass 1 (collect mode): @ai blocks collect prompt/context/output specs
 *          via __hypergenAiCollect. No output is produced.
 *   Pass 2 (answers mode): @ai blocks resolve from state.answers[key].
 *
 * @context outside @ai adds global context via __hypergenAddGlobalContext.
 *
 * Compile strategy:
 *   The @ai tag creates a runtime object (__aiBlock) for collecting child data.
 *   Child tags (@context, @prompt, @output) reference __aiBlock to push data.
 *   After children run, @ai either collects (pass 1) or outputs answers (pass 2).
 *   The __aiBlock variable is scoped by the enclosing @ai tag's braces, so
 *   multiple @ai blocks don't collide.
 */

import type { Edge } from '@jig-lang/jig'
import createDebug from 'debug'

const debug = createDebug('hypergen:template:ai-tags')

/**
 * Register all 2-pass AI tags with a Jig (Edge) instance.
 */
export function registerAiTags(edge: Edge): void {
  registerAiTag(edge)
  registerContextTag(edge)
  registerPromptTag(edge)
  registerOutputTag(edge)
  debug('Registered @ai, @context, @prompt, @output tags')
}

/**
 * @ai — Block container for AI generation.
 *
 * Creates a runtime scope with __aiBlock, processes children, then
 * either collects (pass 1) or outputs answers (pass 2).
 */
function registerAiTag(edge: Edge): void {
  edge.registerTag({
    tagName: 'ai',
    block: true,
    seekable: true,

    compile(parser, buffer, token) {
      const line = token.loc.start.line

      // Open a block scope so __aiBlock doesn't leak between @ai blocks
      buffer.writeStatement(`{`, token.filename, line)

      // Create the block data object that child tags will populate
      buffer.writeStatement(
        `let __aiBlock = { contexts: [], prompt: '', key: '', outputDesc: '' };`,
        token.filename, line
      )

      // Process children — @context/@prompt/@output tags will populate __aiBlock
      for (const child of token.children) {
        parser.processToken(child, buffer)
      }

      // Runtime dispatch: collect or resolve
      // Globals registered via edge.global() are accessed via state.<name>
      const escapedFilename = JSON.stringify(token.filename || 'unknown')
      buffer.writeStatement(
        `if (state.__hypergenCollectMode) {`,
        token.filename, line
      )
      buffer.writeStatement(
        `  state.__hypergenAiCollect(__aiBlock.key, __aiBlock.contexts, __aiBlock.prompt, __aiBlock.outputDesc, ${escapedFilename});`,
        token.filename, line
      )
      buffer.writeStatement(
        `} else {`,
        token.filename, -1
      )
      buffer.writeStatement(
        `  out += (state.answers && state.answers[__aiBlock.key]) || '';`,
        token.filename, line
      )
      buffer.writeStatement(
        `}`,
        token.filename, -1
      )

      // Close the block scope
      buffer.writeStatement(`}`, token.filename, -1)
    },
  })
}

/**
 * @context — Block tag.
 *
 * Inside @ai: pushes rendered body to __aiBlock.contexts.
 * Outside @ai (standalone): calls __hypergenAddGlobalContext.
 *
 * Detection: checks if __aiBlock is defined at runtime.
 */
function registerContextTag(edge: Edge): void {
  edge.registerTag({
    tagName: 'context',
    block: true,
    seekable: true,

    compile(parser, buffer, token) {
      const line = token.loc.start.line

      // Create a child buffer to capture the rendered body
      const captureVar = `__ctxBody_${line}`
      const childBuffer = buffer.create(token.filename, { outputVar: captureVar })

      for (const child of token.children) {
        parser.processToken(child, childBuffer)
      }

      // Flush child buffer — this declares captureVar and fills it
      buffer.writeStatement(
        childBuffer
          .disableFileAndLineVariables()
          .disableReturnStatement()
          .disableTryCatchBlock()
          .flush(),
        token.filename, line
      )

      // Runtime: inside @ai or standalone?
      buffer.writeStatement(
        `if (typeof __aiBlock !== 'undefined') {`,
        token.filename, line
      )
      buffer.writeStatement(
        `  __aiBlock.contexts.push(${captureVar});`,
        token.filename, line
      )
      buffer.writeStatement(`} else {`, token.filename, -1)
      buffer.writeStatement(
        `  state.__hypergenAddGlobalContext(${captureVar});`,
        token.filename, line
      )
      buffer.writeStatement(`}`, token.filename, -1)
    },
  })
}

/**
 * @prompt — Block tag (inside @ai only).
 *
 * Captures rendered body into __aiBlock.prompt.
 */
function registerPromptTag(edge: Edge): void {
  edge.registerTag({
    tagName: 'prompt',
    block: true,
    seekable: true,

    compile(parser, buffer, token) {
      const line = token.loc.start.line

      const captureVar = `__promptBody_${line}`
      const childBuffer = buffer.create(token.filename, { outputVar: captureVar })

      for (const child of token.children) {
        parser.processToken(child, childBuffer)
      }

      buffer.writeStatement(
        childBuffer
          .disableFileAndLineVariables()
          .disableReturnStatement()
          .disableTryCatchBlock()
          .flush(),
        token.filename, line
      )

      buffer.writeStatement(
        `if (typeof __aiBlock !== 'undefined') {`,
        token.filename, line
      )
      buffer.writeStatement(
        `  __aiBlock.prompt = ${captureVar};`,
        token.filename, line
      )
      buffer.writeStatement(`}`, token.filename, -1)
    },
  })
}

/**
 * @output — Block tag (inside @ai only).
 *
 * Takes { key: 'myKey' } argument. Captures rendered body as format hint.
 * Sets __aiBlock.key and __aiBlock.outputDesc.
 */
function registerOutputTag(edge: Edge): void {
  edge.registerTag({
    tagName: 'output',
    block: true,
    seekable: true,

    compile(parser, buffer, token) {
      const line = token.loc.start.line
      const jsArg = token.properties.jsArg.trim()

      const captureVar = `__outputBody_${line}`
      const childBuffer = buffer.create(token.filename, { outputVar: captureVar })

      for (const child of token.children) {
        parser.processToken(child, childBuffer)
      }

      buffer.writeStatement(
        childBuffer
          .disableFileAndLineVariables()
          .disableReturnStatement()
          .disableTryCatchBlock()
          .flush(),
        token.filename, line
      )

      buffer.writeStatement(
        `if (typeof __aiBlock !== 'undefined') {`,
        token.filename, line
      )

      if (jsArg) {
        // Parse argument — supports { key: 'myKey' } or just 'myKey'
        buffer.writeStatement(
          `  let __oArgs_${line} = ${jsArg};`,
          token.filename, line
        )
        buffer.writeStatement(
          `  __aiBlock.key = (typeof __oArgs_${line} === 'string') ? __oArgs_${line} : (__oArgs_${line}.key || '');`,
          token.filename, line
        )
      }

      buffer.writeStatement(
        `  __aiBlock.outputDesc = ${captureVar};`,
        token.filename, line
      )

      buffer.writeStatement(`}`, token.filename, -1)
    },
  })
}
