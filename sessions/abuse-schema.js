import { readFile } from 'node:fs/promises'
export async function validateAbuseSchema(database) {
  const columns = (await database.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    WHERE c.relnamespace=current_schema()::regnamespace AND c.relname='auth_abuse_counters' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`)).rows
  const types = { key: 'text', attempts: 'integer', expires_at: 'timestamp with time zone' }
  if (columns.length !== 3 || columns.some(c => types[c.name] !== c.type || !c.required)) throw new Error('Incompatible abuse schema')
  const indexes = (await database.query(`SELECT i.indisprimary, i.indisvalid, i.indnkeyatts, i.indpred IS NULL AS complete,
    pg_get_indexdef(i.indexrelid,1,true) AS field, am.amname
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
    WHERE c.relnamespace=current_schema()::regnamespace AND c.relname='auth_abuse_counters'`)).rows
  if (!indexes.some(i => i.indisprimary && i.indisvalid && i.indnkeyatts === 1 && i.field === 'key') ||
      !indexes.some(i => i.indisvalid && i.indnkeyatts === 1 && i.field === 'expires_at' && i.complete && i.amname === 'btree')) throw new Error('Incompatible abuse indexes')
  const { rows } = await database.query("SELECT has_table_privilege('auth_abuse_counters','SELECT') AND has_table_privilege('auth_abuse_counters','INSERT') AND has_table_privilege('auth_abuse_counters','UPDATE') AND has_table_privilege('auth_abuse_counters','DELETE') AS allowed")
  if (!rows[0].allowed) throw new Error('Abuse storage unavailable')
}
export async function initializeAbuse(database) {
  const sql = await readFile(new URL('../db/abuse.sql', import.meta.url), 'utf8')
  await database.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema(), 0))")
    await client.query(sql)
    await validateAbuseSchema(client)
  })
}
