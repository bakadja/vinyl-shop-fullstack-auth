import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installContainerCertificates } from '../test-support/ci-certificates.js'
const container='a'.repeat(64),directory='/var/lib/postgresql/data/vinyl-test-tls.aB123456'
const certificates={serverCertFile:'/private/owned/server.pem',serverKeyFile:'/private/owned/server.key'}
test('container TLS installation rejects unsafe or redirected destinations before copying',async()=>{
 for(const unsafe of ['/tmp/predictable','/var/lib/postgresql/data/../escape',directory+'/../outside',directory+'\n/tmp/escape']){
  const calls=[]
  await assert.rejects(installContainerCertificates(container,certificates,async(file,args)=>{calls.push(args);return{stdout:unsafe+'\n'}}))
  assert.equal(calls.some(args=>args[0]==='cp'),false)
 }
})
test('unsafe private-directory validation fails closed before copying certificates',async()=>{
 const calls=[]
 await assert.rejects(installContainerCertificates(container,certificates,async(file,args)=>{
  calls.push(args)
  if(calls.length===1)return{stdout:directory+'\n'}
  if(args.includes('verify-private-tls'))throw new Error('synthetic unsafe existing directory or symlink')
  return{stdout:''}
 }))
 assert.equal(calls.some(args=>args[0]==='cp'),false)
})
test('failed certificate installation removes partial private files without configuring PostgreSQL',async()=>{
 const calls=[]
 await assert.rejects(installContainerCertificates(container,certificates,async(file,args)=>{
  calls.push(args)
  if(calls.length===1)return{stdout:directory+'\n'}
  if(args[0]==='cp')throw new Error('synthetic copy failure')
  return{stdout:''}
 }),/installation failed/)
 assert.ok(calls.some(args=>args.includes('rm')))
 assert.equal(calls.some(args=>args.some(value=>String(value).includes('ALTER SYSTEM'))),false)
})
test('successful installation uses private controlled paths and completes dependent operations sequentially',async()=>{
 const calls=[];let running=false
 const result=await installContainerCertificates(container,certificates,async(file,args)=>{
  assert.equal(running,false);running=true
  calls.push(args);await new Promise(resolve=>setImmediate(resolve));running=false
  return{stdout:calls.length===1?directory+'\n':''}
 })
 assert.equal(result,directory)
 const copies=calls.filter(args=>args[0]==='cp')
 assert.equal(copies.length,2)
 assert.equal(copies[0][2],container+':'+directory+'/server.pem')
 assert.equal(copies[1][2],container+':'+directory+'/server.key')
 assert.ok(calls.some(args=>args.includes('chmod')&&args.includes('600')))
 assert.ok(calls.some(args=>args.includes('chown')&&args.includes('postgres:postgres')))
})

test('preexisting or symbolic-link certificate destination is rejected before docker copy',async()=>{
 const calls=[]
 await assert.rejects(installContainerCertificates(container,certificates,async(file,args)=>{
  calls.push(args)
  if(calls.length===1)return{stdout:directory+'\n'}
  if(args.includes('verify-new-tls-file'))throw new Error('destination already exists or is a symbolic link')
  return{stdout:''}
 }))
 assert.equal(calls.some(args=>args[0]==='cp'),false)
})
