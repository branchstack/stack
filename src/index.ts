import Koa from 'koa'
import Router from '@koa/router'
import { bodyParser } from '@koa/bodyparser'
import logger from 'koa-logger'
import { createServer } from 'http'
import { db } from './db'
import { errorHandler } from './errors'
import { queue, Task } from './queue'
import type { Event } from './events'

interface Strategy {
  create: Task
  delete: Task
}

interface Resource {
  type: string
  strategies: Record<string, Strategy>
}

interface Branch {
  name: string
  parent: string
  resource: string
  strategy: string
  events: Event[]
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
        async create() {
          console.log('using pg_dump | restore to branch a postgres database...')
        },
        async delete() {
          console.log('using DROP DATABASE to remove postgres database...')
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

// TODO: easily compute the status of a branch from the events table
// TODO: derive 409 conflicts from that status (i.e. only allow for POST when status is 'inactive')
// TODO: handle idempotency in DELETE (i.e. just return early if status is 'inactive')
// TODO: run transactional things in single transactions
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
    const existing = await db.get(`select * from branches where name = ?`, name)
    if (!!existing) {
      context.throw(409, `Branch '${name}' already exists`)
    }

    // save request metadata to a database
    await db.run(
      `insert into branches (name, parent, resource, strategy)
       values (?, ?, ?, ?)`,
      name, parent, resource.type, strategy,
    )
    await db.run(
      `insert into events (branch, resource, status)
       values (?, ?, ?)`,
      name, resource.type, 'requested',
    )

    // enqueue a task from the requested strategy
    const create = resource.strategies[strategy]?.create
    if (!create) {
      context.throw(400, `Strategy '${strategy}' is not supported for this resource`)
    }

    queue.add(async () => {
      try {
        await db.run(
          `insert into events (branch, resource, status)
           values (?, ?, ?)`,
          name, resource.type, 'activating',
        )

        await create()

        await db.run(
          `insert into events (branch, resource, status)
           values (?, ?, ?)`,
          name, resource.type, 'active',
        )
      } catch (error: any) {
        await db.run(
          `insert into events (branch, resource, status, message)
           values (?, ?, ?, ?)`,
          name, resource.type, 'error', error?.message ?? `Failed to create branch ${name}`,
        )
      }
    })

    // return information about the branch
    const [events, branch] = await Promise.all([
      db.all(`select * from events where branch = ? order by timestamp`, name),
      db.get(`select * from branches where name = ?`, name),
    ])

    context.body = {
      ...branch,
      events
    }
  })

  router.get(`/${resource.type}/branches/:name?`, async context => {
    const name = context.params?.name

    if (name) {
      const branch = await db.get(`select * from branches where name = ?`, name)

      if (!branch) {
        context.throw(404, `Branch '${name}' not found`)
      } else {
        context.body = branch
      }
    } else {
      context.body = await db.all(`select * from branches`)
    }
  })

  router.delete(`/${resource.type}/branches/:name`, async context => {
    const name = context.params?.name
    const existing = await db.get(`select * from branches where name = ?`, name)
    if (!existing) {
      context.throw(404, `Branch '${name}' not found`)
    }

    await db.run(
      `insert into events (branch, resource, status)
       values (?, ?, ?)`,
      name, resource.type, 'deactivating',
    )

    // enqueue a task from the requested strategy
    const _delete = resource.strategies[existing.strategy]?.delete
    if (!_delete) {
      context.throw(400, `Strategy '${existing.strategy}' is not supported for this resource`)
    }

    queue.add(async () => {
      try {
        await _delete()

        await db.run(
          `insert into events (branch, resource, status)
           values (?, ?, ?)`,
          name, resource.type, 'inactive',
        )
      } catch (error: any) {
        await db.run(
          `insert into events (branch, resource, status, message)
           values (?, ?, ?)`,
          name, resource.type, 'error', error?.message ?? `Failed to delete branch ${name}`,
        )
      }
    })

    // return information about the branch
    const [events, branch] = await Promise.all([
      db.all(`select * from events where branch = ? order by timestamp`, name),
      db.get(`select * from branches where name = ?`, name),
    ])

    context.body = {
      ...branch,
      events
    }
  })

  router.get(`/${resource.type}/branches/:name/events`, async context => {
    const name = context.params?.name
    const existing = await db.get(`select * from branches where name = ?`, name)
    if (!existing) {
      context.throw(404, `Branch '${name}' not found`)
    }
    context.body = await db.all(`select * from events where branch = ?`, name)
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
