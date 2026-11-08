/** Only absolute HTTP(S) task links can be opened in the browser. */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname
  } catch { return false }
}
