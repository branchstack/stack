import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const execAsync = promisify(exec)

// environment variables for this Resource
// TODO: consider what happens when the configuration changes...
// how do we make sure the status of branches reflects configuration? do we care?
const {
  PG_DUMP_RESTORE_HOST,
  PG_DUMP_RESTORE_PORT,
  PG_DUMP_RESTORE_USER,
  PG_DUMP_RESTORE_PASSWORD,
} = process.env

// Derived and default Configuration for this Resource
interface Configuration {
  host: string
  port: string
  user: string
  password: string
}

const CONFIGURATION: Configuration = {
  host: PG_DUMP_RESTORE_HOST ?? 'localhost',
  port: PG_DUMP_RESTORE_PORT ?? '5432',
  user: PG_DUMP_RESTORE_USER ?? 'postgres',
  password: PG_DUMP_RESTORE_PASSWORD ?? '',
}

export default {
  type: 'postgres',
  strategies: {
    dbDumpRestore: {
      async create(target: string, template: string) {
        const { host, port, user, password } = CONFIGURATION
        // TODO: don't leak the PGPASSWORD in errors
        await execAsync(
          `PGPASSWORD=${password} createdb -U ${user} -h ${host} -p ${port} "${target}" &&\
           PGPASSWORD=${password} pg_dump -U ${user} -h ${host} -p ${port} -d "${template}" -Fc |\
           PGPASSWORD=${password} pg_restore -U ${user} -h ${host} -p ${port} -d "${target}"`
        )
      },
      async delete(target: string) {
        const { host, port, user, password } = CONFIGURATION
        // TODO: don't leak the PGPASSWORD in errors
        // TODO: catch and ignore "doesn't exist" errors
        await execAsync(
          `PGPASSWORD=${password} dropdb -f -U ${user} -h ${host} -p ${port} "${target}"`
        )
      }
    }
  }
}
