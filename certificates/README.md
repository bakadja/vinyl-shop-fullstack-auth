# Azure PostgreSQL public trust anchors

`azure-postgresql-roots.pem` contains public root certificates only, never a private key.
Downloaded 2026-10-15 from the links in Microsoft's [TLS guide](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect):

- Microsoft RSA Root Certificate Authority 2017: https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt (DER converted to PEM)
- DigiCert Global Root G2: https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem

SHA-256 certificate fingerprints (DER, not PEM file hash):

- Microsoft: `C741F70F4B2A8D88BF2E71C14122EF53EF10EBA0CFA5E64CFA20F418853073E0`
- DigiCert: `CB3CCBB76031E5E0138F8DD39A23F9DE47FFC35E43C1144CEA27D46A5AB1CB5F`

Tests pin fingerprints, CA status, self-signatures and expiration. Review Microsoft CA rotation notices before deployment and on a regular maintenance schedule. Update the bundle and fingerprints together only after reviewing the issuing authority's official source. Never substitute a leaf/intermediate certificate, disable hostname checks or use `rejectUnauthorized:false`.
