import { db, events } from '.'
import type { Status } from './events'

// return value of branch-fetching queries
interface Branch {
  name: string
  parent: string
  resource: string
  strategy: string
  status: Status
  configuration: Record<string, any> // TODO: handle JSON throughout more cleanly
}

// get a single branch by name and resource
export const get = async (name: string, resource: string) => {
  const branch = await db.get<Branch>(
    `select
       branches.*,
       (
         select status
         from events
         where branch = branches.name
         and resource = branches.resource
         group by branch, resource
         having max(timestamp)
       ) as status
     from branches
     where name = ?
     and resource = ?`,
    name, resource
  )

  return {
    ...branch!,
    configuration: JSON.parse(branch?.configuration as any),
  }
}

// get all previously-created branches
export const all = async () => {
  const branches = await db.all<Branch[]>(
    `select
       branches.*,
       (
         select status
         from events
         where branch = branches.name
         and resource = branches.resource
         group by branch, resource
         having max(timestamp)
       ) as status
     from branches`
  )

  return branches.map(branch => ({
    ...branch,
    configuration: JSON.parse(branch?.configuration as any),
  }))
}

// insert a branch, tracking its associated events along the way.
// avoiding duplicates is the responsiblity of callers.
export const create = async (
  name: string,
  parent: string,
  resource: string,
  strategy: string,
  configuration?: Record<string, any>,
) => {
  const branch = await db.get<Branch>(
    `insert into branches(name, parent, resource, strategy, configuration)
     values(?, ?, ?, ?, json(?))
     returning *`,
    name, parent, resource, strategy, JSON.stringify(configuration)
  )

  const event = await events.create(name, resource, 'requested')

  return {
    ...branch!,
    configuration: JSON.parse(branch?.configuration as any),
    status: event!.status,
  }
}

// update an existing branch with new values and events.
// TODO: handle race conditions between the first and second call better
export interface UpdateFields {
  parent: string
  strategy: string
  status: Status
  configuration: Record<string, any>
}
export const update = async (
  name: string,
  resource: string,
  fields: Partial<UpdateFields>,
) => {
  const branch = await db.get<Branch>(
    `update branches
     set parent = coalesce(?, parent),
         strategy = coalesce(?, strategy),
         configuration = coalesce(json(?), configuration)
     where name = ?
     and resource = ?
     returning *`,
    fields.parent, fields.strategy, JSON.stringify(fields.configuration), name, resource,
  )

  const event = await events.create(name, resource, fields.status ?? 'requested')

  return {
    ...branch!,
    configuration: JSON.parse(branch?.configuration as any),
    status: event!.status,
  }
}
