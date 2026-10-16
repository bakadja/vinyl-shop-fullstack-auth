import { invalidateSession } from './policy.js'
export async function establishSession(req,res,userId,config,{now=Date.now}={}) {
  try {
    await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()))
    req.session.userId=userId
    req.session.authenticatedAt=now()
    req.session.cookie.expires=new Date(req.session.authenticatedAt+config.lifetimeMs)
    await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()))
  } catch (cause) {
    try {await invalidateSession(req,res,config)} catch {console.error('Session invalidation failed')}
    throw new Error('Authentication session failed', { cause })
  }
}
