export function productionTransport(config) {
  return (req,res,next) => {
    if(config.environment !== 'production') return next()
    const protocols=[]
    for(let index=0;index<req.rawHeaders.length;index+=2) if(req.rawHeaders[index].toLowerCase()==='x-forwarded-proto') protocols.push(req.rawHeaders[index+1])
    if(!config.trustPeer(req.socket.remoteAddress) || protocols.length!==1 || protocols[0].trim().toLowerCase()!=='https' || !req.secure) return res.status(400).json({error:'HTTPS required'})
    next()
  }
}
