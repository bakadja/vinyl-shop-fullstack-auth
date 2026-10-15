import { cp, lstat, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const directories = ['controllers', 'middleware', 'routes', 'sessions', 'public']
const files = ['server.js', 'package.json', 'package-lock.json', 'db/config.js', 'db/db.js', 'db/values.js', 'certificates/azure-postgresql-roots.pem']
async function assertSafe(path) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Unsafe runtime artifact')
  if (stat.isDirectory()) {
    for (const name of await readdir(path)) {
      if (name.startsWith('.') || !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(name)) throw new Error('Unsafe runtime artifact')
      await assertSafe(join(path, name))
    }
  } else if (!/\.(js|json|html|css|svg|png|ico|pem)$/.test(path)) throw new Error('Unsafe runtime artifact')
}
export async function assembleRuntime(source, destination) {
  const from = resolve(source), to = resolve(destination)
  if (to === from || to.startsWith(from + '/')) throw new Error('Unsafe runtime artifact destination')
  for (const name of [...directories, ...files]) await assertSafe(join(from, name))
  await mkdir(to, { recursive: false })
  for (const name of [...directories, ...files]) await cp(join(from, name), join(to, name), { recursive: true, errorOnExist: true, force: false })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await assembleRuntime(process.cwd(), process.argv[2]) }
  catch { console.error('Runtime package assembly failed'); process.exitCode = 1 }
}
