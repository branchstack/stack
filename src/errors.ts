import type { Middleware } from 'koa'

// Stack API wrapper around Node's built-in Error class
export class StackError extends Error {
  name = 'StackError'
  status: number
  message: string

  constructor(status: number, message: string) {
    super()
    this.status = status
    this.message = message
  }
}

/// Error-handling middleware for the Koa app
export const errorHandler: Middleware = async (context, next) => {
  try {
    await next()

    // handle 404s as a special case
    if (context.status === 404) {
      throw new StackError(404, 'Not Found')
    }
  } catch (error: any) {
    context.status = error.statusCode ?? error.status ?? 500
    context.body = { message: error.message ?? 'Internal Server Error' }
    context.app.emit('error', error, context)
  }
}
