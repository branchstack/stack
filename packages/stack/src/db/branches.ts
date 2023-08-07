import { db, events } from '.'
import type { Status } from './events'

// return value of branch-fetching queries
interface Branch {
  name: string
  parent: string
  resource: string
  strategy: string
  status: Status
}

// get a single branch by name and resource
export const get = async (name: string, resource: string) =>
  db.get<Branch>(
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

// get all previously-created branches
export const all = async () =>
  db.all<Branch[]>(
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

// insert a branch, tracking its associated events along the way.
// avoiding duplicates is the responsiblity of callers.
export const create = async (name: string, parent: string, resource: string, strategy: string) => {
  const branch = await db.get<Branch>(
    `insert into branches(name, parent, resource, strategy)
     values(?, ?, ?, ?)
     returning *`,
    name, parent, resource, strategy,
  )

  const event = await events.create(name, resource, 'requested')

  return {
    ...branch!,
    status: event!.status,
  }
}

// update an existing branch with new values and events.
// TODO: handle race conditions between the first and second call better
export interface UpdateFields {
  parent: string,
  strategy: string,
  status: Status,
}
export const update = async (
  name: string,
  resource: string,
  fields: Partial<UpdateFields>,
) => {
  const branch = await db.get<Branch>(
    `update branches
     set parent = coalesce(?, parent),
         strategy = coalesce(?, strategy)
     where name = ?
     and resource = ?
     returning *`,
    fields.parent, fields.strategy, name, resource,
  )

  const event = await events.create(name, resource, fields.status ?? 'requested')

  return {
    ...branch!,
    status: event!.status,
  }
}
