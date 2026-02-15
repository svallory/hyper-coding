// Core logging interface (minimal interface for actions)
export interface ActionLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
  trace(message: string): void
}

// Extended logger interface with additional methods
export interface ExtendedLogger extends ActionLogger {
  log: (message?: any, ...optionalParams: any[]) => void
  colorful: (msg: string) => void
  notice: (msg: string) => void
  err: (msg: string) => void
  ok: (msg: string) => void
}
