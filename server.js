import './instrument.js'
import { captureFailure, flushTelemetry, requestTelemetry } from './telemetry/sentry.js'
import { closeDatabase, getDatabase } from './db/db.js'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { productsRouter } from './routes/products.js'
import { authRouter, logoutMethodGuard } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { cartRouter } from './routes/cart.js'
import { healthRouter } from './routes/health.js'
import session from 'express-session'
import { abuseKey, authenticationAbuse } from './sessions/abuse.js'
import { validateAbuseSchema } from './sessions/abuse-schema.js'
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
      captureFailure('shutdown')
      console.error('Session server shutdown failed')
      process.exitCode=1
    } finally {await flushTelemetry();clearTimeout(deadline)}
  })()
  return stopping
}
try {
  const config=sessionConfig()
  const key=abuseKey()
  const db=getDatabase()
  await validateSessionSchema(db)
  await validateAbuseSchema(db)
  owner=createSessionStore({pool:db.getPool(),config})
  const app=express()
  app.use(requestTelemetry)
  app.disable('x-powered-by')
  app.locals.sessionConfig=config
  app.set('trust proxy',config.trustPeer)
  app.use(productionTransport(config))
  app.use(healthRouter(db))
  app.use('/api/auth',(req,res,next)=>{res.set('Cache-Control','no-store');next()})
  app.use('/api/auth/logout',logoutMethodGuard)
  app.use(express.json())
  app.use('/api/auth',authenticationAbuse(db,key,config.trustPeer))
  // Public assets should not read authenticated sessions; HTTPS enforcement stays first.
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(fileURLToPath(new URL('./public/images/spiral_logo.png', import.meta.url)))
  })
  app.use(express.static('public'))
  app.use(session({store:owner.store,secret:config.secrets,name:config.cookieName,resave:false,saveUninitialized:false,rolling:false,cookie:config.cookie}))
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
    const listening=config.bindAddress
      ? app.listen(Number(process.env.PORT??8000),config.bindAddress,()=>resolve(listening))
      : app.listen(Number(process.env.PORT??8000),()=>resolve(listening))
    listening.once('error',reject)
  })
  console.log(`Server running at http://localhost:${server.address().port}`)
  process.on('SIGTERM',shutdown)
  process.on('SIGINT',shutdown)
} catch {
  captureFailure('startup')
  console.error('Session server startup failed. Check configuration, connectivity and schema compatibility.')
  process.exitCode=1
  await shutdown()
}
