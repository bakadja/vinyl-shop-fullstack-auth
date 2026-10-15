import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import express from 'express'
import session from 'express-session'
import { postgresFixture } from '../test-support/postgresql.js'
import { fixture,register,account } from '../test-support/http.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { getDatabase,closeDatabase } from '../db/db.js'
import { createSessionStore } from '../sessions/store.js'
import { sessionConfig } from '../sessions/config.js'
import { registerUser } from '../controllers/authController.js'
test('commit-then-error during session save keeps the account but never authenticates or resaves',async t=>{
 let server,owner
 const prior={}
 t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(owner)await owner.close();await closeDatabase();for(const [k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v}})
 const f=await postgresFixture(t)
 await initializeDatabase(f.database);await initializeSessions(f.database)
 for(const [k,v]of Object.entries(f.childEnv)){prior[k]=process.env[k];process.env[k]=v}
 const config=sessionConfig({...f.childEnv,SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')})
 const db=getDatabase();owner=createSessionStore({pool:db.getPool(),config})
 const query=pg.Pool.prototype.query
 let writes=0
 t.mock.method(pg.Pool.prototype,'query',async function(...args){
   const result=await query.apply(this,args)
   if(String(args[0]).startsWith('INSERT INTO "'+f.schema+'"."user_sessions"')){writes++;throw new Error('synthetic-sensitive-failure')}
   return result
 })
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args))
 const app=express();app.locals.sessionConfig=config;app.use(express.json());app.use(session({store:owner.store,secret:config.secrets,resave:false,saveUninitialized:false,cookie:config.cookie}));app.post('/register',registerUser)
 server=app.listen(0,'127.0.0.1');await once(server,'listening')
 const response=await fetch(`http://127.0.0.1:${server.address().port}/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account())})
 assert.equal(response.status,500)
 assert.deepEqual(await response.json(),{error:'Registration failed. Please try again.'})
 assert.doesNotMatch(response.headers.get('set-cookie')??'',/connect.sid=s%3A/)
 assert.equal(writes,1)
 assert.equal((await f.database.query('SELECT count(*) FROM users')).rows[0].count,'1')
 assert.equal((await f.database.query('SELECT count(*) FROM user_sessions')).rows[0].count,'0')
 assert.doesNotMatch(JSON.stringify(logs),/synthetic-sensitive-failure|postgresql:|SELECT|INSERT/)
})
test('store read outage fails closed, GET logout does not query store, and recovery never uses memory',async t=>{
 const {client,database}=await fixture(t),request=client();await register(request)
 await database.query('DROP TABLE user_sessions')
 assert.deepEqual(await request('/api/auth/me'),{status:500,body:{error:'Internal server error'},cookie:null})
 assert.equal((await request('/api/auth/logout')).status,405)
 await initializeSessions(database)
 assert.deepEqual((await request('/api/auth/me')).body,{isLoggedIn:false})
 assert.equal((await request('/api/cart')).status,401)
})
