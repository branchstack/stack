import PQueue from 'p-queue'

// set up a task queue for centralized handling of long-running branching tasks
export const queue = new PQueue()
