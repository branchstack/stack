import { open } from 'sqlite'
import sqlite3 from 'sqlite3'
import path from 'path'
import url from 'node:url'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// set up the database of branch mappings
export const db = await open({
  filename: path.join(__dirname, '../database.db'),
  driver: sqlite3.cached.Database,
})
