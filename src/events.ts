// types representing branching events
type Status =
  | 'requested'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'error'

export interface Event {
  timestamp: number // in ms since the Epoch
  status: Status
  message?: string
}

