/** Only known browser push services may be contacted by the server. */
export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host === 'notify.windows.com' || host.endsWith('.notify.windows.com')
  } catch { return false }
}
