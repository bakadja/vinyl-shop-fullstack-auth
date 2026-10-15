import { createTestCertificates } from './tls.js'
if (!process.argv[2]) throw new Error('Explicit certificate directory required')
await createTestCertificates(process.argv[2])
