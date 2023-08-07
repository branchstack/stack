import { db } from '.'
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
     where name = $1
     and resource = $2`,
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
  await db.run(
    `insert into branches(name, parent, resource, strategy)
     values($1, $2, $3, $4)
     returning *`,
    name, parent, resource, strategy
  )

  await db.run(
    `insert into events (branch, resource, status)
     values ($1, $2, 'requested')`,
    [name, resource]
  )

  return db.get<Branch>(
    `select *, 'requested' as status
     from branches
     where name = $1
     and resource = $2`,
    [name, resource]
  )
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
  await db.run(
    `update branches
       set parent = coalesce($3, parent),
           strategy = coalesce($4, strategy)
       where name = $1
       and resource = $2`,
    [name, resource, fields.parent, fields.strategy]
  )

  await db.run(
    `insert into events(branch, resource, status)
     values($1, $2, coalesce($3, 'requested'))`,
    [name, resource, fields.status]
  )

  return db.get<Branch>(
    `select *, coalesce($3, 'requested') as status
     from branches
     where name = $1
     and resource = $2`,
    name, resource, fields.status,
  )
}
