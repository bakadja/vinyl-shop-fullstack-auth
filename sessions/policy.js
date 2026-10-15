export function clearSessionCookies(res,config) {
  const {maxAge,...options}=config.cookie
  res.clearCookie(config.cookieName,options)
  if(config.environment==='production') res.clearCookie('connect.sid',{...options,secure:false})
}
export async function invalidateSession(req,res,config) {
  const sid=req.sessionID
  req.session=null
  clearSessionCookies(res,config)
  if(sid) await new Promise((resolve,reject)=>req.sessionStore.destroy(sid,error=>error?reject(error):resolve()))
}
export function sessionValidity(config,{now=Date.now}={}) {
  return async(req,res,next)=>{
    const value=req.session
    if(value?.userId===undefined) return next()
    const time=now()
    if(Number.isSafeInteger(value.userId) && value.userId>0 && Number.isSafeInteger(value.authenticatedAt) && value.authenticatedAt<=time && time-value.authenticatedAt<config.lifetimeMs) return next()
    try {await invalidateSession(req,res,config);next()} catch(error){next(error)}
  }
}
export function logoutPolicy(config) {
  return(req,res,next)=>{
    if(!req.is('application/json')) return res.status(415).json({error:'JSON body required'})
    const origin=req.get('origin')
    if((config.environment==='production' && !origin) || (origin!==undefined && origin!==config.origin) || req.get('sec-fetch-site')==='cross-site') return res.status(403).json({error:'Forbidden'})
    next()
  }
}
