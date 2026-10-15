import { readFile } from 'node:fs/promises'
export async function validateSessionSchema(database) {
  const { rows } = await database.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    WHERE c.relnamespace=current_schema()::regnamespace AND c.relname='user_sessions' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`)
  const types = { sid: 'character varying', sess: 'json', expire: 'timestamp(6) without time zone' }
  if (rows.length !== 3 || rows.some(row => types[row.name] !== row.type || !row.required)) throw new Error('Incompatible session schema')
  const indexes = (await database.query(`SELECT i.indisprimary, i.indisvalid, i.indisunique, i.indnkeyatts, i.indnatts,
    pg_get_indexdef(i.indexrelid,1,true) AS field, am.amname, i.indpred IS NULL AS complete
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
    WHERE c.relnamespace=current_schema()::regnamespace AND c.relname='user_sessions'`)).rows
  if (!indexes.some(i => i.indisprimary && i.indisvalid && i.field === 'sid' && i.indnkeyatts === 1) ||
      !indexes.some(i => i.indisvalid && i.field === 'expire' && i.indnkeyatts === 1 && i.complete && i.amname === 'btree')) throw new Error('Incompatible session indexes')
  const privileges = (await database.query("SELECT has_table_privilege('user_sessions','SELECT,INSERT,UPDATE,DELETE') AS allowed")).rows[0]
  if (!privileges.allowed) throw new Error('Session storage unavailable')
}
export async function initializeSessions(database) {
  const sql = await readFile(new URL('../db/sessions.sql', import.meta.url), 'utf8')
  await database.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema(), 0))")
    await client.query(sql)
    await validateSessionSchema(client)
  })
}
