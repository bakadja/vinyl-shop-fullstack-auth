import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions, validateSessionSchema } from '../sessions/schema.js'
test('session initialization is concurrent, non-destructive and private', async t => {
  const { database } = await postgresFixture(t)
  const other = await postgresFixture(t)
  await initializeDatabase(database)
  await Promise.all([initializeSessions(database), initializeSessions(database)])
  await database.query("INSERT INTO user_sessions VALUES ('live', '{\"userId\":1}', now()+interval '1 hour')")
  const before = (await database.query('SELECT * FROM user_sessions')).rows
  await initializeSessions(database)
  await validateSessionSchema(database)
  assert.deepEqual((await database.query('SELECT * FROM user_sessions')).rows, before)
  assert.equal((await database.query('SELECT count(*) FROM users')).rows[0].count, '0')
  assert.equal((await other.database.query("SELECT to_regclass('user_sessions') AS name")).rows[0].name, null)
})
test('incompatible session schema fails without replacing data', async t => {
  const { database } = await postgresFixture(t)
  await database.query("CREATE TABLE user_sessions(sid text); INSERT INTO user_sessions VALUES ('sentinel')")
  await assert.rejects(initializeSessions(database))
  assert.deepEqual((await database.query('SELECT * FROM user_sessions')).rows, [{ sid: 'sentinel' }])
})
test('readiness requires every session DML privilege, not just one', async t => {
 const {database}=await postgresFixture(t);await initializeSessions(database)
 await database.query('REVOKE UPDATE ON user_sessions FROM CURRENT_USER')
 await assert.rejects(validateSessionSchema(database),/unavailable/)
})
test('session initialization preserves application rows and rejects partial expiry indexes',async t=>{
 const {database}=await postgresFixture(t);await initializeDatabase(database);await initializeSessions(database)
 await database.query("INSERT INTO users(email,username,password) VALUES ('fixture@example.invalid','fixture','unchanged')")
 await database.query('INSERT INTO cart_items(user_id,product_id) SELECT id,1 FROM users')
 const snapshot=()=>Promise.all(['users','cart_items','products'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY id`).then(r=>r.rows)))
 const before=await snapshot();await initializeSessions(database);assert.deepEqual(await snapshot(),before)
 await database.query("DROP INDEX user_sessions_expire_idx; CREATE INDEX user_sessions_expire_idx ON user_sessions(expire) WHERE sid='partial'")
 await assert.rejects(initializeSessions(database),/indexes/)
 assert.deepEqual(await snapshot(),before)
})
