import PQueue from 'p-queue'

// type representing enqueuable units of work
export type Task = () => Promise<void>

// set up a task queue for centralized handling of long-running branching tasks
export const queue = new PQueue()
