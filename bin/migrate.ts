import path from 'path'
import url from 'node:url'
import { db } from '../src/db'

// derive inputs from the environment
const migrationsPath = path.join(url.fileURLToPath(new URL('.', import.meta.url)), '../migrations')
const force = !!process.env.FORCE_MIGRATIONS

// run the actual migrations
await db.migrate({ force, migrationsPath })
console.log('Migrations complete!')
