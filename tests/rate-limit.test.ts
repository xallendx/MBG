import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/lib/db', () => ({ db: { $queryRaw: vi.fn().mockRejectedValue(new Error('db unavailable')) } }))
import { consumeRateLimit } from '../src/lib/rate-limit'
describe('rate limit fail-closed', () => {
  it('menolak permintaan saat penyimpanan limit rusak', async () => {
    await expect(consumeRateLimit('audit', 5, 60000)).rejects.toMatchObject({ status: 503, code: 'RATE_LIMIT_UNAVAILABLE' })
  })
})
