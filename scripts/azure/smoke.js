try {
  const url = new URL(process.env.HEALTH_URL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/health/ready') throw new Error('Invalid health URL')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) })
  if (response.status !== 200 || response.headers.has('set-cookie') || (await response.json()).status !== 'ok') throw new Error('Unhealthy')
  console.log('Public HTTPS readiness passed')
} catch { console.error('Public HTTPS readiness failed; follow the approved rollback runbook'); process.exitCode = 1 }
