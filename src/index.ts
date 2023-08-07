import Koa from 'koa'
import { bodyParser } from '@koa/bodyparser'
import logger from 'koa-logger'
import { createServer } from 'http'
import { errorHandler } from './errors'
import { queue } from './queue'
import plugins from './plugins'

// derive configuration variables from the environment
const PORT = process.env.PORT ?? 8675

// generate routes from Resources
// Configure the Koa-based App
const app = new Koa()
app
  .use(errorHandler)
  .use(logger())
  .use(bodyParser())
  .use(plugins.routes())
  .use(plugins.allowedMethods({ throw: true }))

// Create an HTTP listener that delegates to Koa
const controller = new AbortController()
createServer(app.callback()).listen({
  port: PORT,
  signal: controller.signal,
})

// Handle graceful shutdown of the HTTP server
const shutdown = () => controller.abort()
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// wait for the queue to clear before exiting the process
await queue.onIdle()
