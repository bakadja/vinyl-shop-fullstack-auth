import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp,writeFile,readFile,symlink,lstat,rm,rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestCertificates } from '../test-support/tls.js'
test('certificate generation rejects caller paths without overwriting existing files or following symlinks',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'vinyl-cert-attack-'));t.after(()=>rm(parent,{recursive:true,force:true}))
 const outside=join(parent,'outside');await writeFile(outside,'sentinel')
 const link=join(parent,'link');await symlink(parent,link)
 for(const input of ['../escape',outside,link,join(parent,'new'),'/'])await assert.rejects(createTestCertificates(input))
 assert.equal(await readFile(outside,'utf8'),'sentinel')
})
test('generated certificates and keys are private and cleanup is idempotent',async()=>{
 const certificates=await createTestCertificates()
 const directory=certificates.directory
 try {
  assert.equal((await lstat(directory)).mode&0o777,0o700)
  for(const file of [certificates.caFile,certificates.serverKeyFile,certificates.serverCertFile]){
   const metadata=await lstat(file);assert.equal(metadata.isSymbolicLink(),false);assert.equal(metadata.mode&0o777,0o600)
  }
 }finally{await certificates.cleanup()}
 await assert.rejects(lstat(directory),{code:'ENOENT'})
 await certificates.cleanup()
})
test('cleanup refuses a directory substituted by a symbolic link',async t=>{
 const certificates=await createTestCertificates(),moved=certificates.directory+'-moved'
 t.after(async()=>{await rm(certificates.directory,{force:true});await rm(moved,{recursive:true,force:true})})
 await rename(certificates.directory,moved);await symlink(moved,certificates.directory)
 await assert.rejects(certificates.cleanup(),/identity/)
 assert.ok(await readFile(join(moved,'ca.pem'),'utf8'))
})
test('generation failure removes its private files without leaking key material',async t=>{
 const {chmod}=await import('node:fs/promises')
 const parent=await mkdtemp(join(tmpdir(),'vinyl-cert-failure-')),capture=join(parent,'captured-cwd')
 const executable=join(parent,'openssl')
 await writeFile(executable,'#!/bin/sh\npwd > "$VINYL_CERT_CAPTURE"\nexit 1\n',{mode:0o700});await chmod(executable,0o700)
 const priorPath=process.env.PATH,priorCapture=process.env.VINYL_CERT_CAPTURE
 t.after(()=>rm(parent,{recursive:true,force:true}))
 try{
  process.env.PATH=parent;process.env.VINYL_CERT_CAPTURE=capture
  await assert.rejects(createTestCertificates(),/^Error: Disposable certificate generation failed$/)
 }finally{
  process.env.PATH=priorPath
  if(priorCapture===undefined)delete process.env.VINYL_CERT_CAPTURE;else process.env.VINYL_CERT_CAPTURE=priorCapture
 }
 const generated=(await readFile(capture,'utf8')).trim()
 await assert.rejects(lstat(generated),{code:'ENOENT'})
})
test('cleanup rejects a substituted key symlink and preserves the external target',async t=>{
 const certificates=await createTestCertificates(),parent=await mkdtemp(join(tmpdir(),'vinyl-cert-link-'))
 const outside=join(parent,'outside'),backup=join(parent,'key-backup')
 t.after(async()=>{await rm(certificates.serverKeyFile,{force:true});await rename(backup,certificates.serverKeyFile);await certificates.cleanup();await rm(parent,{recursive:true,force:true})})
 await writeFile(outside,'external-sentinel')
 await rename(certificates.serverKeyFile,backup);await symlink(outside,certificates.serverKeyFile)
 await assert.rejects(certificates.cleanup(),/Unsafe certificate entry/)
 assert.equal(await readFile(outside,'utf8'),'external-sentinel')
})
test('certificate CLI refuses all caller-supplied path arguments',async t=>{
 const {spawnSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url')
 const parent=await mkdtemp(join(tmpdir(),'vinyl-cert-cli-'));t.after(()=>rm(parent,{recursive:true,force:true}))
 const target=join(parent,'existing');await writeFile(target,'sentinel')
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../test-support/create-test-certificates.js',import.meta.url)),target],{encoding:'utf8'})
 assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.equal(await readFile(target,'utf8'),'sentinel')
})
