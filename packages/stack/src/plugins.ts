import Router from '@koa/router'
import { queue } from './queue'
import { events, branches } from './db'

// TODO: import dynamically based on a plugin configuration file (branchstack.json)
import postgres from '../../postgres-db-dump-restore/src'

// Ways of creating and deleting branches for a Resource,
// optionally extensible with Configuration options
interface Strategy {
  create(target: string, template: string, configuration?: Record<string, any>): Promise<void>
  delete(target: string, configuration?: Record<string, any>): Promise<void>
}

// Plugin-generated export used to hook into the routing layer
interface Resource {
  type: string
  strategies: Record<string, Strategy>
}

// load Plugins and their Strategies
const RESOURCES: Resource[] = [postgres]

// generate a Router for the Resources exposed by all of the Plugins
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
    const { name, parent, strategy, configuration } = context.request.body ?? {}
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

      const fields = {
        parent,
        strategy,
        configuration,
        status: 'requested' as const,
      }
      branch = await branches.update(name, resource.type, fields)
    } else {
      branch = await branches.create(
        name,
        parent,
        resource.type,
        strategy,
        configuration,
      )
    }

    // enqueue a task from the requested strategy
    const create = resource.strategies[strategy]?.create
    if (!create) {
      context.throw(400, `Strategy '${strategy}' is not supported for this resource`)
    }

    queue.add(async () => {
      try {
        await events.create(name, resource.type, 'activating')
        await create(name, parent, configuration)
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
        await _delete(name, branch!.configuration)
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

export default router
