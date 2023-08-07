import Koa from 'koa'
import Router from '@koa/router'
import { bodyParser } from '@koa/bodyparser'
import logger from 'koa-logger'
import { createServer } from 'http'
import { errorHandler } from './errors'
import { queue } from './queue'
import { events, branches } from './db'

interface Strategy {
  create: (target: string, template: string) => Promise<void>
  delete: (target: string) => Promise<void>
}

interface Resource {
  type: string
  strategies: Record<string, Strategy>
}

// derive configuration variables from the environment
const PORT = process.env.PORT ?? 8675

// load plugins and their Resources
// TODO: dynamically load plugins at startup (resolve()? import()?)
const RESOURCES: Resource[] = [
  {
    type: 'postgres',
    strategies: {
      dbDumpRestore: {
        async create(target, template) {
          console.log(`using pg_dump | restore to create branch '${target}' from template '${template}'...`)
        },
        async delete(target) {
          console.log(`using DROP DATABASE to remove database '${target}'...`)
        }
      }
    }
  }
]

// generate routes from Resources
const router = new Router()

router.get('/resources', async context => {
  context.body = RESOURCES.map(({ strategies, type }) => ({
    strategies: Object.keys(strategies),
    type,
  }))
})

for (const resource of RESOURCES) {
  router.post(`/${resource.type}/branches`, async context => {
    // validate the request body
    const { name, parent, strategy } = context.request.body ?? {}
    if (!name) {
      context.throw(400, `The 'name' property is missing from the request body`)
    }
    if (!parent) {
      context.throw(400, `The 'parent' property is missing from the request body`)
    }
    if (!strategy) {
      context.throw(400, `The 'strategy' property is missing from the request body`)
    }

    // see if the branch already exists
    let branch = await branches.get(name, resource.type)
    if (branch) {
      if (branch?.status !== 'inactive') {
        context.throw(409, `Branch '${name}' already exists for Resource '${resource.type}'`)
      }

      branch = await branches.update(
        name,
        resource.type,
        { parent, strategy, status: 'requested' },
      )
    } else {
      branch = await branches.create(name, parent, resource.type, strategy)
    }

    // enqueue a task from the requested strategy
    const create = resource.strategies[strategy]?.create
    if (!create) {
      context.throw(400, `Strategy '${strategy}' is not supported for this resource`)
    }

    queue.add(async () => {
      try {
        await events.create(name, resource.type, 'activating')
        await create(name, parent)
        await events.create(name, resource.type, 'active')
      } catch (error: any) {
        const message = error?.message ?? `Failed to create branch ${name}`
        await events.create(name, resource.type, 'error', message)
      }
    })

    // return information about the branch
    context.body = branch
  })

  router.get(`/${resource.type}/branches/:name?`, async context => {
    const name = context.params?.name

    if (name) {
      const branch = await branches.get(name, resource.type)

      if (!branch) {
        context.throw(404, `Branch '${name}' not found`)
      } else {
        context.body = branch
      }
    } else {
      context.body = await branches.all()
    }
  })

  router.delete(`/${resource.type}/branches/:name`, async context => {
    const name = context.params?.name
    const branch = await branches.get(name, resource.type)
    if (!branch) {
      context.throw(404, `Branch '${name}' not found`)
    }

    // return early if we can
    if (branch!.status === 'inactive') {
      return context.body = branch
    }

    // make sure the strategy supports deletion
    const _delete = resource.strategies[branch!.strategy]?.delete
    if (!_delete) {
      context.throw(400, `Strategy '${branch!.strategy}' is not supported for this resource`)
    }

    // start deactivating the branch immediately
    await events.create(name, resource.type, 'deactivating')

    // enqueue a task from the requested strategy
    queue.add(async () => {
      try {
        await _delete(name)
        await events.create(name, resource.type, 'inactive')
      } catch (error: any) {
        const message = error?.message ?? `Failed to create branch ${name}`
        await events.create(name, resource.type, 'error', message)
      }
    })

    // return information about the branch at this point
    context.body = {
      ...branch,
      status: 'deactivating',
    }
  })

  router.get(`/${resource.type}/branches/:name/events`, async context => {
    const name = context.params?.name
    const existing = await branches.get(name, resource.type)
    if (!existing) {
      context.throw(404, `Branch '${name}' not found`)
    }
    context.body = await events.allForBranch(name, resource.type)
  })
}

// Configure the Koa-based App
const app = new Koa()
app
  .use(errorHandler)
  .use(logger())
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods({ throw: true }))

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
