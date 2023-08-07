// Additional configuration needed for this Resource
interface Configuration {
  connectionString: string
}

export default {
  type: 'postgres',
  strategies: {
    dbDumpRestore: {
      async create(target: string, template: string, configuration?: Configuration) {
        const { connectionString } = configuration ?? {}
        if (!connectionString) {
          throw new Error(`Required field 'connectionString' is missing from configuration`)
        }

        console.log(`using pg_dump | restore at '${connectionString}' to create branch '${target}' from template '${template}'...`)
      },
      async delete(target: string, configuration?: Configuration) {
        const { connectionString } = configuration ?? {}
        if (!connectionString) {
          throw new Error(`Required field 'connectionString' is missing from configuration`)
        }

        console.log(`using DROP DATABASE at '${connectionString}' to remove database '${target}'...`)
      }
    }
  }
}
