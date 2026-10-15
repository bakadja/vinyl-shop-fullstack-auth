import { closeDatabase, getDatabase } from './db/db.js'
import express from 'express'
import { productsRouter } from './routes/products.js'
import { authRouter, logoutMethodGuard } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { cartRouter } from './routes/cart.js'
import session from 'express-session'
import { sessionConfig } from './sessions/config.js'
import { validateSessionSchema } from './sessions/schema.js'
import { createSessionStore } from './sessions/store.js'
import { sessionValidity } from './sessions/policy.js'
import { productionTransport } from './sessions/transport.js'

let server
let owner
let stopping
function shutdown() {
  stopping ??= (async()=>{
    const deadline=setTimeout(()=>{
      console.error('Session server shutdown timed out')
      server?.closeAllConnections()
      process.exit(1)
    },10000)
    try {
      if(server) await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
      if(owner) await owner.close()
      await closeDatabase()
    } catch {
      console.error('Session server shutdown failed')
      process.exitCode=1
    } finally {clearTimeout(deadline)}
  })()
  return stopping
}
try {
  const config=sessionConfig()
  const db=getDatabase()
  await validateSessionSchema(db)
  owner=createSessionStore({pool:db.getPool(),config})
  const app=express()
  app.locals.sessionConfig=config
  app.set('trust proxy',config.trustPeer)
  app.use(productionTransport(config))
  app.use('/api/auth',(req,res,next)=>{res.set('Cache-Control','no-store');next()})
  app.use('/api/auth/logout',logoutMethodGuard)
  app.use(express.json())
  app.use(session({store:owner.store,secret:config.secrets,name:config.cookieName,resave:false,saveUninitialized:false,rolling:false,cookie:config.cookie}))
  app.use(express.static('public'))
  app.use('/api/products',productsRouter)
  app.use(['/api/auth/me','/api/cart'],sessionValidity(config))
  app.use('/api/auth/me',meRouter)
  app.use('/api/auth',authRouter)
  app.use('/api/cart',cartRouter)
  app.use((err,req,res,next)=>{
    if(res.headersSent) return next(err)
    let status=500,error='Internal server error'
    if(err.type==='entity.parse.failed' || err.status===400) {status=400;error='Invalid request body'}
    else if(err.status===413) {status=413;error='Request body too large'}
    res.status(status).set('Cache-Control','no-store').json({error})
  })
  server=await new Promise((resolve,reject)=>{
    const listening=app.listen(Number(process.env.PORT??8000),()=>resolve(listening))
    listening.once('error',reject)
  })
  console.log(`Server running at http://localhost:${server.address().port}`)
  process.on('SIGTERM',shutdown)
  process.on('SIGINT',shutdown)
} catch {
  console.error('Session server startup failed. Check configuration, connectivity and schema compatibility.')
  process.exitCode=1
  await shutdown()
}
