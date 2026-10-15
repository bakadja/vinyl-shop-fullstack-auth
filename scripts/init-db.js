import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '../db/db.js'
import { databaseConfig } from '../db/config.js'

const columns = {
  products: { id: ['integer', true], title: ['text', true], artist: ['text', true], price: ['numeric(10,2)', true], image: ['text', true], year: ['integer', false], genre: ['text', false], stock: ['integer', false] },
  users: { id: ['integer', true], name: ['text', false], email: ['text', true], username: ['text', true], password: ['text', true], created_at: ['timestamp with time zone', false] },
  cart_items: { id: ['integer', true], user_id: ['integer', true], product_id: ['integer', true], quantity: ['integer', true] }
}
const constraints = {
  products: ['PRIMARY KEY (id)'],
  users: ['PRIMARY KEY (id)', 'UNIQUE (email)', 'UNIQUE (username)'],
  cart_items: ['PRIMARY KEY (id)', 'UNIQUE (user_id, product_id)', 'FOREIGN KEY (user_id) REFERENCES users(id)', 'FOREIGN KEY (product_id) REFERENCES products(id)']
}

function validateColumns(rows) {
  for (const [table, fields] of Object.entries(columns)) {
    const actual = rows.filter(row => row.table_name === table)
    if (actual.length !== Object.keys(fields).length) throw new Error('Incompatible PostgreSQL schema')
    for (const [name, [type, required]] of Object.entries(fields)) {
      const column = actual.find(row => row.name === name)
      if (column?.type !== type || column.required !== required || name === 'id' && column.identity !== 'd') throw new Error('Incompatible PostgreSQL schema')
    }
  }
}

async function validateSchema(client) {
  const { rows } = await client.query(`SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
    a.attnotnull AS required, a.attidentity AS identity, pg_get_expr(d.adbin, d.adrelid) AS default_value
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE c.relnamespace = current_schema()::regnamespace AND c.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped`, [Object.keys(columns)])
  validateColumns(rows)
  const definitions = (await client.query(`SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition,
    k.convalidated, k.condeferrable, k.confdeltype, k.confupdtype
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    WHERE k.connamespace = current_schema()::regnamespace AND c.relname = ANY($1)`, [Object.keys(columns)])).rows
  for (const [table, expected] of Object.entries(constraints)) {
    for (const definition of expected) {
      if (!definitions.some(row => row.table_name === table && row.definition === definition && row.convalidated && !row.condeferrable &&
          (!definition.startsWith('FOREIGN') || row.confdeltype === 'a' && row.confupdtype === 'a'))) throw new Error('Incompatible PostgreSQL constraints')
    }
  }
  if (rows.find(row => row.table_name === 'cart_items' && row.name === 'quantity').default_value !== '1' ||
      rows.find(row => row.table_name === 'users' && row.name === 'created_at').default_value !== 'CURRENT_TIMESTAMP') throw new Error('Incompatible PostgreSQL defaults')
}

export async function initializeDatabase(database) {
  const sql = await readFile(new URL('../db/init.sql', import.meta.url), 'utf8')
  const separator = sql.indexOf('-- Fictional album metadata;')
  await database.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema(), 0))")
    await client.query(sql.slice(0, separator))
    await validateSchema(client)
    // Block ordinary inserts before reading/aligning the identity sequence.
    await client.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE')
    // Reapply the existing cache value to obtain the sequence DDL lock as well,
    // serializing standalone nextval calls without changing sequence settings.
    const sequenceLock = (await client.query(`SELECT format('ALTER SEQUENCE %s CACHE %s', seqrelid::regclass, seqcache) AS command
      FROM pg_sequence WHERE seqrelid = pg_get_serial_sequence('products', 'id')::regclass`)).rows[0].command
    // PostgreSQL formats/quotes the catalog identifier; no user input forms this DDL.
    await client.query(sequenceLock)
    await client.query(sql.slice(separator))
    await client.query(`SELECT setval(pg_get_serial_sequence('products', 'id'),
      GREATEST((SELECT MAX(id) FROM products), COALESCE(pg_sequence_last_value(pg_get_serial_sequence('products', 'id')::regclass), 1)), true)`)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let database
  try {
    database = createDatabase(databaseConfig())
    await initializeDatabase(database)
    console.log('PostgreSQL demo catalogue initialized; seed contains catalogue only, no users or carts.')
  } catch {
    console.error('PostgreSQL initialization failed. Check configuration, connectivity and schema compatibility.')
    process.exitCode = 1
  } finally { if (database) await database.close() }
}
