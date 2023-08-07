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
     where id = ?
     order by timestamp`,
    id,
  )

// get all of the events associated with a branch
export const allForBranch = async (branch: string, resource: string) =>
  db.all<Event[]>(
    `select * from events
     where branch = ?
     and resource = ?
     order by timestamp`,
    branch, resource,
  )

// create a new event and return it
export const create = async (branch: string, resource: string, status: Status, message?: string) =>
  db.get<Event>(
    `insert into events (branch, resource, status, message)
     values (?, ?, ?, ?)
     returning *`,
    branch, resource, status, message,
  )
