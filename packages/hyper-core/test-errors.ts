import { ErrorCode, ErrorHandler, HypergenError } from '#//src/errors/hypergen-errors.js'

// Test that imports work
console.log('ErrorCode:', Object.keys(ErrorCode).slice(0, 5))
console.log('HypergenError:', typeof HypergenError)
console.log('ErrorHandler:', typeof ErrorHandler)

const error = ErrorHandler.createActionNotFoundError('test-action')
console.log('Created error:', error.code)
