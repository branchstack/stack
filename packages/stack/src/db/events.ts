import { db } from '.'

// Branch statuses communicated through Events
export type Status =
  | 'requested'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'error'


// return value of event-fetching queries
export interface Event {
  timestamp: string // in %Y-%m-%d %H:%M:%f format
  status: Status
  message?: string
}

// get a single event by ID
export const get = async (id: number) =>
  db.get<Event>(
    `select * from events
     where id = $1
     order by timestamp`,
    id,
  )

// get all of the events associated with a branch
export const allForBranch = async (branch: string, resource: string) =>
  db.all<Event[]>(
    `select * from events
     where branch = $1
     and resource = $2
     order by timestamp`,
    branch, resource
  )

// create a new event
export const create = async (branch: string, resource: string, status: Status, message?: string) =>
  db.get<Event>(
    `insert into events (branch, resource, status, message)
     values ($1, $2, $3, $4)
     returning *`,
    branch, resource, status, message
  )
