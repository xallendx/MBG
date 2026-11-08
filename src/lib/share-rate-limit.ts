import { ApiError } from './api'
import { clientIp, consumeRateLimit } from './rate-limit'

/** Cap guessing of share codes across preview and import, per account and source. */
export async function limitShareLookup(req: Request, userId: string) {
  const windowMs = 60 * 60 * 1000
  const [user, ip] = await Promise.all([
    consumeRateLimit(`share:user:${userId}`, 60, windowMs),
    consumeRateLimit(`share:ip:${clientIp(req)}`, 200, windowMs),
  ])
  if (!user.allowed || !ip.allowed) throw new ApiError(429, 'Terlalu banyak percobaan kode share. Coba lagi nanti.', 'RATE_LIMITED')
}
