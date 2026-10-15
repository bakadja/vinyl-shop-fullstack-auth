import { createTestCertificates } from './certificates.js'
if (process.argv.length !== 2) throw new Error('Certificate output paths are not accepted')
const certificates = await createTestCertificates()
console.log(certificates.directory)
